import { itemToIcal, lastModified, parseIcalTodo, type ItemRow, type ListRow } from '@shopping/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { actorContext } from '../api/service.js';
import { credentialPrincipal, type Principal } from '../auth/principal.js';
import type { Config } from '../config.js';
import type { Db } from '../db/index.js';
import { users } from '../db/schema.js';
import { TaskService } from '../tasks/service.js';
import { escapeXml, hrefs, key, multistatus, NS, requestedProps, rootElement, setDisplayName, syncToken, type PropName, type ResponseEntry } from './xml.js';

/**
 * CalDAV: every list as a task list (VTODO), for Apple Erinnerungen, Thunderbird, DAVx⁵ + Tasks.org/jtx …
 * Log-in: any user name, an API token as password. Address: <server>/dav/ (or just the server – /.well-known/caldav).
 */

const BASE = '/dav';
const PRINCIPAL = `${BASE}/principal/`;
const HOME = `${BASE}/lists/`;
const listHref = (l: Pick<ListRow, 'id'>) => `${HOME}${l.id}/`;
const itemHref = (l: Pick<ListRow, 'id'>, i: ItemRow) => `${listHref(l)}${encodeURIComponent(TaskService.fileName(i))}`;
const etag = (i: Pick<ItemRow, 'seq'>) => `"${i.seq}"`;

const METHODS = ['OPTIONS', 'GET', 'PUT', 'DELETE', 'PROPFIND', 'PROPPATCH', 'REPORT', 'MKCALENDAR'] as const;
const READ = new Set(['OPTIONS', 'GET', 'HEAD', 'PROPFIND', 'REPORT']);

const p = (ns: string, name: string): PropName => ({ ns, name });
const P = {
  resourcetype: p(NS.dav, 'resourcetype'),
  displayname: p(NS.dav, 'displayname'),
  currentUserPrincipal: p(NS.dav, 'current-user-principal'),
  principalUrl: p(NS.dav, 'principal-URL'),
  principalCollectionSet: p(NS.dav, 'principal-collection-set'),
  owner: p(NS.dav, 'owner'),
  getetag: p(NS.dav, 'getetag'),
  getcontenttype: p(NS.dav, 'getcontenttype'),
  getlastmodified: p(NS.dav, 'getlastmodified'),
  syncToken: p(NS.dav, 'sync-token'),
  supportedReportSet: p(NS.dav, 'supported-report-set'),
  privileges: p(NS.dav, 'current-user-privilege-set'),
  calendarHomeSet: p(NS.cal, 'calendar-home-set'),
  components: p(NS.cal, 'supported-calendar-component-set'),
  calendarDescription: p(NS.cal, 'calendar-description'),
  calendarData: p(NS.cal, 'calendar-data'),
  ctag: p(NS.cs, 'getctag'),
  color: p(NS.ical, 'calendar-color'),
  order: p(NS.ical, 'calendar-order'),
};

type Resource =
  { kind: 'root' | 'principal' | 'home' } | { kind: 'list'; list: ListRow; state: number; position: number } | { kind: 'item'; list: ListRow; item: ItemRow };

const LIST_COLORS: Record<ListRow['listType'], string> = { shopping: '#2F7D4FFF', packing: '#2C6EB5FF', memo: '#C7841AFF', todo: '#8A4FBFFF' };

