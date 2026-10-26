import { CATEGORIES, type Me } from '@shopping/shared';
import { useEffect, useState } from 'react';
import { logout } from '../actions';
import { useLists, type SettingsSection } from '../hooks';
import { useCustomCategories } from '../categories';
import { Avatar } from './Avatar';
import { CategoriesCard } from './CategoriesCard';
import { TokensCard } from './TokensCard';
import { WebhooksCard } from './WebhooksCard';
import { sync } from '../sync/engine';

interface MealieState {
  url: string | null;
  hasToken: boolean;
  labelMapping: Record<string, string>;
  labels: string[];
  inbox: {
    enabled: boolean;
    mealieListId: string | null;
    targetListId: string | null;
    webhookUrl: string | null;
    appriseUrl: string | null;
  };
  status: string | null;
  lastSyncAt: string | null;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  // Only send a JSON content type with a body – Fastify rejects an empty JSON body.
  const headers = init?.body ? { 'content-type': 'application/json', ...init.headers } : init?.headers;
  const res = await fetch(path, { ...init, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const b = body as { detail?: string; error?: string };
    throw new Error(b.detail ?? b.error ?? `HTTP ${res.status}`);
  }
  return body as T;
}

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="copy">
      <code>{text}</code>
      <button
        type="button"
        className="btn"
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(() => {
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          });
        }}
      >
        {done ? 'Kopiert ✓' : 'Kopieren'}
      </button>
    </div>
  );
}

export const SECTION_TITLE: Record<SettingsSection, string> = {
  order: 'Reihenfolge',
  categories: 'Eigene Kategorien',
  mealie: 'Mealie',
  api: 'API & Integrationen',
  webhooks: 'Webhooks',
};

