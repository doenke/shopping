import {
  generateKeyBetween,
  mergeAmounts,
  type CatalogItem,
  type ItemPatch,
  type ItemRow,
  type ItemSource,
  type ListRow,
  type ParsedItem,
} from '@shopping/shared';
import { db } from './db';
import { sync } from './sync/engine';

function sameItem(item: ItemRow, p: { catalogItemId: string | null; name: string }): boolean {
  if (p.catalogItemId) return item.catalogItemId === p.catalogItemId;
  return !item.catalogItemId && item.name.toLowerCase() === p.name.toLowerCase();
}

async function lastPosition(listId: string): Promise<string | null> {
  const items = await db.items.where('listId').equals(listId).toArray();
  return items.reduce<string | null>((max, i) => (max === null || i.position > max ? i.position : max), null);
}

/** A parsed item plus where it came from (recipe, template …). */
export type NewItem = ParsedItem & { sources?: ItemSource[]; optional?: boolean };

function withSources(attributes: Record<string, unknown>, add: ItemSource[] | undefined): Record<string, unknown> | null {
  if (!add?.length) return null;
  const current = Array.isArray(attributes.sources) ? (attributes.sources as ItemSource[]) : [];
  const merged = [...current];
  for (const s of add) if (!merged.some((m) => m.type === s.type && m.label === s.label)) merged.push(s);
  return merged.length === current.length ? null : { ...attributes, sources: merged };
}

/**
 * Adds parsed items to a list like Bring! does: an item that is already open
 * gets the new amount added, a recently bought one comes back, anything else is new.
 */
export async function addItems(listId: string, parsed: NewItem[]): Promise<void> {
  const items = (await db.items.where('listId').equals(listId).toArray()).filter((i) => !i.deleted);
  let position = await lastPosition(listId);
  const changes: { id: string; patch: ItemPatch }[] = [];
  for (const p of parsed) {
    const open = items.find((i) => !i.checked && sameItem(i, p));
    if (open) {
      const patch: ItemPatch = {};
      if (p.amounts.length) open.amounts = patch.amounts = mergeAmounts(open.amounts, p.amounts);
      const props = [...new Set([...open.properties, ...p.properties])];
      if (props.length !== open.properties.length) open.properties = patch.properties = props;
      if (p.note && p.note !== open.note) open.note = patch.note = open.note ? `${open.note}, ${p.note}` : p.note;
      const attributes = withSources(open.attributes, p.sources);
      if (attributes) open.attributes = patch.attributes = attributes;
      if (Object.keys(patch).length) changes.push({ id: open.id, patch });
      continue;
    }
    const done = items.find((i) => i.checked && sameItem(i, p));
    if (done) {
      done.checked = false;
      changes.push({
        id: done.id,
        patch: {
          checked: false,
          amounts: p.amounts,
          properties: p.properties,
          note: p.note,
          attributes: { ...done.attributes, sources: p.sources ?? [] },
        },
      });
      continue;
    }
    position = generateKeyBetween(position, null);
    const id = crypto.randomUUID();
    const patch: ItemPatch = {
      listId,
      name: p.name,
      catalogItemId: p.catalogItemId,
      categoryId: p.categoryId,
      amounts: p.amounts,
      properties: p.properties,
      note: p.note,
      position,
      ...(p.sources?.length ? { attributes: { sources: p.sources } } : {}),
      ...(p.optional ? { optional: true } : {}),
    };
    changes.push({ id, patch });
    // Same thing twice in one batch ("Milch, Milch") must merge as well.
    items.push({ ...(patch as ItemRow), id, checked: false, attributes: patch.attributes ?? {} });
  }
  await sync.mutateItems(changes);
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

export async function createList(name: string, isTemplate = false): Promise<string> {
  const id = crypto.randomUUID();
  await sync.mutateList(id, { name, listType: 'shopping', isTemplate });
  return id;
}

/** "Als Vorlage speichern": copies the open items of a list into a new template. */
export async function saveAsTemplate(list: ListRow, name: string): Promise<string> {
  const id = await createList(name, true);
  const items = (await db.items.where('listId').equals(list.id).toArray()).filter((i) => !i.deleted && !i.checked);
  await addItems(
    id,
    items.map((i) => ({ name: i.name, catalogItemId: i.catalogItemId, categoryId: i.categoryId, amounts: i.amounts, properties: i.properties, note: i.note })),
  );
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
  const text = `Unsere Einkaufsliste „${list.name}“`;
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
