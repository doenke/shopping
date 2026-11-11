import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './helpers.js';

/** A Photon stand-in: "Hornbach" is found, every position is in the Bahnhofstraße. */
const asked: string[] = [];
const fakePhoton = (async (input: string | URL | Request) => {
  const url = new URL(String(input));
  asked.push(url.pathname);
  const feature = (name: string | null, lat: number, lon: number) => ({
    geometry: { coordinates: [lon, lat] },
    properties: { ...(name ? { name } : {}), street: 'Bahnhofstraße', housenumber: '3', postcode: '22767', city: 'Hamburg' },
  });
  const features = url.pathname.endsWith('/reverse')
    ? [feature(null, 53.5501, 9.9301)]
    : url.searchParams.get('q')?.toLowerCase().includes('hornbach')
      ? [feature('Hornbach', 53.56, 9.93)]
      : [];
  return new Response(JSON.stringify({ features }), { headers: { 'content-type': 'application/json' } });
}) as typeof fetch;

let t: Awaited<ReturnType<typeof createTestApp>>;
let cookie: string;
const req = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) =>
  t.app.inject({ method, url, headers: { cookie }, ...(payload !== undefined ? { payload: payload as object } : {}) });

beforeAll(async () => {
  t = await createTestApp({ fetchImpl: fakePhoton, env: { PHOTON_URL: 'http://photon.test:2322' } });
  ({ cookie } = await t.login('Anna'));
});
afterAll(async () => t?.close());

describe('places as attachments', () => {
  it('are searched and named through the own Photon server', async () => {
    const found = (await req('GET', '/api/v1/places/search?q=Hornbach')).json();
    expect(found.places).toEqual([{ name: 'Hornbach', address: 'Bahnhofstraße 3, 22767 Hamburg', lat: 53.56, lon: 9.93 }]);
    // "Here": the measured position stays, the address comes from Photon.
    const here = (await req('GET', '/api/v1/places/reverse?lat=53.55&lon=9.93')).json();
    expect(here).toEqual({ name: 'Bahnhofstraße 3', address: '22767 Hamburg', lat: 53.55, lon: 9.93 });
    expect(asked).toEqual(['/api', '/reverse']);
  });

  it('"*Name" in the API text attaches the place', async () => {
    const list = (await req('POST', '/api/v1/lists', { name: 'Erledigen', type: 'todo' })).json();
    const added = (await req('POST', `/api/v1/lists/${list.id}/items`, { text: 'Fliesen holen *Hornbach !morgen' })).json();
    const item = added.items?.[0] ?? (await req('GET', `/api/v1/lists/${list.id}`)).json().items[0];
    expect(item.name).toBe('Fliesen holen');
    expect(item.attachments).toEqual([expect.objectContaining({ type: 'place', name: 'Hornbach', lat: 53.56, lon: 9.93 })]);
  });

  it('every attachment syncs with its own clock, an attributes patch keeps them', async () => {
    const list = (await req('POST', '/api/v1/lists', { name: 'Auto', type: 'memo' })).json();
    const id = randomUUID();
    const push = (mutations: unknown[]) => req('POST', '/api/v1/sync/push', { mutations });
    const hlc = (n: number) => `${String(Date.now() + n).padStart(13, '0')}-0000-test`;
    const place = { id: 'p1', type: 'place', at: new Date().toISOString(), name: 'Parkhaus', address: null, lat: 53.5, lon: 9.9 };
    const link = { id: 'l2', type: 'link', at: new Date().toISOString(), url: 'https://example.org/park' };
    const res = await push([
      { mid: randomUUID(), entity: 'item', id, hlc: hlc(1), patch: { listId: list.id, name: 'Auto geparkt', position: 'a0' } },
      { mid: randomUUID(), entity: 'item', id, hlc: hlc(2), patch: { attachments: { p1: place } } },
      { mid: randomUUID(), entity: 'item', id, hlc: hlc(3), patch: { attachments: { l2: link } } },
      { mid: randomUUID(), entity: 'item', id, hlc: hlc(4), patch: { attributes: { person: 'Ben' } } },
    ]);
    expect(res.json().rejected).toEqual([]);
    const item = (await req('GET', `/api/v1/lists/${list.id}`)).json().items.find((i: { id: string }) => i.id === id);
    expect(item.attachments.map((a: { id: string }) => a.id)).toEqual(['p1', 'l2']);
    expect(item.tipFrom).toBe('Ben');
    // A removal with an older clock than the attachment loses.
    await push([{ mid: randomUUID(), entity: 'item', id, hlc: hlc(-5000), patch: { attachments: { p1: null } } }]);
    const again = (await req('GET', `/api/v1/lists/${list.id}`)).json().items.find((i: { id: string }) => i.id === id);
    expect(again.attachments).toHaveLength(2);
  });
});

describe('a slow or unreachable Photon', () => {
  it('waits as long as configured and says why it gave up', async () => {
    const { PlaceService } = await import('../src/places.js');
    const hang = ((_: unknown, init?: RequestInit) =>
      new Promise((_r, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason)))) as typeof fetch;
    await expect(new PlaceService('http://photon.test', hang, 50).search('x')).rejects.toThrow('Die Ortssuche antwortet nicht innerhalb von 0 s');
    const refused = (() => Promise.reject(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }))) as typeof fetch;
    await expect(new PlaceService('http://photon.test', refused).search('x')).rejects.toThrow('Die Ortssuche antwortet nicht (ECONNREFUSED)');
    const bad = (async () => new Response(JSON.stringify({ message: 'Language is not supported. Supported are: en' }), { status: 400 })) as typeof fetch;
    await expect(new PlaceService('http://photon.test', bad).search('x')).rejects.toThrow(
      'Die Ortssuche antwortet mit 400: Language is not supported. Supported are: en',
    );
  });
});

describe('one question to Photon at a time', () => {
  it('queues questions, drops those nobody waits for and calls off a running one', async () => {
    const { PlaceService, PlacesCancelled } = await import('../src/places.js');
    const sent: string[] = [];
    let running = 0;
    let most = 0;
    const answers = new Map<string, () => void>();
    const slow = ((input: string | URL, init?: RequestInit) => {
      const q = new URL(String(input)).searchParams.get('q')!;
      sent.push(q);
      most = Math.max(most, ++running);
      return new Promise<Response>((resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          running--;
          reject(init.signal?.reason);
        });
        answers.set(q, () => {
          running--;
          resolve(new Response(JSON.stringify({ features: [] })));
        });
      });
    }) as typeof fetch;
    const photon = new PlaceService('http://photon.test', slow);
    const tick = () => new Promise((r) => setTimeout(r, 10));

    const first = photon.search('Hor');
    const skipped = new AbortController();
    const second = photon.search('Horn', undefined, 6, skipped.signal);
    const third = new AbortController();
    const last = photon.search('Hornbach', undefined, 6, third.signal);
    await tick();
    expect(sent).toEqual(['Hor']);
    skipped.abort(); // typed on while still waiting: never reaches Photon
    answers.get('Hor')!();
    await expect(first).resolves.toEqual([]);
    await expect(second).rejects.toBeInstanceOf(PlacesCancelled);
    await tick();
    expect(sent).toEqual(['Hor', 'Hornbach']);
    third.abort(); // form closed while Photon is still searching: called off
    await expect(last).rejects.toBeInstanceOf(PlacesCancelled);
    expect(most).toBe(1);
    // The line goes on after a cancelled question.
    const next = photon.search('Baumarkt');
    await tick();
    answers.get('Baumarkt')!();
    await expect(next).resolves.toEqual([]);
  });
});
