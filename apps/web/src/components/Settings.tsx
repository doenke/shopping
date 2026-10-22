import { CATEGORIES, type Me } from '@shopping/shared';
import { useEffect, useState } from 'react';
import { logout } from '../actions';
import { sync } from '../sync/engine';

interface MealieState {
  url: string | null;
  hasToken: boolean;
  labelMapping: Record<string, string>;
  labels: string[];
  status: string | null;
  lastSyncAt: string | null;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  return body as T;
}

export function Settings({ me }: { me: Me }) {
  const [mealie, setMealie] = useState<MealieState | null>(null);
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const m = await api<MealieState>('/api/v1/integrations/mealie');
      setMealie(m);
      setUrl(m.url ?? '');
      setMapping(m.labelMapping);
    } catch {
      setMessage({ kind: 'error', text: 'Einstellungen brauchen eine Verbindung zum Server.' });
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setMessage(null);
    try {
      setMessage({ kind: 'ok', text: await fn() });
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run(async () => {
      await api('/api/v1/integrations/mealie', {
        method: 'PUT',
        body: JSON.stringify({ url, ...(token ? { token } : {}), labelMapping: Object.fromEntries(Object.entries(mapping).filter(([, v]) => v)) }),
      });
      setToken('');
      await load();
      return 'Gespeichert.';
    });

  const test = () =>
    run(async () => {
      const r = await api<{ version: string; user: string | null }>('/api/v1/integrations/mealie/test', { method: 'POST' });
      return `Verbunden mit Mealie ${r.version}${r.user ? ` als ${r.user}` : ''}.`;
    });

  const importCatalog = () =>
    run(async () => {
      const r = await api<{ created: number; linked: number; updated: number }>('/api/v1/integrations/mealie/import-catalog', { method: 'POST' });
      await sync.refreshCatalog();
      await load();
      return `${r.created} neu, ${r.linked} verknüpft, ${r.updated} aktualisiert.`;
    });

  return (
    <section className="settings">
      <h1>Einstellungen</h1>

      <div className="card">
        <h2>Konto</h2>
        <p>
          Angemeldet als <strong>{me.displayName}</strong>
          {me.email && <> ({me.email})</>}
        </p>
        <button className="btn" type="button" onClick={() => void logout()}>
          Abmelden
        </button>
      </div>

      <div className="card">
        <h2>Mealie</h2>
        <p className="muted">
          Phase 1: Lebensmittel aus Mealie in den Katalog übernehmen. Der Eingangskorb für Einkaufslisten folgt in Phase 2.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label className="field">
            <span>Adresse</span>
            <input type="url" placeholder="https://mealie.example.org" value={url} onChange={(e) => setUrl(e.target.value)} required />
          </label>
          <label className="field">
            <span>API-Token {mealie?.hasToken && <small>(gespeichert – leer lassen, um ihn zu behalten)</small>}</span>
            <input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Mealie → Profil → API-Tokens" />
          </label>
          <div className="row">
            <button className="btn btn--primary" type="submit" disabled={busy}>
              Speichern
            </button>
            <button className="btn" type="button" disabled={busy || !mealie?.hasToken} onClick={() => void test()}>
              Verbindung testen
            </button>
            <button className="btn" type="button" disabled={busy || !mealie?.hasToken} onClick={() => void importCatalog()}>
              Lebensmittel importieren
            </button>
          </div>
        </form>
        {message && <p className={message.kind === 'ok' ? 'success' : 'error'}>{message.text}</p>}
        {mealie?.status && (
          <p className="muted">
            {mealie.status}
            {mealie.lastSyncAt && <> · {new Date(mealie.lastSyncAt).toLocaleString('de-DE')}</>}
          </p>
        )}

        {mealie && mealie.labels.length > 0 && (
          <>
            <h3>Mealie-Labels → Kategorien</h3>
            <p className="muted">Wird beim nächsten Import angewendet. Von Hand geänderte Kategorien bleiben erhalten.</p>
            <div className="mapping">
              {mealie.labels.map((label) => (
                <label key={label} className="mapping__row">
                  <span>{label}</span>
                  <select value={mapping[label] ?? ''} onChange={(e) => setMapping({ ...mapping, [label]: e.target.value })}>
                    <option value="">automatisch</option>
                    {CATEGORIES.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
