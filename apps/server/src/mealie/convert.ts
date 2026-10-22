import { CatalogIndex, findUnit, getUnit, mergeAmounts, parseItem, type CatalogItem, type ParsedItem } from '@shopping/shared';
import type { MealieFood, MealieUnit } from './client.js';
import { guessCategory } from './import.js';

/** An item suggested for import; the user can still deselect it. */
export interface ImportCandidate extends ParsedItem {
  /** Usually in stock (salt, oil …) – deselected by default. */
  pantry: boolean;
  /** Recipe name(s) it comes from. */
  sources: string[];
}

export class Converter {
  private readonly index: CatalogIndex;
  private readonly byMealieFood: Map<string, CatalogItem>;
  private readonly byId: Map<string, CatalogItem>;

  constructor(
    catalog: CatalogItem[],
    private readonly labelMapping: Record<string, string>,
  ) {
    this.index = new CatalogIndex(catalog);
    this.byMealieFood = new Map(catalog.filter((c) => c.mealieFoodId).map((c) => [c.mealieFoodId!, c]));
    this.byId = new Map(catalog.map((c) => [c.id, c]));
  }

  unit(u: MealieUnit | null): string | null {
    if (!u) return null;
    for (const token of [u.abbreviation, u.name, u.pluralName]) {
      const found = token ? findUnit(token.trim()) : undefined;
      if (found) return found.id;
    }
    // Unknown units are kept as written ("1 Schale").
    return u.abbreviation?.trim() || u.name?.trim() || null;
  }

  /**
   * Converts a Mealie item/ingredient. `fallbackText` is parsed when Mealie
   * has no structured food (unparsed recipes).
   */
  convert(
    entry: { quantity: number | null; unit: MealieUnit | null; food: MealieFood | null; note: string | null },
    fallbackText: string | null,
    opts: { keepNote: boolean; scale?: number },
  ): ImportCandidate | null {
    const scale = opts.scale ?? 1;
    if (!entry.food) {
      const text = fallbackText?.trim() || entry.note?.trim();
      if (!text) return null;
      const parsed = parseItem(text, this.index);
      if (!parsed) return null;
      const amounts = parsed.amounts.map((a) => ({ ...a, q: a.q !== null ? shoppingQuantity(a.q * scale, a.u) : null }));
      const catalog = parsed.catalogItemId ? this.byId.get(parsed.catalogItemId) : undefined;
      return { ...parsed, amounts, pantry: catalog?.pantry ?? false, sources: [] };
    }

    const food = entry.food;
    const catalog =
      this.byMealieFood.get(food.id) ?? this.index.match(food.name, false) ?? (food.pluralName ? this.index.match(food.pluralName, false) : undefined);
    const u = this.unit(entry.unit);
    const q = entry.quantity && entry.quantity > 0 ? shoppingQuantity(entry.quantity * scale, u) : null;
    const label = food.label?.name;
    return {
      name: catalog?.name ?? capitalize(food.pluralName?.trim() || food.name.trim()),
      catalogItemId: catalog?.id ?? null,
      categoryId: catalog?.categoryId ?? (label ? (this.labelMapping[label] ?? guessCategory(label) ?? null) : null),
      amounts: q !== null || u !== null ? [{ q, u }] : [],
      properties: [],
      note: opts.keepNote && entry.note?.trim() ? entry.note.trim() : null,
      pantry: catalog?.pantry ?? false,
      sources: [],
    };
  }
}

/**
 * After scaling a recipe you cannot buy ¾ of an onion or ¾ of a can:
 * pieces and packages are rounded up to whole numbers, everything else to two decimals.
 */
export function shoppingQuantity(q: number, unitId: string | null): number {
  const dimension = unitId ? getUnit(unitId)?.dimension : 'count';
  if (dimension === 'count' || dimension === 'package') return Math.max(1, Math.ceil(q - 0.001));
  return round(q);
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Combines the same ingredient from several recipes into one candidate. */
export function mergeCandidates(list: ImportCandidate[]): ImportCandidate[] {
  const out: ImportCandidate[] = [];
  for (const c of list) {
    const key = c.catalogItemId ?? c.name.toLowerCase();
    const same = out.find((o) => (o.catalogItemId ?? o.name.toLowerCase()) === key && o.properties.join() === c.properties.join());
    if (!same) {
      out.push({ ...c, sources: [...c.sources] });
      continue;
    }
    same.amounts = mergeAmounts(same.amounts, c.amounts);
    for (const s of c.sources) if (!same.sources.includes(s)) same.sources.push(s);
  }
  return out;
}
