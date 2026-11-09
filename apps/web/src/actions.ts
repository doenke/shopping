import {
  categoriesFor,
  defaultVisibility,
  listTemplateIds,
  listAsText,
  nextCategoryColor,
  type CategoryPatch,
  type CustomCategoryType,
  packingInfo,
  planAdd,
  isForEach,
  linkLabel,
  itemPersons,
  listPersons,
  peopleKey,
  peopleOnItems,
  resolvePeople,
  type CatalogItem,
  type ItemPatch,
  type ItemRow,
  type ListRow,
  type ListType,
  type NewItem,
  type ParsedItem,
  type ResetEvery,
  type ListStatus,
  type SectionKey,
} from '@shopping/shared';
import { db } from './db';
import { sync } from './sync/engine';

export type { NewItem };

/**
 * Adds parsed items to a list (see planAdd): open items get
 * the amount added, recently bought ones come back, the rest is new.
 */
export async function addItems(listId: string, parsed: NewItem[]): Promise<void> {
  const existing = await db.items.where('listId').equals(listId).toArray();
  // "@alle" / "für jeden": everyone the list is made for (or who is on it already); templates keep "für jeden".
  const list = await db.lists.get(listId);
  const persons = list && listPersons(list).length ? listPersons(list) : peopleOnItems(existing);
  const resolved = parsed.map((p) => resolvePeople(p, { isTemplate: !!list?.isTemplate, persons }));
  const changes = planAdd(listId, existing, resolved, () => crypto.randomUUID());
  await sync.mutateItems(changes.map(({ id, patch }) => ({ id, patch })));
}

/** The page title for a link (best effort: offline or without a title the site's name stays). */
export async function linkTitle(url: string): Promise<string | null> {
  const res = await fetch(`/api/v1/links/title?url=${encodeURIComponent(url)}`).catch(() => null);
  if (!res?.ok) return null;
  const body = (await res.json().catch(() => null)) as { title?: string | null } | null;
  return body?.title?.trim() || null;
}

/**
 * Adds a link as an entry: with the typed/shared name, else named after the page's title.
 * "Dune: Part Two | Netflix" stays as it is – the name can be edited later.
 */
export async function addLink(listId: string, url: string, name?: string | null, extra: Partial<NewItem> = {}): Promise<void> {
  const title = name?.trim() || (await linkTitle(url)) || linkLabel(url);
  await addItems(listId, [{ name: title, catalogItemId: null, categoryId: null, amounts: [], properties: [], note: null, url, ...extra }]);
}

export function catalogToParsed(c: CatalogItem): ParsedItem {
  return { name: c.name, catalogItemId: c.id, categoryId: c.categoryId, amounts: [], properties: [], note: null };
}

export async function setChecked(item: ItemRow, checked: boolean): Promise<void> {
  await sync.mutateItem(item.id, { checked });
}

/** Multi-person items: tick off (or untick) single people, e.g. { Ulli: true }. */
export async function setPersonChecked(item: ItemRow, checks: Record<string, boolean>): Promise<void> {
  await sync.mutateItem(item.id, { personChecks: checks });
}

/** Who a list is for ("Für wen packen wir?"), used for "@alle" / "für jeden". */
export async function setListPersons(list: ListRow, persons: string[]): Promise<void> {
  const settings = { ...list.settings };
  if (persons.length) settings.persons = persons;
  else delete settings.persons;
  await sync.mutateList(list.id, { settings });
}

export async function updateItem(id: string, patch: ItemPatch): Promise<void> {
  await sync.mutateItem(id, patch);
}

export async function deleteItem(id: string): Promise<void> {
  await sync.mutateItem(id, { deleted: true });
}

