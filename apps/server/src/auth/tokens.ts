import { and, desc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ApiError } from '../api/errors.js';
import type { Db } from '../db/index.js';
import { apiTokens } from '../db/schema.js';
import { hashToken, newToken, SCOPES } from './principal.js';

interface Options {
  db: Db;
  requireAccount: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
}

/** Personal API tokens (Home Assistant, scripts) – managed in the app only, never by a token itself. */
export async function tokenRoutes(app: FastifyInstance, { db, requireAccount }: Options): Promise<void> {
  const sessionOnly = async (request: FastifyRequest, reply: FastifyReply) => {
    await requireAccount(request, reply);
    if (request.principal.via !== 'session') throw new ApiError(403, 'session_required', 'Tokens lassen sich nur in der App verwalten');
  };

  app.get('/api/v1/tokens', { preHandler: sessionOnly }, async (request) => {
    const rows = await db
      .select()
      .from(apiTokens)
      .where(and(eq(apiTokens.userId, request.userId), isNull(apiTokens.revokedAt)))
      .orderBy(desc(apiTokens.createdAt));
    return rows
      .filter((r) => r.kind === 'pat' || !r.refreshExpiresAt || r.refreshExpiresAt > new Date())
      .map((r) => ({
        id: r.id,
        name: r.name,
        kind: r.kind,
        prefix: r.prefix,
        scopes: r.scopes,
        createdAt: r.createdAt,
        lastUsedAt: r.lastUsedAt,
        expiresAt: r.kind === 'pat' ? r.expiresAt : r.refreshExpiresAt,
      }));
  });

  app.post('/api/v1/tokens', { preHandler: sessionOnly }, async (request) => {
    const body = z
      .object({
        name: z.string().trim().min(1).max(60),
        scopes: z.array(z.enum(SCOPES)).min(1),
        expiresInDays: z.number().int().positive().max(3650).optional(),
      })
      .parse(request.body);
    const token = newToken();
    const [row] = await db
      .insert(apiTokens)
      .values({
        userId: request.userId,
        name: body.name,
        kind: 'pat',
        tokenHash: hashToken(token),
        prefix: token.slice(0, 10),
        scopes: [...new Set(body.scopes)],
        expiresAt: body.expiresInDays ? new Date(Date.now() + body.expiresInDays * 86_400_000) : null,
      })
      .returning();
    // The token itself is shown exactly once.
    return { id: row!.id, name: row!.name, scopes: row!.scopes, token };
  });

  app.delete('/api/v1/tokens/:id', { preHandler: sessionOnly }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const updated = await db
      .update(apiTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiTokens.id, id), eq(apiTokens.userId, request.userId), isNull(apiTokens.revokedAt)))
      .returning({ id: apiTokens.id });
    if (!updated.length) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  });
}