export function Settings({ me, section, onSort }: { me: Me; section?: SettingsSection; onSort: (what: 'lists' | 'shopping' | 'packing') => void }) {
  const lists = useLists().filter((l) => !l.isTemplate && l.listType === 'shopping');
  const [mealie, setMealie] = useState<MealieState | null>(null);
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [inboxEnabled, setInboxEnabled] = useState(false);
  const [mealieListId, setMealieListId] = useState('');
  const [targetListId, setTargetListId] = useState('');
  const [mealieLists, setMealieLists] = useState<{ id: string; name: string }[]>([]);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const m = await api<MealieState>('/api/v1/integrations/mealie');
      setMealie(m);
      setUrl(m.url ?? '');
      setMapping(m.labelMapping);
      setInboxEnabled(m.inbox.enabled);
      setMealieListId(m.inbox.mealieListId ?? '');
      setTargetListId(m.inbox.targetListId ?? me.defaultListId ?? '');
      if (m.hasToken) {
        api<{ id: string; name: string }[]>('/api/v1/integrations/mealie/shopping-lists')
          .then(setMealieLists)
          .catch(() => setMealieLists([]));
      }
    } catch {
      setMessage({ kind: 'error', text: 'Einstellungen brauchen eine Verbindung zum Server.' });
    }
  };

  useEffect(() => {
    if (me.isGuest) return;
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
        body: JSON.stringify({
          url,
          ...(token ? { token } : {}),
          labelMapping: Object.fromEntries(Object.entries(mapping).filter(([, v]) => v)),
          inbox: {
            enabled: inboxEnabled && !!mealieListId && !!targetListId,
            ...(mealieListId ? { mealieListId } : {}),
            ...(targetListId ? { targetListId } : {}),
          },
        }),
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

  const runInbox = () =>
    run(async () => {
      const r = await api<{ added: number; skipped: number }>('/api/v1/integrations/mealie/inbox/run', { method: 'POST' });
      await load();
      return r.added ? `${r.added} Artikel übernommen.` : 'Nichts Neues in Mealie.';
    });

  const custom = useCustomCategories().filter((c) => !c.deleted);
  const tokens = useTokenCount();
  const back = (
    <a className="settings-back" href="#/settings">
      ‹ Einstellungen
    </a>
  );

  if (section && !me.isGuest) {
    return (
      <section className="settings settings--section">
        {back}
        {section === 'order' && (
          <div className="card">
            <p className="muted">Nur für dich, auf allen deinen Geräten (auch in Home Assistant).</p>
            <div className="settings-group settings-group--flat">
              <SettingsRow icon="📋" title="Listen und Abschnitte" text="Reihenfolge in der Seitenleiste" onClick={() => onSort('lists')} />
              <SettingsRow icon="🛒" title="Kategorien Einkauf" text="z. B. nach deinem Weg durch den Laden" onClick={() => onSort('shopping')} />
              <SettingsRow icon="🧳" title="Kategorien Packliste" onClick={() => onSort('packing')} />
            </div>
          </div>
        )}
        {section === 'categories' && <CategoriesCard />}
        {section === 'mealie' && (
    <form
      className="card"
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
      </div>
      {message && <p className={message.kind === 'ok' ? 'success' : 'error'}>{message.text}</p>}
      {mealie?.status && (
        <p className="muted">
          {mealie.status}
          {mealie.lastSyncAt && <> · {new Date(mealie.lastSyncAt).toLocaleString('de-DE')}</>}
        </p>
      )}

      {mealie?.hasToken && (
        <>
          <h3>Eingangskorb</h3>
          <p className="muted">
            Was in Mealie auf der gewählten Einkaufsliste landet, wird hierher übernommen und in Mealie abgehakt.
          </p>
          <label className="check">
            <input type="checkbox" checked={inboxEnabled} onChange={(e) => setInboxEnabled(e.target.checked)} /> Eingangskorb einschalten
          </label>
          <div className="field__row field__row--wrap">
            <label className="field spacer">
              <span>Mealie-Liste</span>
              <select value={mealieListId} onChange={(e) => setMealieListId(e.target.value)}>
                <option value="">– wählen –</option>
                {mealieLists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field spacer">
              <span>landet in</span>
              <select value={targetListId} onChange={(e) => setTargetListId(e.target.value)}>
                <option value="">– wählen –</option>
                {lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.id === me.defaultListId ? '⭐ ' : ''}
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="row">
            <button className="btn btn--primary" type="submit" disabled={busy}>
              Speichern
            </button>
            <button className="btn" type="button" disabled={busy || !mealie.inbox.enabled} onClick={() => void runInbox()}>
              Jetzt abgleichen
            </button>
          </div>
          {mealie.inbox.enabled && mealie.inbox.appriseUrl && (
            <div className="hint">
              <p>
                Damit Artikel sofort ankommen: In Mealie unter <em>Haushalt → Benachrichtigungen</em> einen Notifier anlegen, diese
                Apprise-URL eintragen und das Ereignis <em>Einkaufsliste</em> aktivieren. Ohne Notifier wird alle 15 Minuten abgeglichen.
              </p>
              <Copy text={mealie.inbox.appriseUrl} />
              <p className="muted">Ein bisheriger n8n-Flow für Mealie-Einkaufslisten kann danach abgeschaltet werden.</p>
            </div>
          )}

          <h3>Lebensmittel</h3>
          <p className="muted">Übernimmt die Mealie-Zutaten in den Katalog (Namen, Plural, Aliase, Kategorie über Labels).</p>
          <button className="btn" type="button" disabled={busy} onClick={() => void importCatalog()}>
            Lebensmittel importieren
          </button>

          {mealie.labels.length > 0 && (
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
        </>
      )}
    </form>
        )}
        {section === 'api' && <TokensCard />}
        {section === 'webhooks' && <WebhooksCard />}
      </section>
    );
  }

  const mealieStatus = !mealie
    ? undefined
    : !mealie.hasToken
      ? 'Nicht eingerichtet'
      : mealie.inbox.enabled
        ? 'Verbunden · Eingangskorb an'
        : 'Verbunden';

  return (
    <section className="settings">
      <div className="card account">
        <Avatar user={me} size="md" />
        <p className="spacer">
          <strong>{me.displayName}</strong>
          {me.email && (
            <>
              <br />
              <small className="muted">{me.email}</small>
            </>
          )}
          {me.household && (
            <>
              <br />
              <small className="muted">Haushalt: {me.household}</small>
            </>
          )}
        </p>
        <button className="btn" type="button" onClick={() => void logout()}>
          {me.isGuest ? 'Beenden' : 'Abmelden'}
        </button>
      </div>

      {me.isGuest ? (
        <p className="muted">Du bist als Gast dabei und siehst nur die geteilte Liste.</p>
      ) : (
        <>
          <h2 className="settings-heading">Für mich</h2>
          <div className="settings-group">
            <SettingsRow icon="↕" title="Reihenfolge" text="Listen und Kategorien sortieren" href="#/settings/order" />
          </div>

          <h2 className="settings-heading">Haushalt</h2>
          <div className="settings-group">
            <SettingsRow
              icon="🏷"
              title="Eigene Kategorien"
              text={custom.length ? `${custom.length} eigene` : 'z. B. Angeln, Camping, Asia-Laden'}
              href="#/settings/categories"
            />
            <SettingsRow icon="🖼" title="Icons" text="Bild-KI, Prüfung, Budget" href="#/icons" />
          </div>

          <h2 className="settings-heading">Verbindungen</h2>
          <div className="settings-group">
            <SettingsRow icon="🍲" title="Mealie" text={mealieStatus} href="#/settings/mealie" />
            <SettingsRow
              icon="🔑"
              title="API & Integrationen"
              text={tokens === null ? 'Home Assistant, n8n, Claude' : tokens ? `${tokens} verbunden` : 'Home Assistant, n8n, Claude'}
              href="#/settings/api"
            />
            <SettingsRow icon="↗" title="Webhooks" text="Änderungen an andere Dienste melden" href="#/settings/webhooks" />
          </div>
        </>
      )}
      <p className="muted version">Shopping {__APP_VERSION__}</p>
    </section>
  );
}

/** One line of the settings overview: icon, title, current state, chevron. */
function SettingsRow({ icon, title, text, href, onClick }: { icon: string; title: string; text?: string; href?: string; onClick?: () => void }) {
  const inner = (
    <>
      <span className="settings-row__icon" aria-hidden>
        {icon}
      </span>
      <span className="settings-row__text">
        <span>{title}</span>
        {text && <small>{text}</small>}
      </span>
      <span className="settings-row__chevron" aria-hidden>
        ›
      </span>
    </>
  );
  return href ? (
    <a className="settings-row" href={href}>
      {inner}
    </a>
  ) : (
    <button type="button" className="settings-row" onClick={onClick}>
      {inner}
    </button>
  );
}

/** How many tokens and connected assistants there are (for the overview). */
function useTokenCount(): number | null {
  const [n, setN] = useState<number | null>(null);
  useEffect(() => {
    fetch('/api/v1/tokens')
      .then((r) => (r.ok ? (r.json() as Promise<unknown[]>) : null))
      .then((rows) => setN(rows ? rows.length : null))
      .catch(() => setN(null));
  }, []);
  return n;
}