/** "Rückgängig" after deleting: the item comes back with all its fields (the local copy may be gone already). */
export async function restoreItem(item: ItemRow): Promise<void> {
  await sync.mutateItem(item.id, {
    listId: item.listId,
    name: item.name,
    catalogItemId: item.catalogItemId,
    categoryId: item.categoryId,
    amounts: item.amounts,
    properties: item.properties,
    note: item.note,
    position: item.position,
    optional: item.optional,
    attributes: item.attributes,
    checked: item.checked,
    deleted: false,
  });
}

export async function createList(
  name: string,
  isTemplate = false,
  listType: ListType = 'shopping',
  description?: string | null,
  visibility: 'household' | 'private' = defaultVisibility(listType),
  /** The templates it came from – the first one is preselected later in "Mit Vorlage abgleichen". */
  templateIds: string[] = [],
  /** ToDo lists: Kategorie (Arbeit, Hobby …). */
  group?: string,
  /** Recurring checklist: open again every day/week/month. */
  reset?: ResetEvery | null,
  /** Who the list is for ("für jeden" in templates becomes these people). */
  persons: string[] = [],
): Promise<string> {
  const id = crypto.randomUUID();
  const settings: Record<string, unknown> = {};
  if (description?.trim()) settings.description = description.trim();
  if (templateIds.length) {
    settings.templateId = templateIds[0];
    settings.templateIds = templateIds;
  }
  if (group?.trim()) settings.group = group.trim();
  if (reset) settings.reset = reset;
  if (persons.length) settings.persons = persons;
  await sync.mutateList(id, { name, listType, isTemplate, visibility, ...(Object.keys(settings).length ? { settings } : {}) });
  return id;
}

/** Kategorie of a ToDo list; empty = none. */
export async function setListGroup(list: ListRow, group: string): Promise<void> {
  const settings = { ...list.settings };
  if (group.trim()) settings.group = group.trim();
  else delete settings.group;
  await sync.mutateList(list.id, { settings });
}

/** What the list is about (Merklisten: also guides the icons). */
export async function describeList(list: ListRow, description: string): Promise<void> {
  const settings = { ...list.settings };
  if (description.trim()) settings.description = description.trim();
  else delete settings.description;
  await sync.mutateList(list.id, { settings });
}

/** Shared with the whole household, or only for me. */
export async function setVisibility(id: string, visibility: 'household' | 'private'): Promise<void> {
  await sync.mutateList(id, { visibility });
}

/** Done packing lists go to the archive instead of being deleted. */
export async function archiveList(id: string, archived: boolean): Promise<void> {
  await sync.mutateList(id, { archivedAt: archived ? new Date().toISOString() : null });
}

/** A list or template item as new item (keeps person and Packstück). */
/** "Nicht mehr fragen": no question about the templates after adding something to this list. */
export async function stopAskingForTemplates(list: ListRow): Promise<void> {
  await sync.mutateList(list.id, { settings: { ...list.settings, askTemplates: false } });
}

/**
 * Templates of the list that do not have these things yet (same catalog item or name, and for packing
 * lists the same person and container) – the candidates for "auch in die Vorlage?".
 */
export async function templatesMissing(list: ListRow, items: NewItem[]): Promise<{ template: ListRow; items: NewItem[] }[]> {
  const ids = listTemplateIds(list);
  if (!ids.length || !items.length) return [];
  const templates = (await db.lists.bulkGet(ids)).filter((t): t is ListRow => !!t && !t.deleted && t.isTemplate);
  const out: { template: ListRow; items: NewItem[] }[] = [];
  for (const template of templates) {
    const have = (await db.items.where('listId').equals(template.id).toArray()).filter((i) => !i.deleted);
    const missing = items.filter(
      (n) =>
        !have.some((h) => {
          const same = n.catalogItemId ? h.catalogItemId === n.catalogItemId : h.name.trim().toLowerCase() === n.name.trim().toLowerCase();
          const container = (packingInfo(h).container ?? '').toLowerCase() === (n.container ?? '').toLowerCase();
          const many = n.forEach || (n.persons?.length ?? 0) >= 2;
          return same && container && peopleKey(h) === (many ? '*' : (n.person ?? '').toLowerCase());
        }),
    );
    if (missing.length) out.push({ template, items: missing });
  }
  return out;
}

