import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tidyIngredient } from '../src/recipes/web-recipe.js';
import { createTestApp } from './helpers.js';

/** How Chefkoch delivers a recipe: schema.org JSON-LD next to the page. */
const CHEFKOCH = `<!doctype html><html><head>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[]}</script>
<script type="application/ld+json">
{"@context":"http://schema.org","@type":"Recipe","name":"K&auml;sesp&auml;tzle","image":["https://img.example/spaetzle.jpg"],
 "recipeYield":"4 Portionen",
 "recipeIngredient":["500 g Spätzle","200 g Bergkäse, gerieben","2 Zwiebel(n)","2 EL Butter","n. B. Salz","1 Prise Pfeffer"]}
</script></head><body>…</body></html>`;

const requested: string[] = [];
const fakeFetch = (async (input: string | URL | Request) => {
  const url = String(input instanceof Request ? input.url : input);
  requested.push(url);
  if (url.includes('/weiter')) return new Response('', { status: 301, headers: { location: 'http://127.0.0.1/geheim' } });
  if (url.includes('/kein-rezept')) return new Response('<html><body>Hallo</body></html>', { status: 200 });
  return new Response(CHEFKOCH, { status: 200, headers: { 'content-type': 'text/html' } });
}) as typeof fetch;

let t: Awaited<ReturnType<typeof createTestApp>>;
let cookie: string;
const get = (url: string) => t.app.inject({ method: 'GET', url: `/api/v1/recipes/from-url?url=${encodeURIComponent(url)}`, headers: { cookie } });

beforeAll(async () => {
  t = await createTestApp({ fetchImpl: fakeFetch });
  ({ cookie } = await t.login('Anna'));
});
afterAll(async () => t?.close());

describe('recipes from the web', () => {
  it('reads a recipe page like Bring does and turns the ingredients into list items', async () => {
    const res = await get('http://93.184.216.34/rezepte/123/Kaesespaetzle.html');
    expect(res.statusCode).toBe(200);
    const r = res.json();
    expect(r).toMatchObject({ name: 'Käsespätzle', servings: 4, image: 'https://img.example/spaetzle.jpg' });
    const byName = Object.fromEntries(r.items.map((i: { name: string }) => [i.name, i]));
    expect(byName.Zwiebeln ?? byName.Zwiebel).toMatchObject({ amounts: [{ q: 2, u: null }], categoryId: 'obst-gemuese', sources: ['Käsespätzle'] });
    expect(byName.Spätzle?.amounts ?? byName.Spaetzle?.amounts).toEqual([{ q: 500, u: 'g' }]);
    // Salt is usually at home: it comes, but deselected.
    expect(byName.Salz).toMatchObject({ pantry: true });
  });

  it('scales to other servings', async () => {
    const r = (
      await t.app.inject({ method: 'GET', url: `/api/v1/recipes/from-url?url=${encodeURIComponent('http://93.184.216.34/r')}&servings=2`, headers: { cookie } })
    ).json();
    expect(r.servings).toBe(2);
    expect(r.items.find((i: { name: string }) => i.name.startsWith('Sp')).amounts).toEqual([{ q: 250, u: 'g' }]);
  });

  it('says so when there is no recipe, and never fetches from the own network', async () => {
    expect((await get('http://93.184.216.34/kein-rezept')).json().detail).toContain('kein Rezept');
    requested.length = 0;
    const local = await get('http://127.0.0.1:3000/api/v1/me');
    expect(local.statusCode).toBe(422);
    expect(requested).toHaveLength(0);
    // Not via a redirect either.
    const redirected = await get('http://93.184.216.34/weiter');
    expect(redirected.statusCode).toBe(422);
    expect(requested.some((u) => u.includes('127.0.0.1'))).toBe(false);
  });

  it('is for accounts only', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/api/v1/recipes/from-url?url=http%3A%2F%2F93.184.216.34%2Fr' })).statusCode).toBe(401);
  });

  it('tidies German ingredient lines for the parser', () => {
    expect(tidyIngredient('2 Zwiebel(n)')).toBe('2 Zwiebel');
    expect(tidyIngredient('n. B. Salz')).toBe('Salz');
    expect(tidyIngredient('3 Ei(er)')).toBe('3 Ei');
  });
});
