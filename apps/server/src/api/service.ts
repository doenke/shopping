import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import {
  categoriesFor,
  CatalogIndex,
  defaultVisibility,
  dueOf,
  listDescription,
  packingInfo,
  withPacking,
  type CatalogKind,
  type ListType,
  findUnit,
  parseInput,
  planAdd,
  type CatalogItem,
  type ItemPatch,
  type ListPatch,
  type NewItem,
} from '@shopping/shared';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { catalogItems, listItems, listMembers, lists, users } from '../db/schema.js';
import type { ImportCandidate } from '../mealie/convert.js';
import type { MealieService } from '../mealie/service.js';
import type { SyncHub } from '../sync/hub.js';
import { toCatalogItem, toItemRow, toListRow } from '../sync/rows.js';
import type { SyncService } from '../sync/service.js';
import { ApiError, notFound } from './errors.js';
import { toApiItem, toApiList, type ApiItem, type ApiList } from './format.js';

/** An item as callers describe it: free text ("2 kg Kartoffeln") or structured. */
export type ItemInput =
  | string
  | {
      name: string;
      quantity?: number | null;
      unit?: string | null;
      properties?: string[];
      note?: string | null;
      category?: string | null;
      /** Packing lists: who it is for, and the Packstück ("Koffer"). */
      person?: string | null;
      container?: string | null;
      /** Merklisten: who the tip is from, and where to find it ("Netflix") – same fields as above. */
      tipFrom?: string | null;
      where?: string | null;
      /** ToDo lists: due date (YYYY-MM-DD), who takes care of it, and the area ("Garten"). */
      due?: string | null;
      assignee?: string | null;
      area?: string | null;
    };

/**
 * Who is acting besides the user: the name of the API token or OAuth client
 * ("Claude", "Home Assistant"). New items remember it ("hinzugefügt über Claude").
 */
export const actorContext = new AsyncLocalStorage<{ via: string | null }>();

export interface AddResult {
  added: { id: string; name: string; specification: string; action: 'created' | 'merged' | 'restored' }[];
}

const REJECTIONS: Record<string, [number, string]> = {
  forbidden: [403, 'Kein Zugriff auf diese Liste'],
  owner_only: [403, 'Nur der Besitzer darf das'],
  template_not_checkable: [409, 'In Vorlagen wird nichts abgehakt'],
  type_mismatch: [409, 'Listentyp passt nicht (Einkaufs- und Packliste)'],
  guest: [403, 'Gäste können keine Listen anlegen'],
};

/**
 * The application's use cases, shared by the REST API and the MCP server.
 * All writes go through the sync engine, so the apps see them in real time.
 */
export class ShoppingApi {
  private catalogCache: { at: number; items: CatalogItem[]; index: Record<ListType, CatalogIndex> } | undefined;

  constructor(
    private readonly db: Db,
    private readonly sync: SyncService,
    private readonly hub: SyncHub,
    private readonly mealie: MealieService,
  ) {
    hub.onCatalogChange(() => this.invalidateCatalog());
  }

  // ---- helpers -------------------------------------------------------------

  private async catalog() {
    if (!this.catalogCache || Date.now() - this.catalogCache.at > 30_000) {
      const items = (await this.db.select().from(catalogItems)).map(toCatalogItem);
      // Groceries and packing items are separate catalogs ("Zahnpasta" exists in both).
      this.catalogCache = {
        at: Date.now(),
        items,
        index: {
          shopping: new CatalogIndex(items.filter((i) => i.kind === 'shopping')),
          packing: new CatalogIndex(items.filter((i) => i.kind === 'packing')),
          // Merklisten have no catalog: entries are whatever you type.
          memo: new CatalogIndex([]),
          todo: new CatalogIndex([]),
        },
      };
    }
    return this.catalogCache;
  }

  invalidateCatalog(): void {
    this.catalogCache = undefined;
  }

  private async mutate(userId: string, entity: 'list' | 'item', changes: { id: string; patch: ListPatch | ItemPatch }[]): Promise<void> {
    if (changes.length === 0) return;
    const via = actorContext.getStore()?.via;
    if (via && entity === 'item') {
      // Only new items (they carry a listId) remember how they were added.
      changes = changes.map((c) =>
        'listId' in c.patch && c.patch.listId ? { ...c, patch: { ...c.patch, attributes: { ...(c.patch as ItemPatch).attributes, via } } } : c,
      );
    }
    const mutations = changes.map((c) => ({ mid: randomUUID(), entity, id: c.id, hlc: this.sync.clock.tick(), patch: c.patch }));
    const result = await this.sync.apply(userId, mutations);
    this.hub.notify(result.affectedUsers);
    const rejected = result.rejected[0];
    if (rejected) {
      const [status, message] = REJECTIONS[rejected.reason] ?? [400, `Abgelehnt: ${rejected.reason}`];
      throw new ApiError(status, rejected.reason, message);
    }
  }

