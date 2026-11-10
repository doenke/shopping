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

const tick = (id: string, personChecks: Record<string, boolean>) =>
  t.sync.apply(anna.id, [{ mid: crypto.randomUUID(), entity: 'item', id, hlc: t.sync.clock.tick(), patch: { personChecks } }]);

async function item(listId: string, name: string) {
  const items = (await as(anna, 'GET', `/api/v1/lists/${listId}?items=all`)).json().items as {
    id: string;
    name: string;
    checked: boolean;
    checkedBy: string | null;
    person: string | null;
    persons: string[];
    donePersons: string[];
  }[];
  return items.find((i) => i.name === name)!;
}

describe('one entry for several people', () => {
  it('is ticked off per person and done when everyone is', async () => {
    const list = (await as(anna, 'POST', '/api/v1/lists', { name: 'Ostsee', type: 'packing' })).json();
    await as(anna, 'POST', `/api/v1/lists/${list.id}/items`, { text: 'Sonnenbrille @Sönke @Ulli' });
    // Adding it for someone else keeps one entry.
    await as(anna, 'POST', `/api/v1/lists/${list.id}/items`, { text: 'Sonnenbrille @Anna' });
    let brille = await item(list.id, 'Sonnenbrille');
    expect(brille.persons).toEqual(['Sönke', 'Ulli', 'Anna']);
    expect(brille.person).toBe('Sönke + Ulli + Anna');

    await tick(brille.id, { Ulli: true });
    await tick(brille.id, { Sönke: true });
    brille = await item(list.id, 'Sonnenbrille');
    expect(brille).toMatchObject({ checked: false, donePersons: ['Sönke', 'Ulli'] });

    // The last one: the whole entry is done, by whoever ticked it.
    await tick(brille.id, { anna: true });
    brille = await item(list.id, 'Sonnenbrille');
    expect(brille).toMatchObject({ checked: true, checkedBy: 'Anna', donePersons: ['Sönke', 'Ulli', 'Anna'] });

    // Unchecking the entry (e.g. via Home Assistant) opens it for everyone.
    await as(anna, 'PATCH', `/api/v1/items/${brille.id}`, { checked: false });
    expect(await item(list.id, 'Sonnenbrille')).toMatchObject({ checked: false, donePersons: [] });
  });

  it('templates: "für jeden" becomes the people of the list', async () => {
    const tpl = (await as(anna, 'POST', '/api/v1/lists', { name: 'Strand', type: 'packing', isTemplate: true })).json();
    await as(anna, 'POST', `/api/v1/lists/${tpl.id}/items`, { text: 'Sonnenbrille @alle; Sonnenschirm' });
    const inTemplate = (await as(anna, 'GET', `/api/v1/lists/${tpl.id}`)).json().items as { name: string; person: string | null }[];
    expect(inTemplate.find((i) => i.name === 'Sonnenbrille')!.person).toBeNull();

    const list = (await as(anna, 'POST', '/api/v1/lists', { name: 'Sylt', type: 'packing' })).json();
    await t.db.execute(sql`UPDATE lists SET settings = settings || '{"persons":["Sönke","Ulli"]}'::jsonb WHERE id = ${list.id}`);
    await as(anna, 'POST', `/api/v1/lists/${list.id}/items`, { text: 'Sonnenbrille @alle' });
    expect((await item(list.id, 'Sonnenbrille')).persons).toEqual(['Sönke', 'Ulli']);
  });

  it('recurring lists open partly ticked entries again', async () => {
    const list = (await as(anna, 'POST', '/api/v1/lists', { name: 'Abends', type: 'todo' })).json();
    await as(anna, 'POST', `/api/v1/lists/${list.id}/items`, { text: 'Zähne putzen @Mia @Ben' });
    const task = await item(list.id, 'Zähne putzen');
    await tick(task.id, { Mia: true });
    await t.db.execute(sql`UPDATE lists SET settings = settings || '{"reset":"daily"}'::jsonb WHERE id = ${list.id}`);

    // Same day: stays; next day: open for everyone again.
    const today = new Date(Date.now() + 60_000);
    expect((await t.sync.resetRecurring(today)).size).toBe(0);
    expect((await t.sync.resetRecurring(new Date(Date.now() + 2 * 86_400_000))).size).toBe(1);
    expect(await item(list.id, 'Zähne putzen')).toMatchObject({ checked: false, donePersons: [] });
    // Ticking again works (the reset moved the clocks on, the new tick is newer still).
    await tick(task.id, { Ben: true });
    expect((await item(list.id, 'Zähne putzen')).donePersons).toEqual(['Ben']);
  });
});
