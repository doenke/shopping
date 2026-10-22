import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { hashToken, newToken, SCOPES, type Scope } from '../auth/principal.js';
import { sessionUser } from '../auth/session.js';
import type { Config } from '../config.js';
import type { Db } from '../db/index.js';
import { apiTokens, oauthClients } from '../db/schema.js';

/**
 * A small OAuth 2.1 authorization server for MCP clients (Claude & co.):
 * dynamic client registration, authorization code + PKCE (S256), refresh
 * token rotation. The user logs in through Pocket ID as usual and confirms
 * on a consent page.
 */

const ACCESS_TTL_S = 3600;
const REFRESH_TTL_DAYS = 90;
const CODE_TTL_MS = 10 * 60_000;
const SCOPE_LABELS: Record<Scope, string> = {
  read: 'deine Listen lesen',
  write: 'Listen und Artikel ändern',
  mealie: 'Rezepte und Wochenplan aus Mealie übernehmen',
};

interface PendingCode {
  clientId: string;
  userId: string;
  redirectUri: string;
  challenge: string;
  scopes: Scope[];
  expiresAt: number;
}

function sha256url(s: string): string {
  return createHash('sha256').update(s).digest('base64url');
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** https anywhere, plain http only for local clients (e.g. a desktop app). */
function validRedirect(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.hash) return false;
    if (u.protocol === 'https:') return true;
    return u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  } catch {
    return false;
  }
}

function parseScopes(scope: string | undefined): Scope[] {
  const requested = (scope ?? '').split(/\s+/).filter((s): s is Scope => (SCOPES as readonly string[]).includes(s));
  return requested.length ? [...new Set(requested)] : [...SCOPES];
}

export async function oauthRoutes(app: FastifyInstance, { config, db }: { config: Config; db: Db }): Promise<void> {
  const base = config.PUBLIC_URL;
  const secure = base.startsWith('https://');
  const codes = new Map<string, PendingCode>();
  const sweep = setInterval(() => {
    for (const [k, v] of codes) if (v.expiresAt < Date.now()) codes.delete(k);
  }, 60_000);
  sweep.unref();
  app.addHook('onClose', async () => clearInterval(sweep));

  // OAuth endpoints speak application/x-www-form-urlencoded.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(String(body))));
  });

  // ---- discovery -------------------------------------------------------------

  const resourceMetadata = {
    resource: `${base}/mcp`,
    authorization_servers: [base],
    scopes_supported: [...SCOPES],
    bearer_methods_supported: ['header'],
    resource_name: 'Shopping',
  };
  app.get('/.well-known/oauth-protected-resource', async () => resourceMetadata);
  app.get('/.well-known/oauth-protected-resource/mcp', async () => resourceMetadata);

  const serverMetadata = {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    revocation_endpoint: `${base}/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [...SCOPES],
  };
  app.get('/.well-known/oauth-authorization-server', async () => serverMetadata);

  // ---- dynamic client registration (RFC 7591) -------------------------------

  app.post('/oauth/register', async (request, reply) => {
    const body = z
      .object({ client_name: z.string().max(100).optional(), redirect_uris: z.array(z.string()).min(1).max(10) })
      .safeParse(request.body);
    if (!body.success || !body.data.redirect_uris.every(validRedirect)) {
      return reply.code(400).send({ error: 'invalid_redirect_uri', error_description: 'redirect_uris müssen https (oder http auf localhost) sein' });
    }
    const id = `mcp_${randomBytes(16).toString('base64url')}`;
    const name = body.data.client_name?.trim() || 'KI-Assistent';
    await db.insert(oauthClients).values({ id, name, redirectUris: body.data.redirect_uris });
    return reply.code(201).send({
      client_id: id,
      client_name: name,
      redirect_uris: body.data.redirect_uris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    });
  });

  // ---- authorization ----------------------------------------------------------

  const AuthorizeQuery = z.object({
    response_type: z.literal('code'),
    client_id: z.string().min(1),
    redirect_uri: z.string(),
    code_challenge: z.string().min(43).max(128),
    code_challenge_method: z.literal('S256'),
    state: z.string().max(500).optional(),
    scope: z.string().max(200).optional(),
    resource: z.string().optional(),
  });

  async function client(id: string) {
    const [c] = await db.select().from(oauthClients).where(eq(oauthClients.id, id));
    return c;
  }

  const page = (reply: FastifyReply, status: number, title: string, body: string) =>
    reply
      .code(status)
      .type('text/html; charset=utf-8')
      .header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https: http://localhost:* http://127.0.0.1:*")
      .header('X-Frame-Options', 'DENY')
      .send(`<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} – Shopping</title><style>
