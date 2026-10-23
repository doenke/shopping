import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { users } from '../src/db/schema.js';
import { createTestApp } from './helpers.js';

const IDP = 'https://id.example/api/users/u1/profile-picture.png';
let picture: Buffer;
let requests: { url: string; auth: string | undefined }[] = [];
let needsToken = false;

const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  const auth = (init?.headers as Record<string, string>)?.authorization;
  requests.push({ url, auth });
  if (url !== IDP) return new Response('down', { status: 502 });
  if (needsToken && auth !== 'Bearer at-1') return new Response('unauthorized', { status: 401 });
  return new Response(new Uint8Array(picture), { headers: { 'content-type': 'image/png' } });
}) as typeof fetch;

let t: Awaited<ReturnType<typeof createTestApp>>;

beforeAll(async () => {
  picture = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#3a7' } }).png().toBuffer();
  t = await createTestApp({ fetchImpl: fakeFetch });
});
afterAll(async () => t?.close());

describe('profile pictures from OIDC', () => {
  it('keeps a small local copy and hands out only the local URL', async () => {
    const anna = await t.login('Anna');
    await t.db.update(users).set({ avatarUrl: IDP }).where(eq(users.id, anna.id));
    await t.avatars.refreshAll();

    const pull = (await t.app.inject({ method: 'GET', url: '/api/v1/sync/pull?since=0', headers: { cookie: anna.cookie } })).json();
    const me = pull.users.find((u: { id: string }) => u.id === anna.id);
    expect(me.avatarUrl).toMatch(new RegExp(`^/avatars/${anna.id}\\.webp\\?v=[0-9a-f]{10}$`));
    expect(JSON.stringify(pull)).not.toContain('id.example');
    expect(pull.me.avatarUrl).toBe(me.avatarUrl);

    const img = await t.app.inject({ method: 'GET', url: me.avatarUrl, headers: { cookie: anna.cookie } });
    expect(img.statusCode).toBe(200);
    expect(img.headers['content-type']).toBe('image/webp');
    expect(img.headers['cache-control']).toContain('immutable');
    const meta = await sharp(img.rawPayload).metadata();
    expect([meta.width, meta.height]).toEqual([128, 128]);

    // Not for strangers.
    expect((await t.app.inject({ method: 'GET', url: me.avatarUrl })).statusCode).toBe(401);
  });

  it('retries with the access token, and survives a broken provider', async () => {
    const ben = await t.login('Ben');
    needsToken = true;
    requests = [];
    await t.avatars.refresh(ben.id, IDP, 'at-1');
    expect(requests.map((r) => r.auth)).toEqual([undefined, 'Bearer at-1']);
    const [row] = await t.db.select({ v: users.avatarVersion }).from(users).where(eq(users.id, ben.id));
    expect(row!.v).toMatch(/^[0-9a-f]{10}$/);

    // Provider down: the old picture stays.
    needsToken = false;
    await t.avatars.refresh(ben.id, 'https://id.example/broken.png');
    const [after] = await t.db.select({ v: users.avatarVersion }).from(users).where(eq(users.id, ben.id));
    expect(after!.v).toBe(row!.v);

    // Picture removed in the provider (claim gone): the copy goes too.
    await t.avatars.refresh(ben.id, null);
    const [gone] = await t.db.select({ v: users.avatarVersion }).from(users).where(eq(users.id, ben.id));
    expect(gone!.v).toBeNull();
  });
});
