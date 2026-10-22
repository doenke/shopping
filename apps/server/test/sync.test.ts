import { randomUUID } from 'node:crypto';
import type { ChangeSet, ServerMessage } from '@shopping/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { listMembers } from '../src/db/schema.js';
import { createTestApp, FakeClient } from './helpers.js';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;
type User = Awaited<ReturnType<TestApp['login']>>;

let t: TestApp;
let anna: User;
let ben: User;
const annaClient = new FakeClient('anna-phone');
const benClient = new FakeClient('ben-phone');

async function push(user: User, mutations: unknown[]) {
  const res = await t.app.inject({ method: 'POST', url: '/api/v1/sync/push', headers: { cookie: user.cookie }, payload: { mutations } });
  expect(res.statusCode).toBe(200);
  return res.json() as { acked: string[]; rejected: { mid: string; reason: string }[] };
}

async function pull(user: User, since = 0): Promise<ChangeSet> {
  const res = await t.app.inject({ method: 'GET', url: `/api/v1/sync/pull?since=${since}`, headers: { cookie: user.cookie } });
  expect(res.statusCode).toBe(200);
  return res.json();
}

beforeAll(async () => {
  t = await createTestApp();
  anna = await t.login('Anna');
  ben = await t.login('Ben');
});

afterAll(async () => {
  await t?.close();
});

describe('health', () => {
  it('reports healthy while the database answers', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});

describe('auth', () => {
  it('rejects requests without session', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/v1/me' });
    expect(res.statusCode).toBe(401);
  });
});

describe('sync', () => {
  const listId = randomUUID();
  const milk = randomUUID();

  it('creates a list and makes it the main list', async () => {
    const r = await push(anna, [annaClient.list(listId, { name: 'Einkauf' })]);
    expect(r.rejected).toEqual([]);
    const cs = await pull(anna);
    expect(cs.lists.map((l) => l.name)).toEqual(['Einkauf']);
    expect(cs.me?.defaultListId).toBe(listId);
    expect(cs.seq).toBeGreaterThan(0);
  });

  it('hides lists from users without the link', async () => {
    const cs = await pull(ben);
    expect(cs.lists).toEqual([]);
    const r = await push(ben, [benClient.item(randomUUID(), { listId, name: 'Fremd', position: 'a0' })]);
    expect(r.rejected[0]?.reason).toBe('forbidden');
  });

  it('records who checked an item', async () => {
    await push(anna, [annaClient.item(milk, { listId, name: 'Milch', amounts: [{ q: 1, u: 'l' }], position: 'a0' })]);
    await push(anna, [annaClient.item(milk, { checked: true })]);
    const item = (await pull(anna)).items.find((i) => i.id === milk)!;
    expect(item).toMatchObject({ checked: true, checkedBy: anna.id });
    await push(anna, [annaClient.item(milk, { checked: false })]);
  });

  it('merges a duplicate that was added offline', async () => {
    const dup = randomUUID();
    await push(anna, [annaClient.item(dup, { listId, name: 'Milch', amounts: [{ q: 1, u: 'l' }], position: 'a1' })]);
    const items = (await pull(anna)).items;
    expect(items.find((i) => i.id === milk)?.amounts).toEqual([{ q: 2, u: 'l' }]);
    expect(items.find((i) => i.id === dup)).toBeUndefined(); // tombstones are not sent in full syncs
  });

  it('keeps concurrent edits to different fields and the newest write per field', async () => {
    const early = annaClient.item(milk, { note: 'die gute' });
    const late = benClient.item(milk, { properties: ['laktosefrei'] });
    // Ben joins the list (in phase 2 this happens by opening the link).
    await t.db.insert(listMembers).values({ listId, userId: ben.id });
    await push(ben, [late]);
    await push(anna, [early]);
    const item = (await pull(ben)).items.find((i) => i.id === milk)!;
    expect(item.note).toBe('die gute');
    expect(item.properties).toEqual(['laktosefrei']);

    const stale = { ...annaClient.item(milk, { name: 'Alt' }), hlc: '0000000000001:0000:old' };
    await push(anna, [stale]);
    expect((await pull(anna)).items.find((i) => i.id === milk)!.name).toBe('Milch');
  });

  it('delivers only changes since a cursor', async () => {
    const { seq } = await pull(anna);
    const bread = randomUUID();
    await push(anna, [annaClient.item(bread, { listId, name: 'Brot', position: 'a2' })]);
    const delta = await pull(anna, seq);
    expect(delta.items.map((i) => i.name)).toEqual(['Brot']);
    expect(delta.lists).toEqual([]);
  });

  it('only lets the owner delete a list', async () => {
    const r = await push(ben, [benClient.list(listId, { deleted: true })]);
    expect(r.rejected[0]?.reason).toBe('owner_only');
  });

  it('applies valid mutations even if one in the batch is invalid', async () => {
    const ok = annaClient.item(randomUUID(), { listId, name: 'Butter', position: 'a3' });
    const r = await push(anna, [{ mid: randomUUID(), entity: 'item', id: 'kaputt' }, ok]);
    expect(r.acked).toEqual([ok.mid]);
    expect(r.rejected).toHaveLength(1);
  });

  it('pushes changes to other members in real time', async () => {
    const address = await t.app.listen({ port: 0, host: '127.0.0.1' });
    const ws = new WebSocket(`${address.replace('http', 'ws')}/ws`, { headers: { cookie: ben.cookie } });
    const messages: ServerMessage[] = [];
    ws.on('message', (d) => messages.push(JSON.parse(String(d))));
    await new Promise((resolve) => ws.once('open', resolve));
    const { seq } = await pull(ben);
    ws.send(JSON.stringify({ t: 'hello', since: seq }));
    await waitFor(() => messages.some((m) => m.t === 'changes'));

    const started = Date.now();
    await push(anna, [annaClient.item(milk, { checked: true })]);
    await waitFor(() => messages.some((m) => m.t === 'changes' && m.items.some((i) => i.id === milk && i.checked)));
    expect(Date.now() - started).toBeLessThan(1000);

    ws.send(JSON.stringify({ t: 'ping' }));
    await waitFor(() => messages.some((m) => m.t === 'pong'));
    ws.close();
  });

  it('tells members when a list is deleted', async () => {
    const { seq } = await pull(ben);
    await push(anna, [annaClient.list(listId, { deleted: true })]);
    const delta = await pull(ben, seq);
    expect(delta.removedLists).toContain(listId);
  });
});

async function waitFor(cond: () => boolean, timeout = 3000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeout) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('templates', () => {
  it('cannot be checked', async () => {
    const t1 = randomUUID();
    const item = randomUUID();
    await push(anna, [annaClient.list(t1, { name: 'Grillabend', isTemplate: true })]);
    const r = await push(anna, [annaClient.item(item, { listId: t1, name: 'Würstchen', position: 'a0', optional: true })]);
    expect(r.rejected).toEqual([]);
    const c = await push(anna, [annaClient.item(item, { checked: true })]);
    expect(c.rejected[0]?.reason).toBe('template_not_checkable');
    const cs = await pull(anna);
    expect(cs.lists.find((l) => l.id === t1)).toMatchObject({ isTemplate: true });
    // A template never becomes the main list.
    expect(cs.me?.defaultListId).not.toBe(t1);
  });
});
