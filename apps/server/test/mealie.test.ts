import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { guessCategory } from '../src/mealie/import.js';
import { createTestApp } from './helpers.js';

const foods = [
  { id: 'f1', name: 'Kartoffel', pluralName: 'Kartoffeln', aliases: [], label: { id: 'l1', name: 'Gemüse' } },
  { id: 'f2', name: 'Garam Masala', pluralName: null, aliases: [{ name: 'Gewürzmischung' }], label: { id: 'l2', name: 'Gewürze' } },
  { id: 'f3', name: 'Tempeh', pluralName: null, aliases: [], label: null },
];

const requests: string[] = [];
const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(String(input));
  requests.push(`${url.pathname} ${(init?.headers as Record<string, string>)?.Authorization}`);
  const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  if (url.pathname === '/api/app/about') return json({ version: 'v2.8.0' });
  if (url.pathname === '/api/users/self') return json({ fullName: 'Test' });
  if (url.pathname === '/api/foods') {
    const page = Number(url.searchParams.get('page'));
    return json({ page, total_pages: 2, items: page === 1 ? foods.slice(0, 2) : foods.slice(2) });
  }
  return new Response('not found', { status: 404 });
}) as typeof fetch;

let t: Awaited<ReturnType<typeof createTestApp>>;
let cookie: string;

beforeAll(async () => {
  t = await createTestApp({ fetchImpl: fakeFetch });
  cookie = (await t.login('Anna')).cookie;
});
afterAll(async () => t?.close());

describe('mealie', () => {
  it('guesses categories from label names', () => {
    expect(guessCategory('Obst und Gemüse')).toBe('obst-gemuese');
    expect(guessCategory('Gemüse')).toBe('obst-gemuese');
    expect(guessCategory('Gewürze')).toBe('zutaten-gewuerze');
    expect(guessCategory('Getränke')).toBe('getraenke');
  });

  it('stores the token encrypted and never returns it', async () => {
    const put = await t.app.inject({
      method: 'PUT',
      url: '/api/v1/integrations/mealie',
      headers: { cookie },
      payload: { url: 'https://mealie.example.org/', token: 'secret-token-123' },
    });
    expect(put.statusCode).toBe(200);
    const get = await t.app.inject({ method: 'GET', url: '/api/v1/integrations/mealie', headers: { cookie } });
    expect(get.json()).toMatchObject({ url: 'https://mealie.example.org', hasToken: true });
    expect(get.body).not.toContain('secret-token-123');
  });

  it('tests the connection', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/api/v1/integrations/mealie/test', headers: { cookie } });
    expect(res.json()).toMatchObject({ ok: true, version: 'v2.8.0' });
    expect(requests).toContain('/api/app/about Bearer secret-token-123');
  });

  it('imports foods: links known ones, creates new ones, follows pagination', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/api/v1/integrations/mealie/import-catalog', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ created: 2, linked: 1, labels: ['Gemüse', 'Gewürze'] });

    const catalog = (await t.app.inject({ method: 'GET', url: '/api/v1/catalog', headers: { cookie } })).json();
    const kartoffeln = catalog.items.find((i: { name: string }) => i.name === 'Kartoffeln');
    expect(kartoffeln).toMatchObject({ source: 'seed', mealieFoodId: 'f1' });
    expect(catalog.items.find((i: { name: string }) => i.name === 'Garam Masala')).toMatchObject({
      categoryId: 'zutaten-gewuerze',
      aliases: ['Gewürzmischung'],
    });
    expect(catalog.items.find((i: { name: string }) => i.name === 'Tempeh')).toMatchObject({ categoryId: 'eigene' });

    const again = await t.app.inject({ method: 'POST', url: '/api/v1/integrations/mealie/import-catalog', headers: { cookie } });
    expect(again.json()).toMatchObject({ created: 0, linked: 0, updated: 3 });
  });

  it('keeps hand-edited categories on re-import', async () => {
    const catalog = (await t.app.inject({ method: 'GET', url: '/api/v1/catalog', headers: { cookie } })).json();
    const tempeh = catalog.items.find((i: { name: string }) => i.name === 'Tempeh');
    await t.app.inject({ method: 'PATCH', url: `/api/v1/catalog/${tempeh.id}`, headers: { cookie }, payload: { categoryId: 'fleisch-fisch' } });
    await t.app.inject({
      method: 'PUT',
      url: '/api/v1/integrations/mealie',
      headers: { cookie },
      payload: { url: 'https://mealie.example.org', labelMapping: { Gewürze: 'getreide' } },
    });
    await t.app.inject({ method: 'POST', url: '/api/v1/integrations/mealie/import-catalog', headers: { cookie } });
    const after = (await t.app.inject({ method: 'GET', url: '/api/v1/catalog', headers: { cookie } })).json();
    expect(after.items.find((i: { name: string }) => i.name === 'Tempeh').categoryId).toBe('fleisch-fisch');
    expect(after.items.find((i: { name: string }) => i.name === 'Garam Masala').categoryId).toBe('getreide');
  });
});
