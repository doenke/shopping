import { randomUUID } from 'node:crypto';
import { Hlc, type Mutation } from '@shopping/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './helpers.js';

let t: Awaited<ReturnType<typeof createTestApp>>;
let anna: { cookie: string };
let ben: { cookie: string };
let carla: { cookie: string };
const clock = new Hlc('category-test');
const as = (who: { cookie: string }, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) =>
  t.app.inject({ method, url, headers: { cookie: who.cookie }, ...(payload !== undefined ? { payload: payload as object } : {}) });
const category = (id: string, patch: Record<string, unknown>): Mutation => ({ mid: randomUUID(), entity: 'category', id, hlc: clock.tick(), patch }) as Mutation;
const pull = async (who: { cookie: string }, since = 0) => (await as(who, 'GET', `/api/v1/sync/pull?since=${since}`)).json();

beforeAll(async () => {
  t = await createTestApp();
  anna = await t.login('Anna');
  ben = await t.login('Ben');
  carla = await t.login('Carla', 'Müller');
});
afterAll(async () => t?.close());

describe('own categories', () => {
  const angeln = randomUUID();

  it('are created by sync and shared with the household', async () => {
    const res = await as(anna, 'POST', '/api/v1/sync/push', { mutations: [category(angeln, { listType: 'packing', name: 'Angeln' })] });
    expect(res.json().rejected).toEqual([]);

    const own = (await pull(anna)).categories;
    expect(own).toHaveLength(1);
    expect(own[0]).toMatchObject({ id: angeln, name: 'Angeln', listType: 'packing', deleted: false });
    expect(own[0].color).toMatch(/^#[0-9A-F]{6}$/i);
    expect((await pull(ben)).categories.map((c: { name: string }) => c.name)).toEqual(['Angeln']);
    // Another household does not see it.
    expect((await pull(carla)).categories).toEqual([]);
  });

  it('can be used for items and shows up in the API', async () => {
    const list = (await as(anna, 'POST', '/api/v1/lists', { name: 'Wochenende am See', type: 'packing' })).json();
    const added = await as(anna, 'POST', `/api/v1/lists/${list.id}/items`, { items: [{ name: 'Angelrute', category: 'Angeln' }] });
    expect(added.statusCode).toBeLessThan(300);
    const items = (await as(anna, 'GET', `/api/v1/lists/${list.id}`)).json().items;
    expect(items[0].category).toEqual({ id: angeln, name: 'Angeln' });

    // Shared with Carla by link: she sees the category of that list's household.
    const url = (await as(anna, 'GET', `/api/v1/lists/${list.id}/share-link`)).json().url as string;
    await as(carla, 'GET', url.replace(/^https?:\/\/[^/]+/, ''));
    const forCarla = await pull(carla);
    expect(forCarla.lists.map((l: { id: string }) => l.id)).toContain(list.id);
    expect(forCarla.categories.map((c: { name: string }) => c.name)).toEqual(['Angeln']);
  });

  it('can be renamed by the household and deleted; deltas carry the change', async () => {
    const before = (await pull(ben)).seq;
    const res = await as(ben, 'POST', '/api/v1/sync/push', { mutations: [category(angeln, { name: 'Angeln & Fischen', listType: 'shopping' })] });
    expect(res.json().rejected).toEqual([]);
    const delta = await pull(anna, before);
    expect(delta.categories).toHaveLength(1);
    // The list type stays what it was.
    expect(delta.categories[0]).toMatchObject({ name: 'Angeln & Fischen', listType: 'packing' });

    // Someone from another household may not change it.
    const foreign = await as(carla, 'POST', '/api/v1/sync/push', { mutations: [category(angeln, { name: 'Gekapert' })] });
    expect(foreign.json().rejected).toHaveLength(1);

    await as(anna, 'POST', '/api/v1/sync/push', { mutations: [category(angeln, { deleted: true })] });
    expect((await pull(anna)).categories).toEqual([]);
  });

  it('refuses incomplete ones', async () => {
    const res = await as(anna, 'POST', '/api/v1/sync/push', { mutations: [category(randomUUID(), { name: 'Ohne Typ' })] });
    expect(res.json().rejected).toHaveLength(1);
  });
});
