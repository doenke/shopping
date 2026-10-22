import type { Amount } from './model.js';
import { convertible, getUnit, normalizeUnit, toBase } from './units.js';

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Adds amounts together. Amounts with compatible units are summed
 * (200 g + 1 kg = 1.2 kg), incompatible ones are kept side by side
 * ("2 Stk + 200 g"). Amounts without quantity are dropped when another
 * amount carries a quantity.
 */
export function mergeAmounts(...lists: Amount[][]): Amount[] {
  const result: Amount[] = [];
  for (const a of lists.flat()) {
    if (a.q === null) {
      if (a.u && !result.some((r) => r.u === a.u)) result.push({ ...a });
      continue;
    }
    const target = result.find((r) => r.q !== null && convertible(r.u ?? 'stk', a.u ?? 'stk'));
    if (!target) {
      const sameUnitEmpty = result.findIndex((r) => r.q === null && r.u === a.u);
      if (sameUnitEmpty >= 0) result.splice(sameUnitEmpty, 1);
      result.push({ ...a });
      continue;
    }
    if ((target.u ?? 'stk') === (a.u ?? 'stk')) {
      target.u = target.u ?? a.u;
      const n = target.u ? normalizeUnit(target.q! + a.q, target.u) : { quantity: target.q! + a.q, unit: null };
      target.q = round(n.quantity);
      target.u = n.unit;
    } else {
      const base = toBase(target.q!, target.u!) + toBase(a.q, a.u!);
      const baseUnit = getUnit(target.u)?.dimension === 'mass' ? 'g' : 'ml';
      const n = normalizeUnit(base, baseUnit);
      target.q = round(n.quantity);
      target.u = n.unit;
    }
  }
  return result.length > 1 ? result.filter((r) => r.q !== null || r.u !== null) : result;
}

const FRACTIONS: [number, string][] = [
  [0.25, '¼'],
  [0.5, '½'],
  [0.75, '¾'],
  [1 / 3, '⅓'],
  [2 / 3, '⅔'],
];

const METRIC = new Set(['g', 'kg', 'ml', 'cl', 'l']);

/** Formats a quantity German-style; fractions like ½ are used unless `decimal` is set. */
export function formatNumber(n: number, decimal = false): string {
  const whole = Math.floor(n);
  const frac = n - whole;
  for (const [value, glyph] of decimal ? [] : FRACTIONS) {
    if (Math.abs(frac - value) < 0.01) return whole === 0 ? glyph : `${whole}${glyph}`;
  }
  return round(n).toLocaleString('de-DE', { maximumFractionDigits: 2 });
}

export function formatAmount(a: Amount): string {
  const unit = getUnit(a.u);
  if (a.q === null) return unit ? unit.name : (a.u ?? '');
  const num = formatNumber(a.q, METRIC.has(a.u ?? ''));
  if (!a.u) return num;
  if (!unit) return `${num} ${a.u}`;
  // Short units are written as abbreviation, word units get singular/plural.
  const word = unit.abbr !== unit.name ? unit.abbr : a.q > 1 ? unit.plural : unit.name;
  return `${num} ${word}`;
}

export function formatAmounts(amounts: Amount[]): string {
  return amounts.map(formatAmount).filter(Boolean).join(' + ');
}

/** The small line under the name on a tile, e.g. "500 g · gemischt · bio". */
export function itemSpecification(item: { amounts: Amount[]; properties: string[]; note: string | null }): string {
  return [formatAmounts(item.amounts), ...item.properties, item.note ?? ''].filter(Boolean).join(' · ');
}
