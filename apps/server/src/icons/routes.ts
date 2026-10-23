import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ApiError } from '../api/errors.js';
import { CLOUDFLARE_MODELS, OPENAI_MODELS, OPENAI_QUALITIES } from './generators.js';
import type { IconService } from './service.js';

interface Options {
  icons: IconService;
  requireAccount: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
}

const Target = z.object({
  targetType: z.enum(['item', 'category']),
  targetId: z.string().min(1).max(64),
});

const SettingsBody = z.object({
  enabled: z.boolean().optional(),
  provider: z.enum(['cloudflare', 'openai']).optional(),
  candidates: z.number().int().min(1).max(4).optional(),
  style: z.string().max(1000).optional(),
  cloudflare: z
    .object({
      accountId: z.string().trim().max(64).nullable().optional(),
      token: z.string().trim().max(200).optional(),
      model: z.enum(CLOUDFLARE_MODELS).optional(),
      dailyLimit: z.number().int().min(0).max(5000).optional(),
      size: z.number().int().refine((n) => [512, 768, 1024].includes(n)).optional(),
    })
    .optional(),
  openai: z
    .object({
      apiKey: z.string().trim().max(300).optional(),
      model: z.enum(OPENAI_MODELS).optional(),
      quality: z.enum(OPENAI_QUALITIES).optional(),
      monthlyCapMilli: z.number().int().min(0).max(1_000_000).optional(),
    })
    .optional(),
});

const IdParam = z.object({ id: z.string().uuid() });

export async function iconRoutes(app: FastifyInstance, { icons, requireAccount }: Options): Promise<void> {
  // ---- public: approved icons --------------------------------------------------
  // Not secret, and needed before login, by guests and by the service worker. The
  // version in the query string changes with every new icon, so caching forever is safe.

  const serve = (type: 'item' | 'category') => async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = z.object({ id: z.string().max(64) }).parse(request.params);
    const { v } = z.object({ v: z.string().optional() }).parse(request.query);
    const icon = await icons.approvedImage(type, id.replace(/\.webp$/, ''));
    if (!icon) return reply.code(404).header('Cache-Control', 'no-cache').send({ error: 'not_found' });
    reply.header('Content-Type', 'image/webp');
    reply.header('Cache-Control', v === icon.token ? 'public, max-age=31536000, immutable' : 'public, max-age=300');
    return reply.send(icon.thumb);
  };
  app.get('/icons/item/:id', serve('item'));
  app.get('/icons/category/:id', serve('category'));

  // ---- review & settings (accounts only) ---------------------------------------------

  app.register(async (api) => {
    api.addHook('preHandler', requireAccount);

    api.get('/api/v1/icons/status', async () => icons.status());

    api.put('/api/v1/icons/settings', async (request) => {
      await icons.updateSettings(SettingsBody.parse(request.body));
      return icons.publicSettings();
    });

    api.get('/api/v1/icons/review', async () => ({ targets: await icons.reviewQueue() }));
    api.get('/api/v1/icons/gallery', async () => ({ icons: await icons.gallery() }));

    api.get('/api/v1/icons/:id/image', async (request, reply) => {
      const { id } = IdParam.parse(request.params);
      const { size } = z.object({ size: z.enum(['master', 'thumb']).default('thumb') }).parse(request.query);
      const data = await icons.image(id, size);
      if (!data) throw new ApiError(404, 'not_found', 'Icon nicht gefunden');
      return reply.header('Content-Type', 'image/webp').header('Cache-Control', 'private, max-age=86400').send(data);
    });

    api.post('/api/v1/icons/:id/approve', async (request) => {
      const { id } = IdParam.parse(request.params);
      const { anchor } = z.object({ anchor: z.boolean().optional() }).parse(request.body ?? {});
      await icons.approve(id, request.userId, anchor);
      return { ok: true };
    });

    api.post('/api/v1/icons/:id/reject', async (request) => {
      const { id } = IdParam.parse(request.params);
      await icons.reject(id, request.userId);
      return { ok: true };
    });

    api.post('/api/v1/icons/:id/anchor', async (request) => {
      const { id } = IdParam.parse(request.params);
      const { anchor } = z.object({ anchor: z.boolean() }).parse(request.body);
      await icons.setAnchor(id, anchor);
      return { ok: true };
    });

    api.post('/api/v1/icons/generate', async (request) => {
      const body = Target.extend({
        hint: z.string().trim().max(300).nullable().optional(),
        subject: z.string().trim().max(300).nullable().optional(),
        paid: z.boolean().optional(),
        candidates: z.number().int().min(1).max(4).optional(),
      }).parse(request.body);
      await icons.regenerate(body.targetType, body.targetId, body);
      return { ok: true };
    });

    /** Runs the next job right away (also while automatic generation is off, e.g. to find the style). */
    api.post('/api/v1/icons/run', async () => {
      await icons.enqueueMissing();
      return { result: await icons.runNext() };
    });

    api.post('/api/v1/icons/retry-failed', async () => {
      await icons.retryFailed();
      return { ok: true };
    });

    api.post('/api/v1/icons/upload', { bodyLimit: 12 * 1024 * 1024 }, async (request) => {
      const body = Target.extend({ image: z.string().min(10) }).parse(request.body);
      const data = Buffer.from(body.image.replace(/^data:[^,]*,/, ''), 'base64');
      return { id: await icons.upload(body.targetType, body.targetId, data) };
    });

    /** "Icon gefällt mir nicht" from the item editor. */
    api.post('/api/v1/catalog/:id/icon-report', async (request) => {
      const { id } = IdParam.parse(request.params);
      await icons.regenerate('item', id, { priority: 1500 });
      return { ok: true };
    });
  });
}