export function itemToNew(i: ItemRow): NewItem {
  return {
    name: i.name,
    catalogItemId: i.catalogItemId,
    categoryId: i.categoryId,
    amounts: i.amounts,
    properties: i.properties,
    note: i.note,
    ...packingInfo(i),
    ...(itemPersons(i).length ? { persons: itemPersons(i) } : {}),
    ...(isForEach(i) ? { forEach: true } : {}),
  };
}

/** "Als Vorlage speichern": copies the open items of a list into a new template. */
export async function saveAsTemplate(list: ListRow, name: string): Promise<string> {
  const id = await createList(name, true, list.listType);
  // A packing list is all packed in the end – everything goes into the template.
  const items = (await db.items.where('listId').equals(list.id).toArray()).filter((i) => !i.deleted && (list.listType === 'packing' || !i.checked));
  await addItems(id, items.map(itemToNew));
  return id;
}

/** Name, description and (ToDo lists) Kategorie in one change – one settings patch, nothing overwrites the other. */
export async function editList(
  list: ListRow,
  edit: { name: string; description: string; group?: string; reset?: ResetEvery | null; askTemplates?: boolean; statuses?: ListStatus[] },
): Promise<void> {
  const settings = { ...list.settings };
  if (edit.description.trim()) settings.description = edit.description.trim();
  else delete settings.description;
  if (edit.group !== undefined) {
    if (edit.group.trim()) settings.group = edit.group.trim();
    else delete settings.group;
  }
  if (edit.askTemplates !== undefined) {
    if (edit.askTemplates) delete settings.askTemplates;
    else settings.askTemplates = false;
  }
  if (edit.statuses !== undefined) {
    const statuses = edit.statuses.map((st) => ({ id: st.id, name: st.name.trim() })).filter((st) => st.name);
    if (statuses.length) settings.statuses = statuses;
    else delete settings.statuses;
  }
  if (edit.reset !== undefined) {
    if (edit.reset) settings.reset = edit.reset;
    else delete settings.reset;
  }
  const patch: { name?: string; settings?: Record<string, unknown> } = {};
  if (edit.name.trim() && edit.name.trim() !== list.name) patch.name = edit.name.trim();
  if (JSON.stringify(settings) !== JSON.stringify(list.settings)) patch.settings = settings;
  if (patch.name || patch.settings) await sync.mutateList(list.id, patch);
}

/** A new icon for the list, drawn from its name and description. */
export async function newListIcon(listId: string): Promise<boolean> {
  const res = await fetch('/api/v1/icons/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ targetType: 'list', targetId: listId }),
  }).catch(() => null);
  return !!res?.ok;
}

export async function renameList(id: string, name: string): Promise<void> {
  await sync.mutateList(id, { name });
}

export async function deleteList(id: string): Promise<void> {
  await sync.mutateList(id, { deleted: true });
}

export async function setMainList(id: string): Promise<void> {
  await sync.mutateMe({ defaultListId: id });
}

/** Own order of one list type's categories; the other types' order is kept. */
export async function setCategoryOrder(listType: ListType, ids: string[], current: readonly string[] = []): Promise<void> {
  const own = new Set(categoriesFor(listType, await db.categories.toArray()).map((c) => c.id));
  await sync.mutateMe({ categoryOrder: [...ids, ...current.filter((id) => !own.has(id))] });
}

/** A category of one's own (shared with the household); returns its id. */
export async function createCategory(listType: CustomCategoryType, name: string): Promise<string> {
  const id = crypto.randomUUID();
  await sync.mutateCategory(id, { listType, name: name.trim(), color: nextCategoryColor(listType, await db.categories.toArray()) });
  return id;
}

