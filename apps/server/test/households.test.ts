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
  it('know their name: the claim, or the last name of the first member', async () => {
    expect((await as(anna, 'GET', '/api/v1/me')).json().household).toBe('Anna');
    expect((await as(carla, 'GET', '/api/v1/me')).json().household).toBe('Müller');
    // Without an owner group there is no owner household.
    expect((await as(anna, 'GET', '/api/v1/me')).json().householdIsOwner).toBe(false);
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

describe('owner group', () => {
  let o: Awaited<ReturnType<typeof createTestApp>>;
  beforeAll(async () => {
    o = await createTestApp({ env: { OIDC_OWNER_GROUP: 'familie' } });
  });
  afterAll(async () => o?.close());
  const me = async (u: User) => (await o.app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: u.cookie } })).json();
  const lists = async (u: User) =>
    ((await o.app.inject({ method: 'GET', url: '/api/v1/lists', headers: { cookie: u.cookie } })).json() as { name: string }[]).map((l) => l.name).sort();

  it('puts the group into the owner household and everyone else into their own', async () => {
    const soenke = await o.login('Sönke Jacobs', '', ['familie']);
    const ina = await o.login('Ina Jacobs', '', ['familie', 'admins']);
    const gast = await o.login('Paul Meier', '', ['admins']);
    const tom = await o.login('Tom Schulz');
    expect((await me(soenke)).household).toBe('Jacobs');
    expect((await me(ina)).household).toBe('Jacobs');
    expect((await me(gast)).household).toBe('Meier');
    expect((await me(tom)).household).toBe('Schulz');
    expect((await me(soenke)).householdIsOwner).toBe(true);
    expect((await me(tom)).householdIsOwner).toBe(false);

    await o.app.inject({ method: 'POST', url: '/api/v1/lists', headers: { cookie: soenke.cookie }, payload: { name: 'Wocheneinkauf' } });
    await o.app.inject({ method: 'POST', url: '/api/v1/lists', headers: { cookie: gast.cookie }, payload: { name: 'Pauls Liste' } });
    expect(await lists(ina)).toEqual(['Wocheneinkauf']);
    expect(await lists(gast)).toEqual(['Pauls Liste']);
    expect(await lists(tom)).toEqual([]);
  });

  it('lets an explicit household claim win', async () => {
    const lea = await o.login('Lea Schulz', 'Schulz WG');
    const max = await o.login('Max Becker', 'Schulz WG');
    expect((await me(max)).household).toBe('Schulz WG');
    await o.app.inject({ method: 'POST', url: '/api/v1/lists', headers: { cookie: lea.cookie }, payload: { name: 'WG-Einkauf' } });
    expect(await lists(max)).toEqual(['WG-Einkauf']);
  });

  it('can be renamed by any member', async () => {
    const ina = await o.login('Ina Jacobs', '', ['familie']);
    const soenke = await o.login('Sönke Jacobs', '', ['familie']);
    const before = (await o.sync.pull(soenke.id, 0)).seq;
    const res = await o.app.inject({ method: 'PATCH', url: '/api/v1/me/household', headers: { cookie: ina.cookie }, payload: { name: 'Familie Jacobs' } });
    expect(res.statusCode).toBe(200);
    expect((await me(soenke)).household).toBe('Familie Jacobs');
    // Devices learn it through the sync.
    expect((await o.sync.pull(soenke.id, before)).me?.household).toBe('Familie Jacobs');
    // A new login keeps the name.
    await o.login('Sönke Jacobs', '', ['familie']);
    expect((await me(soenke)).household).toBe('Familie Jacobs');
  });
});
