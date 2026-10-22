export type Dimension = 'mass' | 'volume' | 'count' | 'package' | 'other';

export interface UnitDef {
  id: string;
  name: string;
  plural: string;
  abbr: string;
  dimension: Dimension;
  /** Factor to the dimension's base unit (g, ml). Units of other dimensions are not convertible. */
  factor?: number;
  aliases: string[];
}

export const UNITS: UnitDef[] = [
  { id: 'g', name: 'Gramm', plural: 'Gramm', abbr: 'g', dimension: 'mass', factor: 1, aliases: ['gr', 'gramm', 'grams', 'gram'] },
  { id: 'kg', name: 'Kilogramm', plural: 'Kilogramm', abbr: 'kg', dimension: 'mass', factor: 1000, aliases: ['kilo', 'kilogramm', 'kilos'] },
  { id: 'ml', name: 'Milliliter', plural: 'Milliliter', abbr: 'ml', dimension: 'volume', factor: 1, aliases: ['milliliter'] },
  { id: 'cl', name: 'Zentiliter', plural: 'Zentiliter', abbr: 'cl', dimension: 'volume', factor: 10, aliases: ['zentiliter'] },
  { id: 'l', name: 'Liter', plural: 'Liter', abbr: 'l', dimension: 'volume', factor: 1000, aliases: ['liter', 'ltr', 'lt'] },
  { id: 'el', name: 'Esslöffel', plural: 'Esslöffel', abbr: 'EL', dimension: 'volume', factor: 15, aliases: ['esslöffel', 'essl', 'eßlöffel', 'tbsp'] },
  { id: 'tl', name: 'Teelöffel', plural: 'Teelöffel', abbr: 'TL', dimension: 'volume', factor: 5, aliases: ['teelöffel', 'tsp'] },
  { id: 'stk', name: 'Stück', plural: 'Stück', abbr: 'Stk', dimension: 'count', factor: 1, aliases: ['stück', 'st', 'stck', 'stk.', 'st.', 'x'] },
  { id: 'pck', name: 'Packung', plural: 'Packungen', abbr: 'Pck', dimension: 'package', aliases: ['packung', 'packungen', 'pack', 'päckchen', 'pkg', 'pck.', 'pk'] },
  { id: 'dose', name: 'Dose', plural: 'Dosen', abbr: 'Dose', dimension: 'package', aliases: ['dosen'] },
  { id: 'glas', name: 'Glas', plural: 'Gläser', abbr: 'Glas', dimension: 'package', aliases: ['gläser'] },
  { id: 'flasche', name: 'Flasche', plural: 'Flaschen', abbr: 'Fl', dimension: 'package', aliases: ['flaschen', 'fl.'] },
  { id: 'becher', name: 'Becher', plural: 'Becher', abbr: 'Becher', dimension: 'package', aliases: [] },
  { id: 'tuete', name: 'Tüte', plural: 'Tüten', abbr: 'Tüte', dimension: 'package', aliases: ['tüten', 'beutel'] },
  { id: 'netz', name: 'Netz', plural: 'Netze', abbr: 'Netz', dimension: 'package', aliases: ['netze'] },
  { id: 'kiste', name: 'Kiste', plural: 'Kisten', abbr: 'Kiste', dimension: 'package', aliases: ['kisten', 'kasten'] },
  { id: 'bund', name: 'Bund', plural: 'Bund', abbr: 'Bund', dimension: 'other', aliases: ['bd', 'bündel'] },
  { id: 'kopf', name: 'Kopf', plural: 'Köpfe', abbr: 'Kopf', dimension: 'other', aliases: ['köpfe'] },
  { id: 'zehe', name: 'Zehe', plural: 'Zehen', abbr: 'Zehe', dimension: 'other', aliases: ['zehen'] },
  { id: 'scheibe', name: 'Scheibe', plural: 'Scheiben', abbr: 'Scheibe', dimension: 'other', aliases: ['scheiben'] },
  { id: 'prise', name: 'Prise', plural: 'Prisen', abbr: 'Prise', dimension: 'other', aliases: ['prisen'] },
];

const byId = new Map(UNITS.map((u) => [u.id, u]));
const byToken = new Map<string, UnitDef>();
for (const u of UNITS) {
  for (const t of [u.id, u.name, u.plural, u.abbr, ...u.aliases]) byToken.set(t.toLowerCase(), u);
}

export function getUnit(id: string | null | undefined): UnitDef | undefined {
  return id ? byId.get(id) : undefined;
}

export function findUnit(token: string): UnitDef | undefined {
  return byToken.get(token.toLowerCase().replace(/\.$/, '')) ?? byToken.get(token.toLowerCase());
}

/** Registers aliases (e.g. from Mealie) for an existing unit at runtime. */
export function addUnitAlias(unitId: string, alias: string): void {
  const u = byId.get(unitId);
  if (u && alias.trim()) byToken.set(alias.trim().toLowerCase(), u);
}

export function convertible(a: string | null, b: string | null): boolean {
  if (a === b) return true;
  const ua = getUnit(a);
  const ub = getUnit(b);
  return !!ua && !!ub && ua.dimension === ub.dimension && ua.factor !== undefined && ub.factor !== undefined;
}

export function toBase(quantity: number, unitId: string): number {
  return quantity * (getUnit(unitId)?.factor ?? 1);
}

/** Picks a readable unit for a base quantity, e.g. 1200 g -> 1.2 kg. Spoon units are kept as they are. */
export function normalizeUnit(quantity: number, unitId: string): { quantity: number; unit: string } {
  const u = getUnit(unitId);
  if (!u || u.factor === undefined) return { quantity, unit: unitId };
  const base = quantity * u.factor;
  if (u.dimension === 'mass') return base >= 1000 ? { quantity: base / 1000, unit: 'kg' } : { quantity: base, unit: 'g' };
  if (u.dimension === 'volume' && (unitId === 'ml' || unitId === 'cl' || unitId === 'l')) {
    return base >= 1000 ? { quantity: base / 1000, unit: 'l' } : { quantity: base, unit: 'ml' };
  }
  return { quantity, unit: unitId };
}
