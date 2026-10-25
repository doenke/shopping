import { createHash } from 'node:crypto';
import { seedCatalog } from '@shopping/shared';
import { sql } from 'drizzle-orm';
import type { DbOrTx } from './index.js';
import { catalogItems } from './schema.js';

/** Deterministic UUID (v5-like) so seed items keep their id across installations. */
export function stableUuid(namespace: string, name: string): string {
  const h = createHash('sha1').update(`${namespace}:${name}`).digest();
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const hex = h.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Inserts missing built-in catalog items. Existing (possibly edited) items are left alone. */
export async function seedBaseCatalog(db: DbOrTx): Promise<number> {
  const rows = seedCatalog().map((s) => ({
    // Packing items may share a name with groceries ("Zahnpasta") – own namespace keeps them apart.
    id: stableUuid(s.kind === 'packing' ? 'shopping-seed-packing' : 'shopping-seed', s.name.toLowerCase()),
    kind: s.kind,
    name: s.name,
    categoryId: s.categoryId,
    defaultUnit: s.defaultUnit,
    aliases: s.aliases,
    pantry: s.pantry,
    source: 'seed' as const,
  }));
  const inserted = await db
    .insert(catalogItems)
    .values(rows)
    .onConflictDoNothing({ target: catalogItems.id })
    .returning({ id: catalogItems.id });
  return inserted.length;
}

export async function currentSeq(db: DbOrTx): Promise<number> {
  const [row] = await db.execute<{ last_value: string; is_called: boolean }>(sql`SELECT last_value, is_called FROM sync_seq`);
  return row && row.is_called ? Number(row.last_value) : 0;
}
