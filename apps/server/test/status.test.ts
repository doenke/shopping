import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './helpers.js';

let t: Awaited<ReturnType<typeof createTestApp>>;
let cookie: string;
let userId: string;
const call = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) =>
  t.app.inject({ method, url, headers: { cookie }, ...(payload !== undefined ? { payload: payload as object } : {}) });

beforeAll(async () => {
  t = await createTestApp();
  ({ cookie, id: userId } = await t.login('Anna'));
});
afterAll(async () => t?.close());

describe('status of tasks', () => {
  it('comes from the list statuses and can be set by name', async () => {
    const list = (await call('POST', '/api/v1/lists', { name: 'Projekt', type: 'todo' })).json();
    await call('POST', `/api/v1/lists/${list.id}/items`, { items: ['Konzept', 'Umsetzung'] });
    const items = () => call('GET', `/api/v1/lists/${list.id}`).then((r) => r.json().items as { id: string; name: string; status: string | null }[]);
    // Without statuses: none.
    expect((await items()).map((i) => i.status)).toEqual([null, null]);

    // The app keeps them in the list settings.
    await t.sync.apply(userId, [
      {
        mid: crypto.randomUUID(),
        entity: 'list',
        id: list.id,
        hlc: t.sync.clock.tick(),
        patch: {
          settings: {
            statuses: [
              { id: 'n', name: 'Neu' },
              { id: 'w', name: 'In Arbeit' },
            ],
          },
        },
      },
    ]);
    const konzept = (await items()).find((i) => i.name === 'Konzept')!;
    expect(konzept.status).toBe('Neu');
    expect((await call('PATCH', `/api/v1/items/${konzept.id}`, { status: 'in arbeit' })).json().status).toBe('In Arbeit');
    const bad = await call('PATCH', `/api/v1/items/${konzept.id}`, { status: 'Fertig' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().detail).toContain('Neu, In Arbeit');
    // Done tasks have no status (done is the tick, the last Kanban column).
    expect((await call('PATCH', `/api/v1/items/${konzept.id}`, { checked: true })).json().status).toBeNull();
  });

  it('a recurring list opens tasks again in the default status', async () => {
    const list = (await call('POST', '/api/v1/lists', { name: 'Täglich', type: 'todo' })).json();
    await t.sync.apply(userId, [
      {
        mid: crypto.randomUUID(),
        entity: 'list',
        id: list.id,
        hlc: t.sync.clock.tick(),
        patch: {
          settings: {
            reset: 'daily',
            statuses: [
              { id: 'n', name: 'Neu' },
              { id: 'w', name: 'Wartet' },
            ],
          },
        },
      },
    ]);
    const task = (await call('POST', `/api/v1/lists/${list.id}/items`, { items: ['Post holen'] })).json().added[0];
    await call('PATCH', `/api/v1/items/${task.id}`, { status: 'Wartet' });
    await call('PATCH', `/api/v1/items/${task.id}`, { checked: true });
    expect((await t.sync.resetRecurring(new Date(Date.now() + 2 * 86_400_000))).size).toBe(1);
    expect((await call('GET', `/api/v1/items/${task.id}`)).json()).toMatchObject({ checked: false, status: 'Neu' });
  });
});
