import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './helpers.js';

let t: Awaited<ReturnType<typeof createTestApp>>;
let anna: string;
let ben: string;
const hlc = (n: number) => `${String(Date.now() + n).padStart(13, '0')}-0000-test`;

beforeAll(async () => {
  t = await createTestApp();
  ({ cookie: anna } = await t.login('Anna', 'Jacobs'));
  ({ cookie: ben } = await t.login('Ben', 'Nachbarn'));
});
afterAll(async () => t?.close());

const put = (cookie: string, id: string, body: Buffer, type: string, name: string) =>
  t.app.inject({ method: 'PUT', url: `/api/v1/files/${id}?name=${encodeURIComponent(name)}`, headers: { cookie, 'content-type': type }, payload: body });
const get = (cookie: string, url: string) => t.app.inject({ method: 'GET', url, headers: { cookie } });

describe('files as attachments', () => {
  it('are uploaded under the id of the device, with a preview for pictures', async () => {
    const id = randomUUID();
    const png = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#c33' } })
      .png()
      .toBuffer();
    expect((await put(anna, id, png, 'image/png', 'Fliesen.png')).statusCode).toBe(201);
    // A retry from the offline queue is fine; another person cannot take the id.
    expect((await put(anna, id, png, 'image/png', 'Fliesen.png')).statusCode).toBe(200);
    expect((await put(ben, id, png, 'image/png', 'x.png')).statusCode).toBe(409);

    const full = await get(anna, `/api/v1/files/${id}`);
    expect(full.statusCode).toBe(200);
    expect(full.headers['content-type']).toBe('image/png');
    expect(full.headers['content-disposition']).toContain('inline');
    expect(full.rawPayload.length).toBe(png.length);
    const thumb = await get(anna, `/api/v1/files/${id}?thumb=1`);
    expect(thumb.headers['content-type']).toBe('image/webp');
    expect((await sharp(thumb.rawPayload).metadata()).width).toBe(320);
  });

  it('other files are downloaded, and are only seen by people on a list with the entry', async () => {
    const id = randomUUID();
    const res = await put(anna, id, Buffer.from('a,b\n1,2\n'), 'text/csv', 'Liste ä.csv');
    expect(res.statusCode).toBe(201);
    expect((await get(ben, `/api/v1/files/${id}`)).statusCode).toBe(404);

    // Attached to an entry on a list shared with Ben: now he sees it too.
    const list = (await t.app.inject({ method: 'POST', url: '/api/v1/lists', headers: { cookie: anna }, payload: { name: 'Bau', type: 'todo' } })).json();
    const item = randomUUID();
    const att = { id: 'f1', type: 'file', at: new Date().toISOString(), fileId: id, name: 'Liste ä.csv', mime: 'text/csv', size: 8 };
    const push = await t.app.inject({
      method: 'POST',
      url: '/api/v1/sync/push',
      headers: { cookie: anna },
      payload: {
        mutations: [
          { mid: randomUUID(), entity: 'item', id: item, hlc: hlc(1), patch: { listId: list.id, name: 'Fliesen', position: 'a0' } },
          { mid: randomUUID(), entity: 'item', id: item, hlc: hlc(2), patch: { attachments: { f1: att } } },
        ],
      },
    });
    expect(push.json().rejected).toEqual([]);
    const api = (await get(anna, `/api/v1/lists/${list.id}`)).json();
    expect(api.items[0].attachments).toEqual([expect.objectContaining({ type: 'file', fileId: id, name: 'Liste ä.csv' })]);

    const [benUser] = await t.db.execute(sql`select id from users where display_name = 'Ben'`);
    await t.db.execute(sql`insert into list_members (list_id, user_id) values (${list.id}, ${benUser!.id}) on conflict do nothing`);
    const seen = await get(ben, `/api/v1/files/${id}`);
    expect(seen.statusCode).toBe(200);
    expect(seen.headers['content-disposition']).toBe(`attachment; filename="Liste _.csv"; filename*=UTF-8''Liste%20%C3%A4.csv`);
    expect(seen.headers['content-security-policy']).toContain('sandbox');
  });

  it('are too large above 25 MB, and are removed when no entry points to them any more', async () => {
    expect((await put(anna, randomUUID(), Buffer.alloc(25 * 1024 * 1024 + 1), 'application/octet-stream', 'big.bin')).statusCode).toBe(413);
    const id = randomUUID();
    expect((await put(anna, id, Buffer.from('{"a":1}'), 'application/json', 'alt.json')).statusCode).toBe(201);
    expect(await t.files.prune()).toBe(0);
    await t.db.execute(sql`update files set created_at = now() - interval '8 days'`);
    // Only the one without an entry goes.
    expect(await t.files.prune()).toBe(2);
    expect((await get(anna, `/api/v1/files/${id}`)).statusCode).toBe(404);
  });

  it('go to task apps as ATTACH, fetched with the API token', async () => {
    const token = (
      await t.app.inject({ method: 'POST', url: '/api/v1/tokens', headers: { cookie: anna }, payload: { name: 'Erinnerungen', scopes: ['read'] } })
    ).json().token as string;
    const basic = `Basic ${Buffer.from(`x:${token}`).toString('base64')}`;
    const list = (await t.app.inject({ method: 'POST', url: '/api/v1/lists', headers: { cookie: anna }, payload: { name: 'Aufgaben', type: 'todo' } })).json();
    const fileId = randomUUID();
    await put(anna, fileId, Buffer.from('%PDF-1.4'), 'application/pdf', 'Angebot "Bad".pdf');
    const item = randomUUID();
    const att = { id: 'f2', type: 'file', at: new Date().toISOString(), fileId, name: 'Angebot "Bad".pdf', mime: 'application/pdf', size: 8 };
    await t.app.inject({
      method: 'POST',
      url: '/api/v1/sync/push',
      headers: { cookie: anna },
      payload: {
        mutations: [
          { mid: randomUUID(), entity: 'item', id: item, hlc: hlc(10), patch: { listId: list.id, name: 'Bad fliesen', position: 'a0' } },
          { mid: randomUUID(), entity: 'item', id: item, hlc: hlc(11), patch: { attachments: { f2: att } } },
        ],
      },
    });
    const ics = await t.app.inject({ method: 'GET', url: `/dav/lists/${list.id}/${item}.ics`, headers: { authorization: basic } });
    const unfolded = ics.body.replace(/\r\n /g, '');
    expect(unfolded).toContain(`ATTACH;FMTTYPE=application/pdf;FILENAME="Angebot Bad.pdf":http://localhost:3000/api/v1/files/${fileId}`);
    const got = await t.app.inject({ method: 'GET', url: `/api/v1/files/${fileId}`, headers: { authorization: basic } });
    expect(got.statusCode).toBe(200);
    expect(got.headers['content-disposition']).toContain('inline');
    const wrong = await t.app.inject({
      method: 'GET',
      url: `/api/v1/files/${fileId}`,
      headers: { authorization: `Basic ${Buffer.from('x:falsch').toString('base64')}` },
    });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.headers['www-authenticate']).toContain('Basic');
  });
});
