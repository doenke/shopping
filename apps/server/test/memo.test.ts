import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './helpers.js';

const prompts: string[] = [];
const described: string[] = [];
const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  const json = (b: unknown) => new Response(JSON.stringify(b), { headers: { 'content-type': 'application/json' } });
  if (url.includes('llama')) {
    const body = JSON.parse(String(init!.body));
    described.push(`${body.messages[0].content}\n${body.messages[1].content}`);
    return json({ result: { response: 'a sandworm rising from desert dunes' } });
  }
  const form = init!.body as FormData;
  prompts.push(String(form.get('prompt')));
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#FF00FF"/><circle cx="256" cy="256" r="130" fill="#D9A55B"/></svg>';
  return json({ result: { image: (await sharp(Buffer.from(svg)).png().toBuffer()).toString('base64') } });
}) as typeof fetch;

let t: Awaited<ReturnType<typeof createTestApp>>;
let cookie: string;
const req = (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: unknown) =>
  t.app.inject({ method, url, headers: { cookie }, ...(payload !== undefined ? { payload: payload as object } : {}) });

beforeAll(async () => {
  t = await createTestApp({ fetchImpl: fakeFetch });
  t.icons.delayMs = 0;
  ({ cookie } = await t.login('Anna'));
});
afterAll(async () => t?.close());

describe('Merklisten', () => {
  let listId: string;

  it('keep tips with who recommended them and where to find them', async () => {
    const list = (await req('POST', '/api/v1/lists', { name: 'Filme', type: 'memo', description: 'Filme und Serien, die wir sehen wollen' })).json();
    listId = list.id;
    expect(list).toMatchObject({ type: 'memo', description: 'Filme und Serien, die wir sehen wollen' });
    await req('POST', `/api/v1/lists/${listId}/items`, { text: 'Dune @Ben #Netflix', items: [{ name: 'Severance', tipFrom: 'Carla', where: 'Apple TV' }] });
    const items = (await req('GET', `/api/v1/lists/${listId}`)).json().items;
    expect(items.find((i: { name: string }) => i.name === 'Dune')).toMatchObject({ tipFrom: 'Ben', where: 'Netflix', category: { id: 'merkliste' } });
    expect(items.find((i: { name: string }) => i.name === 'Severance')).toMatchObject({ tipFrom: 'Carla', where: 'Apple TV' });
    // No grocery catalog: "Dune" stays "Dune".
    expect(items.every((i: { catalogItemId: string | null }) => i.catalogItemId === null)).toBe(true);
    await req('PATCH', `/api/v1/lists/${listId}`, { description: 'Filme und Serien für den Winter' });
    expect((await req('GET', `/api/v1/lists/${listId}`)).json().description).toBe('Filme und Serien für den Winter');
  });

  it('give every entry its own icon, drawn with the list description in mind', async () => {
    await req('PUT', '/api/v1/icons/settings', { autoApprove: true, cloudflare: { accountId: 'a', token: 't' } });
    const dune = (await req('GET', `/api/v1/lists/${listId}`)).json().items.find((i: { name: string }) => i.name === 'Dune');
    await req('POST', '/api/v1/icons/generate', { targetType: 'entry', targetId: dune.id, candidates: 1 });
    expect((await req('POST', '/api/v1/icons/run')).json().result).toBe('done');

    expect(described[0]).toContain('film or series');
    expect(described[0]).toContain('"Dune" on the personal list "Filme" (the list is about: Filme und Serien für den Winter) – available at Netflix');
    expect(prompts[0]).toContain('Icon of a sandworm rising from desert dunes.');
    expect(prompts[0]).toContain('It stands for "Dune" on the personal list "Filme"');

    // Approved automatically and synced with the entry.
    const pull = (await req('GET', '/api/v1/sync/pull?since=0')).json();
    const entry = pull.items.find((i: { id: string }) => i.id === dune.id);
    expect(entry.icon).toMatch(/^[0-9a-f]{10}$/);
    const img = await t.app.inject({ method: 'GET', url: `/icons/entry/${dune.id}.webp?v=${entry.icon}` });
    expect(img.statusCode).toBe(200);
    expect(img.headers['cache-control']).toContain('immutable');
  });
});
