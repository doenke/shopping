import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createTestApp } from './helpers.js';

type User = { cookie: string; id: string };
let t: Awaited<ReturnType<typeof createTestApp>>;
let anna: User;
const as = (u: User, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) =>
  t.app.inject({ method, url, headers: { cookie: u.cookie }, ...(payload !== undefined ? { payload: payload as object } : {}) });

beforeAll(async () => {
  t = await createTestApp();
  anna = await t.login('Anna');
});
afterAll(async () => t?.close());

async function listWith(type: string, n: number, extra: Record<string, unknown> = {}) {
  const list = (await as(anna, 'POST', '/api/v1/lists', { name: `${type} ${Math.random()}`, type, ...extra })).json();
  const names = Array.from({ length: n }, (_, i) => `Ding ${i + 1}`);
  await as(anna, 'POST', `/api/v1/lists/${list.id}/items`, { items: names.map((name) => ({ name })) });
  const items = (await as(anna, 'GET', `/api/v1/lists/${list.id}`)).json().items as { id: string; name: string }[];
  // Checked one after the other: "Ding 1" is the oldest.
  for (const name of names) {
    const item = items.find((i) => i.name === name)!;
    await as(anna, 'PATCH', `/api/v1/items/${item.id}`, { checked: true });
  }
  return list.id as string;
}

const done = async (listId: string) =>
  (await as(anna, 'GET', `/api/v1/lists/${listId}?items=done`))
    .json()
    .items.filter((i: { checked: boolean }) => i.checked)
    .map((i: { name: string }) => i.name);

describe('cleaning up checked entries', () => {
  it('keeps only the newest checked entries of shopping and todo lists', async () => {
    const shopping = await listWith('shopping', 5);
    const todo = await listWith('todo', 4);
    const before = await t.sync.pull(anna.id, 0);

    const users = await t.sync.pruneDone(3);
    expect([...users]).toEqual([anna.id]);
    expect((await done(shopping)).sort()).toEqual(['Ding 3', 'Ding 4', 'Ding 5']);
    expect((await done(todo)).sort()).toEqual(['Ding 2', 'Ding 3', 'Ding 4']);

    // Clients learn about it through the normal sync.
    const delta = await t.sync.pull(anna.id, before.seq);
    expect(
      delta.items
        .filter((i) => i.deleted)
        .map((i) => i.name)
        .sort(),
    ).toEqual(['Ding 1', 'Ding 1', 'Ding 2']);

    // Nothing left to do.
    expect((await t.sync.pruneDone(3)).size).toBe(0);
  });

  it('leaves packing lists, templates and open entries alone', async () => {
    const packing = await listWith('packing', 5);
    const template = await listWith('shopping', 5, { isTemplate: true });
    const open = (await as(anna, 'POST', '/api/v1/lists', { name: 'Offen' })).json().id as string;
    await as(anna, 'POST', `/api/v1/lists/${open}/items`, { text: 'Milch; Brot; Eier; Butter' });

    await t.sync.pruneDone(3);
    expect(await done(packing)).toHaveLength(5);
    // Templates ignore checking anyway; even if marked, nothing is removed.
    await t.db.execute(sql`UPDATE list_items SET checked = true WHERE list_id = ${template}`);
    await t.sync.pruneDone(3);
    const [kept] = await t.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM list_items WHERE list_id = ${template} AND NOT deleted`);
    expect(kept!.n).toBe(5);
    expect((await as(anna, 'GET', `/api/v1/lists/${open}`)).json().items).toHaveLength(4);
  });
});

describe('recurring checklists', () => {
  it('open again what was checked before the current period', async () => {
    const list = (await as(anna, 'POST', '/api/v1/lists', { name: 'Haus verlassen', type: 'todo' })).json();
    await as(anna, 'POST', `/api/v1/lists/${list.id}/items`, { text: 'Fenster zu; Herd aus; Licht aus' });
    const items = (await as(anna, 'GET', `/api/v1/lists/${list.id}`)).json().items as { id: string; name: string }[];
    for (const i of items) await as(anna, 'PATCH', `/api/v1/items/${i.id}`, { checked: true });
    // "Fenster zu" was checked last week, the others today.
    const fenster = items.find((i) => i.name === 'Fenster zu')!;
    await t.db.execute(sql`UPDATE list_items SET checked_at = '2026-11-01T10:00:00.000Z' WHERE id = ${fenster.id}`);
    const now = new Date('2026-11-12T09:00:00Z');

    // Without the setting nothing happens.
    expect((await t.sync.resetRecurring(now)).size).toBe(0);

    await t.db.execute(sql`UPDATE lists SET settings = settings || '{"reset":"weekly"}'::jsonb WHERE id = ${list.id}`);
    await t.db.execute(sql`UPDATE list_items SET checked_at = '2026-11-12T08:00:00.000Z' WHERE list_id = ${list.id} AND id <> ${fenster.id}`);
    const before = await t.sync.pull(anna.id, 0);
    expect([...(await t.sync.resetRecurring(now))]).toEqual([anna.id]);
    expect((await done(list.id)).sort()).toEqual(['Herd aus', 'Licht aus']);
    const delta = await t.sync.pull(anna.id, before.seq);
    expect(delta.items.map((i) => [i.name, i.checked])).toEqual([['Fenster zu', false]]);

    // Daily: today's checks stay until midnight.
    await t.db.execute(sql`UPDATE lists SET settings = settings || '{"reset":"daily"}'::jsonb WHERE id = ${list.id}`);
    expect((await t.sync.resetRecurring(now)).size).toBe(0);
    expect((await t.sync.resetRecurring(new Date('2026-11-13T00:30:00Z'))).size).toBe(1);
    expect(await done(list.id)).toEqual([]);
  });
});
