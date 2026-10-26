import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { processIcon } from '../src/icons/image.js';
import { stableUuid } from '../src/db/seed.js';
import { createTestApp } from './helpers.js';

/** What an image model would return: an orange ball with a soft shadow on flat magenta. */
async function fakePicture(opts: { size?: number; touchEdge?: boolean; transparent?: boolean } = {}): Promise<Buffer> {
  const size = opts.size ?? 512;
  const r = opts.touchEdge ? size * 0.6 : size * 0.25;
  const bg = opts.transparent ? 'none' : '#FF00FF';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <rect width="100%" height="100%" fill="${bg}"/>
    <ellipse cx="${size / 2}" cy="${size * 0.78}" rx="${r}" ry="${r * 0.2}" fill="#C800C8"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="#E8892B"/>
    <circle cx="${size * 0.42}" cy="${size * 0.42}" r="${r * 0.25}" fill="#F6B66B"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

interface Call {
  model: string;
  prompt: string;
  references: number;
}
const calls: Call[] = [];
let failWith: { status: number; body: unknown } | null = null;
let cutOff = false;

const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(String(input));
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (url.hostname !== 'api.cloudflare.com') return new Response('not found', { status: 404 });
  expect((init?.headers as Record<string, string>).authorization).toBe('Bearer cf-token');
  if (failWith) return json(failWith.body, failWith.status);
  const model = url.pathname.split('/ai/run/')[1]!;
  if (model.includes('llama')) return json({ result: { response: 'a jar of pickled beetroot' }, success: true });
  const form = init!.body as FormData;
  const references = [0, 1, 2, 3].filter((i) => form.has(`input_image_${i}`)).length;
  calls.push({ model, prompt: String(form.get('prompt')), references });
  return json({ result: { image: (await fakePicture({ touchEdge: cutOff })).toString('base64') }, success: true });
}) as typeof fetch;

let t: Awaited<ReturnType<typeof createTestApp>>;
let cookie: string;

const req = async (method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) => {
  const res = await t.app.inject({ method, url, headers: { cookie }, ...(payload !== undefined ? { payload: payload as object } : {}) });
  return res;
};
const seedId = (name: string) => stableUuid('shopping-seed', name.toLowerCase());

beforeAll(async () => {
  t = await createTestApp({ fetchImpl: fakeFetch });
  t.icons.delayMs = 0;
  cookie = (await t.login('Anna')).cookie;
});
afterAll(async () => t?.close());

describe('icon post-processing', () => {
  it('removes the key colour and its shadow, centres the object in the safe area', async () => {
    const out = await processIcon(await fakePicture({ size: 768 }));
    expect(out.checks).toEqual({ background: true, complete: true, size: true });
    const { data, info } = await sharp(out.image).raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([512, 512]);
    const alpha = (x: number, y: number) => data[(y * info.width + x) * 4 + 3]!;
    expect(alpha(5, 5)).toBe(0);
    expect(alpha(256, 256)).toBe(255);
    // No magenta left anywhere (shadow and anti-aliased fringe are gone).
    let magenta = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3]! > 64 && data[i]! > 150 && data[i + 2]! > 150 && data[i + 1]! < 80) magenta++;
    }
    expect(magenta).toBe(0);
    // Object fills the safe area: 32 px margin, longest side ~392 px.
    let minX = 512;
    let maxX = 0;
    for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) if (alpha(x, y) > 24) [minX, maxX] = [Math.min(minX, x), Math.max(maxX, x)];
    expect(minX).toBeGreaterThanOrEqual(32);
    expect(maxX - minX).toBeGreaterThan(380);
    const thumb = await sharp(out.thumb).metadata();
    expect([thumb.width, thumb.format]).toEqual([192, 'webp']);
  });

  it('flags cut-off objects and keeps real transparency', async () => {
    expect((await processIcon(await fakePicture({ touchEdge: true }))).checks.complete).toBe(false);
    const transparent = await processIcon(await fakePicture({ transparent: true }));
    expect(transparent.checks.background).toBe(true);
  });
});

