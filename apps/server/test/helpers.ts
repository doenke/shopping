import { randomUUID } from 'node:crypto';
import type { Mutation } from '@shopping/shared';
import { Hlc } from '@shopping/shared';
import postgres from 'postgres';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createDb, runMigrations } from '../src/db/index.js';
import { seedBaseCatalog } from '../src/db/seed.js';

const ADMIN_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@127.0.0.1:54329/postgres';

export async function createTestApp(extra: { fetchImpl?: typeof fetch } = {}) {
  const name = `shopping_test_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${name}`);
  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  const { db, close } = createDb(url.toString());
  await runMigrations(db);
  await seedBaseCatalog(db);
  const config = loadConfig({
    DATABASE_URL: url.toString(),
    PUBLIC_URL: 'http://localhost:3000',
    SECRET_KEY: 'test-secret-key-0123456789',
    DEV_LOGIN: 'true',
    LOG_LEVEL: 'error',
    WEB_DIST: '/nonexistent',
  });
  const { app, sync } = await buildApp({ config, db, ...extra });
  await app.ready();

  return {
    app,
    db,
    sync,
    async login(userName: string) {
      const res = await app.inject({ method: 'POST', url: '/auth/dev', payload: { name: userName } });
      const cookie = res.cookies.find((c) => c.name === 'sid')!;
      const me = await app.inject({ method: 'GET', url: '/api/v1/me', cookies: { sid: cookie.value } });
      return { cookie: `sid=${cookie.value}`, sid: cookie.value, id: me.json().id as string };
    },
    async close() {
      await app.close();
      await close();
      await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await admin.end();
    },
  };
}

/** Builds mutations the way a client would. */
export class FakeClient {
  readonly clock: Hlc;
  constructor(node: string) {
    this.clock = new Hlc(node);
  }
  list(id: string, patch: Record<string, unknown>): Mutation {
    return { mid: randomUUID(), entity: 'list', id, hlc: this.clock.tick(), patch } as Mutation;
  }
  item(id: string, patch: Record<string, unknown>): Mutation {
    return { mid: randomUUID(), entity: 'item', id, hlc: this.clock.tick(), patch } as Mutation;
  }
}