  private async accessibleLists(userId: string) {
    const rows = await this.db
      .select({ list: lists })
      .from(listMembers)
      .innerJoin(lists, eq(lists.id, listMembers.listId))
      .where(and(eq(listMembers.userId, userId), eq(listMembers.removed, false), eq(lists.deleted, false)));
    return rows.map((r) => toListRow(r.list));
  }

  private async mainListId(userId: string): Promise<string | null> {
    const [u] = await this.db.select({ id: users.defaultListId }).from(users).where(eq(users.id, userId));
    return u?.id ?? null;
  }

  /** A list by id, by name (case-insensitive) or "default" for the main list. */
  async resolveList(userId: string, ref: string | undefined, opts: { templates?: boolean } = {}) {
    const all = await this.accessibleLists(userId);
    const want = (l: { isTemplate: boolean }) => (opts.templates === undefined ? true : l.isTemplate === opts.templates);
    if (!ref || ref === 'default') {
      const main = await this.mainListId(userId);
      const list = all.find((l) => l.id === main && !l.isTemplate) ?? all.find((l) => !l.isTemplate);
      if (!list) throw notFound('Hauptliste');
      return list;
    }
    const byId = all.find((l) => l.id === ref);
    if (byId) return byId;
    const byName = all.filter((l) => want(l) && l.name.toLowerCase() === ref.trim().toLowerCase());
    if (byName.length === 1) return byName[0]!;
    if (byName.length > 1) {
      throw new ApiError(409, 'ambiguous', `Mehrere Listen heißen „${ref}“`, { candidates: byName.map((l) => ({ id: l.id, name: l.name })) });
    }
    throw notFound(`Liste „${ref}“`);
  }

