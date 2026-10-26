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
  // Another household: sees the owner's lists only through the link.
  member = await t.login('Member', 'Nachbarn');
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

describe('guests and members', () => {
  const list2 = randomUUID();
  let token: string;
  let guestCookie: string;

  beforeAll(async () => {
    await t.app.inject({
      method: 'POST',
      url: '/api/v1/sync/push',
      headers: { cookie: owner.cookie },
      payload: { mutations: [client.list(list2, { name: 'Grillen' })] },
    });
    const url = (await t.app.inject({ method: 'GET', url: `/api/v1/lists/${list2}/share-link`, headers: { cookie: owner.cookie } })).json().url;
    token = url.split('/s/')[1];
  });

  it('lets someone without account join as guest of exactly this list', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/auth/guest', payload: { token, name: 'Oma' } });
    expect(res.json()).toEqual({ ok: true, listId: list2 });
    guestCookie = `sid=${res.cookies.find((c) => c.name === 'sid')!.value}`;
    const cs: ChangeSet = (await t.app.inject({ method: 'GET', url: '/api/v1/sync/pull', headers: { cookie: guestCookie } })).json();
    expect(cs.lists.map((l) => l.id)).toEqual([list2]);
    expect(cs.me).toMatchObject({ displayName: 'Oma', defaultListId: list2, isGuest: true });
  });

  it('lets the guest work on the list but nothing else', async () => {
    const guest = new FakeClient('guest');
    const push = async (m: unknown) =>
      (await t.app.inject({ method: 'POST', url: '/api/v1/sync/push', headers: { cookie: guestCookie }, payload: { mutations: [m] } })).json();
    expect((await push(guest.item(randomUUID(), { listId: list2, name: 'Kohle', position: 'a0' }))).rejected).toEqual([]);
    expect((await push(guest.list(randomUUID(), { name: 'Eigene' }))).rejected[0].reason).toBe('guest');
    const mealie = await t.app.inject({ method: 'GET', url: '/api/v1/integrations/mealie', headers: { cookie: guestCookie } });
    expect(mealie.statusCode).toBe(403);
  });

  it('shows members with owner and guest flags', async () => {
    const res = await t.app.inject({ method: 'GET', url: `/api/v1/lists/${list2}/members`, headers: { cookie: owner.cookie } });
    expect(res.json().map((m: { displayName: string; isOwner: boolean; isGuest: boolean }) => [m.displayName, m.isOwner, m.isGuest])).toEqual([
      ['Owner', true, false],
      ['Oma', false, true],
    ]);
  });

  it('ends guest access when the link is renewed', async () => {
    const r = await t.app.inject({ method: 'POST', url: `/api/v1/lists/${list2}/share-link/renew`, headers: { cookie: owner.cookie } });
    expect(r.json().guestsRemoved).toBe(1);
    const me = await t.app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: guestCookie } });
    expect(me.statusCode).toBe(401);
  });

  it('lets only the owner remove members', async () => {
    await t.app.inject({ method: 'GET', url: (await t.app.inject({ method: 'GET', url: `/api/v1/lists/${list2}/share-link`, headers: { cookie: owner.cookie } })).json().url.replace('http://localhost:3000', ''), headers: { cookie: member.cookie } });
    const denied = await t.app.inject({ method: 'DELETE', url: `/api/v1/lists/${list2}/members/${owner.id}`, headers: { cookie: member.cookie } });
    expect(denied.statusCode).toBe(403);
    const ok = await t.app.inject({ method: 'DELETE', url: `/api/v1/lists/${list2}/members/${member.id}`, headers: { cookie: owner.cookie } });
    expect(ok.json()).toEqual({ ok: true });
    expect((await pull(member)).lists.find((l) => l.id === list2)).toBeUndefined();
  });
});
