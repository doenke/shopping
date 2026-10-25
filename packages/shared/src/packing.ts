import type { ItemRow } from './model.js';

/**
 * Packing lists: an item can belong to a person ("Anna") and a Packstück
 * ("Koffer", "Handgepäck"). Both are free text, kept in `attributes`.
 */
export interface PackingInfo {
  person: string | null;
  container: string | null;
}

function clean(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

export function packingInfo(item: Pick<ItemRow, 'attributes'>): PackingInfo {
  return { person: clean(item.attributes.person), container: clean(item.attributes.container) };
}

/** Same person and Packstück (both may be empty). Case does not matter. */
export function samePacking(a: PackingInfo, b: PackingInfo): boolean {
  return (a.person ?? '').toLowerCase() === (b.person ?? '').toLowerCase() && (a.container ?? '').toLowerCase() === (b.container ?? '').toLowerCase();
}

/** Writes person/Packstück into attributes (null removes). */
export function withPacking(attributes: Record<string, unknown>, info: Partial<PackingInfo>): Record<string, unknown> {
  const next = { ...attributes };
  for (const key of ['person', 'container'] as const) {
    if (!(key in info)) continue;
    const v = clean(info[key]);
    if (v) next[key] = v;
    else delete next[key];
  }
  return next;
}

/**
 * Pulls "@Anna" (person) and "#Koffer" (Packstück) out of a typed line.
 * Underscores stand for spaces: "#Blaue_Tasche" → "Blaue Tasche".
 */
export function extractPackingTokens(text: string): { text: string; person: string | null; container: string | null } {
  let person: string | null = null;
  let container: string | null = null;
  const rest = text.replace(/(^|\s)([@#])([\p{L}\p{N}_-]+)/gu, (_, pre: string, sign: string, word: string) => {
    const value = word.replace(/_/g, ' ');
    const nice = value.charAt(0).toUpperCase() + value.slice(1);
    if (sign === '@') person ??= nice;
    else container ??= nice;
    return pre;
  });
  return { text: rest.replace(/\s+/g, ' ').trim(), person, container };
}