export async function davRoutes(app: FastifyInstance, opts: { config: Config; db: Db; tasks: TaskService }) {
  const { config, db, tasks } = opts;
  const tokenUrl = (n: number) => `${config.PUBLIC_URL}${BASE}/sync/${n}`;

  for (const m of ['PROPFIND', 'PROPPATCH', 'REPORT', 'MKCALENDAR']) {
    if (!app.supportedMethods.includes(m)) app.addHttpMethod(m, { hasBody: true });
  }

  // Calendar apps look here first.

  await app.register(async (dav) => {
    // XML and iCalendar bodies arrive as text.
    dav.addContentTypeParser('*', { parseAs: 'string' }, (_req, body, done) => done(null, body));

    const auth = async (request: FastifyRequest, reply: FastifyReply): Promise<Principal | null> => {
      const principal = await credentialPrincipal(db, request.headers.authorization);
      if (!principal) {
        reply.code(401).header('WWW-Authenticate', 'Basic realm="Shopping", charset="UTF-8"').send('Bitte mit einem API-Token als Passwort anmelden');
        return null;
      }
      const needs = READ.has(request.method) ? 'read' : 'write';
      if (!principal.scopes.has(needs)) {
        reply.code(403).send(`Dem Token fehlt die Berechtigung „${needs}“`);
        return null;
      }
      return principal;
    };

    const handler = async (request: FastifyRequest, reply: FastifyReply) => {
      reply.header('DAV', '1, 3, calendar-access');
      if (request.method === 'OPTIONS') {
        return reply
          .code(200)
          .header('Allow', [...METHODS].join(', '))
          .send();
      }
      const principal = await auth(request, reply);
      if (!principal) return reply;
      const path = decodeURIComponent(request.url.split('?')[0]!);
      // The bare server address and /.well-known/caldav answer like /dav/ (apps start there).
      const parts = path === BASE || path.startsWith(`${BASE}/`) ? path.slice(BASE.length).split('/').filter(Boolean) : [];
      const body = typeof request.body === 'string' ? request.body : '';
      return actorContext.run({ via: principal.tokenName ?? 'Kalender-App' }, () => dispatch(request, reply, principal.userId, parts, body));
    };
    dav.route({ method: [...METHODS], url: BASE, handler });
    // Calendar apps look here first: PROPFIND is answered right here (no need to follow a redirect),
    // anything else is sent on to /dav/.
    dav.route({
      method: [...METHODS],
      url: '/.well-known/caldav',
      handler: (request, reply) => (['PROPFIND', 'OPTIONS'].includes(request.method) ? handler(request, reply) : reply.redirect(`${BASE}/`, 301)),
    });
    // Some apps ask the bare server address first (GET stays the app itself).
    dav.route({ method: ['PROPFIND'], url: '/', handler });
    dav.route({ method: [...METHODS], url: `${BASE}/*`, handler });
  });

  async function dispatch(request: FastifyRequest, reply: FastifyReply, userId: string, parts: string[], body: string) {
    const [area, listId, file] = parts;
    const notFound = () => reply.code(404).send('Nicht gefunden');

    // /dav/, /dav/principal/, /dav/lists/
    if (!area || area === 'principal' || (area === 'lists' && !listId)) {
      const kind = !area ? 'root' : area === 'principal' ? 'principal' : 'home';
      if (request.method === 'PROPFIND') return propfind(request, reply, userId, { kind }, body);
      if (request.method === 'GET')
        return reply.type('text/plain; charset=utf-8').send('Shopping – CalDAV. Adresse in der Kalender-App: diese Seite, Passwort: ein API-Token.');
      if (request.method === 'MKCALENDAR') return reply.code(403).send('Neue Listen bitte in der App anlegen');
      return reply.code(405).send();
    }
    if (area !== 'lists') return notFound();

    const lists = await tasks.lists(userId);
    const position = lists.findIndex((l) => l.id === listId);
    const list = lists[position];
    if (!list) return request.method === 'MKCALENDAR' ? reply.code(403).send('Neue Listen bitte in der App anlegen') : notFound();

    if (!file) {
      switch (request.method) {
        case 'PROPFIND':
          return propfind(request, reply, userId, { kind: 'list', list, state: await tasks.state([list.id]), position }, body);
        case 'REPORT':
          return report(reply, list, body);
        case 'PROPPATCH': {
          const name = setDisplayName(body);
          if (name) await tasks.rename(userId, list, name);
          // Colours and order stay as they are; answered as accepted so apps do not complain.
          return reply
            .code(207)
            .type('application/xml; charset=utf-8')
            .send(
              multistatus([
                {
                  href: listHref(list),
                  found: [
                    [P.displayname, ''],
                    [P.color, ''],
                    [P.order, ''],
                  ],
                },
              ]),
            );
        }
        case 'GET':
          return reply.type('text/plain; charset=utf-8').send(list.name);
        case 'DELETE':
          return reply.code(403).send('Listen bitte in der App löschen');
        default:
          return reply.code(405).send();
      }
    }

    const item = await tasks.byFileName(list.id, file);
    const current = item ? etag(item) : null;
    switch (request.method) {
      case 'GET': {
        if (!item) return notFound();
        return reply
          .type('text/calendar; charset=utf-8')
          .header('ETag', current)
          .header('Last-Modified', lastModified(item).toUTCString())
          .send(itemToIcal(item, list));
      }
      case 'PROPFIND':
        if (!item) return notFound();
        return propfind(request, reply, userId, { kind: 'item', list, item }, body);
      case 'PUT': {
        const ifMatch = request.headers['if-match'];
        if (ifMatch && ifMatch !== '*' && ifMatch !== current) return reply.code(412).send('Inzwischen geändert');
        if (ifMatch && !item) return reply.code(412).send('Gibt es nicht mehr');
        if (request.headers['if-none-match'] === '*' && item) return reply.code(412).send('Gibt es schon');
        const task = parseIcalTodo(body);
        if (!task) return reply.code(403).type('application/xml').send(precondition(NS.cal, 'supported-component'));
        let id = item?.id;
        if (item) await tasks.update(userId, list, item, task);
        else id = await tasks.create(userId, list, task, { fileName: file });
        const after = await tasks.byId(id!);
        if (after) reply.header('ETag', etag(after));
        return reply.code(item ? 204 : 201).send();
      }
      case 'DELETE': {
        if (!item) return notFound();
        const ifMatch = request.headers['if-match'];
        if (ifMatch && ifMatch !== '*' && ifMatch !== current) return reply.code(412).send('Inzwischen geändert');
        await tasks.remove(userId, item);
        return reply.code(204).send();
      }
      default:
        return reply.code(405).send();
    }
  }

  function precondition(ns: string, name: string): string {
    return `<?xml version="1.0" encoding="utf-8"?>\n<d:error xmlns:d="DAV:" xmlns:c="${NS.cal}"><${ns === NS.cal ? 'c' : 'd'}:${name}/></d:error>`;
  }

  // ---- properties -----------------------------------------------------------

  async function displayName(userId: string): Promise<string> {
    const [u] = await db.select({ name: users.displayName }).from(users).where(eq(users.id, userId));
    return u?.name ?? 'Shopping';
  }

  function hrefOf(r: Resource): string {
    if (r.kind === 'root') return `${BASE}/`;
    if (r.kind === 'principal') return PRINCIPAL;
    if (r.kind === 'home') return HOME;
    if (r.kind === 'list') return listHref(r.list);
    if (r.kind === 'item') return itemHref(r.list, r.item);
    return HOME;
  }

  /** A property's value for a resource (inner XML), or undefined: not there. */
  function value(r: Resource, prop: PropName, userName: string, withData: boolean): string | undefined {
    const href = (h: string) => `<d:href>${escapeXml(h)}</d:href>`;
    switch (key(prop)) {
      case key(P.currentUserPrincipal):
      case key(P.principalUrl):
      case key(P.owner):
        return href(PRINCIPAL);
      case key(P.principalCollectionSet):
        return href(PRINCIPAL);
      case key(P.calendarHomeSet):
        return r.kind === 'item' ? undefined : href(HOME);
      case key(P.resourcetype):
        if (r.kind === 'item') return '';
        if (r.kind === 'principal') return '<d:collection/><d:principal/>';
        if (r.kind === 'list') return '<d:collection/><c:calendar/>';
        return '<d:collection/>';
      case key(P.displayname):
        if (r.kind === 'list') return escapeXml(r.list.name);
        if (r.kind === 'principal') return escapeXml(userName);
        if (r.kind === 'home') return 'Listen';
        return r.kind === 'item' ? escapeXml(r.item.name) : 'Shopping';
      case key(P.privileges):
        return '<d:privilege><d:read/></d:privilege><d:privilege><d:write/></d:privilege><d:privilege><d:write-content/></d:privilege><d:privilege><d:bind/></d:privilege><d:privilege><d:unbind/></d:privilege>';
    }
    if (r.kind === 'list') {
      switch (key(prop)) {
        case key(P.components):
          return '<c:comp name="VTODO"/>';
        case key(P.calendarDescription):
          return typeof r.list.settings.description === 'string' ? escapeXml(r.list.settings.description) : undefined;
        case key(P.ctag):
          return String(r.state);
        case key(P.syncToken):
          return escapeXml(tokenUrl(r.state));
        case key(P.supportedReportSet):
          return ['calendar-multiget', 'calendar-query']
            .map((n) => `<d:supported-report><d:report><c:${n}/></d:report></d:supported-report>`)
            .concat('<d:supported-report><d:report><d:sync-collection/></d:report></d:supported-report>')
            .join('');
        case key(P.color):
          return r.list.color ? `${r.list.color.toUpperCase()}FF`.slice(0, 9) : LIST_COLORS[r.list.listType];
        case key(P.order):
          return String(r.position + 1);
        case key(P.getcontenttype):
          return 'text/calendar; charset=utf-8; component=vtodo';
      }
    }
    if (r.kind === 'item') {
      switch (key(prop)) {
        case key(P.getetag):
          return escapeXml(etag(r.item));
        case key(P.getcontenttype):
          return 'text/calendar; charset=utf-8; component=vtodo';
        case key(P.getlastmodified):
          return lastModified(r.item).toUTCString();
        case key(P.calendarData):
          return withData ? escapeXml(itemToIcal(r.item, r.list)) : undefined;
      }
    }
    return undefined;
  }

  const ALLPROP = [P.resourcetype, P.displayname, P.getetag, P.getcontenttype, P.getlastmodified, P.ctag, P.syncToken];

  function entry(r: Resource, props: PropName[], userName: string, withData = false): ResponseEntry {
    const found: [PropName, string][] = [];
    const missing: PropName[] = [];
    for (const prop of props) {
      const v = value(r, prop, userName, withData);
      if (v === undefined) missing.push(prop);
      else found.push([prop, v]);
    }
    return { href: hrefOf(r), found, missing };
  }

  async function propfind(request: FastifyRequest, reply: FastifyReply, userId: string, r: Resource, body: string) {
    const asked = requestedProps(body);
    const props = asked.all ? ALLPROP : asked.props;
    const depth = String(request.headers.depth ?? 'infinity');
    const userName = await displayName(userId);
    const resources: Resource[] = [r];
    if (depth !== '0') {
      if (r.kind === 'root') resources.push({ kind: 'principal' }, { kind: 'home' });
      if (r.kind === 'home') {
        const lists = await tasks.lists(userId);
        for (const [position, list] of lists.entries()) resources.push({ kind: 'list', list, state: await tasks.state([list.id]), position });
      }
      if (r.kind === 'list') for (const item of await tasks.items([r.list.id])) resources.push({ kind: 'item', list: r.list, item });
    }
    const entries = resources.map((res) => {
      const e = entry(res, props, userName);
      // allprop: only what exists, no 404 list.
      return asked.all ? { ...e, missing: [] } : e;
    });
    return reply.code(207).type('application/xml; charset=utf-8').send(multistatus(entries));
  }

  async function report(reply: FastifyReply, list: ListRow, body: string) {
    const root = rootElement(body);
    const asked = requestedProps(body);
    const props = asked.all ? [P.getetag, P.calendarData] : asked.props;
    const send = (entries: ResponseEntry[], extra = '') => reply.code(207).type('application/xml; charset=utf-8').send(multistatus(entries, extra));

    if (root?.name === 'calendar-multiget') {
      const entries: ResponseEntry[] = [];
      for (const href of hrefs(body)) {
        const name = href.split('/').filter(Boolean).at(-1) ?? '';
        const item = href.startsWith(listHref(list)) || !href.startsWith('/') ? await tasks.byFileName(list.id, decodeURIComponent(name)) : null;
        entries.push(item ? entry({ kind: 'item', list, item }, props, '', true) : { href, status: 404 });
      }
      return send(entries);
    }
    if (root?.name === 'sync-collection') {
      const since = Number(/(\d+)$/.exec(syncToken(body))?.[1] ?? NaN);
      const state = await tasks.state([list.id]);
      const changed = Number.isFinite(since) ? await tasks.items([list.id], since) : await tasks.items([list.id]);
      const entries = changed.map((item) =>
        item.deleted ? { href: itemHref(list, item), status: 404 } : entry({ kind: 'item', list, item }, props, '', true),
      );
      return send(entries, `<d:sync-token>${escapeXml(tokenUrl(state))}</d:sync-token>`);
    }
    // calendar-query (filters are not evaluated: all tasks of the list).
    const items = await tasks.items([list.id]);
    return send(items.map((item) => entry({ kind: 'item', list, item }, props, '', true)));
  }
}