  private async userNames(): Promise<Map<string, string>> {
    const rows = await this.db.select({ id: users.id, name: users.displayName }).from(users);
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  private async itemsOf(listId: string) {
    return (await this.db.select().from(listItems).where(and(eq(listItems.listId, listId), eq(listItems.deleted, false)))).map(toItemRow);
  }

  /** An item by id, or by name within a list. */
  async resolveItem(userId: string, ref: string, listRef?: string) {
    const [row] = /^[0-9a-f-]{36}$/i.test(ref) ? await this.db.select().from(listItems).where(eq(listItems.id, ref)) : [];
    if (row && !row.deleted) {
      if (!(await this.sync.isMember(userId, row.listId))) throw notFound('Artikel');
      return toItemRow(row);
    }
    const list = await this.resolveList(userId, listRef);
    const items = await this.itemsOf(list.id);
    const name = ref.trim().toLowerCase();
    const matches = items.filter((i) => i.name.toLowerCase() === name);
    // Prefer the open one ("Milch abhaken" means the milk still to buy).
    const open = matches.filter((i) => !i.checked);
    const pick = open.length === 1 ? open[0] : matches.length === 1 ? matches[0] : undefined;
    if (pick) return pick;
    if (matches.length > 1) throw new ApiError(409, 'ambiguous', `Mehrere Artikel heißen „${ref}“`, { candidates: matches.map((i) => i.id) });
    const fuzzy = (await this.catalog()).index[list.listType].match(ref);
    const viaCatalog = fuzzy ? items.find((i) => i.catalogItemId === fuzzy.id && !i.checked) : undefined;
    if (viaCatalog) return viaCatalog;
    throw notFound(`Artikel „${ref}“`);
  }

  async toNewItems(inputs: ItemInput[], listType: ListType = 'shopping'): Promise<NewItem[]> {
    const index = (await this.catalog()).index[listType];
    const categories = categoriesFor(listType);
    const out: NewItem[] = [];
    for (const input of inputs) {
      if (typeof input === 'string') {
        out.push(...parseInput(input, index));
        continue;
      }
      const hit = index.match(input.name);
      const category = input.category ? categories.find((c) => c.id === input.category || c.name.toLowerCase() === input.category!.toLowerCase()) : undefined;
      const unit = input.unit ? (findUnit(input.unit)?.id ?? input.unit) : null;
      out.push({
        name: hit?.name ?? input.name.trim(),
        catalogItemId: hit?.id ?? null,
        categoryId: category?.id ?? hit?.categoryId ?? null,
        amounts: input.quantity || unit ? [{ q: input.quantity ?? null, u: unit }] : [],
        properties: input.properties ?? [],
        note: input.note ?? null,
        person: (input.person ?? input.tipFrom ?? input.assignee)?.trim() || null,
        container: (input.container ?? input.where ?? input.area)?.trim() || null,
        due: input.due ?? null,
      });
    }
    return out;
  }

  // ---- reads ---------------------------------------------------------------

  async lists(
    userId: string,
    templates: 'exclude' | 'include' | 'only' = 'exclude',
    opts: { type?: ListType; archived?: boolean } = {},
  ): Promise<ApiList[]> {
    const all = (await this.accessibleLists(userId)).filter(
      (l) =>
        (templates === 'include' ? true : templates === 'only' ? l.isTemplate : !l.isTemplate) &&
        (!opts.type || l.listType === opts.type) &&
        (opts.archived || !l.archivedAt),
    );
    const main = await this.mainListId(userId);
    const counts = new Map<string, number>();
    if (all.length) {
      const items = await this.db
        .select({ listId: listItems.listId })
        .from(listItems)
        .where(and(inArray(listItems.listId, all.map((l) => l.id)), eq(listItems.deleted, false), eq(listItems.checked, false)));
      for (const i of items) counts.set(i.listId, (counts.get(i.listId) ?? 0) + 1);
    }
    return all
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((l) => toApiList(l, userId, main, counts.get(l.id) ?? 0));
  }

  async list(userId: string, ref: string | undefined, filter: 'open' | 'done' | 'all' = 'open'): Promise<ApiList & { items: ApiItem[] }> {
    const list = await this.resolveList(userId, ref);
    const items = await this.itemsOf(list.id);
    const names = await this.userNames();
    const categories = categoriesFor(list.listType);
    const rank = (id: string | null) => {
      const i = categories.findIndex((c) => c.id === id);
      return i < 0 ? categories.length : i;
    };
    // ToDo lists: by due date (none last), then position.
    const byDue = (a: (typeof items)[number], b: (typeof items)[number]) => (dueOf(a) ?? '9999').localeCompare(dueOf(b) ?? '9999');
    const shown = items
      .filter((i) => (filter === 'all' ? true : filter === 'open' ? !i.checked : i.checked))
      .sort((a, b) =>
        list.listType === 'todo' ? byDue(a, b) || a.position.localeCompare(b.position) : rank(a.categoryId) - rank(b.categoryId) || a.position.localeCompare(b.position),
      );
    return {
      ...toApiList(list, userId, await this.mainListId(userId), items.filter((i) => !i.checked).length),
      items: shown.map((i) => toApiItem(i, names, list.listType)),
    };
  }

  async item(userId: string, ref: string, listRef?: string): Promise<ApiItem> {
    return toApiItem(await this.resolveItem(userId, ref, listRef), await this.userNames());
  }

  /** Recently bought items – good suggestions for "what do we usually buy?". */
  async history(userId: string, listRef: string | undefined, limit = 30): Promise<ApiItem[]> {
    const list = await this.resolveList(userId, listRef);
    const rows = await this.db
      .select()
      .from(listItems)
      .where(and(eq(listItems.listId, list.id), eq(listItems.checked, true), eq(listItems.deleted, false)))
      .orderBy(desc(listItems.checkedAt))
      .limit(limit);
    const names = await this.userNames();
    return rows.map((r) => toApiItem(toItemRow(r), names));
  }

  async searchCatalog(q: string, limit = 15, kind: CatalogKind = 'shopping') {
    const index = (await this.catalog()).index[kind];
    return index.search(q, limit).map((c) => ({ id: c.id, name: c.name, category: c.categoryId, aliases: c.aliases }));
  }

  async parse(text: string, kind: CatalogKind = 'shopping') {
    return parseInput(text, (await this.catalog()).index[kind]);
  }

  // ---- writes --------------------------------------------------------------

  /** A new list; from a template it takes the template's type (packing template → packing list). */
  async createList(
    userId: string,
    name: string,
    opts: { template?: string; isTemplate?: boolean; type?: ListType; description?: string | null; private?: boolean } = {},
  ): Promise<ApiList> {
    const template = opts.template ? await this.resolveList(userId, opts.template, { templates: true }) : undefined;
    if (template && !template.isTemplate) throw new ApiError(400, 'not_a_template', `„${template.name}“ ist keine Vorlage`);
    const listType = template?.listType ?? opts.type ?? 'shopping';
    const id = randomUUID();
    const description = opts.description?.trim() || (template ? listDescription(template) : null);
    await this.mutate(userId, 'list', [
      {
        id,
        patch: {
          name,
          listType,
          isTemplate: opts.isTemplate ?? false,
          visibility: opts.private === undefined ? defaultVisibility(listType) : opts.private ? 'private' : 'household',
          ...(description ? { settings: { description } } : {}),
        },
      },
    ]);
    if (template) await this.applyTemplate(userId, id, template.id, false);
    return (await this.lists(userId, 'include', { archived: true })).find((l) => l.id === id)!;
  }

  /** Shared with the whole household, or private (owner only). */
  async setVisibility(userId: string, ref: string, visibility: 'household' | 'private'): Promise<void> {
    const list = await this.resolveList(userId, ref);
    await this.mutate(userId, 'list', [{ id: list.id, patch: { visibility } }]);
  }

  /** Done packing lists are archived instead of deleted. */
  async archiveList(userId: string, ref: string, archived: boolean): Promise<void> {
    const list = await this.resolveList(userId, ref);
    await this.mutate(userId, 'list', [{ id: list.id, patch: { archivedAt: archived ? new Date().toISOString() : null } }]);
  }

  async renameList(userId: string, ref: string, name: string): Promise<void> {
    const list = await this.resolveList(userId, ref);
    await this.mutate(userId, 'list', [{ id: list.id, patch: { name } }]);
  }

  /** What the list is about – Merklisten use it for the icons ("Filme, die wir sehen wollen"). */
  async describeList(userId: string, ref: string, description: string | null): Promise<void> {
    const list = await this.resolveList(userId, ref);
    const settings = { ...list.settings };
    if (description?.trim()) settings.description = description.trim();
    else delete settings.description;
    await this.mutate(userId, 'list', [{ id: list.id, patch: { settings } }]);
  }

  async deleteList(userId: string, ref: string): Promise<void> {
    const list = await this.resolveList(userId, ref);
    await this.mutate(userId, 'list', [{ id: list.id, patch: { deleted: true } }]);
  }

  async addItems(userId: string, listRef: string | undefined, inputs: NewItem[] | ItemInput[], parsed = false): Promise<AddResult> {
    const list = await this.resolveList(userId, listRef);
    const items = parsed ? (inputs as NewItem[]) : await this.toNewItems(inputs as ItemInput[], list.listType);
    if (items.length === 0) throw new ApiError(400, 'empty', 'Keine Artikel erkannt');
    const existing = await this.itemsOf(list.id);
    const plan = planAdd(list.id, existing, items, randomUUID);
    await this.mutate(userId, 'item', plan);
    const after = new Map((await this.itemsOf(list.id)).map((i) => [i.id, i]));
    const names = await this.userNames();
    return {
      added: plan
        .map((c) => ({ c, row: after.get(c.id) }))
        .filter((x) => x.row)
        .map(({ c, row }) => ({ id: row!.id, name: row!.name, specification: toApiItem(row!, names).specification, action: c.kind })),
    };
  }

  async updateItem(userId: string, ref: string, input: Partial<Exclude<ItemInput, string>> & { checked?: boolean }, listRef?: string): Promise<ApiItem> {
    const item = await this.resolveItem(userId, ref, listRef);
    const patch: ItemPatch = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.quantity !== undefined || input.unit !== undefined) {
      const q = input.quantity !== undefined ? input.quantity : (item.amounts[0]?.q ?? null);
      const u = input.unit !== undefined ? (input.unit ? (findUnit(input.unit)?.id ?? input.unit) : null) : (item.amounts[0]?.u ?? null);
      patch.amounts = q !== null || u !== null ? [{ q, u }, ...item.amounts.slice(1)] : item.amounts.slice(1);
    }
    if (input.properties !== undefined) patch.properties = input.properties;
    if (input.note !== undefined) patch.note = input.note;
    const person = input.person !== undefined ? input.person : input.tipFrom !== undefined ? input.tipFrom : input.assignee;
    const container = input.container !== undefined ? input.container : input.where !== undefined ? input.where : input.area;
    if (person !== undefined || container !== undefined || input.due !== undefined) {
      patch.attributes = withPacking(item.attributes, {
        ...(person !== undefined ? { person } : {}),
        ...(container !== undefined ? { container } : {}),
      });
      if (input.due !== undefined) {
        if (input.due) patch.attributes.due = input.due;
        else delete patch.attributes.due;
      }
    }
    if (input.category !== undefined) {
      const list = (await this.accessibleLists(userId)).find((l) => l.id === item.listId);
      const cat = categoriesFor(list?.listType ?? 'shopping').find((c) => c.id === input.category || c.name.toLowerCase() === input.category?.toLowerCase());
      if (!cat) throw new ApiError(400, 'unknown_category', `Unbekannte Kategorie „${input.category}“`);
      patch.categoryId = cat.id;
    }
    if (input.checked !== undefined) patch.checked = input.checked;
    await this.mutate(userId, 'item', [{ id: item.id, patch }]);
    return this.item(userId, item.id);
  }

