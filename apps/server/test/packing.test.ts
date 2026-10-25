import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './helpers.js';

let t: Awaited<ReturnType<typeof createTestApp>>;
let token: string;

const call = async (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
  t.app.inject({ method, url, payload: payload as object, headers: { authorization: `Bearer ${token}` } });

beforeAll(async () => {
  t = await createTestApp();
  const { cookie } = await t.login('Anna');
  token = (await t.app.inject({ method: 'POST', url: '/api/v1/tokens', headers: { cookie }, payload: { name: 'Home Assistant', scopes: ['read', 'write', 'mealie'] } })).json()
    .token as string;
  await call('POST', '/api/v1/lists', { name: 'Einkauf' });
});
afterAll(async () => t?.close());

describe('packing lists', () => {
  it('uses its own catalog and categories, with person and Packstück', async () => {
    const tpl = (await call('POST', '/api/v1/lists', { name: 'Wochenend-Trip', type: 'packing', isTemplate: true })).json();
    expect(tpl).toMatchObject({ type: 'packing', isTemplate: true });
    const res = await call('POST', `/api/v1/lists/${tpl.id}/items`, {
      text: '3 T-Shirts @Anna #Koffer, Zahnbürste @Ben #Kulturbeutel, Reisepass',
      items: [{ name: 'Ladekabel', container: 'Rucksack' }],
    });
    expect(res.statusCode).toBe(200);
    const list = (await call('GET', `/api/v1/lists/${tpl.id}?items=all`)).json();
    const byName = Object.fromEntries(list.items.map((i: { name: string }) => [i.name, i]));
    expect(byName['T-Shirts']).toMatchObject({ person: 'Anna', container: 'Koffer', category: { id: 'kleidung' }, quantity: '3' });
    expect(byName['Zahnbürste']).toMatchObject({ person: 'Ben', container: 'Kulturbeutel', category: { name: 'Körperpflege' } });
    expect(byName['Reisepass']).toMatchObject({ person: null, category: { id: 'dokumente' } });
    expect(byName['Ladekabel']).toMatchObject({ container: 'Rucksack', category: { id: 'technik' } });
    // Sorted by packing categories: documents first.
    expect(list.items[0].name).toBe('Reisepass');
    // Added with a token: remembered as "über Home Assistant".
    expect(byName['Reisepass'].addedVia).toBe('Home Assistant');
    // The packing catalog is its own search.
    expect((await call('GET', '/api/v1/catalog/search?q=pass&kind=packing')).json()[0].name).toBe('Reisepass');
  });

  it('creates a new packing list from a packing template, keeping person and Packstück', async () => {
    const created = (await call('POST', '/api/v1/lists', { name: 'Ostsee', template: 'Wochenend-Trip' })).json();
    expect(created).toMatchObject({ type: 'packing', isTemplate: false, openItems: 4 });
    const items = (await call('GET', `/api/v1/lists/${created.id}`)).json().items;
    expect(items.find((i: { name: string }) => i.name === 'T-Shirts')).toMatchObject({ person: 'Anna', container: 'Koffer', sources: ['Wochenend-Trip'] });

    // Packing: same item for another person is its own entry.
    await call('POST', `/api/v1/lists/${created.id}/items`, { text: '2 T-Shirts @Ben, 1 T-Shirts @anna #Koffer' });
    const shirts = (await call('GET', `/api/v1/lists/${created.id}`)).json().items.filter((i: { name: string }) => i.name === 'T-Shirts');
    expect(shirts.map((i: { person: string; quantity: string }) => `${i.person}:${i.quantity}`).sort()).toEqual(['Anna:4', 'Ben:2']);

    // Changing person/Packstück.
    const ben = shirts.find((i: { person: string }) => i.person === 'Ben');
    const moved = (await call('PATCH', `/api/v1/items/${ben.id}`, { container: 'Rucksack', person: null })).json();
    expect(moved).toMatchObject({ person: null, container: 'Rucksack' });
  });

  it('keeps grocery and packing apart', async () => {
    await call('POST', '/api/v1/lists', { name: 'Grillabend', isTemplate: true });
    const res = await call('POST', '/api/v1/lists/Ostsee/apply-template', { template: 'Grillabend' });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('type_mismatch');
    const mealie = await call('POST', '/api/v1/lists/Ostsee/import/mealie', { recipe: 'chili' });
    expect(mealie.statusCode).toBe(409);
    // "default" stays the grocery list.
    expect((await call('GET', '/api/v1/lists/default')).json().type).toBe('shopping');
  });

  it('archives done packing lists', async () => {
    expect((await call('PATCH', '/api/v1/lists/Ostsee', { archived: true })).statusCode).toBe(200);
    const active = (await call('GET', '/api/v1/lists')).json();
    expect(active.map((l: { name: string }) => l.name)).toEqual(['Einkauf']);
    const all = (await call('GET', '/api/v1/lists?archived=true&type=packing')).json();
    expect(all).toMatchObject([{ name: 'Ostsee', archived: true }]);
    await call('PATCH', '/api/v1/lists/Ostsee', { archived: false });
    expect((await call('GET', '/api/v1/lists?type=packing')).json()).toHaveLength(1);
  });
});
