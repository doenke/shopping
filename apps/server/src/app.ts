import { existsSync } from 'node:fs';
import { PlaceService, PlacesUnavailable } from './places.js';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import { ALL_CATEGORIES, CATEGORIES } from '@shopping/shared';
import { and, eq, gt, sql } from 'drizzle-orm';
import Fastify, { type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AvatarService } from './auth/avatar.js';
import { authRoutes } from './auth/routes.js';
import { tokenRoutes } from './auth/tokens.js';
import { resolvePrincipal, requiredScope, type Principal } from './auth/principal.js';
import type { Config } from './config.js';
import { SecretBox } from './crypto.js';
import type { Db } from './db/index.js';
import { catalogItems, users } from './db/schema.js';
import { currentSeq } from './db/seed.js';
import { ApiError, problemHandler } from './api/errors.js';
import { apiRoutes } from './api/routes.js';
import { ShoppingApi } from './api/service.js';
import { iconRoutes } from './icons/routes.js';
import { IconService } from './icons/service.js';
import { mcpRoutes } from './mcp/server.js';
import { mealieRoutes } from './mealie/routes.js';
import { davRoutes } from './dav/routes.js';
import { jmapRoutes } from './jmap/routes.js';
import { TaskService } from './tasks/service.js';
import { fetchPageTitle, fetchWebRecipe, RecipeError, webRecipeCandidates } from './recipes/web-recipe.js';
import { oauthRoutes } from './oauth/routes.js';
import { MealieService } from './mealie/service.js';
import { sharingRoutes } from './sharing/routes.js';
import { SyncHub } from './sync/hub.js';
import { toCatalogItem, toMe } from './sync/rows.js';
import { SyncService } from './sync/service.js';
import { webhookRoutes } from './webhooks/routes.js';
import { WebhookService } from './webhooks/service.js';

declare module 'fastify' {
  interface FastifyRequest {
    userId: string;
    isGuest: boolean;
    principal: Principal;
  }
}

export interface AppOptions {
  config: Config;
  db: Db;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
}

