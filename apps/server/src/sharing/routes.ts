import { createHash, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { sessionUser } from '../auth/session.js';
import type { Config } from '../config.js';
import type { SecretBox } from '../crypto.js';
import type { Db } from '../db/index.js';
import { lists, shareLinks } from '../db/schema.js';
import type { SyncHub } from '../sync/hub.js';
import type { SyncService } from '../sync/service.js';

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

interface Options {
  config: Config;
  db: Db;
  sync: SyncService;
  hub: SyncHub;
  secrets: SecretBox;
  requireUser: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
}

/**
 * Sharing by link: everybody who opens a list's link while logged in becomes a member.
 * There are no roles – members can do everything except deleting the list.
 */
export async function sharingRoutes(app: FastifyInstance, opts: Options): Promise<void> {
  const { config, db, sync, hub, secrets, requireUser } = opts;
  const secure = config.PUBLIC_URL.startsWith('https://');
  const linkUrl = (token: string) => `${config.PUBLIC_URL}/s/${token}`;

  async function issue(listId: string, userId: string): Promise<string> {
    const token = randomBytes(24).toString('base64url');
    await db
      .insert(shareLinks)
      .values({ listId, tokenHash: hash(token), tokenSealed: secrets.seal(token), createdBy: userId })
      .onConflictDoUpdate({
        target: shareLinks.listId,
        set: { tokenHash: hash(token), tokenSealed: secrets.seal(token), createdBy: userId, createdAt: new Date() },
      });
    return token;
  }

  const listParams = z.object({ id: z.string().uuid() });

  app.get('/api/v1/lists/:id/share-link', { preHandler: requireUser }, async (request, reply) => {
    const { id } = listParams.parse(request.params);
    if (!(await sync.isMember(request.userId, id))) return reply.code(404).send({ error: 'not_found' });
    const [existing] = await db.select().from(shareLinks).where(eq(shareLinks.listId, id));
    const token = existing ? secrets.open(existing.tokenSealed) : await issue(id, request.userId);
    return { url: linkUrl(token) };
  });

  app.post('/api/v1/lists/:id/share-link/renew', { preHandler: requireUser }, async (request, reply) => {
    const { id } = listParams.parse(request.params);
    const [list] = await db.select({ ownerId: lists.ownerId }).from(lists).where(eq(lists.id, id));
    if (!list || list.ownerId !== request.userId) return reply.code(403).send({ error: 'owner_only' });
    return { url: linkUrl(await issue(id, request.userId)) };
  });

  app.post('/api/v1/lists/:id/leave', { preHandler: requireUser }, async (request, reply) => {
    const { id } = listParams.parse(request.params);
    const result = await sync.leave(request.userId, id);
    if (result === 'owner') return reply.code(409).send({ error: 'owner_cannot_leave' });
    hub.notify([request.userId]);
    return { ok: result === 'ok' };
  });

  app.get('/s/:token', async (request, reply) => {
    const { token } = z.object({ token: z.string().min(10).max(100) }).parse(request.params);
    const [link] = await db.select({ listId: shareLinks.listId }).from(shareLinks).where(eq(shareLinks.tokenHash, hash(token)));
    if (!link) return reply.redirect('/?join=invalid');
    const userId = await sessionUser(db, request, reply, secure);
    // Not logged in: log in first, then come back here.
    if (!userId) return reply.redirect(`/?next=${encodeURIComponent(`/s/${token}`)}`);
    if (!(await sync.join(userId, link.listId))) return reply.redirect('/?join=invalid');
    hub.notify([userId]);
    return reply.redirect(`/#/list/${link.listId}`);
  });
}
