import { randomBytes, randomUUID } from 'node:crypto';
import { generateKeyBetween, type ItemSource } from '@shopping/shared';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { SecretBox } from '../crypto.js';
import type { Db } from '../db/index.js';
import { stableUuid } from '../db/seed.js';
import { catalogItems, integrations, listItems } from '../db/schema.js';
import type { SyncHub } from '../sync/hub.js';
import { toCatalogItem } from '../sync/rows.js';
import type { SyncService } from '../sync/service.js';
import { MealieClient, MealieError, type MealieShoppingItem } from './client.js';
import { Converter, mergeCandidates, type ImportCandidate } from './convert.js';

export interface InboxConfig {
  enabled: boolean;
  /** Mealie shopping list acting as inbox. */
  mealieListId?: string;
  /** Shopping list the items go to. */
  targetListId?: string;
  /** Secret path segment of the webhook URL. */
  webhookSecret?: string;
}

export interface MealieConfig {
  url?: string;
  /** Sealed with SecretBox. */
  token?: string;
  labelMapping?: Record<string, string>;
  labels?: string[];
  inbox?: InboxConfig;
}

type IntegrationRow = typeof integrations.$inferSelect;

export interface InboxResult {
  added: number;
  skipped: number;
}

const POLL_MINUTES = 15;

