import { useEffect, useState } from 'react';

interface Token {
  id: string;
  name: string;
  kind: 'pat' | 'oauth';
  prefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
}

const SCOPES: [string, string][] = [
  ['read', 'Lesen'],
  ['write', 'Ändern'],
  ['mealie', 'Mealie-Import'],
];

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = init?.body ? { 'content-type': 'application/json' } : undefined;
  const res = await fetch(path, { ...init, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { detail?: string }).detail ?? `HTTP ${res.status}`);
  return body as T;
}

const date = (s: string | null) => (s ? new Date(s).toLocaleDateString('de-DE') : 'nie');

/** Personal API tokens for Home Assistant, n8n & co., plus connected AI assistants (MCP). */
export function TokensCard() {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [name, setName] = useState('Home Assistant');
  const [scopes, setScopes] = useState<string[]>(['read', 'write']);
  const [fresh, setFresh] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => api<Token[]>('/api/v1/tokens').then(setTokens, (e: Error) => setError(e.message));
  useEffect(() => void load(), []);

  const create = async () => {
    try {
      const res = await api<{ token: string }>('/api/v1/tokens', { method: 'POST', body: JSON.stringify({ name, scopes }) });
      setFresh(res.token);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const revoke = async (t: Token) => {
    if (!confirm(`„${t.name}“ widerrufen? Was dieses Token nutzt, verliert sofort den Zugriff.`)) return;
    await api(`/api/v1/tokens/${t.id}`, { method: 'DELETE' }).catch(() => undefined);
    await load();
  };

  const pats = tokens.filter((t) => t.kind === 'pat');
  const assistants = tokens.filter((t) => t.kind === 'oauth');

  return (
    <div className="card">
      <h2>API &amp; Integrationen</h2>
      <p className="muted">
        Tokens für Home Assistant, n8n oder Skripte. Sie sehen dieselben Listen wie du. <a href="/api/docs">API-Dokumentation</a>
      </p>
      {error && <p className="error">{error}</p>}

      {fresh && (
        <div className="hint">
          <p>
            <strong>Neues Token – nur jetzt sichtbar:</strong>
          </p>
          <div className="copy">
            <code>{fresh}</code>
            <button type="button" className="btn" onClick={() => void navigator.clipboard?.writeText(fresh)}>
              Kopieren
            </button>
          </div>
          <button type="button" className="link" onClick={() => setFresh(null)}>
            Erledigt
          </button>
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <div className="field__row field__row--wrap">
          <label className="field spacer">
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} />
          </label>
        </div>
        <div className="chips">
          {SCOPES.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`chip${scopes.includes(id) ? ' chip--on' : ''}`}
              onClick={() => setScopes((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))}
            >
              {label}
            </button>
          ))}
        </div>
        <p>
          <button type="submit" className="btn btn--primary" disabled={!scopes.length || !name.trim()}>
            Token erzeugen
          </button>
        </p>
      </form>

      {pats.length > 0 && (
        <ul className="checklist">
          {pats.map((t) => (
            <li key={t.id}>
              <label>
                <span className="spacer">
                  {t.name} <small className="muted">· {t.prefix}… · {t.scopes.join(', ')} · zuletzt benutzt: {date(t.lastUsedAt)}</small>
                </span>
                <button type="button" className="link danger" onClick={() => void revoke(t)}>
                  widerrufen
                </button>
              </label>
            </li>
          ))}
        </ul>
      )}

      <h3>KI-Assistenten (MCP)</h3>
      <p className="muted">
        MCP-Server-Adresse für Claude &amp; Co.: <code>{location.origin}/mcp</code> – die Anmeldung läuft über dein Pocket-ID-Konto.
      </p>
      {assistants.length > 0 && (
        <ul className="checklist">
          {assistants.map((t) => (
            <li key={t.id}>
              <label>
                <span className="spacer">
                  {t.name} <small className="muted">· verbunden seit {date(t.createdAt)} · zuletzt benutzt: {date(t.lastUsedAt)}</small>
                </span>
                <button type="button" className="link danger" onClick={() => void revoke(t)}>
                  trennen
                </button>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