body{font-family:system-ui,sans-serif;background:#f6f5f2;color:#1f2421;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:16px}
main{background:#fff;border:1px solid #dedbd4;border-radius:16px;padding:24px;max-width:420px;width:100%}
h1{font-size:1.3rem;margin-top:0}ul{padding-left:20px}button{min-height:44px;padding:0 18px;border-radius:10px;border:1px solid #dedbd4;background:#fff;font:inherit;cursor:pointer}
.primary{background:#2f7d4f;border-color:#2f7d4f;color:#fff;font-weight:600}.row{display:flex;gap:8px;justify-content:flex-end;margin-top:20px}
@media (prefers-color-scheme:dark){body{background:#141716;color:#e9ecea}main{background:#1d2120;border-color:#333a37}button{background:#262b29;color:inherit;border-color:#333a37}}
</style></head><body><main>${body}</main></body></html>`);

  const fail = (reply: FastifyReply, message: string) => page(reply, 400, 'Fehler', `<h1>Das hat nicht geklappt</h1><p>${escapeHtml(message)}</p>`);

  function redirectWith(uri: string, params: Record<string, string | undefined>): string {
    const u = new URL(uri);
    for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, v);
    return u.toString();
  }

  app.get('/oauth/authorize', async (request, reply) => {
    const q = AuthorizeQuery.safeParse(request.query);
    if (!q.success) return fail(reply, 'Unvollständige Anfrage (PKCE mit S256 ist Pflicht).');
    const c = await client(q.data.client_id);
    if (!c || !c.redirectUris.includes(q.data.redirect_uri)) return fail(reply, 'Unbekannter Client oder falsche Rücksprungadresse.');

    const principal = await sessionUser(db, request, reply, secure);
    if (!principal) {
      // Log in first (Pocket ID), then come back to this page.
      return reply.redirect(`/?next=${encodeURIComponent(request.url)}`);
    }
    if (principal.isGuest) return fail(reply, 'Gäste können keine Assistenten verbinden.');

    const csrf = randomBytes(16).toString('base64url');
    reply.setCookie('oauth_csrf', csrf, { path: '/oauth', httpOnly: true, sameSite: 'strict', secure, signed: true, maxAge: 600 });
    const scopes = parseScopes(q.data.scope);
    const hidden = Object.entries({ ...q.data, csrf })
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(String(v))}">`)
      .join('');
    return page(
      reply,
      200,
      'Zugriff erlauben',
      `<h1>${escapeHtml(c.name)} möchte auf Shopping zugreifen</h1>
<p>Erlaubt wird:</p><ul>${scopes.map((s) => `<li>${SCOPE_LABELS[s]}</li>`).join('')}</ul>
<p style="color:#69716c;font-size:.9rem">Du kannst die Verbindung jederzeit in den Einstellungen wieder trennen.</p>
<form method="post" action="/oauth/authorize">${hidden}<div class="row">
<button name="decision" value="deny">Ablehnen</button><button class="primary" name="decision" value="allow">Erlauben</button></div></form>`,
    );
  });

  app.post('/oauth/authorize', async (request, reply) => {
    const body = AuthorizeQuery.extend({ csrf: z.string(), decision: z.enum(['allow', 'deny']) }).safeParse(request.body);
    if (!body.success) return fail(reply, 'Ungültige Anfrage.');
    const cookie = request.cookies.oauth_csrf ? request.unsignCookie(request.cookies.oauth_csrf) : undefined;
    if (!cookie?.valid || cookie.value !== body.data.csrf) return fail(reply, 'Sitzung abgelaufen, bitte noch einmal versuchen.');
    reply.clearCookie('oauth_csrf', { path: '/oauth' });
    const c = await client(body.data.client_id);
    if (!c || !c.redirectUris.includes(body.data.redirect_uri)) return fail(reply, 'Unbekannter Client.');
    const principal = await sessionUser(db, request, reply, secure);
    if (!principal || principal.isGuest) return fail(reply, 'Nicht angemeldet.');

    if (body.data.decision === 'deny') {
      return reply.redirect(redirectWith(body.data.redirect_uri, { error: 'access_denied', state: body.data.state }));
    }
    const code = randomBytes(32).toString('base64url');
    codes.set(code, {
      clientId: c.id,
      userId: principal.userId,
      redirectUri: body.data.redirect_uri,
      challenge: body.data.code_challenge,
      scopes: parseScopes(body.data.scope),
      expiresAt: Date.now() + CODE_TTL_MS,
    });
    return reply.redirect(redirectWith(body.data.redirect_uri, { code, state: body.data.state, iss: base }));
  });

  // ---- tokens -------------------------------------------------------------------

  const tokenError = (reply: FastifyReply, error: string, description: string) =>
    reply.code(400).header('Cache-Control', 'no-store').send({ error, error_description: description });

  async function issue(reply: FastifyReply, values: { userId: string; clientId: string; name: string; scopes: Scope[] }, replaceId?: string) {
    const access = newToken();
    const refresh = `shr_${randomBytes(32).toString('base64url')}`;
    const row = {
      tokenHash: hashToken(access),
      prefix: access.slice(0, 10),
      refreshHash: hashToken(refresh),
      expiresAt: new Date(Date.now() + ACCESS_TTL_S * 1000),
      refreshExpiresAt: new Date(Date.now() + REFRESH_TTL_DAYS * 86_400_000),
    };
    if (replaceId) await db.update(apiTokens).set(row).where(eq(apiTokens.id, replaceId));
    else await db.insert(apiTokens).values({ ...row, userId: values.userId, kind: 'oauth', clientId: values.clientId, name: values.name, scopes: values.scopes });
    return reply.header('Cache-Control', 'no-store').send({
      access_token: access,
      token_type: 'Bearer',
      expires_in: ACCESS_TTL_S,
      refresh_token: refresh,
      scope: values.scopes.join(' '),
    });
  }

  app.post('/oauth/token', async (request: FastifyRequest, reply) => {
    const body = (request.body ?? {}) as Record<string, string | undefined>;
    if (body.grant_type === 'authorization_code') {
      const pending = body.code ? codes.get(body.code) : undefined;
      if (body.code) codes.delete(body.code); // single use
      if (!pending || pending.expiresAt < Date.now()) return tokenError(reply, 'invalid_grant', 'Code ungültig oder abgelaufen');
      if (pending.clientId !== body.client_id || pending.redirectUri !== body.redirect_uri) return tokenError(reply, 'invalid_grant', 'Client passt nicht');
      if (!body.code_verifier || sha256url(body.code_verifier) !== pending.challenge) return tokenError(reply, 'invalid_grant', 'PKCE-Prüfung fehlgeschlagen');
      const c = await client(pending.clientId);
      return issue(reply, { userId: pending.userId, clientId: pending.clientId, name: c?.name ?? 'KI-Assistent', scopes: pending.scopes });
    }
    if (body.grant_type === 'refresh_token') {
      if (!body.refresh_token) return tokenError(reply, 'invalid_request', 'refresh_token fehlt');
      const [row] = await db
        .select()
        .from(apiTokens)
        .where(
          and(
            eq(apiTokens.refreshHash, hashToken(body.refresh_token)),
            isNull(apiTokens.revokedAt),
            gt(apiTokens.refreshExpiresAt, new Date()),
          ),
        );
      if (!row || (body.client_id && row.clientId !== body.client_id)) return tokenError(reply, 'invalid_grant', 'Refresh-Token ungültig');
      // Rotation: the old refresh token stops working.
      return issue(reply, { userId: row.userId, clientId: row.clientId!, name: row.name, scopes: row.scopes as Scope[] }, row.id);
    }
    return tokenError(reply, 'unsupported_grant_type', 'Nur authorization_code und refresh_token');
  });

  app.post('/oauth/revoke', async (request, reply) => {
    const token = ((request.body ?? {}) as Record<string, string | undefined>).token;
    if (token) {
      const h = hashToken(token);
      await db.update(apiTokens).set({ revokedAt: new Date() }).where(eq(apiTokens.tokenHash, h));
      await db.update(apiTokens).set({ revokedAt: new Date() }).where(eq(apiTokens.refreshHash, h));
    }
    return reply.code(200).send({});
  });
}
