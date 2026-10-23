import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import { CATEGORIES } from '@shopping/shared';
import { eq, gt, sql } from 'drizzle-orm';
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
import { oauthRoutes } from './oauth/routes.js';
import { MealieService } from './mealie/service.js';
import { sharingRoutes } from './sharing/routes.js';
import { SyncHub } from './sync/hub.js';
import { toCatalogItem, toMe } from './sync/rows.js';
import { SyncService } from './sync/service.js';

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
  const sync = new SyncService(db);
  const hub = new SyncHub(sync, app.log);
  app.addHook('onClose', async () => hub.close());
  const icons = new IconService(db, secrets, sync, hub, app.log, fetchImpl);
  app.addHook('onClose', async () => icons.stop());

  app.setErrorHandler(problemHandler);
  await app.register(cookie, { secret: config.SECRET_KEY });
  await app.register(websocket, { options: { maxPayload: 1024 * 1024 } });
  const avatars = new AvatarService(db, sync, hub, app.log, fetchImpl);
  app.addHook('onClose', async () => avatars.stop());
  await app.register(authRoutes, { config, db, avatars });

  // Used by the Docker/Compose health check: healthy only if the database answers.
  app.get('/healthz', async (_request, reply) => {
    try {
      await Promise.race([
        db.execute(sql`SELECT 1`),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
      ]);
      return { ok: true };
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
  await app.register(iconRoutes, { icons, requireAccount });
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
      return toMe(u!);
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
        return { items: rows.map(toCatalogItem), categories: CATEGORIES, categoryIcons: await icons.categoryIcons(), seq };
      });
    });

    api.patch('/api/v1/catalog/:id', { preHandler: requireAccount }, async (request, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const body = z
        .object({
          categoryId: z.enum(CATEGORIES.map((c) => c.id) as [string, ...string[]]).optional(),
          hidden: z.boolean().optional(),
          pantry: z.boolean().optional(),
        })
        .parse(request.body);
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
  const api = new ShoppingApi(db, sync, hub, mealie);
  await app.register(apiRoutes, { config, api, sync, hub, requireUser });
  await app.register(oauthRoutes, { config, db });
  await app.register(mcpRoutes, { api, requireUser });
  await app.register(mealieRoutes, { config, db, sync, hub, secrets, mealie, requireUser: requireAccount });
  app.addHook('onClose', async () => mealie.stop());

  // ---- Web app ------------------------------------------------------------

  const webDist =
    config.WEB_DIST ?? [resolve(fileURLToPath(import.meta.url), '../../../web/dist'), resolve(fileURLToPath(import.meta.url), '../../web/dist')].find(existsSync);
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

  return { app, sync, hub, mealie, api, icons, avatars };
}
