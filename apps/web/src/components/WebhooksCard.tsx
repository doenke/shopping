import { useEffect, useState } from 'react';

interface Webhook {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  lastStatus: string | null;
  lastDeliveryAt: string | null;
  failures: number;
}

const EVENTS: [string, string][] = [
  ['item.changed', 'Artikel geändert'],
  ['item.removed', 'Artikel entfernt'],
  ['list.changed', 'Liste geändert'],
  ['list.removed', 'Liste entfernt'],
];

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = init?.body ? { 'content-type': 'application/json' } : undefined;
  const res = await fetch(path, { ...init, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { detail?: string }).detail ?? `HTTP ${res.status}`);
  return body as T;
}

const when = (s: string | null) => (s ? new Date(s).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : 'noch nie');

/** Outgoing webhooks for own automations (n8n …). Shopping itself never sends notifications. */
export function WebhooksCard() {
  const [hooks, setHooks] = useState<Webhook[]>([]);
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<string[]>(EVENTS.map(([id]) => id));
  const [fresh, setFresh] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const load = () => api<Webhook[]>('/api/v1/webhooks').then(setHooks, (e: Error) => setMessage({ kind: 'error', text: e.message }));
  useEffect(() => void load(), []);

  const run = async (fn: () => Promise<string | void>) => {
    setMessage(null);
    try {
      const text = await fn();
      if (text) setMessage({ kind: 'ok', text });
      await load();
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message });
    }
  };

  return (
    <div className="card">
      <h2>Webhooks</h2>
      <p className="muted">
        Für eigene Automationen, z. B. in n8n: Jede Änderung an deinen Listen wird als JSON an die Adresse geschickt, signiert im Header{' '}
        <code>X-Shopping-Signature</code> (<code>t=…,v1=</code> HMAC-SHA256 über <code>t.body</code>). Ist das Ziel nicht erreichbar, wird
        nachgeliefert.
      </p>
      {message && <p className={message.kind === 'ok' ? 'success' : 'error'}>{message.text}</p>}

      {fresh && (
        <div className="hint">
          <p>
            <strong>Signatur-Schlüssel – nur jetzt sichtbar:</strong>
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
          void run(async () => {
            const created = await api<{ secret: string }>('/api/v1/webhooks', { method: 'POST', body: JSON.stringify({ url, events }) });
            setFresh(created.secret);
            setUrl('');
          });
        }}
      >
        <label className="field">
          <span>Adresse</span>
          <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://n8n.example.de/webhook/…" required />
        </label>
        <div className="chips">
          {EVENTS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`chip${events.includes(id) ? ' chip--on' : ''}`}
              onClick={() => setEvents((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))}
            >
              {label}
            </button>
          ))}
        </div>
        <p>
          <button type="submit" className="btn btn--primary" disabled={!events.length || !url.trim()}>
            Webhook anlegen
          </button>
        </p>
      </form>

      {hooks.length > 0 && (
        <ul className="checklist">
          {hooks.map((h) => (
            <li key={h.id}>
              <label>
                <span className="spacer">
                  {h.active ? '' : '⏸ '}
                  <code>{h.url}</code>
                  <small className="muted">
                    {' '}
                    · {h.events.length === EVENTS.length ? 'alle Ereignisse' : h.events.join(', ')} · zuletzt: {when(h.lastDeliveryAt)}
                    {h.lastStatus && ` (${h.lastStatus})`}
                  </small>
                </span>
                <button
                  type="button"
                  className="link"
                  onClick={() =>
                    void run(async () => {
                      const r = await api<{ ok: boolean; status: string | null }>(`/api/v1/webhooks/${h.id}/test`, { method: 'POST' });
                      return r.ok ? `Test angekommen (${r.status}).` : `Test fehlgeschlagen: ${r.status}`;
                    })
                  }
                >
                  testen
                </button>
                <button
                  type="button"
                  className="link"
                  onClick={() => void run(async () => void (await api(`/api/v1/webhooks/${h.id}`, { method: 'PATCH', body: JSON.stringify({ active: !h.active }) })))}
                >
                  {h.active ? 'pausieren' : 'fortsetzen'}
                </button>
                <button
                  type="button"
                  className="link danger"
                  onClick={() => {
                    if (confirm('Webhook löschen?')) void run(async () => void (await api(`/api/v1/webhooks/${h.id}`, { method: 'DELETE' })));
                  }}
                >
                  löschen
                </button>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
