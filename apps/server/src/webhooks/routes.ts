import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { WEBHOOK_EVENTS } from '../db/schema.js';
import type { WebhookService } from './service.js';

interface Options {
  webhooks: WebhookService;
  requireAccount: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
}

const Url = z
  .string()
  .trim()
  .url()
  .max(500)
  .refine((u) => /^https?:\/\//.test(u), 'nur http(s)');
const Events = z.array(z.enum(WEBHOOK_EVENTS)).max(WEBHOOK_EVENTS.length);
const IdParam = z.object({ id: z.string().uuid() });

export async function webhookRoutes(app: FastifyInstance, { webhooks, requireAccount }: Options): Promise<void> {
  app.register(async (api) => {
    api.addHook('preHandler', requireAccount);

    api.get('/api/v1/webhooks', async (request) => webhooks.list(request.userId));

    api.post('/api/v1/webhooks', async (request) => {
      const body = z.object({ url: Url, events: Events.default([...WEBHOOK_EVENTS]) }).parse(request.body);
      return webhooks.create(request.userId, body.url, body.events);
    });

    api.patch('/api/v1/webhooks/:id', async (request) => {
      const { id } = IdParam.parse(request.params);
      const body = z.object({ url: Url.optional(), events: Events.min(1).optional(), active: z.boolean().optional() }).parse(request.body);
      return webhooks.update(request.userId, id, body);
    });

    api.delete('/api/v1/webhooks/:id', async (request) => {
      const { id } = IdParam.parse(request.params);
      await webhooks.remove(request.userId, id);
      return { ok: true };
    });

    api.post('/api/v1/webhooks/:id/test', async (request) => {
      const { id } = IdParam.parse(request.params);
      return webhooks.test(request.userId, id);
    });
  });
}
