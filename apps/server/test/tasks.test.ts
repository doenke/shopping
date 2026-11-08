import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './helpers.js';

let t: Awaited<ReturnType<typeof createTestApp>>;
let cookie: string;
let token: string;
let readOnly: string;
let listId: string;

const basic = (tok: string) => `Basic ${Buffer.from(`egal:${tok}`).toString('base64')}`;
const dav = (method: string, url: string, body?: string, headers: Record<string, string> = {}, tok = token) =>
  t.app.inject({
    method: method as 'GET',
    url,
    headers: { authorization: basic(tok), ...(body ? { 'content-type': url.endsWith('.ics') ? 'text/calendar' : 'application/xml' } : {}), ...headers },
    ...(body ? { payload: body } : {}),
  });
const jmap = (methodCalls: unknown[], tok = token) =>
  t.app.inject({
    method: 'POST',
    url: '/jmap/api',
    headers: { authorization: `Bearer ${tok}` },
    payload: { using: ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:tasks'], methodCalls },
  });

beforeAll(async () => {
  t = await createTestApp();
  ({ cookie } = await t.login('Anna'));
  const mk = async (scopes: string[]) =>
    (await t.app.inject({ method: 'POST', url: '/api/v1/tokens', headers: { cookie }, payload: { name: 'Erinnerungen', scopes } })).json().token as string;
  token = await mk(['read', 'write']);
  readOnly = await mk(['read']);
  listId = (await t.app.inject({ method: 'POST', url: '/api/v1/lists', headers: { cookie }, payload: { name: 'Aufgaben', type: 'todo' } })).json().id;
  await t.app.inject({ method: 'POST', url: `/api/v1/lists/${listId}/items`, headers: { cookie }, payload: { text: 'Reifen wechseln !2026-11-20' } });
  await t.app.inject({ method: 'POST', url: `/api/v1/lists/${listId}/items`, headers: { cookie }, payload: { text: 'Steuer machen' } });
});
afterAll(async () => t?.close());

const items = async () =>
  (await t.app.inject({ method: 'GET', url: `/api/v1/lists/${listId}?items=all`, headers: { cookie } })).json().items as {
    id: string;
    name: string;
    checked: boolean;
    note: string | null;
    due: string | null;
    url: string | null;
    addedVia: string | null;
  }[];

describe('CalDAV', () => {
  it('is found from the server address and asks for a token', async () => {
    // Exactly what DAVx⁵ sends first: the bare address and /.well-known/caldav, with an XML body.
    const davx5 =
      '<?xml version=\'1.0\' encoding=\'UTF-8\' ?><propfind xmlns="DAV:" xmlns:CAL="urn:ietf:params:xml:ns:caldav" xmlns:CARD="urn:ietf:params:xml:ns:carddav"><prop><current-user-principal /></prop></propfind>';
    for (const url of ['/', '/.well-known/caldav']) {
      const res = await t.app.inject({
        method: 'PROPFIND',
        url,
        headers: { authorization: basic(token), 'content-type': 'application/xml; charset=UTF-8', depth: '0' },
        payload: davx5,
      });
      expect(res.statusCode).toBe(207);
      expect(res.body).toContain('<d:current-user-principal><d:href>/dav/principal/</d:href>');
    }
    expect((await t.app.inject({ method: 'GET', url: '/.well-known/caldav', headers: { authorization: basic(token) } })).headers.location).toBe('/dav/');
    const anon = await t.app.inject({ method: 'PROPFIND', url: '/dav/' });
    expect(anon.statusCode).toBe(401);
    expect(anon.headers['www-authenticate']).toContain('Basic');

    const root = await dav('PROPFIND', '/dav/', '<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>', { depth: '0' });
    expect(root.statusCode).toBe(207);
    expect(root.body).toContain('<d:current-user-principal><d:href>/dav/principal/</d:href>');
    const principal = await dav(
      'PROPFIND',
      '/dav/principal/',
      '<propfind xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><prop><C:calendar-home-set/><displayname/></prop></propfind>',
      { depth: '0' },
    );
    expect(principal.body).toContain('<c:calendar-home-set><d:href>/dav/lists/</d:href>');
    expect(principal.body).toContain('<d:displayname>Anna</d:displayname>');
  });

  it('lists the lists as task calendars with their entries', async () => {
    const home = await dav(
      'PROPFIND',
      '/dav/lists/',
      '<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/"><d:prop><d:resourcetype/><d:displayname/><c:supported-calendar-component-set/><cs:getctag/><d:foo/></d:prop></d:propfind>',
      { depth: '1' },
    );
    expect(home.body).toContain(`<d:href>/dav/lists/${listId}/</d:href>`);
    expect(home.body).toContain('<d:displayname>Aufgaben</d:displayname>');
    expect(home.body).toContain('<c:comp name="VTODO"/>');
    expect(home.body).toMatch(/<d:propstat><d:prop><d:foo\/><\/d:prop><d:status>HTTP\/1.1 404 Not Found/);

    const query = await dav(
      'REPORT',
      `/dav/lists/${listId}/`,
      '<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VTODO"/></c:comp-filter></c:filter></c:calendar-query>',
      { depth: '1' },
    );
    expect(query.body).toContain('SUMMARY:Reifen wechseln');
    expect(query.body).toContain('DUE;VALUE=DATE:20261120');
  });

  it('takes over changes, new entries and deletions from a task app', async () => {
    const reifen = (await items()).find((i) => i.name === 'Reifen wechseln')!;
    const get = await dav('GET', `/dav/lists/${listId}/${reifen.id}.ics`);
    expect(get.headers['content-type']).toContain('text/calendar');
    const done = get.body.replace('STATUS:NEEDS-ACTION', 'STATUS:COMPLETED\r\nDESCRIPTION:Winterreifen');
    // A stale ETag is refused.
    expect((await dav('PUT', `/dav/lists/${listId}/${reifen.id}.ics`, done, { 'if-match': '"1"' })).statusCode).toBe(412);
    const put = await dav('PUT', `/dav/lists/${listId}/${reifen.id}.ics`, done, { 'if-match': String(get.headers.etag) });
    expect(put.statusCode).toBe(204);
    expect(put.headers.etag).not.toBe(get.headers.etag);
    expect((await items()).find((i) => i.id === reifen.id)).toMatchObject({ checked: true, note: 'Winterreifen' });

    // New from the app, under its own file name and UID.
    const ics =
      'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTODO\r\nUID:APPLE-1234\r\nSUMMARY:Fahrrad putzen\r\nURL:https://a.de/rad\r\nEND:VTODO\r\nEND:VCALENDAR\r\n';
    const created = await dav('PUT', `/dav/lists/${listId}/APPLE-1234.ics`, ics, { 'if-none-match': '*' });
    expect(created.statusCode).toBe(201);
    const rad = (await items()).find((i) => i.name === 'Fahrrad putzen')!;
    expect(rad).toMatchObject({ url: 'https://a.de/rad', addedVia: 'Erinnerungen' });
    const again = await dav('GET', `/dav/lists/${listId}/APPLE-1234.ics`);
    expect(again.body).toContain('UID:APPLE-1234');

    // Sync: only what changed since the token; deleted ones as 404.
    const sync = (token: string) =>
      dav(
        'REPORT',
        `/dav/lists/${listId}/`,
        `<d:sync-collection xmlns:d="DAV:"><d:sync-token>${token}</d:sync-token><d:sync-level>1</d:sync-level><d:prop><d:getetag/></d:prop></d:sync-collection>`,
      );
    const first = await sync('');
    const tokenNow = /<d:sync-token>([^<]+)<\/d:sync-token>/.exec(first.body)![1]!;
    expect((await dav('DELETE', `/dav/lists/${listId}/APPLE-1234.ics`)).statusCode).toBe(204);
    const delta = await sync(tokenNow);
    expect(delta.body).toContain(`/dav/lists/${listId}/APPLE-1234.ics</d:href><d:status>HTTP/1.1 404`);
    expect(delta.body).not.toContain('Steuer');

    // Read-only token: reading yes, writing no.
    expect((await dav('GET', `/dav/lists/${listId}/${reifen.id}.ics`, undefined, {}, readOnly)).statusCode).toBe(200);
    expect((await dav('DELETE', `/dav/lists/${listId}/${reifen.id}.ics`, undefined, {}, readOnly)).statusCode).toBe(403);
  });
});

describe('JMAP', () => {
  it('has a session and offers the lists as task lists', async () => {
    const session = await t.app.inject({ method: 'GET', url: '/.well-known/jmap', headers: { authorization: `Bearer ${token}` } });
    expect(session.json()).toMatchObject({ capabilities: { 'urn:ietf:params:jmap:tasks': {} }, apiUrl: expect.stringContaining('/jmap/api') });
    const res = (
      await jmap([
        ['TaskList/get', { ids: null }, 'a'],
        ['Task/query', { filter: { inTaskList: listId, completed: false } }, 'b'],
        ['Task/get', { '#ids': { resultOf: 'b', name: 'Task/query', path: '/ids' }, properties: ['title'] }, 'c'],
      ])
    ).json();
    const [lists, , got] = res.methodResponses;
    expect(lists[1].list.map((l: { name: string }) => l.name)).toContain('Aufgaben');
    expect(got[1].list.map((x: { title: string }) => x.title)).toEqual(['Steuer machen']);
  });

  it('creates, updates and removes tasks; changes since a state', async () => {
    const before = (await jmap([['Task/get', { ids: [] }, 'a']])).json().methodResponses[0][1].state;
    const set = (
      await jmap([
        [
          'Task/set',
          { create: { n1: { taskListId: listId, title: 'Keller aufräumen', due: '2026-12-01T00:00:00', links: { a: { href: 'https://a.de/k' } } } } },
          'a',
        ],
        ['Task/set', { update: { '#n1': { progress: 'completed' } } }, 'b'],
      ])
    ).json();
    const id = set.methodResponses[0][1].created.n1.id;
    expect(set.createdIds.n1).toBe(id);
    expect((await items()).find((i) => i.id === id)).toMatchObject({ name: 'Keller aufräumen', checked: true, due: '2026-12-01', url: 'https://a.de/k' });

    const changes = (await jmap([['Task/changes', { sinceState: before }, 'a']])).json().methodResponses[0][1];
    expect(changes.updated).toContain(id);
    const gone = (await jmap([['Task/set', { destroy: [id] }, 'a']])).json().methodResponses[0][1];
    expect(gone.destroyed).toEqual([id]);
    expect((await jmap([['Task/set', { destroy: [id] }, 'a']], readOnly)).json().methodResponses[0]).toEqual([
      'error',
      expect.objectContaining({ type: 'forbidden' }),
      'a',
    ]);
    expect((await jmap([['Mail/get', {}, 'x']])).json().methodResponses[0][1].type).toBe('unknownMethod');
  });
});
