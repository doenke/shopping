import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import { CATEGORIES } from '@shopping/shared';
import { and, eq, gt, sql } from 'drizzle-orm';
import Fastify, { type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authRoutes } from './auth/routes.js';
import { sessionUser } from './auth/session.js';
import type { Config } from './config.js';
import { SecretBox } from './crypto.js';
import type { Db } from './db/index.js';
import { catalogItems, integrations, users } from './db/schema.js';
import { currentSeq } from './db/seed.js';
import { MealieClient, MealieError } from './mealie/client.js';
import { importFoods } from './mealie/import.js';
import { SyncHub } from './sync/hub.js';
import { toCatalogItem, toMe } from './sync/rows.js';
import { SyncService } from './sync/service.js';

declare module 'fastify' {
  interface FastifyRequest {
    userId: string;
  }
}

export interface AppOptions {
  config: Config;
  db: Db;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
}

const MealieSettingsSchema = z.object({
  url: z.string().url(),
  token: z.string().min(10).optional(),
  labelMapping: z.record(z.string(), z.enum(CATEGORIES.map((c) => c.id) as [string, ...string[]])).optional(),
});

interface MealieConfig {
  url?: string;
  token?: string;
  labelMapping?: Record<string, string>;
  labels?: string[];
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

  await app.register(cookie, { secret: config.SECRET_KEY });
  await app.register(websocket, { options: { maxPayload: 1024 * 1024 } });
  await app.register(authRoutes, { config, db });

  app.get('/healthz', async () => ({ ok: true }));

  const requireUser = async (request: FastifyRequest, reply: import('fastify').FastifyReply) => {
    const userId = await sessionUser(db, request, reply, secure);
    if (!userId) return reply.code(401).send({ error: 'unauthorized' });
    request.userId = userId;
  };

  // ---- Sync ---------------------------------------------------------------

  app.register(async (api) => {
    api.addHook('preHandler', requireUser);

    api.get('/ws', { websocket: true }, (socket, request) => hub.attach(socket, request.userId));

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
        return { items: rows.map(toCatalogItem), categories: CATEGORIES, seq };
      });
    });

    api.patch('/api/v1/catalog/:id', async (request, reply) => {
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

    // ---- Mealie -----------------------------------------------------------

    const loadMealie = async (userId: string) => {
      const [row] = await db
        .select()
        .from(integrations)
        .where(and(eq(integrations.ownerId, userId), eq(integrations.type, 'mealie')));
      return row;
    };

    const mealieClient = (cfg: MealieConfig) => {
      if (!cfg.url || !cfg.token) throw new MealieError('Mealie ist noch nicht eingerichtet');
      return new MealieClient(cfg.url, secrets.open(cfg.token), fetchImpl);
    };

    api.get('/api/v1/integrations/mealie', async (request) => {
      const row = await loadMealie(request.userId);
      const cfg = (row?.config ?? {}) as MealieConfig;
      return {
        url: cfg.url ?? null,
        hasToken: !!cfg.token,
        labelMapping: cfg.labelMapping ?? {},
        labels: cfg.labels ?? [],
        status: row?.status ?? null,
        lastSyncAt: row?.lastSyncAt ?? null,
      };
    });

    api.put('/api/v1/integrations/mealie', async (request) => {
      const body = MealieSettingsSchema.parse(request.body);
      const row = await loadMealie(request.userId);
      const prev = (row?.config ?? {}) as MealieConfig;
      const next: MealieConfig = {
        ...prev,
        url: body.url.replace(/\/$/, ''),
        token: body.token ? secrets.seal(body.token) : prev.token,
        labelMapping: body.labelMapping ?? prev.labelMapping ?? {},
      };
      await db
        .insert(integrations)
        .values({ ownerId: request.userId, type: 'mealie', config: next as Record<string, unknown> })
        .onConflictDoUpdate({ target: [integrations.ownerId, integrations.type], set: { config: next as Record<string, unknown> } });
      return { ok: true };
    });

    api.post('/api/v1/integrations/mealie/test', async (request, reply) => {
      const row = await loadMealie(request.userId);
      try {
        const client = mealieClient((row?.config ?? {}) as MealieConfig);
        const [about, self] = await Promise.all([client.about(), client.self()]);
        return { ok: true, version: about.version, user: self.fullName ?? self.username ?? null };
      } catch (err) {
        if (err instanceof MealieError) return reply.code(400).send({ ok: false, error: err.message });
        throw err;
      }
    });

    api.post('/api/v1/integrations/mealie/import-catalog', async (request, reply) => {
      const row = await loadMealie(request.userId);
      const cfg = (row?.config ?? {}) as MealieConfig;
      try {
        const foods = await mealieClient(cfg).foods();
        const result = await sync.exclusive(() => importFoods(db, foods, cfg.labelMapping ?? {}));
        await db
          .update(integrations)
          .set({
            config: { ...cfg, labels: result.labels } as Record<string, unknown>,
            status: `${foods.length} Lebensmittel abgeglichen`,
            lastSyncAt: new Date(),
          })
          .where(eq(integrations.id, row!.id));
        hub.broadcast({ t: 'catalog', seq: await currentSeq(db) });
        return result;
      } catch (err) {
        if (err instanceof MealieError) {
          if (row) await db.update(integrations).set({ status: `Fehler: ${err.message}` }).where(eq(integrations.id, row.id));
          return reply.code(400).send({ error: err.message });
        }
        throw err;
      }
    });
  });

  // ---- Web app ------------------------------------------------------------

  const webDist =
    config.WEB_DIST ?? [resolve(fileURLToPath(import.meta.url), '../../../web/dist'), resolve(fileURLToPath(import.meta.url), '../../web/dist')].find(existsSync);
  if (webDist && existsSync(webDist)) {
    await app.register(fastifyStatic, {
      root: webDist,
      wildcard: false,
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
      if (request.method === 'GET' && !/^\/(api|auth|ws)\b/.test(request.url)) {
        return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
      }
      return reply.code(404).send({ error: 'not_found' });
    });
  } else {
    app.log.warn('Kein Web-Build gefunden – es läuft nur die API.');
  }

  return { app, sync, hub };
}
