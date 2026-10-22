import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.js';
import type { SyncHub } from '../sync/hub.js';
import type { SyncService } from '../sync/service.js';
import { toApiItem, toApiList } from './format.js';
import { buildOpenApi, type RouteDoc } from './openapi.js';
import type { ShoppingApi } from './service.js';

const ItemObject = z.object({
  name: z.string().trim().min(1).max(120).describe('Artikelname, z. B. „Milch“'),
  quantity: z.number().positive().nullable().optional().describe('Menge, z. B. 2'),
  unit: z.string().max(32).nullable().optional().describe('Einheit, z. B. „l“, „kg“, „Stk“, „Dose“'),
  properties: z.array(z.string().max(40)).max(20).optional().describe('Eigenschaften, z. B. ["bio", "laktosefrei"]'),
  note: z.string().max(500).nullable().optional(),
  category: z.string().max(40).nullable().optional().describe('Kategorie-ID oder -Name, z. B. „Milch & Käse“'),
});
const ItemInput = z.union([z.string().trim().min(1).max(300).describe('Freitext, z. B. „2 kg Kartoffeln festkochend“'), ItemObject]);

const ListRef = z.object({ id: z.string().min(1).max(100).describe('Listen-ID, Name oder „default“ für die Hauptliste') });
const ItemRef = z.object({ id: z.string().min(1).max(120).describe('Artikel-ID') });

const AddItemsBody = z
  .object({
    text: z.string().max(2000).optional().describe('Ein oder mehrere Artikel als Text, z. B. „Milch, 6 Eier, 500g Hack bio“'),
    items: z.array(ItemInput).max(200).optional(),
  })
  .refine((b) => b.text || b.items?.length, 'text oder items angeben');

const ItemPatchBody = ItemObject.partial().extend({ checked: z.boolean().optional() });

const ImportBody = z.union([
  z.object({
    recipe: z.string().min(1).describe('Mealie-Rezept (Slug)'),
    servings: z.number().positive().max(100).optional(),
    includePantry: z.boolean().default(false).describe('Auch Vorräte wie Salz/Öl übernehmen'),
  }),
  z.object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    includePantry: z.boolean().default(false),
  }),
]);

