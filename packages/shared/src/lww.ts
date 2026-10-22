import type { FieldClock } from './model.js';

/**
 * Applies a patch field by field: a field is only overwritten when the patch's
 * timestamp is newer than the timestamp of the field's last write.
 * Returns the names of the fields that were applied.
 */
export function applyPatch<T extends { hlc: FieldClock }>(
  row: T,
  patch: Partial<Record<keyof T, unknown>>,
  ts: string,
): (keyof T & string)[] {
  const applied: (keyof T & string)[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const current = row.hlc[key];
    if (current !== undefined && current >= ts) continue;
    (row as Record<string, unknown>)[key] = value;
    row.hlc[key] = ts;
    applied.push(key as keyof T & string);
  }
  return applied;
}

/**
 * Merges two replicas of the same row, keeping the newer value of each field.
 * Fields without a clock entry are taken from `incoming` (server-maintained fields).
 */
export function mergeRow<T extends { hlc: FieldClock }>(local: T, incoming: T, clockedFields: readonly string[]): T {
  const merged = { ...incoming, hlc: { ...incoming.hlc } } as T;
  for (const key of clockedFields) {
    const l = local.hlc[key];
    const r = incoming.hlc[key];
    if (l !== undefined && (r === undefined || l > r)) {
      (merged as Record<string, unknown>)[key] = (local as Record<string, unknown>)[key];
      merged.hlc[key] = l;
    }
  }
  return merged;
}

export const LIST_FIELDS = ['name', 'listType', 'isTemplate', 'icon', 'color', 'settings', 'archivedAt', 'deleted'] as const;
export const ITEM_FIELDS = [
  'listId',
  'catalogItemId',
  'name',
  'amounts',
  'properties',
  'note',
  'categoryId',
  'checked',
  'checkedAt',
  'checkedBy',
  'position',
  'optional',
  'attributes',
  'deleted',
] as const;
