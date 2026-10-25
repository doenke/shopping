import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ApiError } from '../api/errors.js';
import type { ApiItem } from '../api/format.js';
import { actorContext, type ShoppingApi } from '../api/service.js';
import type { Principal, Scope } from '../auth/principal.js';
import { MealieError } from '../mealie/client.js';

const listParam = z.string().optional().describe('Liste: Name, ID oder weglassen für die Hauptliste');

function itemLine(i: ApiItem, type = 'shopping'): string {
  const spec = i.specification ? ` – ${i.specification}` : '';
  const from = i.sources.length ? ` (für ${i.sources.join(', ')})` : '';
  const packing =
    type === 'memo'
      ? [i.tipFrom && `Tipp von ${i.tipFrom}`, i.where && `bei ${i.where}`, i.note].filter(Boolean).join(', ')
      : [i.person && `@${i.person}`, i.container && `#${i.container}`].filter(Boolean).join(' ');
  return `- ${i.checked ? '~~' : ''}${i.name}${spec}${i.checked ? '~~' : ''}${packing ? ` ${packing}` : ''}${from}`;
}

/** A list as Markdown, grouped by category – easy to read for models and people. */
function listMarkdown(list: { name: string; type: string; description: string | null; isMain: boolean; items: ApiItem[] }): string {
  const kind = list.type === 'packing' ? ' (Packliste, durchgestrichen = eingepackt)' : list.type === 'memo' ? ' (Merkliste, durchgestrichen = erledigt)' : '';
  const lines = [`# ${list.name}${list.isMain ? ' (Hauptliste)' : ''}${kind}`];
  if (list.description) lines.push('', `_${list.description}_`);
  if (list.items.length === 0) lines.push('', '_Nichts auf der Liste._');
  let cat = '';
  for (const i of list.items) {
    if (i.category.name !== cat) {
      cat = i.category.name;
      lines.push('', `## ${cat}`);
    }
    lines.push(itemLine(i, list.type));
  }
  return lines.join('\n');
}

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });

