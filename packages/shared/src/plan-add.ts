import { generateKeyBetween } from 'fractional-indexing';
import { mergeAmounts } from './amounts.js';
import type { ItemPatch, ItemRow, ItemSource } from './model.js';
import { packingInfo, samePacking, withPacking } from './packing.js';
import type { ParsedItem } from './parser.js';

/** A parsed item plus where it came from (recipe, template …). */
export type NewItem = ParsedItem & { sources?: ItemSource[]; optional?: boolean };

export interface PlannedChange {
  id: string;
  patch: ItemPatch;
  kind: 'merged' | 'restored' | 'created';
}

type ExistingItem = Pick<
  ItemRow,
  'id' | 'catalogItemId' | 'name' | 'checked' | 'deleted' | 'amounts' | 'properties' | 'note' | 'attributes' | 'position'
>;

function sameItem(item: ExistingItem, p: NewItem): boolean {
  // Packing lists: Annas T-Shirts and Bens T-Shirts (or the ones in another Packstück) stay apart.
  if (!samePacking(packingInfo(item), { person: p.person ?? null, container: p.container ?? null })) return false;
  if (p.catalogItemId) return item.catalogItemId === p.catalogItemId;
  return !item.catalogItemId && item.name.toLowerCase() === p.name.toLowerCase();
}

function packingOf(p: NewItem) {
  return { person: p.person ?? null, container: p.container ?? null };
}

function withSources(attributes: Record<string, unknown>, add: ItemSource[] | undefined): Record<string, unknown> | null {
  if (!add?.length) return null;
  const current = Array.isArray(attributes.sources) ? (attributes.sources as ItemSource[]) : [];
  const merged = [...current];
  for (const s of add) if (!merged.some((m) => m.type === s.type && m.label === s.label)) merged.push(s);
  return merged.length === current.length ? null : { ...attributes, sources: merged };
}

/**
 * Works out what "add these items to the list" means:
 * an item that is already open gets the new amount added, a recently bought
 * one comes back, anything else is created. Pure function – used by the app,
 * the REST API and the MCP server alike.
 */
export function planAdd(listId: string, existing: ExistingItem[], parsed: NewItem[], newId: () => string): PlannedChange[] {
  const items = existing.filter((i) => !i.deleted).map((i) => ({ ...i }));
  let position = items.reduce<string | null>((max, i) => (max === null || i.position > max ? i.position : max), null);
  const changes: PlannedChange[] = [];

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
      if (Object.keys(patch).length) changes.push({ id: open.id, patch, kind: 'merged' });
      continue;
    }
    const done = items.find((i) => i.checked && sameItem(i, p));
    if (done) {
      done.checked = false;
      done.amounts = p.amounts;
      done.properties = p.properties;
      done.note = p.note;
      changes.push({
        id: done.id,
        patch: {
          checked: false,
          amounts: p.amounts,
          properties: p.properties,
          note: p.note,
          attributes: withPacking({ ...done.attributes, sources: p.sources ?? [], ...(p.due ? { due: p.due } : {}) }, packingOf(p)),
        },
        kind: 'restored',
      });
      continue;
    }
    position = generateKeyBetween(position, null);
    const id = newId();
    const patch: ItemPatch = {
      listId,
      name: p.name,
      catalogItemId: p.catalogItemId,
      categoryId: p.categoryId,
      amounts: p.amounts,
      properties: p.properties,
      note: p.note,
      position,
      ...(p.sources?.length || p.person || p.container || p.due
        ? { attributes: withPacking({ ...(p.sources?.length ? { sources: p.sources } : {}), ...(p.due ? { due: p.due } : {}) }, packingOf(p)) }
        : {}),
      ...(p.optional ? { optional: true } : {}),
    };
    changes.push({ id, patch, kind: 'created' });
    // The same thing twice in one batch ("Milch, Milch") must merge as well.
    items.push({
      id,
      catalogItemId: p.catalogItemId,
      name: p.name,
      checked: false,
      deleted: false,
      amounts: p.amounts,
      properties: p.properties,
      note: p.note,
      attributes: patch.attributes ?? {},
      position,
    });
  }
  return changes;
}
