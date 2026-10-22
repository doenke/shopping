import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from './schema.js';

export type Db = ReturnType<typeof createDb>['db'];
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

export function createDb(url: string) {
  const client = postgres(url, { max: 10, onnotice: () => {} });
  const db = drizzle(client, { schema });
  return { db, close: () => client.end() };
}

export async function runMigrations(db: Db, folder?: string): Promise<void> {
  // Source layout: src/db/index.ts, bundled layout: dist/main.js – both next to apps/server/drizzle.
  const candidates = [new URL('../../drizzle', import.meta.url), new URL('../drizzle', import.meta.url)].map((u) => fileURLToPath(u));
  const migrationsFolder = folder ?? process.env.MIGRATIONS_DIR ?? candidates.find((c) => existsSync(`${c}/meta/_journal.json`)) ?? candidates[0]!;
  await migrate(db, { migrationsFolder });
}
