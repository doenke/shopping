import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './helpers.js';

interface Delivery {
  url: string;
  headers: Headers;
  body: string;
}
const deliveries: Delivery[] = [];
let answer = 200;

const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const req = new Request(input, init);
  if (!req.url.startsWith('https://n8n.example/')) return new Response('nope', { status: 404 });
  deliveries.push({ url: req.url, headers: req.headers, body: await req.text() });
  return new Response('ok', { status: answer });
}) as typeof fetch;

let t: Awaited<ReturnType<typeof createTestApp>>;
let cookie: string;
let token: string;
const req = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown, headers: Record<string, string> = { cookie }) =>
  t.app.inject({ method, url, headers, ...(payload !== undefined ? { payload: payload as object } : {}) });
const waitFor = async (cond: () => boolean) => {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 20));
  expect(cond()).toBe(true);
};

beforeAll(async () => {
  t = await createTestApp({ fetchImpl: fakeFetch });
  t.webhooks.retryDelaysMs = [10, 10];
  ({ cookie } = await t.login('Anna'));
  token = (await req('POST', '/api/v1/tokens', { name: 'n8n', scopes: ['read', 'write'] })).json().token;
  await req('POST', '/api/v1/lists', { name: 'Einkauf' }, { authorization: `Bearer ${token}` });
});
afterAll(async () => t?.close());

describe('outgoing webhooks', () => {
  let secret: string;
  let hookId: string;

  it('signs every delivery with the secret shown once', async () => {
    const created = (await req('POST', '/api/v1/webhooks', { url: 'https://n8n.example/hook', events: ['item.changed'] })).json();
    secret = created.secret;
    hookId = created.id;
    expect(secret).toMatch(/^whsec_/);
    expect((await req('GET', '/api/v1/webhooks')).body).not.toContain(secret);

    await req('POST', '/api/v1/lists/default/items', { text: 'Milch, Brot' }, { authorization: `Bearer ${token}` });
    await waitFor(() => deliveries.length === 1);
    const d = deliveries[0]!;
    const payload = JSON.parse(d.body);
    // Only the wanted event type, both items in one delivery.
    expect(payload.events.map((e: { type: string; data: { name: string } }) => `${e.type}:${e.data.name}`).sort()).toEqual([
      'item.changed:Brot',
      'item.changed:Milch',
    ]);
    expect(payload.events[0].data.addedVia).toBe('n8n');
    const [, ts, sig] = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(d.headers.get('x-shopping-signature')!)!;
    expect(sig).toBe(createHmac('sha256', secret).update(`${ts}.${d.body}`).digest('hex'));
    expect(d.headers.get('x-shopping-event-id')).toBe(payload.id);
  });

  it('retries, and sends again what failed', async () => {
    deliveries.length = 0;
    answer = 503;
    await req('POST', '/api/v1/lists/default/items', { text: 'Eier' }, { authorization: `Bearer ${token}` });
    await waitFor(() => deliveries.length === 3); // first try + 2 retries
    let hook = { failures: 0, lastStatus: '' };
    for (let i = 0; i < 50 && hook.failures === 0; i++) {
      await new Promise((r) => setTimeout(r, 20));
      [hook] = (await req('GET', '/api/v1/webhooks')).json();
    }
    expect(hook).toMatchObject({ failures: 1, lastStatus: 'HTTP 503' });

    // Receiver is back: the next change brings the missed one along (stored stream position).
    answer = 200;
    deliveries.length = 0;
    t.webhooks.stop();
    await t.webhooks.start();
    await waitFor(() => deliveries.length >= 1);
    const names = deliveries.flatMap((d) => JSON.parse(d.body).events.map((e: { data: { name: string } }) => e.data.name));
    expect(names).toContain('Eier');
  });

  it('can be tested, paused and deleted', async () => {
    deliveries.length = 0;
    const test = (await req('POST', `/api/v1/webhooks/${hookId}/test`)).json();
    expect(test).toEqual({ ok: true, status: 'HTTP 200' });
    expect(JSON.parse(deliveries[0]!.body).events[0].type).toBe('ping');

    await req('PATCH', `/api/v1/webhooks/${hookId}`, { active: false });
    deliveries.length = 0;
    await req('POST', '/api/v1/lists/default/items', { text: 'Butter' }, { authorization: `Bearer ${token}` });
    await new Promise((r) => setTimeout(r, 200));
    expect(deliveries).toHaveLength(0);
    expect((await req('DELETE', `/api/v1/webhooks/${hookId}`)).statusCode).toBe(200);
    expect((await req('GET', '/api/v1/webhooks')).json()).toEqual([]);
  });
});

describe('Idempotency-Key', () => {
  const auth = () => ({ authorization: `Bearer ${token}`, 'idempotency-key': 'retry-1' });

  it('answers a repeated request from memory instead of adding twice', async () => {
    const first = await req('POST', '/api/v1/lists/default/items', { text: '2 Zitronen' }, auth());
    const second = await req('POST', '/api/v1/lists/default/items', { text: '2 Zitronen' }, auth());
    expect(second.statusCode).toBe(200);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.json()).toEqual(first.json());
    const list = (await req('GET', '/api/v1/lists/default', undefined, { authorization: `Bearer ${token}` })).json();
    expect(list.items.find((i: { name: string }) => i.name === 'Zitronen').quantity).toBe('2');
  });

  it('refuses the same key for a different request', async () => {
    const res = await req('POST', '/api/v1/lists/default/items', { text: '3 Zitronen' }, auth());
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('idempotency_key_reused');
  });

  it('lets a failed request be retried with the same key', async () => {
    const h = { authorization: `Bearer ${token}`, 'idempotency-key': 'retry-2' };
    expect((await req('POST', '/api/v1/lists/nope/items', { text: 'X' }, h)).statusCode).toBe(404);
    expect((await req('POST', '/api/v1/lists/nope/items', { text: 'X' }, h)).statusCode).toBe(404);
  });
});
