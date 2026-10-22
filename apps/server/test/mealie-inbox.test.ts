import { randomUUID } from 'node:crypto';
import type { ChangeSet } from '@shopping/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, FakeClient } from './helpers.js';

const unitG = { id: 'u-g', name: 'Gramm', abbreviation: 'g' };
const unitEl = { id: 'u-el', name: 'Esslöffel', abbreviation: 'EL' };
const zwiebel = { id: 'food-zwiebel', name: 'Zwiebel', pluralName: 'Zwiebeln', label: { id: 'l', name: 'Gemüse' } };
const hack = { id: 'food-hack', name: 'Hackfleisch', label: null };
const salz = { id: 'food-salz', name: 'Salz', label: null };

/** A tiny fake Mealie that remembers which items were ticked off. */
function fakeMealie() {
  const items = [
    { id: 'm1', shoppingListId: 'inbox', quantity: 2, unit: null, food: zwiebel, note: '', display: '2 Zwiebeln', checked: false, recipeReferences: [{ recipeId: 'r-chili' }] },
    { id: 'm2', shoppingListId: 'inbox', quantity: 500, unit: unitG, food: hack, note: 'gemischt', display: '500 g Hackfleisch gemischt', checked: false, recipeReferences: [{ recipeId: 'r-chili' }] },
    { id: 'm3', shoppingListId: 'inbox', quantity: 0, unit: null, food: null, note: 'Klopapier', display: 'Klopapier', checked: false },
    { id: 'm4', shoppingListId: 'inbox', quantity: 1, unit: null, food: zwiebel, note: '', display: '1 Zwiebel', checked: true },
  ];
  const recipes: Record<string, unknown> = {
    chili: {
      id: 'r-chili',
      slug: 'chili',
      name: 'Chili con Carne',
      recipeServings: 4,
      recipeIngredient: [
        { quantity: 500, unit: unitG, food: hack, note: 'gemischt', display: '500 g Hackfleisch' },
        { quantity: 2, unit: null, food: zwiebel, note: 'gewürfelt', display: '2 Zwiebeln' },
        { quantity: 1, unit: unitEl, food: salz, note: null, display: '1 EL Salz' },
        { quantity: null, unit: null, food: null, note: null, display: '1 Dose Kidneybohnen', originalText: '1 Dose Kidneybohnen' },
      ],
    },
    salat: {
      id: 'r-salat',
      slug: 'salat',
      name: 'Salat',
      recipeServings: 2,
      recipeIngredient: [{ quantity: 1, unit: null, food: zwiebel, note: null, display: '1 Zwiebel' }],
    },
  };
  let failPut = false;
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    const path = url.pathname;
    if (path === '/api/households/shopping/lists') return json({ items: [{ id: 'inbox', name: 'Einkauf' }], total_pages: 1 });
    if (path === '/api/households/shopping/lists/inbox') {
      return json({ id: 'inbox', name: 'Einkauf', listItems: items, recipeReferences: [{ recipeId: 'r-chili', recipe: { name: 'Chili con Carne' } }] });
    }
    if (path === '/api/households/shopping/items' && init?.method === 'PUT') {
      if (failPut) return json({ detail: 'boom' }, 500);
      for (const u of JSON.parse(String(init.body)) as { id: string; checked: boolean }[]) {
        const it = items.find((i) => i.id === u.id);
        if (it) it.checked = u.checked;
      }
      return json({});
    }
    if (path === '/api/recipes') return json({ items: [{ slug: 'chili', name: 'Chili con Carne', recipeServings: 4 }] });
    if (path.startsWith('/api/recipes/')) return json(recipes[path.split('/').pop()!] ?? {}, recipes[path.split('/').pop()!] ? 200 : 404);
    if (path === '/api/households/mealplans') {
      return json({
        total_pages: 1,
        items: [
          { date: '2026-10-26', entryType: 'dinner', title: '', recipeId: 'r-chili', recipeScale: 1, recipe: { slug: 'chili', recipeServings: 4 } },
          { date: '2026-10-27', entryType: 'dinner', title: '', recipeId: 'r-salat', recipeScale: 2, recipe: { slug: 'salat', recipeServings: 2 } },
          { date: '2026-10-28', entryType: 'dinner', title: 'Pizza bestellen', recipeId: null, recipe: null },
        ],
      });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  return { items, fetchImpl, setFailPut: (v: boolean) => (failPut = v) };
}

type TestApp = Awaited<ReturnType<typeof createTestApp>>;
let t: TestApp;
let cookie: string;
let mealie: ReturnType<typeof fakeMealie>;
const listId = randomUUID();

const pull = async (): Promise<ChangeSet> => (await t.app.inject({ method: 'GET', url: '/api/v1/sync/pull', headers: { cookie } })).json();

beforeAll(async () => {
  mealie = fakeMealie();
  t = await createTestApp({ fetchImpl: mealie.fetchImpl });
  cookie = (await t.login('Anna')).cookie;
  await t.app.inject({
    method: 'POST',
    url: '/api/v1/sync/push',
    headers: { cookie },
    payload: { mutations: [new FakeClient('a').list(listId, { name: 'Einkauf' })] },
  });
});
afterAll(async () => t?.close());

describe('mealie inbox', () => {
  let webhookPath: string;

  it('configures the inbox and hands out webhook + Apprise URL', async () => {
    const put = await t.app.inject({
      method: 'PUT',
      url: '/api/v1/integrations/mealie',
      headers: { cookie },
      payload: { url: 'https://mealie.example.org', token: 'secret-token-123', inbox: { enabled: true, mealieListId: 'inbox', targetListId: listId } },
    });
    expect(put.statusCode).toBe(200);
    const cfg = (await t.app.inject({ method: 'GET', url: '/api/v1/integrations/mealie', headers: { cookie } })).json();
    expect(cfg.inbox.webhookUrl).toMatch(/^http:\/\/localhost:3000\/hooks\/mealie\/[\w-]{20,}$/);
    expect(cfg.inbox.appriseUrl).toMatch(/^json:\/\/localhost:3000\/hooks\/mealie\//);
    webhookPath = new URL(cfg.inbox.webhookUrl).pathname;
    const lists = (await t.app.inject({ method: 'GET', url: '/api/v1/integrations/mealie/shopping-lists', headers: { cookie } })).json();
    expect(lists).toEqual([{ id: 'inbox', name: 'Einkauf' }]);
  });

  it('rejects unknown webhook secrets', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/hooks/mealie/xxxxxxxxxxxxxxxxxxxxxxxxxxxx', payload: {} });
    expect(res.statusCode).toBe(404);
  });

  it('takes over open items structured and ticks them off in Mealie', async () => {
    const res = await t.app.inject({ method: 'POST', url: webhookPath, payload: { document_data: '{}' } });
    expect(res.statusCode).toBe(202);
    await waitFor(async () => (await pull()).items.length === 3);
    const items = (await pull()).items;
    const byName = Object.fromEntries(items.map((i) => [i.name, i]));
    expect(byName.Zwiebeln).toMatchObject({ amounts: [{ q: 2, u: null }], categoryId: 'obst-gemuese', attributes: { sources: [{ type: 'mealie_recipe', label: 'Chili con Carne' }] } });
    expect(byName.Hackfleisch).toMatchObject({ amounts: [{ q: 500, u: 'g' }], note: 'gemischt', categoryId: 'fleisch-fisch' });
    expect(byName.Toilettenpapier).toMatchObject({ categoryId: 'haushalt', attributes: { sources: [{ type: 'mealie_list', label: 'Einkauf' }] } });
    expect(mealie.items.every((i) => i.checked)).toBe(true);
  });

  it('never adds an item twice, even if ticking off in Mealie failed', async () => {
    mealie.items[0]!.checked = false;
    mealie.setFailPut(true);
    const fail = await t.app.inject({ method: 'POST', url: '/api/v1/integrations/mealie/inbox/run', headers: { cookie } });
    expect(fail.statusCode).toBe(400);
    mealie.setFailPut(false);
    const ok = await t.app.inject({ method: 'POST', url: '/api/v1/integrations/mealie/inbox/run', headers: { cookie } });
    expect(ok.json()).toEqual({ added: 0, skipped: 0 });
    expect(mealie.items[0]!.checked).toBe(true);
    expect((await pull()).items.find((i) => i.name === 'Zwiebeln')!.amounts).toEqual([{ q: 2, u: null }]);
    const status = (await t.app.inject({ method: 'GET', url: '/api/v1/integrations/mealie', headers: { cookie } })).json().status;
    expect(status).toContain('übernommen');
  });
});

describe('recipes and meal plan', () => {
  it('searches recipes', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/v1/integrations/mealie/recipes?q=chi', headers: { cookie } });
    expect(res.json()).toEqual([{ slug: 'chili', name: 'Chili con Carne', servings: 4 }]);
  });

  it('scales ingredients, marks pantry items and parses unstructured lines', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/v1/integrations/mealie/recipes/chili?servings=2', headers: { cookie } });
    const r = res.json();
    expect(r.name).toBe('Chili con Carne');
    const byName = Object.fromEntries(r.items.map((i: { name: string }) => [i.name, i]));
    expect(byName.Hackfleisch).toMatchObject({ amounts: [{ q: 250, u: 'g' }], note: null, sources: ['Chili con Carne'] });
    expect(byName.Salz).toMatchObject({ pantry: true });
    // Half a can is still one can to buy.
    expect(byName.Kidneybohnen).toMatchObject({ amounts: [{ q: 1, u: 'dose' }] });
    expect(byName.Zwiebeln).toMatchObject({ amounts: [{ q: 1, u: null }] });
  });

  it('combines the meal plan and skips entries without recipe', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/v1/integrations/mealie/mealplan?from=2026-10-26&to=2026-11-01', headers: { cookie } });
    const r = res.json();
    expect(r.recipes.map((x: { name: string }) => x.name)).toEqual(['Chili con Carne', 'Salat']);
    const zw = r.items.find((i: { name: string }) => i.name === 'Zwiebeln');
    // 2 (Chili) + 1 × scale 2 (Salat)
    expect(zw).toMatchObject({ amounts: [{ q: 4, u: null }], sources: ['Chili con Carne', 'Salat'] });
  });
});

async function waitFor(cond: () => Promise<boolean>, timeout = 3000): Promise<void> {
  const start = Date.now();
  while (!(await cond())) {
    if (Date.now() - start > timeout) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 25));
  }
}