/** Rename, recolour or delete an own category (its items then show under "Sonstiges"). */
export async function editCategory(id: string, patch: Omit<CategoryPatch, 'listType'>): Promise<void> {
  await sync.mutateCategory(id, patch);
}

/** Own order of the sidebar sections (shopping, packing, memo, todo, templates). */
export async function setSectionOrder(keys: SectionKey[]): Promise<void> {
  await sync.mutateMe({ sectionOrder: keys });
}

/** Own order of the lists in the sidebar. */
export async function setListOrder(ids: string[]): Promise<void> {
  await sync.mutateMe({ listOrder: ids });
}

/** "Alle als erledigt markieren": checks every open item of a list; returns how many. */
/** Recurring checklists: everything open again (also done by the server at the start of each period). */
export async function resetList(listId: string): Promise<number> {
  const checked = (await db.items.where('listId').equals(listId).toArray()).filter((i) => i.checked && !i.deleted);
  await sync.mutateItems(checked.map((i) => ({ id: i.id, patch: { checked: false } })));
  return checked.length;
}

export async function checkAll(listId: string): Promise<number> {
  const open = (await db.items.where('listId').equals(listId).toArray()).filter((i) => !i.checked && !i.deleted);
  await sync.mutateItems(open.map((i) => ({ id: i.id, patch: { checked: true } })));
  return open.length;
}

/** Removes bought items from "Zuletzt verwendet". */
export async function clearChecked(listId: string): Promise<void> {
  const checked = (await db.items.where('listId').equals(listId).toArray()).filter((i) => i.checked && !i.deleted);
  await sync.mutateItems(checked.map((i) => ({ id: i.id, patch: { deleted: true } })));
}

/** Shares the list link via the phone's share sheet (or copies it on a laptop). */
export async function shareList(list: ListRow, renew = false): Promise<void> {
  const res = await fetch(renew ? `/api/v1/lists/${list.id}/share-link/renew` : `/api/v1/lists/${list.id}/share-link`, {
    method: renew ? 'POST' : 'GET',
  }).catch(() => null);
  if (!res?.ok) {
    alert('Zum Teilen wird eine Verbindung zum Server gebraucht.');
    return;
  }
  const { url } = (await res.json()) as { url: string };
  const text = `${list.listType === 'packing' ? 'Unsere Packliste' : list.listType === 'memo' ? 'Unsere Merkliste' : list.listType === 'todo' ? 'Unsere ToDo-Liste' : 'Unsere Einkaufsliste'} „${list.name}“`;
  if (navigator.share) {
    await navigator.share({ title: list.name, text, url }).catch(() => undefined);
  } else {
    await navigator.clipboard?.writeText(url).catch(() => undefined);
    prompt('Link kopiert – zum Weitergeben:', url);
  }
}

/**
 * The list as plain text into the phone's share dialog (messenger, notes …), on the laptop to the
 * clipboard. Works offline: it only reads the local copy. Returns what happened, for a hint.
 */
export async function shareListAsText(list: ListRow, categoryOrder?: readonly string[]): Promise<'shared' | 'copied' | 'failed'> {
  const items = await db.items.where('listId').equals(list.id).toArray();
  const text = listAsText(list, items, categoryOrder, new Date(), await db.categories.toArray());
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try {
      await navigator.share({ title: list.name, text });
      return 'shared';
    } catch (err) {
      // Closed the dialog: nothing to do. Anything else: fall back to the clipboard.
      if ((err as Error).name === 'AbortError') return 'shared';
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    prompt('Zum Kopieren:', text);
    return 'failed';
  }
}

export async function leaveList(listId: string): Promise<void> {
  const res = await fetch(`/api/v1/lists/${listId}/leave`, { method: 'POST' }).catch(() => null);
  if (!res?.ok) alert('Zum Verlassen wird eine Verbindung zum Server gebraucht.');
}

export async function logout(): Promise<void> {
  await fetch('/auth/logout', { method: 'POST' }).catch(() => undefined);
  await db.delete();
  location.replace('/');
}