interface Options {
  config: Config;
  api: ShoppingApi;
  sync: SyncService;
  hub: SyncHub;
  requireUser: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/**
 * The REST API for Home Assistant, n8n and scripts (Bearer token) – and
 * anything else that is not the app's own sync protocol.
 */
export async function apiRoutes(app: FastifyInstance, opts: Options): Promise<void> {
  const { config, api, sync, hub, requireUser } = opts;
  const docs: RouteDoc[] = [];

  /** Registers a route and documents it in the OpenAPI description. */
  function route<P extends z.ZodTypeAny, Q extends z.ZodTypeAny, B extends z.ZodTypeAny>(
    method: Method,
    url: string,
    doc: { summary: string; tag: string; params?: P; query?: Q; body?: B; description?: string },
    handler: (ctx: { userId: string; params: z.infer<P>; query: z.infer<Q>; body: z.infer<B>; request: FastifyRequest }) => Promise<unknown>,
  ) {
    docs.push({ method, url, ...doc });
    app.route({
      method,
      url,
      preHandler: requireUser,
      handler: async (request) =>
        handler({
          userId: request.userId,
          params: (doc.params ? doc.params.parse(request.params) : {}) as z.infer<P>,
          query: (doc.query ? doc.query.parse(request.query) : {}) as z.infer<Q>,
          body: (doc.body ? doc.body.parse(request.body ?? {}) : {}) as z.infer<B>,
          request,
        }),
    });
  }

  // ---- lists ---------------------------------------------------------------

  route(
    'GET',
    '/api/v1/lists',
    {
      summary: 'Alle Listen',
      tag: 'Listen',
      query: z.object({ templates: z.enum(['exclude', 'include', 'only']).default('exclude') }),
    },
    ({ userId, query }) => api.lists(userId, query.templates),
  );

  route(
    'POST',
    '/api/v1/lists',
    {
      summary: 'Liste anlegen (optional aus einer Vorlage)',
      tag: 'Listen',
      body: z.object({ name: z.string().trim().min(1).max(80), template: z.string().optional(), isTemplate: z.boolean().optional() }),
    },
    ({ userId, body }) => api.createList(userId, body.name, { template: body.template, isTemplate: body.isTemplate }),
  );

  route(
    'GET',
    '/api/v1/lists/:id',
    {
      summary: 'Liste mit Artikeln',
      tag: 'Listen',
      params: ListRef,
      query: z.object({ items: z.enum(['open', 'done', 'all']).default('open') }),
    },
    ({ userId, params, query }) => api.list(userId, params.id, query.items),
  );

  route(
    'PATCH',
    '/api/v1/lists/:id',
    { summary: 'Liste umbenennen', tag: 'Listen', params: ListRef, body: z.object({ name: z.string().trim().min(1).max(80) }) },
    async ({ userId, params, body }) => {
      await api.renameList(userId, params.id, body.name);
      return api.list(userId, params.id);
    },
  );

  route('DELETE', '/api/v1/lists/:id', { summary: 'Liste löschen (nur Besitzer)', tag: 'Listen', params: ListRef }, async ({ userId, params }) => {
    await api.deleteList(userId, params.id);
    return { ok: true };
  });

  route(
    'GET',
    '/api/v1/lists/:id/items',
    { summary: 'Artikel einer Liste', tag: 'Artikel', params: ListRef, query: z.object({ items: z.enum(['open', 'done', 'all']).default('open') }) },
    async ({ userId, params, query }) => (await api.list(userId, params.id, query.items)).items,
  );

  route(
    'POST',
    '/api/v1/lists/:id/items',
    {
      summary: 'Artikel hinzufügen',
      description: 'Vorhandene offene Artikel bekommen die Menge dazu, zuletzt gekaufte kommen zurück, alles andere wird neu angelegt.',
      tag: 'Artikel',
      params: ListRef,
      body: AddItemsBody,
    },
    ({ userId, params, body }) => api.addItems(userId, params.id, [...(body.text ? [body.text] : []), ...(body.items ?? [])]),
  );

  route('POST', '/api/v1/lists/:id/clear-checked', { summary: '„Zuletzt verwendet“ leeren', tag: 'Artikel', params: ListRef }, async ({ userId, params }) => ({
    removed: await api.clearChecked(userId, params.id),
  }));

  route(
    'POST',
    '/api/v1/lists/:id/apply-template',
    {
      summary: 'Vorlage in die Liste übernehmen',
      tag: 'Vorlagen',
      params: ListRef,
      body: z.object({ template: z.string().min(1).describe('Vorlagen-ID oder -Name'), includeOptional: z.boolean().default(false) }),
    },
    ({ userId, params, body }) => api.applyTemplate(userId, params.id, body.template, body.includeOptional),
  );

  route(
    'POST',
    '/api/v1/lists/:id/import/mealie',
    { summary: 'Rezept oder Wochenplan aus Mealie übernehmen', tag: 'Mealie', params: ListRef, body: ImportBody },
    ({ userId, params, body }) =>
      'recipe' in body
        ? api.importRecipe(userId, params.id, body.recipe, body.servings, body.includePantry)
        : api.importMealplan(userId, params.id, body.from, body.to, body.includePantry),
  );

  // ---- items ---------------------------------------------------------------

  route('GET', '/api/v1/items/:id', { summary: 'Einzelner Artikel', tag: 'Artikel', params: ItemRef }, ({ userId, params }) => api.item(userId, params.id));

  route(
    'PATCH',
    '/api/v1/items/:id',
    { summary: 'Artikel ändern (Menge, Einheit, Eigenschaften, Notiz, Kategorie, abgehakt)', tag: 'Artikel', params: ItemRef, body: ItemPatchBody },
    ({ userId, params, body }) => api.updateItem(userId, params.id, body),
  );

  route('POST', '/api/v1/items/:id/check', { summary: 'Abhaken (gekauft)', tag: 'Artikel', params: ItemRef }, async ({ userId, params }) =>
    (await api.setChecked(userId, [params.id], true))[0],
  );

  route('POST', '/api/v1/items/:id/uncheck', { summary: 'Wieder auf die Liste', tag: 'Artikel', params: ItemRef }, async ({ userId, params }) =>
    (await api.setChecked(userId, [params.id], false))[0],
  );

  route('DELETE', '/api/v1/items/:id', { summary: 'Artikel entfernen', tag: 'Artikel', params: ItemRef }, async ({ userId, params }) => ({
    removed: await api.removeItems(userId, [params.id]),
  }));

  // ---- helpers -------------------------------------------------------------

  route(
    'GET',
    '/api/v1/catalog/search',
    { summary: 'Lebensmittel im Katalog suchen', tag: 'Katalog', query: z.object({ q: z.string().min(1).max(100) }) },
    ({ query }) => api.searchCatalog(query.q),
  );

  route(
    'POST',
    '/api/v1/parse',
    { summary: 'Text in Artikel zerlegen (ohne zu speichern)', tag: 'Katalog', body: z.object({ text: z.string().min(1).max(2000) }) },
    ({ body }) => api.parse(body.text),
  );

  route(
    'GET',
    '/api/v1/history',
    {
      summary: 'Zuletzt gekaufte Artikel',
      tag: 'Artikel',
      query: z.object({ list: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).default(30) }),
    },
    ({ userId, query }) => api.history(userId, query.list, query.limit),
  );

