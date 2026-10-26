import { packingInfo, planAdd, type CatalogItem, type ItemPatch, type ItemRow, type ListRow, type ListType, type NewItem, type ParsedItem } from '@shopping/shared';
import { db } from './db';
import { sync } from './sync/engine';

export type { NewItem };

/**
 * Adds parsed items to a list (see planAdd): open items get
 * the amount added, recently bought ones come back, the rest is new.
 */
export async function addItems(listId: string, parsed: NewItem[]): Promise<void> {
  const existing = await db.items.where('listId').equals(listId).toArray();
  const changes = planAdd(listId, existing, parsed, () => crypto.randomUUID());
  await sync.mutateItems(changes.map(({ id, patch }) => ({ id, patch })));
}

export function catalogToParsed(c: CatalogItem): ParsedItem {
  return { name: c.name, catalogItemId: c.id, categoryId: c.categoryId, amounts: [], properties: [], note: null };
}

export async function setChecked(item: ItemRow, checked: boolean): Promise<void> {
  await sync.mutateItem(item.id, { checked });
}

export async function updateItem(id: string, patch: ItemPatch): Promise<void> {
  await sync.mutateItem(id, patch);
}

export async function deleteItem(id: string): Promise<void> {
  await sync.mutateItem(id, { deleted: true });
}

export async function createList(
  name: string,
  isTemplate = false,
  listType: ListType = 'shopping',
  description?: string | null,
  visibility: 'household' | 'private' = 'household',
): Promise<string> {
  const id = crypto.randomUUID();
  await sync.mutateList(id, { name, listType, isTemplate, visibility, ...(description?.trim() ? { settings: { description: description.trim() } } : {}) });
  return id;
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
export function itemToNew(i: ItemRow): NewItem {
  return {
    name: i.name,
    catalogItemId: i.catalogItemId,
    categoryId: i.categoryId,
    amounts: i.amounts,
    properties: i.properties,
    note: i.note,
    ...packingInfo(i),
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

export async function renameList(id: string, name: string): Promise<void> {
  await sync.mutateList(id, { name });
}

export async function deleteList(id: string): Promise<void> {
  await sync.mutateList(id, { deleted: true });
}

export async function setMainList(id: string): Promise<void> {
  await sync.mutateMe({ defaultListId: id });
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
  const text = `${list.listType === 'packing' ? 'Unsere Packliste' : list.listType === 'memo' ? 'Unsere Merkliste' : 'Unsere Einkaufsliste'} „${list.name}“`;
  if (navigator.share) {
    await navigator.share({ title: list.name, text, url }).catch(() => undefined);
  } else {
    await navigator.clipboard?.writeText(url).catch(() => undefined);
    prompt('Link kopiert – zum Weitergeben:', url);
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
