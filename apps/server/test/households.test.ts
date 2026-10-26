import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './helpers.js';

type User = { cookie: string; id: string };
let t: Awaited<ReturnType<typeof createTestApp>>;
let anna: User;
let ben: User;
let carla: User;

const as = (u: User, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) =>
  t.app.inject({ method, url, headers: { cookie: u.cookie }, ...(payload !== undefined ? { payload: payload as object } : {}) });
const listNames = async (u: User) => ((await as(u, 'GET', '/api/v1/lists?templates=include')).json() as { name: string }[]).map((l) => l.name).sort();

beforeAll(async () => {
  t = await createTestApp();
  anna = await t.login('Anna'); // no tag: default household
  ben = await t.login('Ben');
  carla = await t.login('Carla', 'Müller');
});
afterAll(async () => t?.close());

describe('households', () => {
  it('know their name: the tag, or the configured default', async () => {
    expect((await as(anna, 'GET', '/api/v1/me')).json().household).toBe('Haushalt');
    expect((await as(carla, 'GET', '/api/v1/me')).json().household).toBe('Müller');
  });

  it('share new lists with the whole household, and only with it', async () => {
    await as(anna, 'POST', '/api/v1/lists', { name: 'Einkauf' });
    expect(await listNames(ben)).toEqual(['Einkauf']);
    expect(await listNames(carla)).toEqual([]);
    // Ben gets it through the sync as well.
    const pull = (await as(ben, 'GET', '/api/v1/sync/pull?since=0')).json();
    expect(pull.lists.map((l: { name: string }) => l.name)).toEqual(['Einkauf']);
  });

  it('keep private lists to their owner, and can change that', async () => {
    const tagebuch = (await as(anna, 'POST', '/api/v1/lists', { name: 'Geschenke für Ben', private: true })).json();
    expect(tagebuch.visibility).toBe('private');
    expect(await listNames(ben)).toEqual(['Einkauf']);

    // Only the owner may change it.
    expect((await as(ben, 'PATCH', `/api/v1/lists/${tagebuch.id}`, { visibility: 'household' })).statusCode).toBe(404);
    const seqBefore = (await as(ben, 'GET', '/api/v1/sync/pull?since=0')).json().seq;
    await as(anna, 'PATCH', `/api/v1/lists/${tagebuch.id}`, { visibility: 'household' });
    expect(await listNames(ben)).toEqual(['Einkauf', 'Geschenke für Ben']);

    await as(anna, 'PATCH', `/api/v1/lists/${tagebuch.id}`, { visibility: 'private' });
    expect(await listNames(ben)).toEqual(['Einkauf']);
    // Ben's device is told to drop it.
    const delta = (await as(ben, 'GET', `/api/v1/sync/pull?since=${seqBefore}`)).json();
    expect(delta.removedLists).toContain(tagebuch.id);
  });

  it('respect leaving a list: a new login does not bring it back', async () => {
    const einkauf = (await as(ben, 'GET', '/api/v1/lists')).json()[0];
    expect((await as(ben, 'POST', `/api/v1/lists/${einkauf.id}/leave`)).statusCode).toBe(200);
    ben = await t.login('Ben');
    expect(await listNames(ben)).toEqual([]);
  });

  it('move people with their own lists when their tag changes', async () => {
    await as(ben, 'POST', '/api/v1/lists', { name: 'Werkzeug' });
    expect(await listNames(anna)).toContain('Werkzeug');
    await as(carla, 'POST', '/api/v1/lists', { name: 'Müllers Einkauf' });

    ben = await t.login('Ben', 'Müller');
    expect((await as(ben, 'GET', '/api/v1/me')).json().household).toBe('Müller');
    expect(await listNames(ben)).toEqual(['Müllers Einkauf', 'Werkzeug']);
    expect(await listNames(carla)).toEqual(['Müllers Einkauf', 'Werkzeug']);
    expect(await listNames(anna)).toEqual(['Einkauf', 'Geschenke für Ben']);
  });

  it('can still share across households with the link', async () => {
    const einkauf = (await as(anna, 'GET', '/api/v1/lists')).json().find((l: { name: string }) => l.name === 'Einkauf');
    const { url } = (await as(anna, 'GET', `/api/v1/lists/${einkauf.id}/share-link`)).json();
    await as(carla, 'GET', new URL(url).pathname);
    expect(await listNames(carla)).toContain('Einkauf');
  });
});
