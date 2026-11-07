import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './helpers.js';

type User = { cookie: string; id: string };
let t: Awaited<ReturnType<typeof createTestApp>>;
let soenke: User;
let ina: User;
let paul: User;
let tom: User;

const as = (u: User, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
  t.app.inject({ method, url, headers: { cookie: u.cookie }, ...(payload !== undefined ? { payload: payload as object } : {}) });
const lists = async (u: User) => ((await as(u, 'GET', '/api/v1/lists')).json() as { name: string }[]).map((l) => l.name).sort();

beforeAll(async () => {
  t = await createTestApp({ env: { OIDC_OWNER_GROUP: 'familie' } });
  soenke = await t.login('Sönke Jacobs', '', ['familie']);
  ina = await t.login('Ina Jacobs', '', ['familie']);
  paul = await t.login('Paul Meier');
  tom = await t.login('Tom Schulz');
});
afterAll(async () => t?.close());

describe('households overview', () => {
  it('lists every household with its people, the own one first', async () => {
    const all = (await as(paul, 'GET', '/api/v1/households')).json() as { name: string; own: boolean; members: { displayName: string }[] }[];
    expect(all.map((h) => [h.name, h.own, h.members.map((m) => m.displayName)])).toEqual([
      ['Meier', true, ['Paul Meier']],
      ['Jacobs', false, ['Ina Jacobs', 'Sönke Jacobs']],
      ['Schulz', false, ['Tom Schulz']],
    ]);
  });
});

describe('sharing a list beyond the household', () => {
  let listId: string;
  let meierId: string;

  it('with another household: all its members, also those who join later', async () => {
    listId = (await as(soenke, 'POST', '/api/v1/lists', { name: 'Grillfest' })).json().id;
    const all = (await as(soenke, 'GET', '/api/v1/households')).json() as { id: string; name: string }[];
    meierId = all.find((h) => h.name === 'Meier')!.id;
    expect((await as(soenke, 'POST', `/api/v1/lists/${listId}/households`, { householdId: meierId })).statusCode).toBe(200);
    expect(await lists(paul)).toEqual(['Grillfest']);
    expect((await as(paul, 'GET', `/api/v1/lists/${listId}/households`)).json().map((h: { name: string }) => h.name)).toEqual(['Meier']);
    const members = (await as(paul, 'GET', `/api/v1/lists/${listId}/members`)).json() as { displayName: string; via: string }[];
    expect(members.find((m) => m.displayName === 'Paul Meier')?.via).toBe('shared');
    expect(await lists(tom)).toEqual([]);
  });

  it('with one person from another household', async () => {
    expect((await as(ina, 'POST', `/api/v1/lists/${listId}/members`, { userId: tom.id })).statusCode).toBe(200);
    expect(await lists(tom)).toEqual(['Grillfest']);
    const members = (await as(tom, 'GET', `/api/v1/lists/${listId}/members`)).json() as { displayName: string; via: string }[];
    expect(members.find((m) => m.displayName === 'Tom Schulz')?.via).toBe('invite');
  });

  it('ends for the household when the owner stops sharing – invited people stay', async () => {
    expect((await as(paul, 'DELETE', `/api/v1/lists/${listId}/households/${meierId}`)).statusCode).toBe(403);
    expect((await as(soenke, 'DELETE', `/api/v1/lists/${listId}/households/${meierId}`)).statusCode).toBe(200);
    expect(await lists(paul)).toEqual([]);
    expect(await lists(tom)).toEqual(['Grillfest']);
  });

  it('reaches people who join a shared household later', async () => {
    const wg = (await as(soenke, 'POST', '/api/v1/lists', { name: 'WG-Party' })).json().id as string;
    const lea = await t.login('Lea Brandt', 'WG');
    const wgId = ((await as(lea, 'GET', '/api/v1/households')).json() as { id: string; own: boolean }[]).find((h) => h.own)!.id;
    await as(soenke, 'POST', `/api/v1/lists/${wg}/households`, { householdId: wgId });
    expect(await lists(lea)).toEqual(['WG-Party']);
    const max = await t.login('Max Roth', 'WG');
    expect(await lists(max)).toEqual(['WG-Party']);
    // Moving out takes them off again.
    await t.login('Max Roth');
    expect(await lists(max)).toEqual([]);
  });

  it('is only for members of the list, and only for accounts', async () => {
    const secret = (await as(soenke, 'POST', '/api/v1/lists', { name: 'Geheim', private: true })).json().id as string;
    expect((await as(tom, 'POST', `/api/v1/lists/${secret}/members`, { userId: tom.id })).statusCode).toBe(404);
    expect((await as(tom, 'POST', `/api/v1/lists/${secret}/households`, { householdId: meierId })).statusCode).toBe(404);
  });
});

describe('sharing badge', () => {
  it('tells link and people apart, and goes away again', async () => {
    const id = (await as(soenke, 'POST', '/api/v1/lists', { name: 'Badge' })).json().id as string;
    const sharing = async () => (await t.sync.pull(soenke.id, 0)).lists.find((l) => l.id === id)!.sharing;
    expect(await sharing()).toBeNull();
    await as(soenke, 'POST', `/api/v1/lists/${id}/members`, { userId: tom.id });
    expect(await sharing()).toBe('people');
    const url = (await as(soenke, 'GET', `/api/v1/lists/${id}/share-link`)).json().url as string;
    await t.app.inject({ method: 'GET', url: new URL(url).pathname, headers: { cookie: paul.cookie } });
    expect(await sharing()).toBe('both');
    await as(soenke, 'DELETE', `/api/v1/lists/${id}/members/${tom.id}`);
    expect(await sharing()).toBe('link');
    await as(soenke, 'DELETE', `/api/v1/lists/${id}/members/${paul.id}`);
    expect(await sharing()).toBeNull();
  });
});