/** Builds an MCP server bound to one user (stateless: one per request). */
export function createMcpServer(api: ShoppingApi, principal: Principal): McpServer {
  const server = new McpServer(
    { name: 'shopping', title: 'Shopping – Einkaufslisten', version: '1.0.0' },
    {
      instructions:
        'Einkaufslisten und Packlisten des Haushalts. Ohne Angabe einer Liste ist immer die Hauptliste (Einkauf) gemeint. Artikel am besten als natürlichen Text übergeben („2 kg Kartoffeln festkochend“) – Menge, Einheit und Eigenschaften werden erkannt. Gleiche Artikel werden zusammengeführt statt doppelt angelegt. In Packlisten bedeutet abgehakt „eingepackt“; „@Anna“ im Text ordnet einer Person zu, „#Koffer“ einem Packstück. Neue Packlisten am besten aus einer Packvorlage anlegen. Merklisten (Typ memo) sammeln Filme, Bücher, Restaurants usw.: „@Anna“ heißt dort „Tipp von Anna“, „#Netflix“ heißt „gibt es bei Netflix“; abgehakt = erledigt (gesehen, gelesen, besucht).',
    },
  );
  const userId = principal.userId;

  /** Wraps a tool: checks the scope and turns API errors into readable tool errors. */
  const guard =
    <A>(scope: Scope, fn: (args: A) => Promise<ReturnType<typeof text>>) =>
    async (args: A) => {
      if (!principal.scopes.has(scope)) return { ...text(`Dafür fehlt die Berechtigung „${scope}“.`), isError: true };
      try {
        // New items remember the assistant ("hinzugefügt über Claude").
        return await actorContext.run({ via: principal.tokenName ?? (principal.via === 'token' ? 'KI-Assistent' : null) }, () => fn(args));
      } catch (err) {
        if (err instanceof ApiError || err instanceof MealieError) {
          const candidates = err instanceof ApiError && err.extra.candidates ? `\nKandidaten: ${JSON.stringify(err.extra.candidates)}` : '';
          return { ...text(`${err.message}${candidates}`), isError: true };
        }
        throw err;
      }
    };

  const added = (r: { added: { name: string; specification: string; action: string }[] }) =>
    r.added.length
      ? r.added
          .map((a) => `- ${a.name}${a.specification ? ` – ${a.specification}` : ''} (${a.action === 'created' ? 'neu' : a.action === 'merged' ? 'zusammengeführt' : 'wieder auf der Liste'})`)
          .join('\n')
      : 'Nichts hinzugefügt.';

  // ---- reading ---------------------------------------------------------------

  server.registerTool(
    'list_lists',
    {
      title: 'Listen anzeigen',
      description: 'Alle Einkaufs- und Packlisten (und optional Vorlagen, archivierte Packlisten) mit Anzahl offener Artikel.',
      inputSchema: {
        include_templates: z.boolean().default(false),
        type: z.enum(['shopping', 'packing', 'memo']).optional().describe('Nur Einkaufslisten (shopping), Packlisten (packing) oder Merklisten (memo)'),
        include_archived: z.boolean().default(false),
      },
      annotations: { readOnlyHint: true },
    },
    guard('read', async ({ include_templates, type, include_archived }: { include_templates: boolean; type?: 'shopping' | 'packing' | 'memo'; include_archived: boolean }) => {
      const lists = await api.lists(userId, include_templates ? 'include' : 'exclude', { type, archived: include_archived });
      return text(
        lists
          .map(
            (l) =>
              `- ${l.isTemplate ? '◇ ' : ''}${l.name}${l.type === 'packing' ? ' [Packliste]' : l.type === 'memo' ? ' [Merkliste]' : ''}${l.isMain ? ' ⭐ Hauptliste' : ''}${l.archived ? ' (archiviert)' : ''} – ${l.openItems} offen${l.description ? ` – ${l.description}` : ''} (id: ${l.id})`,
          )
          .join('\n') || 'Keine Listen.',
      );
    }),
  );

  server.registerTool(
    'get_list',
    {
      title: 'Liste lesen',
      description: 'Inhalt einer Liste, nach Kategorien sortiert. Erledigtes ist durchgestrichen.',
      inputSchema: { list: listParam, include_checked: z.boolean().default(false).describe('Auch zuletzt gekaufte Artikel zeigen') },
      annotations: { readOnlyHint: true },
    },
    guard('read', async ({ list, include_checked }: { list?: string; include_checked: boolean }) =>
      text(listMarkdown(await api.list(userId, list, include_checked ? 'all' : 'open'))),
    ),
  );

  server.registerTool(
    'search_catalog',
    {
      title: 'Lebensmittel suchen',
      description: 'Sucht im Lebensmittel-Katalog (mit Tippfehlertoleranz).',
      inputSchema: { query: z.string().min(1) },
      annotations: { readOnlyHint: true },
    },
    guard('read', async ({ query }: { query: string }) => {
      const hits = await api.searchCatalog(query, 10);
      return text(hits.map((h) => `- ${h.name} (${h.category})`).join('\n') || 'Nichts gefunden.');
    }),
  );

  server.registerTool(
    'get_history',
    {
      title: 'Zuletzt gekauft',
      description: 'Zuletzt gekaufte Artikel – hilfreich für „was kaufen wir normalerweise?“.',
      inputSchema: { list: listParam, limit: z.number().int().min(1).max(100).default(30) },
      annotations: { readOnlyHint: true },
    },
    guard('read', async ({ list, limit }: { list?: string; limit: number }) => {
      const items = await api.history(userId, list, limit);
      return text(items.map((i) => `- ${i.name}${i.checkedAt ? ` (${i.checkedAt.slice(0, 10)})` : ''}`).join('\n') || 'Noch nichts gekauft.');
    }),
  );

  // ---- writing -----------------------------------------------------------------

  server.registerTool(
    'add_items',
    {
      title: 'Artikel hinzufügen',
      description: 'Fügt Artikel hinzu. Jeder Eintrag ist natürlicher Text, z. B. „2 l Milch laktosefrei“ oder „500g Hack gemischt bio“.',
      inputSchema: { items: z.array(z.string().min(1)).min(1).max(100), list: listParam },
    },
    guard('write', async ({ items, list }: { items: string[]; list?: string }) => text(added(await api.addItems(userId, list, items)))),
  );

  server.registerTool(
    'update_item',
    {
      title: 'Artikel ändern',
      description: 'Ändert Menge, Einheit, Eigenschaften, Notiz oder Kategorie eines Artikels (per Name oder ID).',
      inputSchema: {
        item: z.string().describe('Artikelname oder ID'),
        list: listParam,
        name: z.string().optional(),
        quantity: z.number().positive().nullable().optional(),
        unit: z.string().nullable().optional(),
        properties: z.array(z.string()).optional(),
        note: z.string().nullable().optional(),
        category: z.string().optional().describe('z. B. „Milch & Käse“'),
        person: z.string().nullable().optional().describe('Packliste: für wen (leer = niemand)'),
        container: z.string().nullable().optional().describe('Packliste: Packstück, z. B. „Koffer“'),
        tipFrom: z.string().nullable().optional().describe('Merkliste: von wem der Tipp kommt'),
        where: z.string().nullable().optional().describe('Merkliste: wo es das gibt, z. B. „Netflix“'),
      },
    },
    guard('write', async ({ item, list, ...patch }: { item: string; list?: string } & Record<string, unknown>) => {
      const updated = await api.updateItem(userId, item, patch, list);
      return text(`Geändert: ${updated.name}${updated.specification ? ` – ${updated.specification}` : ''}`);
    }),
  );

  for (const [name, checked, title] of [
    ['check_items', true, 'Abhaken (gekauft bzw. eingepackt)'],
    ['uncheck_items', false, 'Wieder auf die Liste'],
  ] as const) {
    server.registerTool(
      name,
      { title, description: `${title} – Artikel per Name oder ID.`, inputSchema: { items: z.array(z.string()).min(1), list: listParam } },
      guard('write', async ({ items, list }: { items: string[]; list?: string }) => {
        const done = await api.setChecked(userId, items, checked, list);
        return text(`${checked ? 'Abgehakt' : 'Wieder offen'}: ${done.map((i) => i.name).join(', ')}`);
      }),
    );
  }

  server.registerTool(
    'remove_items',
    {
      title: 'Artikel entfernen',
      description: 'Entfernt Artikel ganz von der Liste (statt sie abzuhaken).',
      inputSchema: { items: z.array(z.string()).min(1), list: listParam },
      annotations: { destructiveHint: true },
    },
    guard('write', async ({ items, list }: { items: string[]; list?: string }) => text(`${await api.removeItems(userId, items, list)} Artikel entfernt.`)),
  );

  server.registerTool(
    'create_list',
    {
      title: 'Liste anlegen',
      description: 'Legt eine neue Einkaufs-, Pack- oder Merkliste an, optional vorbefüllt aus einer Vorlage (dann gilt deren Typ).',
      inputSchema: {
        name: z.string().min(1).max(80),
        template: z.string().optional().describe('Name einer Vorlage'),
        type: z.enum(['shopping', 'packing', 'memo']).optional().describe('Ohne Vorlage: Einkaufsliste (Standard), Packliste oder Merkliste'),
        description: z.string().max(300).optional().describe('Worum es geht, z. B. „Filme und Serien, die wir sehen wollen“ (wichtig für die Icons von Merklisten)'),
      },
    },
    guard('write', async ({ name, template, type, description }: { name: string; template?: string; type?: 'shopping' | 'packing' | 'memo'; description?: string }) => {
      const l = await api.createList(userId, name, { template, type, description });
      return text(`${l.type === 'packing' ? 'Packliste' : l.type === 'memo' ? 'Merkliste' : 'Liste'} „${l.name}“ angelegt (${l.openItems} Einträge).`);
    }),
  );

  server.registerTool(
    'archive_list',
    {
      title: 'Liste archivieren',
      description: 'Archiviert eine erledigte Packliste (oder holt sie mit archived=false zurück).',
      inputSchema: { list: z.string().min(1), archived: z.boolean().default(true) },
    },
    guard('write', async ({ list, archived }: { list: string; archived: boolean }) => {
      await api.archiveList(userId, list, archived);
      return text(archived ? 'Archiviert.' : 'Wieder aktiv.');
    }),
  );

  server.registerTool(
    'apply_template',
    {
      title: 'Vorlage übernehmen',
      description: 'Übernimmt eine Vorlage (z. B. „Grillabend“) in eine Liste.',
      inputSchema: { template: z.string().min(1), list: listParam, include_optional: z.boolean().default(false) },
    },
    guard('write', async ({ template, list, include_optional }: { template: string; list?: string; include_optional: boolean }) =>
      text(added(await api.applyTemplate(userId, list, template, include_optional))),
    ),
  );

  // ---- Mealie --------------------------------------------------------------------

  server.registerTool(
    'search_mealie_recipes',
    {
      title: 'Rezepte in Mealie suchen',
      description: 'Sucht Rezepte in Mealie. Liefert Slugs für import_mealie_recipe.',
      inputSchema: { query: z.string() },
      annotations: { readOnlyHint: true },
    },
    guard('mealie', async ({ query }: { query: string }) => {
      const hits = await api.searchRecipes(userId, query);
      return text(hits.map((h) => `- ${h.name} (slug: ${h.slug}${h.servings ? `, ${h.servings} Portionen` : ''})`).join('\n') || 'Kein Rezept gefunden.');
    }),
  );

  server.registerTool(
    'import_mealie_recipe',
    {
      title: 'Rezept einkaufen',
      description: 'Setzt die Zutaten eines Mealie-Rezepts auf die Liste. Vorräte (Salz, Öl …) nur mit include_pantry.',
      inputSchema: {
        recipe: z.string().describe('Rezept-Slug aus search_mealie_recipes'),
        servings: z.number().positive().max(100).optional(),
        list: listParam,
        include_pantry: z.boolean().default(false),
      },
    },
    guard('mealie', async (a: { recipe: string; servings?: number; list?: string; include_pantry: boolean }) => {
      const r = await api.importRecipe(userId, a.list, a.recipe, a.servings, a.include_pantry);
      return text(`${r.recipe}${r.servings ? ` (${r.servings} Portionen)` : ''}:\n${added(r)}`);
    }),
  );

  server.registerTool(
    'import_mealie_mealplan',
    {
      title: 'Wochenplan einkaufen',
      description: 'Setzt die Zutaten aller Rezepte aus dem Mealie-Wochenplan im Zeitraum auf die Liste (gleiche Zutaten zusammengefasst).',
      inputSchema: {
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('YYYY-MM-DD'),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('YYYY-MM-DD'),
        list: listParam,
        include_pantry: z.boolean().default(false),
      },
    },
    guard('mealie', async (a: { from: string; to: string; list?: string; include_pantry: boolean }) => {
      const r = await api.importMealplan(userId, a.list, a.from, a.to, a.include_pantry);
      return text(`Rezepte: ${r.recipes.map((x) => x.name).join(', ') || 'keine'}\n${added(r)}`);
    }),
  );

  // ---- resources & prompts ----------------------------------------------------------

  server.registerResource(
    'list',
    new ResourceTemplate('shopping://lists/{id}', {
      list: async () => ({
        resources: (await api.lists(userId, 'include')).map((l) => ({ uri: `shopping://lists/${l.id}`, name: l.name, mimeType: 'text/markdown' })),
      }),
    }),
    { title: 'Einkaufsliste', description: 'Eine Liste als Markdown', mimeType: 'text/markdown' },
    async (uri, { id }) => ({
      contents: [{ uri: uri.href, mimeType: 'text/markdown', text: listMarkdown(await api.list(userId, String(id), 'open')) }],
    }),
  );

  server.registerPrompt(
    'wocheneinkauf',
    {
      title: 'Wocheneinkauf planen',
      description: 'Wochenplan aus Mealie, Basis-Vorlage und Verlauf zu einer Einkaufsliste zusammenführen',
    },
    () => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: 'Plane unseren Wocheneinkauf: Schau dir mit get_list die Hauptliste an, übernimm mit import_mealie_mealplan den Wochenplan für die kommende Woche (Montag bis Sonntag), prüfe mit list_lists, ob es eine Basis-Vorlage gibt, und schlag mir anhand von get_history vor, was sonst noch fehlen könnte. Frag nach, bevor du etwas anderes als den Wochenplan hinzufügst.',
          },
        },
      ],
    }),
  );

  return server;
}

/** MCP over Streamable HTTP at /mcp (stateless: a fresh server per request). */
export async function mcpRoutes(
  app: FastifyInstance,
  opts: { api: ShoppingApi; requireUser: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> },
): Promise<void> {
  app.post('/mcp', { preHandler: opts.requireUser }, async (request, reply) => {
    const server = createMcpServer(opts.api, request.principal);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    reply.hijack();
    reply.raw.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(request.raw, reply.raw, request.body);
  });

  // Stateless server: no server-initiated streams, no sessions to end.
  const notAllowed = async (_request: FastifyRequest, reply: FastifyReply) =>
    reply.code(405).header('Allow', 'POST').send({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null });
  app.get('/mcp', notAllowed);
  app.delete('/mcp', notAllowed);
}
