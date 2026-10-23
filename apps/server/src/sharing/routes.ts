import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { avatarPath } from '../auth/avatar.js';
import { createSession, destroyUserSessions, sessionUser } from '../auth/session.js';
import type { Config } from '../config.js';
import type { SecretBox } from '../crypto.js';
import type { Db } from '../db/index.js';
import { listMembers, lists, shareLinks, users } from '../db/schema.js';
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
  requireAccount: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
}

/**
 * Sharing by link: whoever opens a list's link becomes a member – with a
 * Pocket ID account for good, without one as a guest of just that list.
 * There are no roles; only the owner can renew the link, remove members and delete the list.
 */
export async function sharingRoutes(app: FastifyInstance, opts: Options): Promise<void> {
  const { config, db, sync, hub, secrets, requireUser, requireAccount } = opts;
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

  async function listForToken(token: string): Promise<string | undefined> {
    const [link] = await db.select({ listId: shareLinks.listId }).from(shareLinks).where(eq(shareLinks.tokenHash, hash(token)));
    return link?.listId;
  }

  async function isOwner(listId: string, userId: string): Promise<boolean> {
    const [list] = await db.select({ ownerId: lists.ownerId }).from(lists).where(eq(lists.id, listId));
    return list?.ownerId === userId;
  }

  /** Removes a member; guests also lose their session (they have nothing else). */
  async function remove(listId: string, userId: string): Promise<void> {
    await sync.leave(userId, listId);
    const [u] = await db.select({ isGuest: users.isGuest }).from(users).where(eq(users.id, userId));
    if (u?.isGuest) await destroyUserSessions(db, userId);
    hub.notify([userId]);
  }

  const listParams = z.object({ id: z.string().uuid() });
  const tokenSchema = z.string().min(10).max(100);

  app.get('/api/v1/lists/:id/share-link', { preHandler: requireUser }, async (request, reply) => {
    const { id } = listParams.parse(request.params);
    if (!(await sync.isMember(request.userId, id))) return reply.code(404).send({ error: 'not_found' });
    const [existing] = await db.select().from(shareLinks).where(eq(shareLinks.listId, id));
    const token = existing ? secrets.open(existing.tokenSealed) : await issue(id, request.userId);
    return { url: linkUrl(token) };
  });

  // Renewing kills the old link; members with an account stay, guests of the old link are out.
  app.post('/api/v1/lists/:id/share-link/renew', { preHandler: requireAccount }, async (request, reply) => {
    const { id } = listParams.parse(request.params);
    if (!(await isOwner(id, request.userId))) return reply.code(403).send({ error: 'owner_only' });
    const url = linkUrl(await issue(id, request.userId));
    const guests = await db
      .select({ userId: listMembers.userId })
      .from(listMembers)
      .innerJoin(users, eq(users.id, listMembers.userId))
      .where(and(eq(listMembers.listId, id), eq(listMembers.removed, false), eq(users.isGuest, true)));
    for (const g of guests) await remove(id, g.userId);
    return { url, guestsRemoved: guests.length };
  });

  app.get('/api/v1/lists/:id/members', { preHandler: requireUser }, async (request, reply) => {
    const { id } = listParams.parse(request.params);
    if (!(await sync.isMember(request.userId, id))) return reply.code(404).send({ error: 'not_found' });
    const [list] = await db.select({ ownerId: lists.ownerId }).from(lists).where(eq(lists.id, id));
    const rows = await db
      .select({ id: users.id, displayName: users.displayName, avatarVersion: users.avatarVersion, isGuest: users.isGuest, joinedAt: listMembers.joinedAt })
      .from(listMembers)
      .innerJoin(users, eq(users.id, listMembers.userId))
      .where(and(eq(listMembers.listId, id), eq(listMembers.removed, false)))
      .orderBy(listMembers.joinedAt);
    return rows.map(({ avatarVersion, ...r }) => ({ ...r, avatarUrl: avatarPath(r.id, avatarVersion), isOwner: r.id === list?.ownerId }));
  });

  app.delete('/api/v1/lists/:id/members/:userId', { preHandler: requireAccount }, async (request, reply) => {
    const { id, userId } = z.object({ id: z.string().uuid(), userId: z.string().uuid() }).parse(request.params);
    if (!(await isOwner(id, request.userId))) return reply.code(403).send({ error: 'owner_only' });
    if (userId === request.userId) return reply.code(409).send({ error: 'owner_cannot_leave' });
    await remove(id, userId);
    return { ok: true };
  });

  app.post('/api/v1/lists/:id/leave', { preHandler: requireUser }, async (request, reply) => {
    const { id } = listParams.parse(request.params);
    const result = await sync.leave(request.userId, id);
    if (result === 'owner') return reply.code(409).send({ error: 'owner_cannot_leave' });
    hub.notify([request.userId]);
    return { ok: result === 'ok' };
  });

  app.get('/s/:token', async (request, reply) => {
    const { token } = z.object({ token: tokenSchema }).parse(request.params);
    const listId = await listForToken(token);
    if (!listId) return reply.redirect('/?join=invalid');
    const principal = await sessionUser(db, request, reply, secure);
    // Not logged in: log in (or continue as guest), then come back here.
    if (!principal) return reply.redirect(`/?next=${encodeURIComponent(`/s/${token}`)}`);
    if (principal.isGuest && !(await sync.isMember(principal.userId, listId))) {
      // A guest of another list: guests only ever belong to one list.
      return reply.redirect(`/?next=${encodeURIComponent(`/s/${token}`)}`);
    }
    if (!(await sync.join(principal.userId, listId))) return reply.redirect('/?join=invalid');
    hub.notify([principal.userId]);
    return reply.redirect(`/#/list/${listId}`);
  });

  /** Continue without an account: a guest user that only belongs to this list. */
  app.post('/auth/guest', async (request, reply) => {
    const { token, name } = z.object({ token: tokenSchema, name: z.string().trim().min(1).max(40) }).parse(request.body);
    const listId = await listForToken(token);
    if (!listId) return reply.code(404).send({ error: 'invalid_link' });
    const id = randomUUID();
    await db.insert(users).values({ id, oidcSubject: `guest:${id}`, displayName: name, isGuest: true });
    if (!(await sync.join(id, listId))) return reply.code(404).send({ error: 'invalid_link' });
    await sync.setDefaultList(id, listId);
    await createSession(db, id, reply, secure);
    hub.notify([id]);
    return { ok: true, listId };
  });
}
