import { createHash, randomBytes } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './helpers.js';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;
let t: TestApp;
let cookie: string;
let base: string;

beforeAll(async () => {
  t = await createTestApp();
  cookie = (await t.login('Anna')).cookie;
  base = await t.app.listen({ port: 0, host: '127.0.0.1' });
});
afterAll(async () => t?.close());

async function mcpClient(token: string) {
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  return client;
}

const textOf = (r: unknown) => ((r as { content: { text: string }[] }).content[0]?.text ?? '');

describe('OAuth for MCP clients', () => {
  let accessToken: string;
  let refreshToken: string;
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const redirect = 'https://claude.ai/api/mcp/auth_callback';

  it('advertises itself via well-known metadata and 401', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/mcp', payload: {} });
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toContain('resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource"');
    const pr = (await t.app.inject({ method: 'GET', url: '/.well-known/oauth-protected-resource' })).json();
    expect(pr.authorization_servers).toEqual(['http://localhost:3000']);
    const as = (await t.app.inject({ method: 'GET', url: '/.well-known/oauth-authorization-server' })).json();
    expect(as).toMatchObject({ registration_endpoint: 'http://localhost:3000/oauth/register', code_challenge_methods_supported: ['S256'] });
  });

  it('runs registration, consent, code exchange and refresh', async () => {
    const reg = await t.app.inject({ method: 'POST', url: '/oauth/register', payload: { client_name: 'Claude', redirect_uris: [redirect] } });
    expect(reg.statusCode).toBe(201);
    const clientId = reg.json().client_id;
    expect((await t.app.inject({ method: 'POST', url: '/oauth/register', payload: { redirect_uris: ['http://evil.example/cb'] } })).statusCode).toBe(400);

    const q = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirect,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 'xyz',
      scope: 'read write',
    });
    const anon = await t.app.inject({ method: 'GET', url: `/oauth/authorize?${q}` });
    expect(anon.statusCode).toBe(302);
    expect(anon.headers.location).toBe(`/?next=${encodeURIComponent(`/oauth/authorize?${q}`)}`);

    const consent = await t.app.inject({ method: 'GET', url: `/oauth/authorize?${q}`, headers: { cookie } });
    expect(consent.body).toContain('Claude möchte auf Shopping zugreifen');
    expect(consent.body).not.toContain('Mealie');
    const csrfCookie = consent.cookies.find((c) => c.name === 'oauth_csrf')!;
    const fields = Object.fromEntries([...consent.body.matchAll(/name="(\w+)" value="([^"]*)"/g)].map((m) => [m[1], m[2]]));

    const approve = await t.app.inject({
      method: 'POST',
      url: '/oauth/authorize',
      headers: { cookie: `${cookie}; oauth_csrf=${csrfCookie.value}`, 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({ ...fields, decision: 'allow' }).toString(),
    });
    expect(approve.statusCode).toBe(302);
    const back = new URL(approve.headers.location as string);
    expect(back.origin + back.pathname).toBe(redirect);
    expect(back.searchParams.get('state')).toBe('xyz');
    const code = back.searchParams.get('code')!;

    const form = (o: Record<string, string>) => ({
      method: 'POST' as const,
      url: '/oauth/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams(o).toString(),
    });
    const wrong = await t.app.inject(form({ grant_type: 'authorization_code', code, client_id: clientId, redirect_uri: redirect, code_verifier: 'falsch-falsch-falsch-falsch-falsch-falsch-1' }));
    expect(wrong.json().error).toBe('invalid_grant');
    // A code is single-use, so get a fresh one.
    const again = await t.app.inject({
      method: 'POST',
      url: '/oauth/authorize',
      headers: { cookie: `${cookie}; oauth_csrf=${csrfCookie.value}`, 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({ ...fields, decision: 'allow' }).toString(),
    });
    const code2 = new URL(again.headers.location as string).searchParams.get('code')!;
    const tok = await t.app.inject(form({ grant_type: 'authorization_code', code: code2, client_id: clientId, redirect_uri: redirect, code_verifier: verifier }));
    expect(tok.json()).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'read write' });
    accessToken = tok.json().access_token;
    refreshToken = tok.json().refresh_token;

    const refreshed = await t.app.inject(form({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId }));
    expect(refreshed.json().access_token).not.toBe(accessToken);
    expect((await t.app.inject(form({ grant_type: 'refresh_token', refresh_token: refreshToken }))).json().error).toBe('invalid_grant');
    accessToken = refreshed.json().access_token;

    const list = await t.app.inject({ method: 'GET', url: '/api/v1/tokens', headers: { cookie } });
    expect(list.json().find((x: { kind: string }) => x.kind === 'oauth')).toMatchObject({ name: 'Claude', scopes: ['read', 'write'] });
  });

  it('serves MCP with the OAuth token, but without Mealie scope', async () => {
    const client = await mcpClient(accessToken);
    await client.callTool({ name: 'create_list', arguments: { name: 'Einkauf' } });
    const r = await client.callTool({ name: 'search_mealie_recipes', arguments: { query: 'chili' } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('mealie');
    await client.close();
  });
});

describe('MCP tools', () => {
  let client: Client;

  beforeAll(async () => {
    const token = (await t.app.inject({ method: 'POST', url: '/api/v1/tokens', headers: { cookie }, payload: { name: 'mcp', scopes: ['read', 'write'] } })).json().token;
    client = await mcpClient(token);
  });
  afterAll(async () => client?.close());

  it('lists its tools', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((x) => x.name)).toEqual(
      expect.arrayContaining(['list_lists', 'get_list', 'add_items', 'check_items', 'remove_items', 'apply_template', 'import_mealie_recipe']),
    );
  });

  it('adds, reads and checks items by name', async () => {
    const add = await client.callTool({ name: 'add_items', arguments: { items: ['2 l Milch laktosefrei', '500g Hack gemischt bio', 'Milch 1l laktosefrei'] } });
    expect(textOf(add)).toContain('Hackfleisch – 500 g · gemischt · bio (neu)');
    const list = textOf(await client.callTool({ name: 'get_list', arguments: {} }));
    expect(list).toContain('# Einkauf (Hauptliste)');
    expect(list).toContain('## Milch & Käse\n- Milch – 3 l · laktosefrei');
    const check = await client.callTool({ name: 'check_items', arguments: { items: ['milch'] } });
    expect(textOf(check)).toBe('Abgehakt: Milch');
    expect(textOf(await client.callTool({ name: 'get_history', arguments: {} }))).toContain('- Milch');
  });

  it('reports ambiguity and unknown things as tool errors', async () => {
    const r = await client.callTool({ name: 'check_items', arguments: { items: ['Einhorn'] } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('nicht gefunden');
  });

  it('exposes lists as resources and offers a prompt', async () => {
    const { resources } = await client.listResources();
    expect(resources[0]?.uri).toMatch(/^shopping:\/\/lists\//);
    const res = await client.readResource({ uri: resources[0]!.uri });
    expect((res.contents[0] as { text: string }).text).toContain('Hackfleisch');
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name)).toContain('wocheneinkauf');
  });
});
