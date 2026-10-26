import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './helpers.js';

type User = { cookie: string; id: string };
let t: Awaited<ReturnType<typeof createTestApp>>;
let anna: User;
let ben: User;
const as = (u: User, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) =>
  t.app.inject({ method, url, headers: { cookie: u.cookie }, ...(payload !== undefined ? { payload: payload as object } : {}) });

beforeAll(async () => {
  t = await createTestApp();
  anna = await t.login('Anna');
  ben = await t.login('Ben'); // same household
});
afterAll(async () => t?.close());

describe('ToDo lists', () => {
  let listId: string;

  it('are private by default, but can be shared with the household', async () => {
    const todo = (await as(anna, 'POST', '/api/v1/lists', { name: 'Haus', type: 'todo' })).json();
    listId = todo.id;
    expect(todo).toMatchObject({ type: 'todo', visibility: 'private' });
    expect((await as(ben, 'GET', '/api/v1/lists')).json()).toEqual([]);
    const shared = (await as(anna, 'POST', '/api/v1/lists', { name: 'Familie', type: 'todo', private: false })).json();
    expect(shared.visibility).toBe('household');
    expect((await as(ben, 'GET', '/api/v1/lists')).json().map((l: { name: string }) => l.name)).toEqual(['Familie']);
  });

  it('keep due date, who and area, sorted by due date', async () => {
    const res = await as(anna, 'POST', `/api/v1/lists/${listId}/items`, {
      text: 'Reifen wechseln !2026-11-20 @Ben #Auto, Steuer !2026-11-15',
      items: [{ name: 'Fenster putzen', area: 'Haus' }, { name: 'Hecke schneiden', due: '2026-11-18', assignee: 'Anna', area: 'Garten' }],
    });
    expect(res.statusCode).toBe(200);
    const items = (await as(anna, 'GET', `/api/v1/lists/${listId}`)).json().items;
    expect(items.map((i: { name: string }) => i.name)).toEqual(['Steuer', 'Hecke schneiden', 'Reifen wechseln', 'Fenster putzen']);
    expect(items[2]).toMatchObject({ due: '2026-11-20', assignee: 'Ben', area: 'Auto', category: { id: 'aufgaben' } });
    // No grocery catalog: "Steuer" stays a task.
    expect(items[0].catalogItemId).toBeNull();

    const moved = (await as(anna, 'PATCH', `/api/v1/items/${items[0].id}`, { due: '2026-12-01' })).json();
    expect(moved.due).toBe('2026-12-01');
    const cleared = (await as(anna, 'PATCH', `/api/v1/items/${items[0].id}`, { due: null })).json();
    expect(cleared.due).toBeNull();
  });

  it('never become the main list', async () => {
    const me = (await as(anna, 'GET', '/api/v1/me')).json();
    expect(me.defaultListId).toBeNull();
    await as(anna, 'POST', '/api/v1/lists', { name: 'Einkauf' });
    expect((await as(anna, 'GET', '/api/v1/lists/default')).json()).toMatchObject({ name: 'Einkauf', isMain: true });
  });
});
