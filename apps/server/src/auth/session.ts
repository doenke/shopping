import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, lt } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../db/index.js';
import { sessions, users } from '../db/schema.js';

export const SESSION_COOKIE = 'sid';
const SESSION_DAYS = 90;
const DAY = 24 * 60 * 60 * 1000;

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(db: Db, userId: string, reply: FastifyReply, secure: boolean): Promise<void> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * DAY);
  await db.insert(sessions).values({ idHash: hash(token), userId, expiresAt });
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure,
    expires: expiresAt,
  });
}

export interface Principal {
  userId: string;
  isGuest: boolean;
}

/** Resolves the session cookie to a user and slides the expiry once a day. */
export async function sessionUser(db: Db, request: FastifyRequest, reply?: FastifyReply, secure = true): Promise<Principal | null> {
  const token = request.cookies[SESSION_COOKIE];
  if (!token) return null;
  const idHash = hash(token);
  const [row] = await db
    .select({ userId: sessions.userId, expiresAt: sessions.expiresAt, isGuest: users.isGuest })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.idHash, idHash), gt(sessions.expiresAt, new Date())));
  if (!row) return null;
  const remaining = row.expiresAt.getTime() - Date.now();
  if (reply && remaining < (SESSION_DAYS - 1) * DAY) {
    const expiresAt = new Date(Date.now() + SESSION_DAYS * DAY);
    await db.update(sessions).set({ expiresAt }).where(eq(sessions.idHash, idHash));
    reply.setCookie(SESSION_COOKIE, token, { path: '/', httpOnly: true, sameSite: 'lax', secure, expires: expiresAt });
  }
  return { userId: row.userId, isGuest: row.isGuest };
}

/** Ends all sessions of a user (e.g. a guest whose link was renewed). */
export async function destroyUserSessions(db: Db, userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

export async function destroySession(db: Db, request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = request.cookies[SESSION_COOKIE];
  if (token) await db.delete(sessions).where(eq(sessions.idHash, hash(token)));
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

export async function purgeExpiredSessions(db: Db): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}
