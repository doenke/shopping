import type { CatalogIndex } from './catalog-index.js';
import type { Amount, ListType } from './model.js';
import { extractDue } from './due.js';
import { extractPackingTokens } from './packing.js';
import { extractUrl, linkLabel } from './links.js';
import { extractPlace } from './attachments.js';
import { findProperty } from './properties.js';
import { findUnit } from './units.js';

export interface ParsedItem {
  name: string;
  catalogItemId: string | null;
  categoryId: string | null;
  amounts: Amount[];
  properties: string[];
  note: string | null;
  /** Packing lists: "@Anna" and "#Koffer" in the typed text. */
  person?: string | null;
  /** "@Sönke @Ulli": one entry for several people (ticked off per person). */
  persons?: string[];
  /** "@alle" (templates: "für jeden"). */
  forEach?: boolean;
  container?: string | null;
  /** ToDo lists: "!morgen", "!12.11." → YYYY-MM-DD. */
  due?: string | null;
  /** A web link in the text ("Dune https://…"). */
  url?: string | null;
  /** "*": attach the current location; "*Hornbach Altona": search that place (resolved by the app or server). */
  place?: { query: string | null };
  /** Only "*" was typed: named "Standort 14:32" for now, renamed after the place once it is known. */
  nameFromPlace?: boolean;
}

const NUMBER_WORDS: Record<string, number> = {
  ein: 1,
  eine: 1,
  einen: 1,
  zwei: 2,
  drei: 3,
  vier: 4,
  fünf: 5,
  sechs: 6,
  sieben: 7,
  acht: 8,
  neun: 9,
  zehn: 10,
  zwölf: 12,
  dutzend: 12,
  halb: 0.5,
  halbe: 0.5,
  halben: 0.5,
};

const UNICODE_FRACTIONS: Record<string, number> = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3 };

function parseNumber(s: string): number | undefined {
  if (s in UNICODE_FRACTIONS) return UNICODE_FRACTIONS[s];
  const frac = /^(\d+)\/(\d+)$/.exec(s);
  if (frac) return Number(frac[2]) === 0 ? undefined : Number(frac[1]) / Number(frac[2]);
  const mixed = /^(\d+)([½¼¾⅓⅔])$/.exec(s);
  if (mixed) return Number(mixed[1]) + UNICODE_FRACTIONS[mixed[2]!]!;
  if (/^\d+(?:[.,]\d+)?$/.test(s)) return Number(s.replace(',', '.'));
  return undefined;
}

