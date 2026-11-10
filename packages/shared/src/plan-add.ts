import { generateKeyBetween } from 'fractional-indexing';
import { addPlacePatch, type PlaceData } from './attachments.js';
import { mergeAmounts } from './amounts.js';
import type { ItemPatch, ItemRow, ItemSource } from './model.js';
import { packingInfo, withPacking } from './packing.js';
import { withUrl } from './links.js';
import { isForEach, peopleAttributes, peopleOf, withPeople } from './people.js';
import type { ParsedItem } from './parser.js';

/** A parsed item plus where it came from (recipe, template …). */
export type NewItem = ParsedItem & {
  sources?: ItemSource[];
  optional?: boolean;
  /** The place for "*…", once looked up (the server does that before planning; the app afterwards). */
  placeData?: PlaceData | null;
};

export interface PlannedChange {
  id: string;
  patch: ItemPatch;
  kind: 'merged' | 'restored' | 'created';
}

type ExistingItem = Pick<ItemRow, 'id' | 'catalogItemId' | 'name' | 'checked' | 'deleted' | 'amounts' | 'properties' | 'note' | 'attributes' | 'position'>;

function sameName(item: ExistingItem, p: NewItem): boolean {
  if (p.catalogItemId) return item.catalogItemId === p.catalogItemId;
  return !item.catalogItemId && item.name.toLowerCase() === p.name.toLowerCase();
}

/** Everyone a new item is for ("@Sönke @Ulli" or "@Anna"). */
function newPeople(p: NewItem): string[] {
  return p.persons?.length ? p.persons : p.person ? [p.person] : [];
}

const lower = (xs: string[]) => xs.map((x) => x.toLowerCase());

/**
 * Same thing for the same people and Packstück. Annas T-Shirts and Bens T-Shirts stay apart; but an entry
 * for several people takes in more people ("Sonnenbrille" for Sönke + Ulli, then "Sonnenbrille @Anna").
 */
function sameItem(item: ExistingItem, p: NewItem): boolean {
  if ((packingInfo(item).container ?? '').toLowerCase() !== (p.container ?? '').toLowerCase()) return false;
  if (isForEach(item) !== !!p.forEach) return false;
  const a = lower(peopleOf(item));
  const b = lower(newPeople(p));
  const samePeople = a.length === b.length && a.every((x) => b.includes(x));
  if (!samePeople && a.length < 2 && b.length < 2) return false;
  return sameName(item, p);
}

function attributesOf(p: NewItem): Record<string, unknown> {
  const base = withPacking({ ...(p.sources?.length ? { sources: p.sources } : {}), ...(p.due ? { due: p.due } : {}) }, { container: p.container ?? null });
  return { ...(p.url ? withUrl(base, p.url) : base), ...peopleAttributes(p) };
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
      // A multi-person entry takes in more people; its amount is per person, so it stays.
      const have = peopleOf(open);
      const more = newPeople(p).filter((n) => !lower(have).includes(n.toLowerCase()));
      if (p.amounts.length && !(have.length >= 2 && newPeople(p).length)) open.amounts = patch.amounts = mergeAmounts(open.amounts, p.amounts);
      const props = [...new Set([...open.properties, ...p.properties])];
      if (props.length !== open.properties.length) open.properties = patch.properties = props;
      if (p.note && p.note !== open.note) open.note = patch.note = open.note ? `${open.note}, ${p.note}` : p.note;
      let attributes = withSources(open.attributes, p.sources);
      if (more.length) attributes = withPeople(attributes ?? open.attributes, [...have, ...more]);
      // A link comes on (or replaces the old one).
      if (p.url && p.url !== (attributes ?? open.attributes).url) attributes = withUrl(attributes ?? open.attributes, p.url);
      if (attributes) open.attributes = patch.attributes = attributes;
      // Someone already ticked off needs it again: open for them.
      const again = have.length >= 2 ? newPeople(p).filter((n) => lower(have).includes(n.toLowerCase())) : [];
      if (again.length) patch.personChecks = Object.fromEntries(again.map((n) => [n, false]));
      if (p.placeData) patch.attachments = addPlacePatch(p.placeData).attachments;
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
          attributes: {
            ...withPeople(
              withPacking({ ...done.attributes, sources: p.sources ?? [], ...(p.due ? { due: p.due } : {}) }, { container: p.container ?? null }),
              [],
            ),
            ...peopleAttributes(p),
          },
          ...(p.placeData ? addPlacePatch(p.placeData) : {}),
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
      ...(Object.keys(attributesOf(p)).length ? { attributes: attributesOf(p) } : {}),
      ...(p.optional ? { optional: true } : {}),
      ...(p.placeData ? addPlacePatch(p.placeData) : {}),
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