  async setChecked(userId: string, refs: string[], checked: boolean, listRef?: string): Promise<ApiItem[]> {
    const items = [];
    for (const ref of refs) items.push(await this.resolveItem(userId, ref, listRef));
    await this.mutate(userId, 'item', items.map((i) => ({ id: i.id, patch: { checked } })));
    const names = await this.userNames();
    return Promise.all(items.map(async (i) => toApiItem((await this.resolveItem(userId, i.id)) ?? i, names)));
  }

  async removeItems(userId: string, refs: string[], listRef?: string): Promise<number> {
    const items = [];
    for (const ref of refs) items.push(await this.resolveItem(userId, ref, listRef));
    await this.mutate(userId, 'item', items.map((i) => ({ id: i.id, patch: { deleted: true } })));
    return items.length;
  }

  async clearChecked(userId: string, listRef: string | undefined): Promise<number> {
    const list = await this.resolveList(userId, listRef);
    const done = (await this.itemsOf(list.id)).filter((i) => i.checked);
    await this.mutate(userId, 'item', done.map((i) => ({ id: i.id, patch: { deleted: true } })));
    return done.length;
  }

  async applyTemplate(userId: string, listRef: string | undefined, templateRef: string, includeOptional: boolean): Promise<AddResult> {
    const template = await this.resolveList(userId, templateRef, { templates: true });
    if (!template.isTemplate) throw new ApiError(400, 'not_a_template', `„${template.name}“ ist keine Vorlage`);
    const target = await this.resolveList(userId, listRef);
    if (target.listType !== template.listType) throw new ApiError(409, 'type_mismatch', REJECTIONS.type_mismatch![1]);
    const items = (await this.itemsOf(template.id))
      .filter((i) => includeOptional || !i.optional)
      .map<NewItem>((i) => ({
        name: i.name,
        catalogItemId: i.catalogItemId,
        categoryId: i.categoryId,
        amounts: i.amounts,
        properties: i.properties,
        note: i.note,
        ...packingInfo(i),
        sources: [{ type: 'template', label: template.name }],
      }));
    if (items.length === 0) return { added: [] };
    return this.addItems(userId, listRef, items, true);
  }

