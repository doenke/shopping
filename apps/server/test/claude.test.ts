import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sanitizeSvg } from '../src/icons/anthropic.js';
import { createTestApp } from './helpers.js';

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><radialGradient id="h"><stop offset="0" stop-color="#F6B66B"/><stop offset="1" stop-color="#E8892B"/></radialGradient></defs>' +
  '<circle cx="256" cy="260" r="160" fill="url(#h)"/><ellipse cx="200" cy="200" rx="40" ry="28" fill="#F8C98E"/><path d="M256 100 L270 60" stroke="#6B4A2B" stroke-width="12"/></svg>';

interface Call {
  kind: 'svg' | 'review' | 'describe';
  model: string;
  beta: string | null;
  fallbacks: unknown;
  text: string;
  images: number;
}
const calls: Call[] = [];
let reviewOk = true;

const usage = { input_tokens: 1200, output_tokens: 900, cache_creation_input_tokens: 0, cache_read_input_tokens: 3000 };
const message = (model: string, payload: unknown) =>
  new Response(
    JSON.stringify({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model,
      content: [{ type: 'text', text: JSON.stringify(payload) }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage,
    }),
    { headers: { 'content-type': 'application/json' } },
  );

const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  // The SDK may hand over a Request or a URL plus init.
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (url.hostname !== 'api.anthropic.com') return new Response('not found', { status: 404 });
  const headers = request.headers;
  expect(headers.get('authorization')).toBe('Bearer sk-ant-test');
  const body = JSON.parse(await request.text()) as {
    model: string;
    fallbacks?: unknown;
    output_config: { format: { schema: { properties: Record<string, unknown> } } };
    messages: { content: string | { type: string; text?: string }[] }[];
  };
  const props = body.output_config.format.schema.properties;
  const kind = 'svg' in props ? 'svg' : 'recognizable' in props ? 'review' : 'describe';
  const content = body.messages[0]!.content;
  const blocks = typeof content === 'string' ? [{ type: 'text', text: content }] : content;
  calls.push({
    kind,
    model: body.model,
    beta: headers.get('anthropic-beta'),
    fallbacks: body.fallbacks,
    text: blocks.map((b) => b.text ?? '').join('\n'),
    images: blocks.filter((b) => b.type === 'image').length,
  });
  if (kind === 'svg') return message(body.model, { svg: SVG });
  if (kind === 'describe') return message(body.model, { subject: 'jar of pickled beetroot' });
  return message(body.model, {
    shows: reviewOk ? 'an orange fruit' : 'a blurry blob',
    recognizable: reviewOk,
    has_text: false,
    style_match: true,
    defects: false,
    reason: reviewOk ? 'Passt.' : 'Nicht zu erkennen.',
  });
}) as typeof fetch;

let t: Awaited<ReturnType<typeof createTestApp>>;
let cookie: string;
const req = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) =>
  t.app.inject({ method, url, headers: { cookie }, ...(payload !== undefined ? { payload: payload as object } : {}) });

beforeAll(async () => {
  t = await createTestApp({ fetchImpl: fakeFetch });
  t.icons.delayMs = 0;
  cookie = (await t.login('Anna')).cookie;
});
afterAll(async () => t?.close());

