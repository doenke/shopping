import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull, or } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../db/index.js';
import { apiTokens, users } from '../db/schema.js';
import { sessionUser } from './session.js';

export const SCOPES = ['read', 'write', 'mealie'] as const;
export type Scope = (typeof SCOPES)[number];

export interface Principal {
  userId: string;
  isGuest: boolean;
  via: 'session' | 'token';
  /** Granted scopes; a browser session has all of them. */
  scopes: ReadonlySet<Scope>;
  tokenId?: string;
}

export const TOKEN_PREFIX = 'shp_';

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newToken(): string {
  return `${TOKEN_PREFIX}${randomBytes(30).toString('base64url')}`;
}

const ALL_SCOPES: ReadonlySet<Scope> = new Set(SCOPES);
const LAST_USED_GRANULARITY_MS = 5 * 60_000;

async function tokenPrincipal(db: Db, token: string): Promise<Principal | null> {
  const now = new Date();
  const [row] = await db
    .select({ id: apiTokens.id, userId: apiTokens.userId, scopes: apiTokens.scopes, lastUsedAt: apiTokens.lastUsedAt, isGuest: users.isGuest })
    .from(apiTokens)
    .innerJoin(users, eq(users.id, apiTokens.userId))
    .where(
      and(
        eq(apiTokens.tokenHash, hashToken(token)),
        isNull(apiTokens.revokedAt),
        or(isNull(apiTokens.expiresAt), gt(apiTokens.expiresAt, now)),
      ),
    );
  if (!row || row.isGuest) return null;
  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > LAST_USED_GRANULARITY_MS) {
    await db.update(apiTokens).set({ lastUsedAt: now }).where(eq(apiTokens.id, row.id));
  }
  return {
    userId: row.userId,
    isGuest: false,
    via: 'token',
    scopes: new Set(row.scopes.filter((s): s is Scope => (SCOPES as readonly string[]).includes(s))),
    tokenId: row.id,
  };
}

/** Bearer token (API/OAuth) or the browser's session cookie. */
export async function resolvePrincipal(db: Db, request: FastifyRequest, reply: FastifyReply, secure: boolean): Promise<Principal | null> {
  const auth = request.headers.authorization;
  if (auth?.startsWith('Bearer ')) return tokenPrincipal(db, auth.slice(7).trim());
  const session = await sessionUser(db, request, reply, secure);
  return session ? { ...session, via: 'session', scopes: ALL_SCOPES } : null;
}

/** Which scope a request needs: Mealie features need "mealie", reads "read", everything else "write". */
export function requiredScope(request: FastifyRequest): Scope {
  if (request.url.startsWith('/api/v1/integrations/mealie') || /\/import\/mealie/.test(request.url)) return 'mealie';
  return request.method === 'GET' || request.method === 'HEAD' ? 'read' : 'write';
}