export async function buildApp({ config, db, fetchImpl }: AppOptions) {
  const app = Fastify({
    logger: { level: config.LOG_LEVEL },
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
  });
  const secure = config.PUBLIC_URL.startsWith('https://');
  const secrets = new SecretBox(config.SECRET_KEY);
  const sync = new SyncService(db, !!config.OIDC_OWNER_GROUP);
  const hub = new SyncHub(sync, app.log);
  app.addHook('onClose', async () => hub.close());
  const places = new PlaceService(config.PHOTON_URL, fetchImpl);
  const icons = new IconService(db, secrets, sync, hub, app.log, fetchImpl);
  app.addHook('onClose', async () => icons.stop());

  app.setErrorHandler(problemHandler);
  await app.register(cookie, { secret: config.SECRET_KEY });
  await app.register(websocket, { options: { maxPayload: 1024 * 1024 } });
  const avatars = new AvatarService(db, sync, hub, app.log, fetchImpl, config.OIDC_ISSUER);
  app.addHook('onClose', async () => avatars.stop());
  await app.register(authRoutes, { config, db, avatars, sync, hub });

  // Used by the Docker/Compose health check: healthy only if the database answers.
  app.get('/healthz', async (_request, reply) => {
    try {
      await Promise.race([db.execute(sql`SELECT 1`), new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))]);
      return { ok: true, version: process.env.APP_VERSION || 'dev' };
    } catch {
      return reply.code(503).send({ ok: false, error: 'database unavailable' });
    }
  });

  const requireUser = async (request: FastifyRequest, reply: import('fastify').FastifyReply) => {
    const principal = await resolvePrincipal(db, request, reply, secure);
    if (!principal) {
      // Tells OAuth clients (MCP) where to find out how to log in.
      reply.header('WWW-Authenticate', `Bearer resource_metadata="${config.PUBLIC_URL}/.well-known/oauth-protected-resource"`);
      throw new ApiError(401, 'unauthorized', 'Bitte anmelden oder ein gültiges Token mitschicken');
    }
    const scope = requiredScope(request);
    if (!principal.scopes.has(scope)) throw new ApiError(403, 'insufficient_scope', `Dem Token fehlt die Berechtigung „${scope}“`, { scope });
    request.principal = principal;
    request.userId = principal.userId;
    request.isGuest = principal.isGuest;
  };

  /** Everything beyond working on a shared list is for real accounts only. */
  const requireAccount = async (request: FastifyRequest, reply: import('fastify').FastifyReply) => {
    await requireUser(request, reply);
    if (request.isGuest) throw new ApiError(403, 'guest', 'Gäste haben darauf keinen Zugriff');
  };

  await app.register(tokenRoutes, { db, requireAccount });
  /** Server-wide settings (image AI, budget) are for the admin group only. */
  const requireAdmin = async (request: FastifyRequest, reply: import('fastify').FastifyReply) => {
    await requireAccount(request, reply);
    const [u] = await db.select({ isAdmin: users.isAdmin }).from(users).where(eq(users.id, request.userId));
    if (!u?.isAdmin) throw new ApiError(403, 'admin_only', 'Das dürfen nur Admins – sie gelten für alle auf diesem Server');
  };
  await app.register(iconRoutes, { icons, requireAccount, requireAdmin });
  await app.register(sharingRoutes, { config, db, sync, hub, secrets, requireUser, requireAccount });

  // ---- Sync ---------------------------------------------------------------

  app.register(async (api) => {
    api.addHook('preHandler', requireUser);

    api.get('/ws', { websocket: true }, (socket, request) => hub.attach(socket, request.userId));

    // Profile pictures of the people on one's lists (only for logged-in users, also guests).
    api.get('/avatars/:file', async (request, reply) => {
      const { file } = z.object({ file: z.string().regex(/^[0-9a-f-]{36}\.webp$/) }).parse(request.params);
      const { v } = z.object({ v: z.string().optional() }).parse(request.query);
      const avatar = await avatars.get(file.slice(0, 36));
      if (!avatar) throw new ApiError(404, 'not_found', 'Kein Profilbild');
      reply.header('Content-Type', 'image/webp');
      reply.header('Cache-Control', v === avatar.version ? 'private, max-age=31536000, immutable' : 'private, no-cache');
      return reply.send(avatar.data);
    });

    api.get('/api/v1/me', async (request) => {
      const [u] = await db.select().from(users).where(eq(users.id, request.userId));
      const h = await sync.householdInfo(u?.householdId ?? null);
      return toMe(u!, h.name, h.owner);
    });

    /** For the help page: who the admins are (guests ask them for an account) and, for admins, the household setup. */
    api.get('/api/v1/help', async (request) => {
      const admins = await db
        .select({ displayName: users.displayName })
        .from(users)
        .where(and(eq(users.isAdmin, true), eq(users.isGuest, false)))
        .orderBy(users.displayName);
      const [me] = await db.select({ isAdmin: users.isAdmin }).from(users).where(eq(users.id, request.userId));
      return {
        admins: admins.map((a) => a.displayName),
        ...(me?.isAdmin
          ? { setup: { ownerGroup: config.OIDC_OWNER_GROUP ?? null, adminGroup: config.OIDC_ADMIN_GROUP, householdClaim: config.OIDC_HOUSEHOLD_CLAIM } }
          : {}),
      };
    });

    /** Anyone in a household may rename it; all members get the new name. */
    api.patch('/api/v1/me/household', async (request) => {
      const { name } = z.object({ name: z.string().trim().min(1).max(60) }).parse(request.body);
      const members = await sync.renameHousehold(request.userId, name);
      if (!members) throw new ApiError(404, 'no_household', 'Gäste gehören zu keinem Haushalt');
      hub.notify(members);
      return { name };
    });

    api.get('/api/v1/sync/pull', async (request) => {
      const { since } = z.object({ since: z.coerce.number().int().min(0).default(0) }).parse(request.query);
      return sync.pull(request.userId, since);
    });

    api.post('/api/v1/sync/push', async (request) => {
      // Mutations are validated one by one, so a single bad one cannot block a whole outbox.
      const { mutations } = z.object({ mutations: z.array(z.unknown()).max(500) }).parse(request.body);
      const result = await sync.apply(request.userId, mutations);
      hub.notify(result.affectedUsers);
      return { acked: result.acked, rejected: result.rejected };
    });

    // ---- Catalog ----------------------------------------------------------

    api.get('/api/v1/catalog', async (request) => {
      const { since } = z.object({ since: z.coerce.number().int().min(0).default(0) }).parse(request.query);
      return sync.exclusive(async () => {
        const seq = await currentSeq(db);
        const rows = await db
          .select()
          .from(catalogItems)
          .where(since ? gt(catalogItems.seq, since) : undefined);
        return {
          items: rows.map(toCatalogItem),
          categories: CATEGORIES,
          categoryIcons: await icons.categoryIcons(),
          pendingIcons: await icons.pendingTargets(),
          seq,
        };
      });
    });

    // "Rezept aus dem Web": a recipe page (Chefkoch & co.) read like Bring does – from its schema.org data.
    api.get('/api/v1/recipes/from-url', { preHandler: requireAccount }, async (request, reply) => {
      const q = z.object({ url: z.string().url().max(2000), servings: z.coerce.number().positive().max(100).optional() }).parse(request.query);
      try {
        const recipe = await fetchWebRecipe(q.url, fetchImpl);
        const catalog = (await db.select().from(catalogItems).where(eq(catalogItems.kind, 'shopping'))).map(toCatalogItem);
        return await webRecipeCandidates(recipe, catalog, q.servings);
      } catch (err) {
        if (err instanceof RecipeError) return reply.code(422).send({ error: 'recipe', detail: err.message });
        throw err;
      }
    });

    // Places for attachments (Photon): search by text, or what is at a position ("*" = here).
    api.get('/api/v1/places/search', { preHandler: requireUser }, async (request, reply) => {
      const q = z
        .object({
          q: z.string().trim().min(1).max(200),
          lat: z.coerce.number().min(-90).max(90).optional(),
          lon: z.coerce.number().min(-180).max(180).optional(),
        })
        .parse(request.query);
      try {
        return { places: await places.search(q.q, q.lat !== undefined && q.lon !== undefined ? { lat: q.lat, lon: q.lon } : undefined) };
      } catch (err) {
        if (err instanceof PlacesUnavailable) return reply.code(503).send({ error: 'places', detail: err.message });
        throw err;
      }
    });
    api.get('/api/v1/places/reverse', { preHandler: requireUser }, async (request) => {
      const q = z.object({ lat: z.coerce.number().min(-90).max(90), lon: z.coerce.number().min(-180).max(180) }).parse(request.query);
      return places.reverse(q.lat, q.lon);
    });

    // Name for a link that came without one (shared or pasted): the page's title.
    api.get('/api/v1/links/title', { preHandler: requireAccount }, async (request, reply) => {
      const q = z.object({ url: z.string().url().max(2000) }).parse(request.query);
      try {
        return await fetchPageTitle(q.url, fetchImpl);
      } catch (err) {
        if (err instanceof RecipeError) return reply.code(422).send({ error: 'link', detail: err.message });
        throw err;
      }
    });

    api.patch('/api/v1/catalog/:id', { preHandler: requireAccount }, async (request, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const body = z
        .object({
          categoryId: z.string().max(40).optional(),
          hidden: z.boolean().optional(),
          pantry: z.boolean().optional(),
        })
        .parse(request.body);
      // A built-in category or one of the user's own.
      if (body.categoryId && !ALL_CATEGORIES.some((c) => c.id === body.categoryId)) {
        const own = await sync.visibleCategories(request.userId);
        if (!own.some((c) => c.id === body.categoryId)) return reply.code(400).send({ error: 'unknown_category' });
      }
      const updated = await sync.exclusive(() =>
        db
          .update(catalogItems)
          .set({ ...body, ...(body.categoryId ? { categoryLocked: true } : {}), seq: sql`nextval('sync_seq')` })
          .where(eq(catalogItems.id, id))
          .returning(),
      );
      if (!updated[0]) return reply.code(404).send({ error: 'not_found' });
      hub.broadcast({ t: 'catalog', seq: updated[0].seq });
      return toCatalogItem(updated[0]);
    });
  });

  const mealie = new MealieService(db, secrets, sync, hub, app.log, fetchImpl);
  const api = new ShoppingApi(db, sync, hub, places);
  await app.register(apiRoutes, { config, db, api, sync, hub, requireUser });
  const webhooks = new WebhookService(db, secrets, hub, app.log, fetchImpl);
  await app.register(webhookRoutes, { webhooks, requireAccount });
  app.addHook('onClose', async () => webhooks.stop());
  await app.register(oauthRoutes, { config, db });
  await app.register(mcpRoutes, { api, requireUser });
  // Lists as task lists for other apps: CalDAV (Erinnerungen, Thunderbird, DAVx⁵) and JMAP.
  const tasks = new TaskService(db, api);
  await davRoutes(app, { config, db, tasks });
  await app.register(jmapRoutes, { config, db, tasks });
  await app.register(mealieRoutes, { config, db, sync, hub, secrets, mealie, requireUser: requireAccount });
  app.addHook('onClose', async () => mealie.stop());

  // ---- Web app ------------------------------------------------------------

  const webDist =
    config.WEB_DIST ??
    [resolve(fileURLToPath(import.meta.url), '../../../web/dist'), resolve(fileURLToPath(import.meta.url), '../../web/dist')].find(existsSync);
  if (webDist && existsSync(webDist)) {
    await app.register(fastifyStatic, {
      root: webDist,
      setHeaders(res, path) {
        // The service worker and the app shell must always be revalidated.
        if (path.endsWith('sw.js') || path.endsWith('index.html') || path.endsWith('.webmanifest')) {
          res.header('Cache-Control', 'no-cache');
        } else if (path.includes('/assets/')) {
          res.header('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    });
    app.setNotFoundHandler((request, reply) => {
      // Client-side routes get the app shell; missing files (e.g. old asset hashes) get a real 404.
      const path = request.url.split('?')[0]!;
      if (request.method === 'GET' && !/^\/(api|auth|ws|icons|avatars)\b/.test(path) && !/\.[a-z0-9]+$/i.test(path)) {
        return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
      }
      return reply.code(404).send({ error: 'not_found' });
    });
  } else {
    app.log.warn('Kein Web-Build gefunden – es läuft nur die API.');
  }

  return { app, sync, hub, mealie, api, icons, avatars, webhooks };
}