  // ---- real-time events (Server-Sent Events) ----------------------------------

  docs.push({
    method: 'GET',
    url: '/api/v1/events',
    summary: 'Änderungen in Echtzeit (Server-Sent Events)',
    description:
      'Liefert `list.changed`, `list.removed`, `item.changed` und `item.removed`, jeweils mit dem Objekt als JSON. Kommentarzeilen alle 25 s halten die Verbindung offen.',
    tag: 'Echtzeit',
    stream: true,
  });
  app.get('/api/v1/events', { preHandler: requireUser }, async (request, reply) => {
    const userId = request.userId;
    const since = (await sync.pull(userId, 0)).seq;
    const main = async () => (await api.lists(userId, 'include')).find((l) => l.isMain)?.id ?? null;
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const write = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    write('ready', { seq: since });
    const detach = hub.attachStream(userId, since, {
      isOpen: () => !res.destroyed,
      ping: () => res.write(': ping\n\n'),
      close: () => res.end(),
      send: (msg) => {
        if (msg.t !== 'changes') return;
        void (async () => {
          const names = new Map(msg.users.map((u) => [u.id, u.displayName]));
          const mainId = await main();
          for (const l of msg.lists) write('list.changed', toApiList(l, userId, mainId, -1));
          for (const id of msg.removedLists) write('list.removed', { id });
          for (const i of msg.items) {
            if (i.deleted) write('item.removed', { id: i.id, listId: i.listId });
            else write('item.changed', toApiItem(i, names));
          }
        })();
      },
    });
    request.raw.on('close', detach);
  });

  // ---- description ---------------------------------------------------------------

  app.get('/api/v1/openapi.json', async () => buildOpenApi(docs, config.PUBLIC_URL));
  app.get('/api/docs', async (_request, reply) =>
    reply.type('text/html').send(`<!doctype html>
<html lang="de"><head><meta charset="utf-8"><title>Shopping API</title><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body><script id="api-reference" data-url="/api/v1/openapi.json"></script>
<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.25.0"></script></body></html>`),
  );
}