describe('icon pipeline', () => {
  it('keeps secrets out of the settings it returns', async () => {
    const res = await req('PUT', '/api/v1/icons/settings', { autoApprove: false, cloudflare: { accountId: 'acc', token: 'cf-token', dailyLimit: 20 } });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('cf-token');
    expect(res.json().cloudflare.hasToken).toBe(true);
  });

  it('starts by finding the style with the anchor items, without references', async () => {
    const status = (await req('GET', '/api/v1/icons/status')).json();
    expect(status.phase).toBe('style');
    const run = await req('POST', '/api/v1/icons/run');
    expect(run.json().result).toBe('done');
    // Highest priority anchor job, three candidates, no references yet.
    expect(calls).toHaveLength(3);
    expect(calls.every((c) => c.references === 0 && c.model === '@cf/black-forest-labs/flux-2-klein-4b')).toBe(true);
    expect(calls[0]!.prompt).toMatch(/^Icon of .+ magenta/);
    expect(calls[0]!.prompt).not.toContain('reference');

    const review = (await req('GET', '/api/v1/icons/review')).json();
    expect(review.targets).toHaveLength(1);
    expect(review.targets[0].candidates).toHaveLength(3);
    const img = await req('GET', `/api/v1/icons/${review.targets[0].candidates[0].id}/image`);
    expect(img.headers['content-type']).toBe('image/webp');
  });

  it('approving publishes the icon to the catalog and serves it publicly', async () => {
    const [target] = (await req('GET', '/api/v1/icons/review')).json().targets;
    const chosen = target.candidates[1].id;
    expect((await req('POST', `/api/v1/icons/${chosen}/approve`, { anchor: true })).statusCode).toBe(200);

    const catalog = (await req('GET', '/api/v1/catalog')).json();
    const item = catalog.items.find((i: { id: string }) => i.id === target.targetId);
    expect(item.icon).toMatch(/^[0-9a-f]{10}$/);
    // The other candidates are rejected and gone from the review.
    expect((await req('GET', '/api/v1/icons/review')).json().targets).toHaveLength(0);

    const pub = await t.app.inject({ method: 'GET', url: `/icons/item/${target.targetId}.webp?v=${item.icon}` });
    expect(pub.statusCode).toBe(200);
    expect(pub.headers['cache-control']).toContain('immutable');
    expect((await t.app.inject({ method: 'GET', url: `/icons/item/${seedId('Salz')}.webp` })).statusCode).toBe(404);
  });

  it('uses the anchors as style references once the style is found', async () => {
    // Three more anchors (the style phase needs four).
    for (let n = 0; n < 3; n++) {
      expect((await req('POST', '/api/v1/icons/run')).json().result).toBe('done');
      const [target] = (await req('GET', '/api/v1/icons/review')).json().targets;
      await req('POST', `/api/v1/icons/${target.candidates[0].id}/approve`, { anchor: true });
    }
    const status = (await req('GET', '/api/v1/icons/status')).json();
    expect(status.phase).toBe('mass');
    expect(status.anchors).toBe(4);

    calls.length = 0;
    expect((await req('POST', '/api/v1/icons/run')).json().result).toBe('done');
    // Next come category icons, now with the four anchors as references.
    expect(calls[0]!.references).toBe(4);
    expect(calls[0]!.prompt).toContain('composition');
    expect(calls[0]!.prompt).toContain('reference images');

    const [category] = (await req('GET', '/api/v1/icons/review')).json().targets;
    expect(category.targetType).toBe('category');
    await req('POST', `/api/v1/icons/${category.candidates[0].id}/approve`);
    const catalog = (await req('GET', '/api/v1/catalog?since=999999999')).json();
    expect(catalog.categoryIcons[category.targetId]).toMatch(/^[0-9a-f]{10}$/);
    expect((await t.app.inject({ method: 'GET', url: `/icons/category/${category.targetId}.webp` })).statusCode).toBe(200);
  });

  it('describes items without a built-in subject with a text model', async () => {
    const [row] = await t.db.execute<{ id: string }>(
      // A Mealie food without English description.
      (await import('drizzle-orm')).sql`INSERT INTO catalog_items (id, name, category_id, source) VALUES (gen_random_uuid(), 'Rote-Bete-Salat', 'fertig-tk', 'mealie') RETURNING id`,
    );
    calls.length = 0;
    await req('POST', '/api/v1/icons/generate', { targetType: 'item', targetId: row!.id, candidates: 1, hint: 'only one jar' });
    expect((await req('POST', '/api/v1/icons/run')).json().result).toBe('done');
    expect(calls.some((c) => c.prompt.startsWith('Icon of a jar of pickled beetroot. only one jar.'))).toBe(true);
  });

  it('stops at the daily budget and pauses when the provider says the quota is used up', async () => {
    await req('PUT', '/api/v1/icons/settings', { cloudflare: { dailyLimit: 0 } });
    await req('POST', '/api/v1/icons/generate', { targetType: 'item', targetId: seedId('Salz') });
    calls.length = 0;
    expect((await req('POST', '/api/v1/icons/run')).json().result).toBe('budget');
    expect(calls).toHaveLength(0);

    await req('PUT', '/api/v1/icons/settings', { cloudflare: { dailyLimit: 100 } });
    failWith = { status: 429, body: { success: false, errors: [{ code: 4006, message: 'you have used up your daily free allocation of 10,000 neurons' }] } };
    expect((await req('POST', '/api/v1/icons/run')).json().result).toBe('paused');
    failWith = null;
    const status = (await req('GET', '/api/v1/icons/status')).json();
    expect(new Date(status.settings.pausedUntil).getTime()).toBeGreaterThan(Date.now());
    expect((await req('POST', '/api/v1/icons/run')).json().result).toBe('paused');
    // New credentials lift the pause.
    await req('PUT', '/api/v1/icons/settings', { cloudflare: { token: 'cf-token' } });
    expect((await req('POST', '/api/v1/icons/run')).json().result).toBe('done');
  });

  it('takes back an approved icon, takes reports and uploads', async () => {
    const apple = (await req('GET', '/api/v1/icons/gallery')).json().icons.find((i: { targetType: string }) => i.targetType === 'item');
    await req('POST', `/api/v1/icons/${apple.id}/reject`);
    const catalog = (await req('GET', '/api/v1/catalog')).json();
    expect(catalog.items.find((i: { id: string }) => i.id === apple.targetId).icon).toBeNull();

    expect((await req('POST', `/api/v1/catalog/${seedId('Milch')}/icon-report`)).statusCode).toBe(200);

    const up = await req('POST', '/api/v1/icons/upload', {
      targetType: 'item',
      targetId: seedId('Butter'),
      image: `data:image/png;base64,${(await fakePicture()).toString('base64')}`,
    });
    expect(up.statusCode).toBe(200);
    const bad = await req('POST', '/api/v1/icons/upload', { targetType: 'item', targetId: seedId('Butter'), image: 'bm90IGFuIGltYWdl' });
    expect(bad.statusCode).toBe(422);
    expect(bad.headers['content-type']).toContain('problem+json');
  });

  it('is for logged-in accounts only', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/api/v1/icons/status' })).statusCode).toBe(401);
  });

  it('approves automatically: the first good candidate goes live, bad ones wait for a person', async () => {
    // Waiting candidates from before are approved when switching it on.
    const before = (await req('GET', '/api/v1/icons/review')).json().targets.length;
    expect(before).toBeGreaterThan(0);
    await req('PUT', '/api/v1/icons/settings', { autoApprove: true });
    const left = (await req('GET', '/api/v1/icons/review')).json().targets;
    expect(left.length).toBeLessThan(before);

    // New jobs: one picture is enough when it passes.
    await req('POST', '/api/v1/icons/generate', { targetType: 'item', targetId: seedId('Zucker'), candidates: 3 });
    calls.length = 0;
    expect((await req('POST', '/api/v1/icons/run')).json().result).toBe('done');
    expect(calls).toHaveLength(1);
    const catalog = (await req('GET', '/api/v1/catalog')).json();
    expect(catalog.items.find((i: { id: string }) => i.id === seedId('Zucker')).icon).toMatch(/^[0-9a-f]{10}$/);

    // A cut-off picture fails a check: not approved, the app keeps the category icon.
    cutOff = true;
    await req('POST', '/api/v1/icons/generate', { targetType: 'item', targetId: seedId('Mehl'), candidates: 2 });
    calls.length = 0;
    expect((await req('POST', '/api/v1/icons/run')).json().result).toBe('done');
    expect(calls).toHaveLength(2);
    cutOff = false;
    const after = (await req('GET', '/api/v1/catalog')).json();
    expect(after.items.find((i: { id: string }) => i.id === seedId('Mehl')).icon).toBeNull();
    const waiting = (await req('GET', '/api/v1/icons/review')).json().targets.find((x: { targetId: string }) => x.targetId === seedId('Mehl'));
    expect(waiting.candidates).toHaveLength(2);
  });

  it('draws spices as a coloured pile, without image AI', async () => {
    const list = (await req('POST', '/api/v1/lists', { name: 'Gewürze' })).json().id;
    await req('POST', `/api/v1/lists/${list}/items`, { text: 'Paprikapulver' });
    await t.icons.enqueueMissing();
    calls.length = 0;
    // Work through the queue until the spice is done (other items may come first).
    for (let n = 0; n < 40; n++) {
      const catalog = (await req('GET', '/api/v1/catalog')).json();
      if (catalog.items.find((i: { id: string }) => i.id === seedId('Paprikapulver')).icon) break;
      expect(['done', 'failed']).toContain((await req('POST', '/api/v1/icons/run')).json().result);
    }
    const [icon] = await t.db.execute<{ provider: string; status: string; svg: string }>(
      (await import('drizzle-orm')).sql`SELECT provider, status, svg FROM icons WHERE target_type = 'item' AND target_id = ${seedId('Paprikapulver')}`,
    );
    expect(icon).toMatchObject({ provider: 'builtin', status: 'approved' });
    expect(icon!.svg).toContain('#C8372D');
    expect(calls.some((c) => c.prompt.includes('Paprikapulver'))).toBe(false);
  });

  it('only plans pictures for catalog items that are or were on a list', async () => {
    await t.icons.enqueueMissing();
    const rows = await t.db.execute<{ target_id: string }>(
      (await import('drizzle-orm')).sql`SELECT target_id FROM icon_jobs WHERE target_type = 'item' AND status = 'queued' AND priority < 1000`,
    );
    const ids = rows.map((r) => r.target_id);
    expect(ids.every((id) => id !== seedId('Ingwer'))).toBe(true);
    const list = (await req('POST', '/api/v1/lists', { name: 'Asia' })).json().id;
    await req('POST', `/api/v1/lists/${list}/items`, { text: 'Ingwer' });
    await t.icons.enqueueMissing();
    const after = await t.db.execute<{ target_id: string }>(
      (await import('drizzle-orm')).sql`SELECT target_id FROM icon_jobs WHERE target_type = 'item' AND target_id = ${seedId('Ingwer')}`,
    );
    expect(after).toHaveLength(1);
  });

  it('is for logged-in accounts only, too', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/api/v1/icons/review' })).statusCode).toBe(401);
  });
});
