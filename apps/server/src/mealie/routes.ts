import { CATEGORIES } from '@shopping/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.js';
import type { SecretBox } from '../crypto.js';
import type { Db } from '../db/index.js';
import { currentSeq } from '../db/seed.js';
import type { SyncHub } from '../sync/hub.js';
import type { SyncService } from '../sync/service.js';
import { MealieError } from './client.js';
import { importFoods } from './import.js';
import type { MealieService } from './service.js';

const categoryId = z.enum(CATEGORIES.map((c) => c.id) as [string, ...string[]]);

const SettingsSchema = z.object({
  url: z.string().url(),
  token: z.string().min(10).optional(),
  labelMapping: z.record(z.string(), categoryId).optional(),
  inbox: z
    .object({
      enabled: z.boolean(),
      mealieListId: z.string().min(1).optional(),
      targetListId: z.string().uuid().optional(),
    })
    .optional(),
});

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

interface Options {
  config: Config;
  db: Db;
  sync: SyncService;
  hub: SyncHub;
  secrets: SecretBox;
  mealie: MealieService;
  requireUser: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
}

export async function mealieRoutes(app: FastifyInstance, opts: Options): Promise<void> {
  const { config, db, sync, hub, secrets, mealie, requireUser } = opts;

  /** Turns Mealie problems into a readable 400 instead of a 500. */
  const guarded =
    <T>(fn: (request: FastifyRequest) => Promise<T>) =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        return await fn(request);
      } catch (err) {
        if (err instanceof MealieError) return reply.code(400).send({ error: err.message });
        throw err;
      }
    };

  // The Mealie notifier posts here (no login; the secret is in the path).
  app.post('/hooks/mealie/:secret', async (request, reply) => {
    const { secret } = z.object({ secret: z.string().min(20).max(100) }).parse(request.params);
    const ok = await mealie.webhook(secret);
    return reply.code(ok ? 202 : 404).send({ ok });
  });

  app.register(async (api) => {
    api.addHook('preHandler', requireUser);

    api.get('/api/v1/integrations/mealie', async (request) => {
      const row = await mealie.load(request.userId);
      const cfg = mealie.config(row);
      const host = new URL(config.PUBLIC_URL);
      const secret = cfg.inbox?.webhookSecret;
      return {
        url: cfg.url ?? null,
        hasToken: !!cfg.token,
        labelMapping: cfg.labelMapping ?? {},
        labels: cfg.labels ?? [],
        inbox: {
          enabled: cfg.inbox?.enabled ?? false,
          mealieListId: cfg.inbox?.mealieListId ?? null,
          targetListId: cfg.inbox?.targetListId ?? null,
          webhookUrl: secret ? `${config.PUBLIC_URL}/hooks/mealie/${secret}` : null,
          // Apprise URL for Mealie's notifier (json:// for http, jsons:// for https).
          appriseUrl: secret ? `${host.protocol === 'https:' ? 'jsons' : 'json'}://${host.host}${host.pathname.replace(/\/$/, '')}/hooks/mealie/${secret}` : null,
        },
        status: row?.status ?? null,
        lastSyncAt: row?.lastSyncAt ?? null,
      };
    });

    api.put('/api/v1/integrations/mealie', async (request, reply) => {
      const body = SettingsSchema.parse(request.body);
      if (body.inbox?.targetListId && !(await sync.isMember(request.userId, body.inbox.targetListId))) {
        return reply.code(400).send({ error: 'Zielliste nicht gefunden' });
      }
      await mealie.save(request.userId, (prev) => ({
        ...prev,
        url: body.url.replace(/\/$/, ''),
        token: body.token ? secrets.seal(body.token) : prev.token,
        labelMapping: body.labelMapping ?? prev.labelMapping ?? {},
        inbox: body.inbox ? { ...prev.inbox, ...body.inbox } : prev.inbox,
      }));
      return { ok: true };
    });

    api.post(
      '/api/v1/integrations/mealie/test',
      guarded(async (request) => {
        const { client } = await mealie.clientFor(request.userId);
        const [about, self] = await Promise.all([client.about(), client.self()]);
        return { ok: true, version: about.version, user: self.fullName ?? self.username ?? null };
      }),
    );

    api.get(
      '/api/v1/integrations/mealie/shopping-lists',
      guarded(async (request) => {
        const { client } = await mealie.clientFor(request.userId);
        return (await client.shoppingLists()).map((l) => ({ id: l.id, name: l.name ?? 'Ohne Namen' }));
      }),
    );

    api.post(
      '/api/v1/integrations/mealie/import-catalog',
      guarded(async (request) => {
        const { client, cfg, row } = await mealie.clientFor(request.userId);
        try {
          const foods = await client.foods();
          const result = await sync.exclusive(() => importFoods(db, foods, cfg.labelMapping ?? {}));
          await mealie.save(request.userId, (prev) => ({ ...prev, labels: result.labels }));
          await mealie.setStatus(row.id, `${foods.length} Lebensmittel abgeglichen`, true);
          hub.broadcast({ t: 'catalog', seq: await currentSeq(db) });
          return result;
        } catch (err) {
          if (err instanceof MealieError) await mealie.setStatus(row.id, `Fehler: ${err.message}`);
          throw err;
        }
      }),
    );

    api.post(
      '/api/v1/integrations/mealie/inbox/run',
      guarded(async (request) => {
        const row = await mealie.load(request.userId);
        if (!row || !mealie.config(row).inbox?.enabled) throw new MealieError('Der Eingangskorb ist nicht eingeschaltet');
        return mealie.runInbox(row.id);
      }),
    );

    api.get(
      '/api/v1/integrations/mealie/recipes',
      guarded(async (request) => {
        const { q } = z.object({ q: z.string().max(100).default('') }).parse(request.query);
        const { client } = await mealie.clientFor(request.userId);
        return (await client.searchRecipes(q)).map((r) => ({ slug: r.slug, name: r.name ?? r.slug, servings: r.recipeServings || null }));
      }),
    );

    api.get(
      '/api/v1/integrations/mealie/recipes/:slug',
      guarded(async (request) => {
        const { slug } = z.object({ slug: z.string().min(1).max(200) }).parse(request.params);
        const { servings } = z.object({ servings: z.coerce.number().positive().max(100).optional() }).parse(request.query);
        return mealie.recipeCandidates(request.userId, slug, servings);
      }),
    );

    api.get(
      '/api/v1/integrations/mealie/mealplan',
      guarded(async (request) => {
        const { from, to } = z.object({ from: isoDate, to: isoDate }).parse(request.query);
        return mealie.mealplanCandidates(request.userId, from, to);
      }),
    );
  });
}