/** Splits "a; b" into items. A comma does not split – it belongs to the entry ("Fenster zu, Herd aus"). */
export function splitInput(text: string): string[] {
  // A pasted ingredient list (several lines, e.g. from a recipe page): one item per line; a comma
  // within a line is a note ("200 g Bergkäse, gerieben"), bullets and tabs are dropped.
  if (/\n/.test(text.trim())) {
    return text
      .split(/\r?\n/)
      .map((line) =>
        line
          .replace(/^\s*(?:[-–•*·▪◦]|\d+[.)])\s+/, '')
          .replace(/\t+/g, ' ')
          .replace(/(?<!\d),(?!\d)\s*(.+)$/, ' ($1)')
          .trim(),
      )
      .filter(Boolean);
  }
  return text
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** "14:32" – a lone "*" stays apart from the one before (no merging into an older "Standort"). */
function hereTime(now = new Date()): string {
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function parseItem(text: string, catalog?: CatalogIndex, listType: ListType = 'shopping'): ParsedItem | null {
  // A link first: its "#…" or "@…" are no Packstück or person.
  const linked = extractUrl(text);
  if (linked.url && !linked.text) {
    // Only a link: named after the site until there is something better (the page title).
    return { name: linkLabel(linked.url), catalogItemId: null, categoryId: null, amounts: [], properties: [], note: null, url: linked.url };
  }
  const placed = extractPlace(linked.text);
  const dated = extractDue(placed.text);
  const packing = extractPackingTokens(dated.text);
  let rest = packing.text;
  // Just "*" (or "*Hornbach"): the place is the entry.
  const placeOnly = !rest && !!placed.place;
  if (placeOnly) rest = placed.place!.query ?? `Standort ${hereTime()}`;
  if (!rest) return null;

  const notes: string[] = [];
  // Plural markers of recipe sites are no notes: "Zehe(n)", "Ei(er)", "Zwiebel(n)".
  rest = rest.replace(/(\p{L})\((?:n|e|s|en|er|nen)\)/gu, '$1');
  rest = rest.replace(/\(([^)]*)\)/g, (_, inner: string) => {
    if (inner.trim()) notes.push(inner.trim());
    return ' ';
  });

  // Split glued number+unit tokens: "500g" -> "500 g", "2l" -> "2 l".
  const tokens = rest
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((t) => {
      const m = /^(\d+(?:[.,]\d+)?|\d+\/\d+)([a-zA-ZäöüÄÖÜß]+\.?)$/.exec(t);
      return m && findUnit(m[2]!) ? [m[1]!, m[2]!] : [t];
    });

  let quantity: number | null = null;
  let unit: string | null = null;
  const remaining: string[] = [];
  const properties: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    const lower = tok.toLowerCase();
    if (quantity === null) {
      const n = parseNumber(tok) ?? (remaining.length === 0 && i < tokens.length - 1 ? NUMBER_WORDS[lower] : undefined);
      if (n !== undefined) {
        quantity = n;
        const next = tokens[i + 1];
        const u = next ? findUnit(next) : undefined;
        // Do not swallow the item itself as unit ("2 Dosen" is fine, "2 Tomaten" is no unit).
        if (u && (remaining.length > 0 || i + 2 < tokens.length)) {
          unit = u.id;
          i++;
        }
        continue;
      }
    }
    if (unit === null && quantity === null && remaining.length === 0 && i < tokens.length - 1) {
      const u = findUnit(tok);
      if (u && u.dimension !== 'mass' && u.dimension !== 'volume') {
        unit = u.id;
        continue;
      }
    }
    const prop = findProperty(lower, listType);
    if (prop && tokens.length > 1) {
      if (!properties.includes(prop)) properties.push(prop);
      continue;
    }
    remaining.push(tok);
  }

  if (remaining.length === 0) {
    if (properties.length === 0) return null;
    remaining.push(...properties.splice(0, 1));
  }

  // Find the longest run of words that names a catalog item; leftovers become properties.
  let name = remaining.join(' ');
  let catalogItemId: string | null = null;
  let categoryId: string | null = null;
  if (catalog) {
    let found: { start: number; end: number; id: string; name: string; category: string } | undefined;
    outer: for (let len = remaining.length; len >= 1; len--) {
      for (let start = 0; start + len <= remaining.length; start++) {
        const hit = catalog.match(remaining.slice(start, start + len).join(' '));
        if (hit) {
          found = { start, end: start + len, id: hit.id, name: hit.name, category: hit.categoryId };
          break outer;
        }
      }
    }
    if (found) {
      catalogItemId = found.id;
      categoryId = found.category;
      name = found.name;
      const extras = [...remaining.slice(0, found.start), ...remaining.slice(found.end)];
      properties.unshift(...extras.filter((e) => !properties.includes(e)));
    }
  }

  return {
    name: catalogItemId ? name : capitalize(name),
    catalogItemId,
    categoryId,
    amounts: quantity !== null || unit !== null ? [{ q: quantity, u: unit }] : [],
    properties,
    note: notes.length ? notes.join(', ') : null,
    ...(packing.person ? { person: packing.person } : {}),
    ...(listType !== 'memo' && packing.persons.length >= 2 ? { persons: packing.persons } : {}),
    ...(listType !== 'memo' && packing.forEach ? { forEach: true } : {}),
    ...(packing.container ? { container: packing.container } : {}),
    ...(dated.due ? { due: dated.due } : {}),
    ...(linked.url ? { url: linked.url } : {}),
    ...(placed.place ? { place: placed.place } : {}),
    ...(placeOnly && !placed.place!.query ? { nameFromPlace: true } : {}),
  };
}

/** Splits and parses an input line; the list type decides which words are properties. */
export function parseInput(text: string, catalog?: CatalogIndex, listType: ListType = 'shopping'): ParsedItem[] {
  // One line with a link is one entry: links may contain semicolons.
  if (extractUrl(text).url && !text.trim().includes('\n')) {
    const one = parseItem(text.trim(), catalog, listType);
    return one ? [one] : [];
  }
  return splitInput(text)
    .map((part) => parseItem(part, catalog, listType))
    .filter((p): p is ParsedItem => p !== null);
}