  private candidatesToItems(items: ImportCandidate[], includePantry: boolean, type: 'mealie_recipe' | 'mealie_mealplan'): NewItem[] {
    return items
      .filter((c) => includePantry || !c.pantry)
      .map(({ pantry: _p, sources, ...rest }) => ({ ...rest, sources: sources.map((label) => ({ type, label })) }));
  }

  private async shoppingOnly(userId: string, listRef: string | undefined): Promise<void> {
    const list = await this.resolveList(userId, listRef);
    if (list.listType !== 'shopping') throw new ApiError(409, 'type_mismatch', 'Mealie-Rezepte gehören auf eine Einkaufsliste');
  }

  async importRecipe(userId: string, listRef: string | undefined, slug: string, servings: number | undefined, includePantry: boolean) {
    await this.shoppingOnly(userId, listRef);
    const r = await this.mealie.recipeCandidates(userId, slug, servings);
    const res = await this.addItems(userId, listRef, this.candidatesToItems(r.items, includePantry, 'mealie_recipe'), true);
    return { recipe: r.name, servings: r.servings, ...res };
  }

  async importMealplan(userId: string, listRef: string | undefined, from: string, to: string, includePantry: boolean) {
    await this.shoppingOnly(userId, listRef);
    const r = await this.mealie.mealplanCandidates(userId, from, to);
    if (r.items.length === 0) return { recipes: r.recipes, added: [] };
    const res = await this.addItems(userId, listRef, this.candidatesToItems(r.items, includePantry, 'mealie_mealplan'), true);
    return { recipes: r.recipes, ...res };
  }

  async searchRecipes(userId: string, q: string) {
    const { client } = await this.mealie.clientFor(userId);
    return (await client.searchRecipes(q)).map((r) => ({ slug: r.slug, name: r.name ?? r.slug, servings: r.recipeServings || null }));
  }
}
