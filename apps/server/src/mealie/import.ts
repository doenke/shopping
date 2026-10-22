import { CATEGORIES, CatalogIndex, DEFAULT_CATEGORY, normalize, similarity } from '@shopping/shared';
import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { stableUuid } from '../db/seed.js';
import { catalogItems } from '../db/schema.js';
import { toCatalogItem } from '../sync/rows.js';
import type { MealieFood } from './client.js';

export interface ImportResult {
  created: number;
  linked: number;
  updated: number;
  labels: string[];
}

/** Guesses a category for a Mealie label by name, e.g. "Obst und Gemüse" -> obst-gemuese. */
export function guessCategory(label: string): string | undefined {
  const l = normalize(label).replace(/\bund\b/g, ' ').replace(/\s+/g, ' ');
  let best: { id: string; score: number } | undefined;
  for (const c of CATEGORIES) {
    const name = normalize(c.name).replace(/\s+/g, ' ');
    const parts = name.split(' ').filter((p) => p.length > 3);
    const score = Math.max(similarity(l, name), ...parts.map((p) => (l.includes(p) ? 0.6 : 0)));
    if (score >= 0.45 && (!best || score > best.score)) best = { id: c.id, score };
  }
  return best?.id;
}

/**
 * Brings Mealie foods into the catalog:
 * - already linked items get name/plural/aliases refreshed,
 * - foods matching an existing item by name get linked to it,
 * - everything else becomes a new catalog item.
 * Categories come from the label mapping; hand-edited categories are kept.
 */
export async function importFoods(db: Db, foods: MealieFood[], labelMapping: Record<string, string>): Promise<ImportResult> {
  const result: ImportResult = { created: 0, linked: 0, updated: 0, labels: [] };
  const labels = new Set<string>();
  const existing = (await db.select().from(catalogItems)).map((r) => ({ record: r, item: toCatalogItem(r) }));
  const byMealie = new Map(existing.filter((e) => e.record.mealieFoodId).map((e) => [e.record.mealieFoodId!, e.record]));
  const index = new CatalogIndex(existing.filter((e) => !e.record.mealieFoodId).map((e) => e.item));

  await db.transaction(async (tx) => {
    for (const food of foods) {
      const name = food.name?.trim();
      if (!name) continue;
      const labelName = food.label?.name?.trim();
      if (labelName) labels.add(labelName);
      const mapped = labelName ? (labelMapping[labelName] ?? guessCategory(labelName)) : undefined;
      const aliases = (food.aliases ?? []).map((a) => a.name.trim()).filter(Boolean);
      const plural = food.pluralName?.trim() || null;

      const linked = byMealie.get(food.id);
      if (linked) {
        await tx
          .update(catalogItems)
          .set({
            plural,
            aliases: [...new Set([...linked.aliases, ...aliases])],
            ...(linked.source === 'mealie' ? { name } : {}),
            ...(mapped && !linked.categoryLocked ? { categoryId: mapped } : {}),
            seq: sql`nextval('sync_seq')`,
          })
          .where(eq(catalogItems.id, linked.id));
        result.updated++;
        continue;
      }

      const match = index.match(name, false) ?? (plural ? index.match(plural, false) : undefined);
      if (match) {
        const rec = existing.find((e) => e.item.id === match.id)!.record;
        if (!rec.mealieFoodId) {
          const extra = [name, plural, ...aliases].filter((a): a is string => !!a && a.toLowerCase() !== rec.name.toLowerCase());
          await tx
            .update(catalogItems)
            .set({ mealieFoodId: food.id, aliases: [...new Set([...rec.aliases, ...extra])], seq: sql`nextval('sync_seq')` })
            .where(eq(catalogItems.id, rec.id));
          rec.mealieFoodId = food.id;
          result.linked++;
          continue;
        }
      }

      await tx.insert(catalogItems).values({
        id: stableUuid('shopping-mealie', food.id),
        name,
        plural,
        aliases,
        categoryId: mapped ?? DEFAULT_CATEGORY,
        source: 'mealie',
        mealieFoodId: food.id,
      }).onConflictDoNothing();
      result.created++;
    }
  });
  result.labels = [...labels].sort((a, b) => a.localeCompare(b, 'de'));
  return result;
}