describe('SVG safety', () => {
  it('accepts plain shapes and rejects anything that could load or show something else', () => {
    expect(sanitizeSvg(SVG)).toBe(SVG);
    const wrap = (inner: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${inner}</svg>`;
    expect(() => sanitizeSvg(wrap('<image href="file:///etc/passwd"/>'))).toThrow();
    expect(() => sanitizeSvg(wrap('<text x="1" y="1">MILCH</text>'))).toThrow();
    expect(() => sanitizeSvg(wrap('<script>alert(1)</script>'))).toThrow();
    expect(() => sanitizeSvg(wrap('<rect fill="url(https://x.example/a)"/>'))).toThrow();
    expect(() => sanitizeSvg(wrap('<rect onload="x()"/>'))).toThrow();
    expect(() => sanitizeSvg(wrap('<use xlink:href="#a"/>'))).toThrow();
    expect(() => sanitizeSvg('<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]>' + wrap(''))).toThrow();
  });
});

describe('Claude in the icon pipeline', () => {
  it('keeps the key secret', async () => {
    const res = await req('PUT', '/api/v1/icons/settings', { autoApprove: false, provider: 'claude', anthropic: { apiKey: 'sk-ant-test', monthlyCap: 5 } });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('sk-ant-test');
    expect(res.json().anthropic).toMatchObject({ hasKey: true, svgModel: 'claude-sonnet-5-5', review: true, reviewModel: 'claude-haiku-5-5' });
  });

  it('draws SVG icons with Sonnet and has Haiku pre-review each one', async () => {
    expect((await req('POST', '/api/v1/icons/run')).json().result).toBe('done');
    const svg = calls.filter((c) => c.kind === 'svg');
    const review = calls.filter((c) => c.kind === 'review');
    expect(svg).toHaveLength(3);
    expect(review).toHaveLength(3);
    // Sonnet gets the server-side fallback on a safety decline, Haiku does not.
    expect(svg[0]).toMatchObject({ model: 'claude-sonnet-5-5', fallbacks: 'default' });
    expect(svg[0]!.beta).toContain('server-side-fallback-2026-07-01');
    expect(review[0]).toMatchObject({ model: 'claude-haiku-5-5', fallbacks: undefined, images: 1 });

    const [target] = (await req('GET', '/api/v1/icons/review')).json().targets;
    expect(target.candidates).toHaveLength(3);
    expect(target.candidates[0]).toMatchObject({ provider: 'claude', aiReview: { ok: true, shows: 'an orange fruit' } });
    const img = await req('GET', `/api/v1/icons/${target.candidates[0].id}/image?size=master`);
    expect(img.headers['content-type']).toBe('image/webp');

    // Real token usage is billed: 1200·2 + 3000·0.2 + 900·10 µ$ per SVG, plus the Haiku reviews.
    const status = (await req('GET', '/api/v1/icons/status')).json();
    expect(status.usage.claudeMonth).toBeGreaterThan(0.03);
    expect(status.usage.claudeMonth).toBeLessThan(0.05);
  });

  it('uses approved SVG anchors as references for the next icons', async () => {
    for (let n = 0; n < 4; n++) {
      if (n > 0) expect((await req('POST', '/api/v1/icons/run')).json().result).toBe('done');
      const [target] = (await req('GET', '/api/v1/icons/review')).json().targets;
      await req('POST', `/api/v1/icons/${target.candidates[0].id}/approve`, { anchor: true });
    }
    calls.length = 0;
    expect((await req('POST', '/api/v1/icons/run')).json().result).toBe('done');
    const first = calls.find((c) => c.kind === 'svg')!;
    expect(first.text).toContain('Reference 4:');
    expect(first.text).toContain('<circle');
    expect(first.text).toContain('Draw: small composition');
    // The reviewer compares with three anchors plus the candidate.
    expect(calls.find((c) => c.kind === 'review')!.images).toBe(4);
  });

  it('tries once more when the pre-review rejects every candidate', async () => {
    reviewOk = false;
    calls.length = 0;
    await req('POST', '/api/v1/icons/generate', { targetType: 'category', targetId: 'getraenke', provider: 'claude', candidates: 1 });
    expect((await req('POST', '/api/v1/icons/run')).json().result).toBe('done');
    const [job] = await t.db.execute<{ status: string; attempts: number; hint: string }>(
      sql`SELECT status, attempts, hint FROM icon_jobs WHERE target_id = 'getraenke' ORDER BY created_at DESC LIMIT 1`,
    );
    expect(job).toMatchObject({ status: 'queued', attempts: 1 });
    expect(job!.hint).toContain('a blurry blob');
    // The pre-review knows what the icon is for – a category here, not a grocery.
    const review = calls.find((c) => c.kind === 'review')!;
    expect(review.text).toContain('a section of a list');
    expect(review.text).toContain('a symbolic motif is right here');
    expect(review.text).not.toContain('grocery icon set');
    expect((await req('POST', '/api/v1/icons/run')).json().result).toBe('done');
    const [after] = await t.db.execute<{ status: string }>(sql`SELECT status FROM icon_jobs WHERE target_id = 'getraenke' ORDER BY created_at DESC LIMIT 1`);
    expect(after!.status).toBe('done');
    // Sorted out, but still there for a person to overrule.
    const target = (await req('GET', '/api/v1/icons/review')).json().targets.find((x: { targetId: string }) => x.targetId === 'getraenke');
    expect(target.candidates.every((c: { aiReview: { ok: boolean } }) => c.aiReview.ok === false)).toBe(true);
    reviewOk = true;
  });

  it('describes Mealie items with Claude', async () => {
    const [row] = await t.db.execute<{ id: string }>(
      sql`INSERT INTO catalog_items (id, name, category_id, source) VALUES (gen_random_uuid(), 'Rote-Bete-Salat', 'fertig-tk', 'mealie') RETURNING id`,
    );
    calls.length = 0;
    await req('POST', '/api/v1/icons/generate', { targetType: 'item', targetId: row!.id, candidates: 1 });
    expect((await req('POST', '/api/v1/icons/run')).json().result).toBe('done');
    expect(calls[0]).toMatchObject({ kind: 'describe', model: 'claude-haiku-5-5' });
    expect(calls.find((c) => c.kind === 'svg')!.text).toContain('Draw: jar of pickled beetroot.');
  });

  it('stops at the monthly cap', async () => {
    await req('PUT', '/api/v1/icons/settings', { anthropic: { monthlyCap: 0.01 } });
    await req('POST', '/api/v1/icons/generate', { targetType: 'category', targetId: 'pflege' });
    calls.length = 0;
    expect((await req('POST', '/api/v1/icons/run')).json().result).toBe('budget');
    expect(calls).toHaveLength(0);
  });

  it('approves automatically only what the AI pre-review passed', async () => {
    await req('PUT', '/api/v1/icons/settings', { autoApprove: true, anthropic: { monthlyCap: 5 } });
    reviewOk = false;
    await req('POST', '/api/v1/icons/generate', { targetType: 'category', targetId: 'tierbedarf', candidates: 1 });
    expect((await req('POST', '/api/v1/icons/run')).json().result).toBe('done');
    const cat = () => req('GET', '/api/v1/catalog').then((r) => r.json().categoryIcons as Record<string, string>);
    expect((await cat()).tierbedarf).toBeUndefined();

    reviewOk = true;
    await req('POST', '/api/v1/icons/generate', { targetType: 'category', targetId: 'tierbedarf', candidates: 2 });
    calls.length = 0;
    expect((await req('POST', '/api/v1/icons/run')).json().result).toBe('done');
    expect(calls.filter((c) => c.kind === 'svg')).toHaveLength(1);
    expect((await cat()).tierbedarf).toMatch(/^[0-9a-f]{10}$/);
  });
});
