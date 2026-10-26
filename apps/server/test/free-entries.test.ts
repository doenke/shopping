import { and, eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { iconJobs, icons } from '../src/db/schema.js';
import { createTestApp } from './helpers.js';

const described: string[] = [];
const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  const json = (b: unknown) => new Response(JSON.stringify(b), { headers: { 'content-type': 'application/json' } });
  if (url.includes('llama')) {
    const body = JSON.parse(String(init!.body));
    described.push(String(body.messages[1].content));
    return json({ result: { response: 'a round loaf of dark bread' } });
  }
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#FF00FF"/><circle cx="256" cy="256" r="130" fill="#8B5A2B"/></svg>';
  return json({ result: { image: (await sharp(Buffer.from(svg)).png().toBuffer()).toString('base64') } });
}) as typeof fetch;

let t: Awaited<ReturnType<typeof createTestApp>>;
let cookie: string;
const req = (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: unknown) =>
  t.app.inject({ method, url, headers: { cookie }, ...(payload !== undefined ? { payload: payload as object } : {}) });

const itemsOf = async (listId: string) => (await req('GET', `/api/v1/lists/${listId}`)).json().items as { id: string; name: string; catalogItemId: string | null }[];
const pulled = async (id: string) => (await req('GET', '/api/v1/sync/pull?since=0')).json().items.find((i: { id: string }) => i.id === id);
const jobsFor = (id: string) => t.db.select().from(iconJobs).where(and(eq(iconJobs.targetType, 'entry'), eq(iconJobs.targetId, id)));

beforeAll(async () => {
  t = await createTestApp({ fetchImpl: fakeFetch });
  t.icons.delayMs = 0;
  ({ cookie } = await t.login('Anna'));
  await req('PUT', '/api/v1/icons/settings', { autoApprove: true, cloudflare: { accountId: 'a', token: 't' } });
  // The style has been found: four anchors.
  const image = await sharp({ create: { width: 512, height: 512, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).webp().toBuffer();
  for (const name of ['Milch', 'Brot', 'Äpfel', 'Käse']) {
    await t.db.insert(icons).values({ targetType: 'item', targetId: name, status: 'approved', isAnchor: true, provider: 'upload', model: 'manual', prompt: '', image, thumb: image });
  }
});
afterAll(async () => t?.close());

describe('free-text entries', () => {
  let first: string;
  let second: string;

  it('are planned for a picture, once per name', async () => {
    const a = (await req('POST', '/api/v1/lists', { name: 'Einkauf' })).json().id;
    const b = (await req('POST', '/api/v1/lists', { name: 'Markt' })).json().id;
    await req('POST', `/api/v1/lists/${a}/items`, { text: 'Zwergenbrot' });
    await req('POST', `/api/v1/lists/${b}/items`, { text: 'zwergenbrot' });
    first = (await itemsOf(a)).find((i) => i.name === 'Zwergenbrot')!.id;
    second = (await itemsOf(b)).find((i) => i.name.toLowerCase() === 'zwergenbrot')!.id;
    expect((await itemsOf(a)).find((i) => i.id === first)!.catalogItemId).toBeNull();

    await t.icons.enqueueMissing();
    expect(await jobsFor(first)).toHaveLength(1);
    expect(await jobsFor(second)).toHaveLength(0);
  });

  it('get the picture, and every entry of the same name shares it', async () => {
    await req('POST', '/api/v1/icons/generate', { targetType: 'entry', targetId: first, candidates: 1 });
    expect((await req('POST', '/api/v1/icons/run')).json().result).toBe('done');
    expect(described.at(-1)).toContain('Zwergenbrot');

    const a = await pulled(first);
    const b = await pulled(second);
    expect(a.icon).toMatch(/^[0-9a-f]{10}$/);
    expect(b.icon).toBe(a.icon);
    for (const id of [first, second]) {
      const img = await t.app.inject({ method: 'GET', url: `/icons/entry/${id}.webp?v=${a.icon}` });
      expect(img.statusCode).toBe(200);
    }
  });

  it('added later, get the existing picture right away', async () => {
    const c = (await req('POST', '/api/v1/lists', { name: 'Urlaub', type: 'packing' })).json().id;
    await req('POST', `/api/v1/lists/${c}/items`, { text: 'Zwergenbrot' });
    const third = (await itemsOf(c)).find((i) => i.name === 'Zwergenbrot')!.id;
    await t.icons.enqueueMissing();
    expect(await jobsFor(third)).toHaveLength(0);
    expect((await pulled(third)).icon).toBe((await pulled(first)).icon);
  });

});

describe('list icons', () => {
  const listJobs = (id: string) => t.db.select().from(iconJobs).where(and(eq(iconJobs.targetType, 'list'), eq(iconJobs.targetId, id)));

  it('come from the name, and again after a rename', async () => {
    const id = (await req('POST', '/api/v1/lists', { name: 'Baumarkt' })).json().id;
    await t.icons.enqueueMissing();
    expect(await listJobs(id)).toHaveLength(1);
    // Planned once, not on every round.
    await t.icons.enqueueMissing();
    expect(await listJobs(id)).toHaveLength(1);

    await req('POST', '/api/v1/icons/generate', { targetType: 'list', targetId: id, candidates: 1 });
    expect((await req('POST', '/api/v1/icons/run')).json().result).toBe('done');
    expect(described.at(-1)).toContain('"Baumarkt" – a shopping list');
    const pulled = (await req('GET', '/api/v1/sync/pull?since=0')).json().lists.find((l: { id: string }) => l.id === id);
    expect(pulled.icon).toMatch(/^[0-9a-f]{10}$/);
    expect((await t.app.inject({ method: 'GET', url: `/icons/list/${id}.webp?v=${pulled.icon}` })).statusCode).toBe(200);

    await req('PATCH', `/api/v1/lists/${id}`, { name: 'Gartencenter' });
    await t.icons.enqueueMissing();
    expect((await listJobs(id)).filter((j) => j.status === 'queued')).toHaveLength(1);
  });
});
