import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DAY_MINUTES, itemPm, type ItemRow } from '@shopping/shared';
import { createTestApp } from './helpers.js';

let t: Awaited<ReturnType<typeof createTestApp>>;
let anna: string;
const base = Date.now();
const hlc = (n: number) => `${String(base + n).padStart(13, '0')}-0000-test`;

beforeAll(async () => {
  t = await createTestApp();
  ({ cookie: anna } = await t.login('Anna', 'Jacobs'));
});
afterAll(async () => t?.close());

const push = async (mutations: unknown[]) => {
  const res = await t.app.inject({ method: 'POST', url: '/api/v1/sync/push', headers: { cookie: anna }, payload: { mutations } });
  return res.json() as { rejected: unknown[] };
};
const pull = async (id: string): Promise<ItemRow> => {
  const res = await t.app.inject({ method: 'GET', url: '/api/v1/sync/pull?since=0', headers: { cookie: anna } });
  return (res.json().items as ItemRow[]).find((i) => i.id === id)!;
};

describe('project planning', () => {
  it('syncs planning fields with own clocks; an attributes patch keeps them', async () => {
    const list = (await t.app.inject({ method: 'POST', url: '/api/v1/lists', headers: { cookie: anna }, payload: { name: 'Garten', type: 'todo' } })).json();
    const a = randomUUID();
    const b = randomUUID();
    const mut = (id: string, n: number, patch: Record<string, unknown>) => ({ mid: randomUUID(), entity: 'item', id, hlc: hlc(n), patch });
    const res = await push([
      mut(a, 1, { listId: list.id, name: 'Beet umgraben', position: 'a0' }),
      mut(b, 2, { listId: list.id, name: 'Pflanzen setzen', position: 'a1' }),
      mut(b, 3, { pm: { dur: { v: 2 * DAY_MINUTES, src: 'set' }, [`dep:${a}`]: { type: 'FS', lag: 0 }, effort: 240 } }),
      // Older change to the same field: loses. Another field from someone else: kept.
      mut(b, 4, { attributes: { due: '2026-12-01' } }),
      mut(b, 5, { pm: { spent: 60 } }),
    ]);
    expect(res.rejected).toEqual([]);
    expect(await push([mut(b, 0, { pm: { effort: 999 } })])).toEqual(expect.objectContaining({ rejected: [] }));
    const row = await pull(b);
    expect(itemPm(row)).toEqual({ dur: { v: 960, src: 'set' }, effort: 240, spent: 60, deps: { [a]: { type: 'FS', lag: 0 } } });
    expect(row.attributes.due).toBe('2026-12-01');
  });
});
