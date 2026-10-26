import { randomUUID } from 'node:crypto';
import { Hlc, type Mutation } from '@shopping/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './helpers.js';

let t: Awaited<ReturnType<typeof createTestApp>>;
let cookie: string;
const clock = new Hlc('order-test');
const req = (method: 'GET' | 'POST', url: string, payload?: unknown) =>
  t.app.inject({ method, url, headers: { cookie }, ...(payload !== undefined ? { payload: payload as object } : {}) });
const me = (patch: Record<string, unknown>): Mutation => ({ mid: randomUUID(), entity: 'me', id: 'me', hlc: clock.tick(), patch }) as Mutation;

beforeAll(async () => {
  t = await createTestApp();
  ({ cookie } = await t.login('Anna'));
});
afterAll(async () => t?.close());

describe('own order per user', () => {
  it('keeps the order of lists and categories, synced and used by the API', async () => {
    const a = (await req('POST', '/api/v1/lists', { name: 'Einkauf' })).json().id;
    const b = (await req('POST', '/api/v1/lists', { name: 'Drogerie' })).json().id;
    await req('POST', `/api/v1/lists/${a}/items`, { text: 'Milch, Äpfel, Brot' });

    const push = await req('POST', '/api/v1/sync/push', {
      mutations: [me({ listOrder: [b, a], categoryOrder: ['brot-gebaeck', 'milch-kaese', 'obst-gemuese'] })],
    });
    expect(push.json().rejected).toEqual([]);

    const pulled = (await req('GET', '/api/v1/sync/pull?since=0')).json().me;
    expect(pulled.listOrder).toEqual([b, a]);
    expect(pulled.categoryOrder).toEqual(['brot-gebaeck', 'milch-kaese', 'obst-gemuese']);

    expect((await req('GET', '/api/v1/lists')).json().map((l: { name: string }) => l.name)).toEqual(['Drogerie', 'Einkauf']);
    const items = (await req('GET', `/api/v1/lists/${a}`)).json().items.map((i: { name: string }) => i.name);
    expect(items).toEqual(['Brot', 'Milch', 'Äpfel']);
  });

  it('is per user', async () => {
    const ben = await t.login('Ben');
    const lists = (await t.app.inject({ method: 'GET', url: '/api/v1/lists', headers: { cookie: ben.cookie } })).json();
    expect(lists.map((l: { name: string }) => l.name)).toEqual(['Einkauf', 'Drogerie']);
  });
});
