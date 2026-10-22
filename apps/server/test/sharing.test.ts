import { randomUUID } from 'node:crypto';
import type { ChangeSet } from '@shopping/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { safeNext } from '../src/auth/routes.js';
import { createTestApp, FakeClient } from './helpers.js';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;
type User = Awaited<ReturnType<TestApp['login']>>;

let t: TestApp;
let owner: User;
let member: User;
const client = new FakeClient('owner');
const listId = randomUUID();

const pull = async (u: User): Promise<ChangeSet> =>
  (await t.app.inject({ method: 'GET', url: '/api/v1/sync/pull?since=0', headers: { cookie: u.cookie } })).json();

const shareUrl = async (u: User) => t.app.inject({ method: 'GET', url: `/api/v1/lists/${listId}/share-link`, headers: { cookie: u.cookie } });

beforeAll(async () => {
  t = await createTestApp();
  owner = await t.login('Owner');
  member = await t.login('Member');
  await t.app.inject({
    method: 'POST',
    url: '/api/v1/sync/push',
    headers: { cookie: owner.cookie },
    payload: { mutations: [client.list(listId, { name: 'Haushalt' })] },
  });
});
afterAll(async () => t?.close());

describe('sharing by link', () => {
  let link: string;

  it('only lets members fetch the link, and keeps it stable', async () => {
    expect((await shareUrl(member)).statusCode).toBe(404);
    const first = (await shareUrl(owner)).json().url as string;
    expect(first).toMatch(/^http:\/\/localhost:3000\/s\/[A-Za-z0-9_-]+$/);
    expect((await shareUrl(owner)).json().url).toBe(first);
    link = new URL(first).pathname;
  });

  it('sends visitors without session to the login and back', async () => {
    const res = await t.app.inject({ method: 'GET', url: link });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`/?next=${encodeURIComponent(link)}`);
  });

  it('makes a logged-in visitor a member', async () => {
    const res = await t.app.inject({ method: 'GET', url: link, headers: { cookie: member.cookie } });
    expect(res.headers.location).toBe(`/#/list/${listId}`);
    expect((await pull(member)).lists.map((l) => l.id)).toEqual([listId]);
    // Members may share the link further.
    expect((await shareUrl(member)).json().url).toContain(link);
  });

  it('lets only the owner renew; old link dies, members stay', async () => {
    const denied = await t.app.inject({ method: 'POST', url: `/api/v1/lists/${listId}/share-link/renew`, headers: { cookie: member.cookie } });
    expect(denied.statusCode).toBe(403);
    const renewed = await t.app.inject({ method: 'POST', url: `/api/v1/lists/${listId}/share-link/renew`, headers: { cookie: owner.cookie } });
    expect(new URL(renewed.json().url).pathname).not.toBe(link);
    const old = await t.app.inject({ method: 'GET', url: link, headers: { cookie: member.cookie } });
    expect(old.headers.location).toBe('/?join=invalid');
    expect((await pull(member)).lists).toHaveLength(1);
  });

  it('lets members leave, but not the owner', async () => {
    const { seq } = await pull(member);
    const left = await t.app.inject({ method: 'POST', url: `/api/v1/lists/${listId}/leave`, headers: { cookie: member.cookie } });
    expect(left.json()).toEqual({ ok: true });
    const delta: ChangeSet = (await t.app.inject({ method: 'GET', url: `/api/v1/sync/pull?since=${seq}`, headers: { cookie: member.cookie } })).json();
    expect(delta.removedLists).toEqual([listId]);
    const ownerLeave = await t.app.inject({ method: 'POST', url: `/api/v1/lists/${listId}/leave`, headers: { cookie: owner.cookie } });
    expect(ownerLeave.statusCode).toBe(409);
  });

  it('only accepts list links as return target', () => {
    expect(safeNext('/s/abcdefghijkl')).toBe('/s/abcdefghijkl');
    expect(safeNext('https://evil.example')).toBe('/');
    expect(safeNext('//evil.example')).toBe('/');
    expect(safeNext(undefined)).toBe('/');
  });
});