export class MealieService {
  private readonly running = new Map<string, Promise<InboxResult>>();
  private readonly rerun = new Set<string>();
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly db: Db,
    private readonly secrets: SecretBox,
    private readonly sync: SyncService,
    private readonly hub: SyncHub,
    private readonly log: FastifyBaseLogger,
    private readonly fetchImpl?: typeof fetch,
  ) {}

  // ---- configuration ------------------------------------------------------

  async load(userId: string): Promise<IntegrationRow | undefined> {
    const [row] = await this.db
      .select()
      .from(integrations)
      .where(and(eq(integrations.ownerId, userId), eq(integrations.type, 'mealie')));
    return row;
  }

  config(row: IntegrationRow | undefined): MealieConfig {
    return (row?.config ?? {}) as MealieConfig;
  }

  async save(userId: string, update: (prev: MealieConfig) => MealieConfig): Promise<MealieConfig> {
    const prev = this.config(await this.load(userId));
    const next = update(prev);
    if (next.inbox && !next.inbox.webhookSecret) next.inbox = { ...next.inbox, webhookSecret: randomBytes(24).toString('base64url') };
    await this.db
      .insert(integrations)
      .values({ ownerId: userId, type: 'mealie', config: next as Record<string, unknown> })
      .onConflictDoUpdate({ target: [integrations.ownerId, integrations.type], set: { config: next as Record<string, unknown> } });
    return next;
  }

  async setStatus(id: string, status: string, synced = false): Promise<void> {
    await this.db
      .update(integrations)
      .set({ status, ...(synced ? { lastSyncAt: new Date() } : {}) })
      .where(eq(integrations.id, id));
  }

  client(cfg: MealieConfig): MealieClient {
    if (!cfg.url || !cfg.token) throw new MealieError('Mealie ist noch nicht eingerichtet');
    return new MealieClient(cfg.url, this.secrets.open(cfg.token), this.fetchImpl);
  }

  async clientFor(userId: string): Promise<{ client: MealieClient; cfg: MealieConfig; row: IntegrationRow }> {
    const row = await this.load(userId);
    const cfg = this.config(row);
    return { client: this.client(cfg), cfg, row: row! };
  }

  private async converter(cfg: MealieConfig): Promise<Converter> {
    const catalog = (await this.db.select().from(catalogItems).where(eq(catalogItems.kind, 'shopping'))).map(toCatalogItem);
    return new Converter(catalog, cfg.labelMapping ?? {});
  }

  // ---- inbox (Mealie shopping list → Shopping, then checked off in Mealie) ---

  /** Called by the Mealie notifier. The payload is only a hint; we always re-read the list. */
  async webhook(secret: string): Promise<boolean> {
    const [row] = await this.db
      .select()
      .from(integrations)
      .where(and(eq(integrations.type, 'mealie'), sql`${integrations.config} -> 'inbox' ->> 'webhookSecret' = ${secret}`));
    if (!row || !this.config(row).inbox?.enabled) return false;
    void this.runInbox(row.id).catch(() => undefined);
    return true;
  }

  /**
   * Runs the inbox for one integration. Concurrent triggers (several webhooks
   * for one recipe) collapse into at most one follow-up run.
   */
  runInbox(integrationId: string): Promise<InboxResult> {
    const current = this.running.get(integrationId);
    if (current) {
      this.rerun.add(integrationId);
      return current;
    }
    const run = (async () => {
      let result: InboxResult = { added: 0, skipped: 0 };
      do {
        this.rerun.delete(integrationId);
        const r = await this.inboxOnce(integrationId);
        result = { added: result.added + r.added, skipped: result.skipped + r.skipped };
      } while (this.rerun.has(integrationId));
      return result;
    })().finally(() => this.running.delete(integrationId));
    this.running.set(integrationId, run);
    return run;
  }

  private async inboxOnce(integrationId: string): Promise<InboxResult> {
    const [row] = await this.db.select().from(integrations).where(eq(integrations.id, integrationId));
    const cfg = this.config(row);
    const inbox = cfg.inbox;
    if (!row || !inbox?.enabled || !inbox.mealieListId || !inbox.targetListId) return { added: 0, skipped: 0 };

    try {
      const client = this.client(cfg);
      const list = await client.shoppingList(inbox.mealieListId);
      const open = list.listItems.filter((i) => !i.checked);
      if (open.length === 0) {
        await this.setStatus(row.id, 'Eingangskorb leer', true);
        return { added: 0, skipped: 0 };
      }

      const recipeNames = new Map(
        (list.recipeReferences ?? []).filter((r) => r.recipe?.name).map((r) => [r.recipeId, r.recipe!.name!]),
      );
      const converter = await this.converter(cfg);
      const ids = open.map((i) => stableUuid('mealie-inbox', i.id));
      const existing = new Set(
        (await this.db.select({ id: listItems.id }).from(listItems).where(inArray(listItems.id, ids))).map((r) => r.id),
      );
      let position = await this.lastPosition(inbox.targetListId);

      const mutations: unknown[] = [];
      const taken: MealieShoppingItem[] = [];
      let skipped = 0;
      for (const item of open) {
        const id = stableUuid('mealie-inbox', item.id);
        // Already taken over earlier, only the tick in Mealie failed: just tick it now.
        if (existing.has(id)) {
          taken.push(item);
          continue;
        }
        const candidate = converter.convert(item, item.display || item.note, { keepNote: true });
        if (!candidate) {
          skipped++;
          continue;
        }
        const recipes = (item.recipeReferences ?? []).map((r) => recipeNames.get(r.recipeId)).filter((n): n is string => !!n);
        const sources: ItemSource[] = recipes.length
          ? recipes.map((label) => ({ type: 'mealie_recipe', label }))
          : [{ type: 'mealie_list', label: list.name ?? 'Mealie' }];
        position = generateKeyBetween(position, null);
        mutations.push({
          mid: randomUUID(),
          entity: 'item',
          id,
          hlc: this.sync.clock.tick(),
          patch: {
            listId: inbox.targetListId,
            name: candidate.name,
            catalogItemId: candidate.catalogItemId,
            categoryId: candidate.categoryId,
            amounts: candidate.amounts,
            properties: candidate.properties,
            note: candidate.note,
            position,
            attributes: { sources },
          },
        });
        taken.push(item);
      }

      let added = 0;
      if (mutations.length) {
        const result = await this.sync.apply(row.ownerId, mutations);
        this.hub.notify(result.affectedUsers);
        if (result.rejected.length) {
          throw new MealieError(`Zielliste nimmt keine Artikel an (${result.rejected[0]!.reason})`);
        }
        added = result.acked.length;
      }

      // Tick off in Mealie, like the n8n flow did.
      if (taken.length) await client.updateShoppingItems(taken.map((i) => ({ ...i, checked: true })));
      await this.setStatus(row.id, `${added} Artikel aus Mealie übernommen`, true);
      return { added, skipped };
    } catch (err) {
      const message = err instanceof MealieError ? err.message : 'unerwarteter Fehler';
      if (!(err instanceof MealieError)) this.log.error({ err }, 'mealie inbox failed');
      await this.setStatus(row.id, `Fehler: ${message}`);
      throw err;
    }
  }

  private async lastPosition(listId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ position: listItems.position })
      .from(listItems)
      .where(eq(listItems.listId, listId))
      .orderBy(desc(listItems.position))
      .limit(1);
    return row?.position ?? null;
  }

  /** Safety net for lost webhooks: poll every inbox regularly. */
  startScheduler(): void {
    const tick = async () => {
      const rows = await this.db
        .select({ id: integrations.id })
        .from(integrations)
        .where(and(eq(integrations.type, 'mealie'), sql`(${integrations.config} -> 'inbox' ->> 'enabled')::boolean IS TRUE`));
      for (const r of rows) await this.runInbox(r.id).catch(() => undefined);
    };
    setTimeout(() => void tick().catch(() => undefined), 30_000).unref();
    this.timer = setInterval(() => void tick().catch(() => undefined), POLL_MINUTES * 60_000);
    this.timer.unref();
  }

  stop(): void {
    clearInterval(this.timer);
  }

  // ---- recipes & meal plan -------------------------------------------------

  async recipeCandidates(userId: string, slug: string, servings?: number) {
    const { client, cfg } = await this.clientFor(userId);
    const recipe = await client.recipe(slug);
    const base = recipe.recipeServings || recipe.recipeYieldQuantity || 0;
    const scale = servings && base ? servings / base : 1;
    const converter = await this.converter(cfg);
    const name = recipe.name ?? slug;
    const items = recipe.recipeIngredient
      .map((ing) => converter.convert(ing, ing.originalText ?? ing.display, { keepNote: false, scale }))
      .filter((c): c is ImportCandidate => !!c)
      .map((c) => ({ ...c, sources: [name] }));
    return { name, slug: recipe.slug, servings: servings ?? (base || null), items: mergeCandidates(items) };
  }

  async mealplanCandidates(userId: string, from: string, to: string) {
    const { client } = await this.clientFor(userId);
    const entries = (await client.mealplan(from, to)).filter((e) => e.recipe?.slug);
    const all: ImportCandidate[] = [];
    const recipes: { date: string; name: string }[] = [];
    for (const e of entries) {
      const base = e.recipe!.recipeServings || 0;
      const scale = e.recipeScale && e.recipeScale > 0 ? e.recipeScale : 1;
      const r = await this.recipeCandidates(userId, e.recipe!.slug, base ? base * scale : undefined);
      recipes.push({ date: e.date, name: r.name });
      all.push(...r.items);
    }
    return { recipes, items: mergeCandidates(all) };
  }
}
