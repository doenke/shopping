import { createHash } from 'node:crypto';
import { and, eq, lt, sql } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../db/index.js';
import { idempotencyKeys } from '../db/schema.js';
import { ApiError } from './errors.js';

const TTL_HOURS = 24;

/**
 * `Idempotency-Key` for writing API calls: a script that retries after a
 * timeout (bad network) gets the first answer again instead of adding twice.
 */
export async function withIdempotency(db: Db, request: FastifyRequest, reply: FastifyReply, run: () => Promise<unknown>): Promise<unknown> {
  const key = request.headers['idempotency-key'];
  if (typeof key !== 'string' || request.method === 'GET') return run();
  if (!/^[\w.:-]{1,200}$/.test(key)) throw new ApiError(400, 'invalid_idempotency_key', 'Idempotency-Key: 1–200 Zeichen aus Buchstaben, Ziffern, ._:-');
  const userId = request.userId;
  const requestHash = createHash('sha256')
    .update(`${request.method} ${request.url.split('?')[0]} ${JSON.stringify(request.body ?? null)}`)
    .digest('hex');

  // Now and then: forget old keys.
  if (Math.random() < 0.05) await db.delete(idempotencyKeys).where(lt(idempotencyKeys.createdAt, sql`now() - interval '${sql.raw(String(TTL_HOURS))} hours'`));

  const inserted = await db.insert(idempotencyKeys).values({ userId, key, requestHash }).onConflictDoNothing().returning({ key: idempotencyKeys.key });
  if (!inserted.length) {
    const [prev] = await db.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key)));
    if (prev && prev.requestHash !== requestHash) {
      throw new ApiError(422, 'idempotency_key_reused', 'Dieser Idempotency-Key wurde schon für eine andere Anfrage benutzt');
    }
    if (!prev || prev.status === null) throw new ApiError(409, 'idempotency_in_progress', 'Die erste Anfrage mit diesem Idempotency-Key läuft noch');
    reply.header('Idempotent-Replayed', 'true');
    return reply.code(prev.status).send(prev.response);
  }
  try {
    const result = await run();
    await db
      .update(idempotencyKeys)
      .set({ status: reply.statusCode || 200, response: (result ?? null) as object })
      .where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key)));
    return result;
  } catch (err) {
    // Failed requests may be retried with the same key.
    await db.delete(idempotencyKeys).where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key)));
    throw err;
  }
}
