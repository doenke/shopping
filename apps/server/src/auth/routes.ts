import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import * as oidc from 'openid-client';
import { z } from 'zod';
import type { Config } from '../config.js';
import type { Db } from '../db/index.js';
import { users } from '../db/schema.js';
import type { AvatarService } from './avatar.js';
import { createSession, destroySession } from './session.js';

const FLOW_COOKIE = 'oidc_flow';

/** Only local paths are allowed as return target (no open redirects). */
export function safeNext(next: unknown): string {
  if (typeof next !== 'string') return '/';
  // A list link, or the OAuth consent page of an MCP client.
  if (/^\/s\/[A-Za-z0-9_-]{10,100}$/.test(next)) return next;
  if (/^\/oauth\/authorize\?[^\s\\]*$/.test(next) && next.length < 3000) return next;
  return '/';
}

interface Profile {
  subject: string;
  email: string | null;
  displayName: string;
  avatarUrl: string | null;
  isAdmin: boolean;
}

export async function upsertUser(db: Db, p: Profile): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({ id: randomUUID(), oidcSubject: p.subject, email: p.email, displayName: p.displayName, avatarUrl: p.avatarUrl, isAdmin: p.isAdmin })
    .onConflictDoUpdate({
      target: users.oidcSubject,
      set: { email: p.email, displayName: p.displayName, avatarUrl: p.avatarUrl, isAdmin: p.isAdmin },
    })
    .returning({ id: users.id });
  return row!.id;
}

export async function authRoutes(app: FastifyInstance, opts: { config: Config; db: Db; avatars: AvatarService }): Promise<void> {
  const { config, db, avatars } = opts;
  const secure = config.PUBLIC_URL.startsWith('https://');
  const redirectUri = `${config.PUBLIC_URL}/auth/callback`;

  let discovered: Promise<oidc.Configuration> | undefined;
  const oidcConfig = () => {
    if (!config.OIDC_ISSUER || !config.OIDC_CLIENT_ID) throw new Error('OIDC ist nicht konfiguriert');
    discovered ??= oidc
      .discovery(
        new URL(config.OIDC_ISSUER),
        config.OIDC_CLIENT_ID,
        config.OIDC_CLIENT_SECRET,
        config.OIDC_CLIENT_SECRET ? undefined : oidc.None(),
        config.OIDC_ISSUER.startsWith('http://') ? { execute: [oidc.allowInsecureRequests] } : undefined,
      )
      .catch((err) => {
        discovered = undefined;
        throw err;
      });
    return discovered;
  };

  app.get('/auth/config', async () => ({ oidc: !!config.OIDC_ISSUER, devLogin: config.DEV_LOGIN }));

  app.get('/auth/login', async (request, reply) => {
    const next = safeNext((request.query as Record<string, unknown>).next);
    const cfg = await oidcConfig();
    const verifier = oidc.randomPKCECodeVerifier();
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const url = oidc.buildAuthorizationUrl(cfg, {
      redirect_uri: redirectUri,
      scope: 'openid profile email groups',
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
      code_challenge_method: 'S256',
      state,
      nonce,
    });
    reply.setCookie(FLOW_COOKIE, JSON.stringify({ verifier, state, nonce, next }), {
      path: '/auth',
      httpOnly: true,
      sameSite: 'lax',
      secure,
      signed: true,
      maxAge: 600,
    });
    return reply.redirect(url.href);
  });

  app.get('/auth/callback', async (request, reply) => {
    const raw = request.cookies[FLOW_COOKIE];
    const unsigned = raw ? request.unsignCookie(raw) : undefined;
    if (!unsigned?.valid || !unsigned.value) return reply.redirect('/?login=expired');
    const flow = JSON.parse(unsigned.value) as { verifier: string; state: string; nonce: string; next?: string };
    reply.clearCookie(FLOW_COOKIE, { path: '/auth' });

    const cfg = await oidcConfig();
    const current = new URL(request.url, config.PUBLIC_URL);
    let tokens;
    try {
      tokens = await oidc.authorizationCodeGrant(cfg, current, {
        pkceCodeVerifier: flow.verifier,
        expectedState: flow.state,
        expectedNonce: flow.nonce,
      });
    } catch (err) {
      request.log.warn({ err }, 'OIDC callback failed');
      return reply.redirect('/?login=failed');
    }
    let claims: Record<string, unknown> = { ...tokens.claims() };
    if (!claims.groups || !claims.email) {
      const info = await oidc.fetchUserInfo(cfg, tokens.access_token, String(claims.sub)).catch(() => ({}));
      claims = { ...info, ...claims };
    }
    const groups = Array.isArray(claims.groups) ? claims.groups.map(String) : [];
    const picture = typeof claims.picture === 'string' ? claims.picture : null;
    const userId = await upsertUser(db, {
      subject: String(claims.sub),
      email: typeof claims.email === 'string' ? claims.email : null,
      displayName: String(claims.name ?? claims.preferred_username ?? claims.email ?? 'Unbekannt'),
      avatarUrl: picture,
      isAdmin: groups.includes(config.OIDC_ADMIN_GROUP),
    });
    // In the background: the login does not wait for the picture.
    void avatars.refresh(userId, picture, tokens.access_token);
    await createSession(db, userId, reply, secure);
    return reply.redirect(safeNext(flow.next));
  });

  if (config.DEV_LOGIN) {
    app.log.warn('DEV_LOGIN ist aktiv – Anmeldung ohne Passwort möglich. Nur für die lokale Entwicklung!');
    app.post('/auth/dev', async (request, reply) => {
      const { name } = z.object({ name: z.string().trim().min(1).max(40) }).parse(request.body);
      const userId = await upsertUser(db, {
        subject: `dev:${name.toLowerCase()}`,
        email: null,
        displayName: name,
        avatarUrl: null,
        isAdmin: false,
      });
      await createSession(db, userId, reply, secure);
      return { ok: true };
    });
  }

  app.post('/auth/logout', async (request, reply) => {
    await destroySession(db, request, reply);
    return { ok: true };
  });
}
