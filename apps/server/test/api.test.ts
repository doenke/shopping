import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './helpers.js';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;
let t: TestApp;
let cookie: string;
let token: string;
let readOnly: string;

const call = async (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown, bearer = token) =>
  t.app.inject({ method, url, payload: payload as object, headers: { authorization: `Bearer ${bearer}` } });

beforeAll(async () => {
  t = await createTestApp();
  cookie = (await t.login('Anna')).cookie;
  const create = async (name: string, scopes: string[]) =>
    (await t.app.inject({ method: 'POST', url: '/api/v1/tokens', headers: { cookie }, payload: { name, scopes } })).json().token as string;
  token = await create('Home Assistant', ['read', 'write']);
  readOnly = await create('Dashboard', ['read']);
});
afterAll(async () => t?.close());

describe('API tokens', () => {
  it('are shown once, listed without the secret, and cannot create tokens themselves', async () => {
    expect(token).toMatch(/^shp_/);
    const list = await t.app.inject({ method: 'GET', url: '/api/v1/tokens', headers: { cookie } });
    expect(list.json().map((x: { name: string }) => x.name).sort()).toEqual(['Dashboard', 'Home Assistant']);
    expect(list.body).not.toContain(token);
    expect((await call('POST', '/api/v1/tokens', { name: 'x', scopes: ['read'] })).statusCode).toBe(403);
  });

  it('rejects unknown tokens with a hint where OAuth starts', async () => {
    const res = await call('GET', '/api/v1/lists', undefined, 'shp_nope');
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toContain('/.well-known/oauth-protected-resource');
  });

  it('enforces scopes', async () => {
    expect((await call('GET', '/api/v1/lists', undefined, readOnly)).statusCode).toBe(200);
    const write = await call('POST', '/api/v1/lists', { name: 'Nope' }, readOnly);
    expect(write.statusCode).toBe(403);
    expect(write.json()).toMatchObject({ code: 'insufficient_scope', scope: 'write' });
    expect((await call('GET', '/api/v1/integrations/mealie')).json()).toMatchObject({ scope: 'mealie' });
  });
});

describe('REST API', () => {
  it('creates lists and finds them by name or as main list', async () => {
    const created = await call('POST', '/api/v1/lists', { name: 'Einkauf' });
    expect(created.json()).toMatchObject({ name: 'Einkauf', isMain: true, isOwner: true });
    expect((await call('GET', '/api/v1/lists/default')).json().name).toBe('Einkauf');
    expect((await call('GET', '/api/v1/lists/einkauf')).json().name).toBe('Einkauf');
  });

  it('adds free text and structured items, merging like the app', async () => {
    const res = await call('POST', '/api/v1/lists/default/items', {
      text: '2 l Milch, 500g Hack gemischt bio',
      items: [{ name: 'Milch', quantity: 1, unit: 'Liter' }, 'Kaffee'],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().added.map((a: { name: string; action: string }) => `${a.name}:${a.action}`)).toEqual([
      'Milch:created',
      'Hackfleisch:created',
      'Milch:merged',
      'Kaffee:created',
    ]);
    const list = (await call('GET', '/api/v1/lists/Einkauf')).json();
    const milk = list.items.find((i: { name: string }) => i.name === 'Milch');
    expect(milk).toMatchObject({ specification: '3 l', category: { id: 'milch-kaese' }, checked: false });
  });

  it('checks, edits and removes items; shows who checked', async () => {
    const list = (await call('GET', '/api/v1/lists/default')).json();
    const hack = list.items.find((i: { name: string }) => i.name === 'Hackfleisch');
    const checked = await call('POST', `/api/v1/items/${hack.id}/check`);
    expect(checked.json()).toMatchObject({ checked: true, checkedBy: 'Anna' });
    const edited = await call('PATCH', `/api/v1/items/${hack.id}`, { quantity: 1, unit: 'kg', checked: false, category: 'Fleisch & Fisch' });
    expect(edited.json()).toMatchObject({ specification: '1 kg · gemischt · bio', checked: false });
    expect((await call('GET', '/api/v1/history')).json()).toEqual([]);
    expect((await call('DELETE', `/api/v1/items/${hack.id}`)).json()).toEqual({ removed: 1 });
  });

  it('applies templates and leaves out optional items', async () => {
    const tpl = (await call('POST', '/api/v1/lists', { name: 'Grillabend', isTemplate: true })).json();
    await call('POST', `/api/v1/lists/${tpl.id}/items`, { items: ['Würstchen', 'Grillkohle'] });
    const sun = (await call('POST', `/api/v1/lists/${tpl.id}/items`, { text: 'Sonnencreme' })).json().added[0];
    // Optional flag is an app feature; set it via sync like the app does.
    await t.sync.apply(
      (await t.app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } })).json().id,
      [{ mid: crypto.randomUUID(), entity: 'item', id: sun.id, hlc: t.sync.clock.tick(), patch: { optional: true } }],
    );
    expect((await call('POST', `/api/v1/items/${sun.id}/check`)).statusCode).toBe(409);
    const applied = (await call('POST', '/api/v1/lists/default/apply-template', { template: 'Grillabend' })).json();
    expect(applied.added.map((a: { name: string }) => a.name).sort()).toEqual(['Grillkohle', 'Würstchen']);
    const fresh = (await call('POST', '/api/v1/lists', { name: 'Samstag', template: 'Grillabend' })).json();
    expect(fresh.openItems).toBe(2);
  });

  it('answers errors as problem+json', async () => {
    const res = await call('GET', '/api/v1/lists/gibtsnicht');
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.json()).toMatchObject({ status: 404, code: 'not_found', detail: 'Liste „gibtsnicht“ nicht gefunden' });
    const bad = await call('POST', '/api/v1/lists/default/items', {});
    expect(bad.json()).toMatchObject({ status: 400, code: 'validation' });
  });

  it('parses text and searches the catalog', async () => {
    expect((await call('POST', '/api/v1/parse', { text: '3 Zwiebeln' })).json()[0]).toMatchObject({ name: 'Zwiebeln', amounts: [{ q: 3, u: null }] });
    expect((await call('GET', '/api/v1/catalog/search?q=klopa')).json()[0].name).toBe('Toilettenpapier');
  });

  it('describes itself as OpenAPI', async () => {
    const spec = (await t.app.inject({ method: 'GET', url: '/api/v1/openapi.json' })).json();
    expect(spec.openapi).toBe('3.1.0');
    expect(Object.keys(spec.paths)).toContain('/api/v1/lists/{id}/items');
    expect(spec.paths['/api/v1/lists/{id}/items'].post.requestBody.content['application/json'].schema).toBeTruthy();
  });

  it('streams changes as server-sent events', async () => {
    const address = await t.app.listen({ port: 0, host: '127.0.0.1' });
    const ctrl = new AbortController();
    const res = await fetch(`${address}/api/v1/events`, { headers: { authorization: `Bearer ${token}` }, signal: ctrl.signal });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    let text = '';
    const read = async (until: string) => {
      const start = Date.now();
      while (!text.includes(until)) {
        if (Date.now() - start > 3000) throw new Error(`timeout waiting for ${until}: ${text}`);
        const { value } = await reader.read();
        text += new TextDecoder().decode(value);
      }
    };
    await read('event: ready');
    await call('POST', '/api/v1/lists/default/items', { text: 'Bananen' });
    await read('"name":"Bananen"');
    expect(text).toContain('event: item.changed');
    ctrl.abort();
  });
});
