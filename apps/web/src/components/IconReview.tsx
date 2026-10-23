import { CATEGORIES, getCategory, type CatalogItem } from '@shopping/shared';
import { useEffect, useMemo, useState } from 'react';
import { sync } from '../sync/engine';

/** Icon generation and review (docs/konzept/10-icons-plan.md, guideline 11). */

interface Checks {
  background?: boolean;
  complete?: boolean;
  size?: boolean;
}

interface Candidate {
  id: string;
  checks: Checks;
  provider: string;
  model: string;
}

interface ReviewTarget {
  targetType: 'item' | 'category';
  targetId: string;
  name: string;
  categoryId: string;
  subject: string | null;
  approved: string | null;
  candidates: Candidate[];
}

interface GalleryIcon {
  id: string;
  targetType: 'item' | 'category';
  targetId: string;
  name: string;
  categoryId: string;
  subject: string | null;
  isAnchor: boolean;
}

interface Status {
  settings: {
    enabled: boolean;
    provider: 'cloudflare' | 'openai';
    candidates: number;
    style: string;
    cloudflare: { accountId: string | null; hasToken: boolean; model: string; dailyLimit: number; size: number };
    openai: { hasKey: boolean; model: string; quality: string; monthlyCapMilli: number };
    pausedUntil: string | null;
    pauseReason: string | null;
  };
  phase: 'style' | 'mass';
  anchors: number;
  minAnchors: number;
  items: number;
  withIcon: number;
  categoriesWithIcon: number;
  candidates: number;
  queued: number;
  failed: { id: string; targetType: string; targetId: string; name: string; error: string | null }[];
  usage: { cloudflareToday: number; openaiMonthCostMilli: number };
  running: boolean;
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

const post = <T,>(path: string, body: unknown = {}) => api<T>(path, { method: 'POST', body: JSON.stringify(body) });

const CHECK_TEXT: Record<keyof Checks, string> = {
  background: 'Hintergrund nicht sauber entfernt',
  complete: 'Motiv angeschnitten',
  size: 'Motiv sehr klein',
};

function euro(milli: number): string {
  return (milli / 1000).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/** The candidate as the app shows it: on the light and dark tile, at 96, 48 and 32 px. */
function Preview({ src, categoryId }: { src: string; categoryId: string }) {
  const color = getCategory(categoryId).color;
  return (
    <div className="icon-preview">
      {(['light', 'dark'] as const).map((mode) => (
        <div key={mode} className={`icon-preview__row icon-preview__row--${mode}`} style={{ '--cat': color } as React.CSSProperties}>
          {[96, 48, 32].map((px) => (
            <span key={px} className="icon-preview__tile" style={{ width: px + 12, height: px + 12 }}>
              <img src={src} alt="" width={px} height={px} />
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

export function IconReview({ catalog }: { catalog: CatalogItem[] }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [targets, setTargets] = useState<ReviewTarget[]>([]);
  const [gallery, setGallery] = useState<GalleryIcon[]>([]);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const [s, r, g] = await Promise.all([
        api<Status>('/api/v1/icons/status'),
        api<{ targets: ReviewTarget[] }>('/api/v1/icons/review'),
        api<{ icons: GalleryIcon[] }>('/api/v1/icons/gallery'),
      ]);
      setStatus(s);
      setTargets(r.targets);
      setGallery(g.icons);
    } catch {
      setMessage({ kind: 'error', text: 'Die Icon-Verwaltung braucht eine Verbindung zum Server.' });
    }
  };

  useEffect(() => {
    void load();
    // While the queue runs on its own, new candidates keep coming in.
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 20_000);
    return () => clearInterval(timer);
  }, []);

  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true);
    setMessage(null);
    try {
      const text = await fn();
      if (text) setMessage({ kind: 'ok', text });
      await load();
      void sync.refreshCatalog();
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const configured = !!status && (status.settings.provider === 'openai' ? status.settings.openai.hasKey : status.settings.cloudflare.hasToken && !!status.settings.cloudflare.accountId);
  const paused = status?.settings.pausedUntil && new Date(status.settings.pausedUntil) > new Date() ? new Date(status.settings.pausedUntil) : null;

  // Three random approved icons next to each candidate: does it break the style?
  const neighbours = useMemo(() => [...gallery].sort(() => Math.random() - 0.5).slice(0, 3), [gallery]);

  const runNow = () =>
    run(async () => {
      const { result } = await post<{ result: string }>('/api/v1/icons/run');
      return (
        {
          done: 'Neue Entwürfe sind da.',
          idle: 'Nichts zu tun – alle Artikel haben ein Icon oder warten auf Prüfung.',
          paused: 'Pausiert: das Kontingent des Anbieters ist erschöpft.',
          budget: 'Das Tageslimit ist erreicht.',
          failed: 'Das hat nicht geklappt, Details unten bei „Fehlgeschlagen“.',
          unconfigured: 'Bitte zuerst einen Anbieter einrichten.',
        } as Record<string, string>
      )[result];
    });

  if (!status) {
    return <div className="settings">{message ? <p className={message.kind === 'ok' ? 'success' : 'error'}>{message.text}</p> : <p className="muted">Lädt …</p>}</div>;
  }

  return (
    <div className="settings icons-page">
      <section className="card">
        <h2>Stand</h2>
        {status.phase === 'style' ? (
          <p>
            <strong>Schritt 1: Stil finden.</strong> Für zwölf typische Artikel entstehen je drei Entwürfe ohne Vorlage. Nimm die, die gut
            zusammenpassen, als <strong>Stil-Referenz ★</strong>. Ab {status.minAnchors} Stil-Referenzen ({status.anchors} bisher) werden alle
            weiteren Icons mit diesen Referenzbildern im selben Stil erzeugt.
          </p>
        ) : (
          <>
            <progress max={status.items} value={status.withIcon} />
            <p>
              {status.withIcon} von {status.items} Artikeln haben ein Icon, {status.categoriesWithIcon} von {CATEGORIES.length} Kategorien.{' '}
              {status.anchors} Stil-Referenzen.
            </p>
          </>
        )}
        <p className="muted">
          {status.candidates} Entwürfe warten auf Prüfung · {status.queued} Aufträge in der Warteschlange · heute {status.usage.cloudflareToday} von{' '}
          {status.settings.cloudflare.dailyLimit} Gratis-Bildern
          {status.settings.openai.hasKey && ` · diesen Monat ${euro(status.usage.openaiMonthCostMilli)} von ${euro(status.settings.openai.monthlyCapMilli)}`}
        </p>
        {paused && (
          <p className="error">
            Pausiert bis {paused.toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}: {status.settings.pauseReason}
          </p>
        )}
        <div className="row">
          <button type="button" className="btn btn--primary" disabled={busy || !configured} onClick={() => void runNow()}>
            {busy ? 'Erzeuge …' : 'Nächsten Auftrag jetzt erzeugen'}
          </button>
          <label className="check">
            <input
              type="checkbox"
              checked={status.settings.enabled}
              disabled={!configured}
              onChange={(e) => void run(async () => void (await api('/api/v1/icons/settings', { method: 'PUT', body: JSON.stringify({ enabled: e.target.checked }) })))}
            />
            Automatisch im Hintergrund (bis zum Tageslimit)
          </label>
        </div>
        {message && <p className={message.kind === 'ok' ? 'success' : 'error'}>{message.text}</p>}
      </section>

      <SettingsForm status={status} open={!configured} onSaved={() => void load()} />

      <section>
        <h2 className="section-title">Zur Prüfung {targets.length > 0 && <span className="count">{targets.length}</span>}</h2>
        {targets.length === 0 && <p className="muted">Gerade gibt es nichts zu prüfen.</p>}
        {targets.map((t) => (
          <ReviewCard
            key={`${t.targetType}:${t.targetId}`}
            target={t}
            stylePhase={status.phase === 'style'}
            neighbours={neighbours.filter((n) => n.targetId !== t.targetId)}
            paidAvailable={status.settings.openai.hasKey}
            busy={busy}
            run={run}
          />
        ))}
      </section>

      <Gallery icons={gallery} catalog={catalog} run={run} busy={busy} paidAvailable={status.settings.openai.hasKey} />

      {status.failed.length > 0 && (
        <section className="card">
          <h2>Fehlgeschlagen</h2>
          <ul className="plain">
            {status.failed.map((f) => (
              <li key={f.id}>
                <strong>{f.name}</strong> <span className="muted">{f.error}</span>
              </li>
            ))}
          </ul>
          <button type="button" className="btn" disabled={busy} onClick={() => void run(async () => void (await post('/api/v1/icons/retry-failed')))}>
            Noch einmal versuchen
          </button>
        </section>
      )}
    </div>
  );
}

interface ReviewCardProps {
  target: ReviewTarget;
  stylePhase: boolean;
  neighbours: GalleryIcon[];
  paidAvailable: boolean;
  busy: boolean;
  run: (fn: () => Promise<string | void>) => Promise<void>;
}

function ReviewCard({ target, stylePhase, neighbours, paidAvailable, busy, run }: ReviewCardProps) {
  const [anchor, setAnchor] = useState(stylePhase);
  const [subject, setSubject] = useState(target.subject ?? '');
  const [hint, setHint] = useState('');
  const regenerate = (paid: boolean) =>
    run(async () => {
      await post('/api/v1/icons/generate', {
        targetType: target.targetType,
        targetId: target.targetId,
        hint: hint || null,
        paid,
        ...(target.targetType === 'item' && subject !== (target.subject ?? '') ? { subject } : {}),
      });
      return `Neue Entwürfe für „${target.name}“ sind in Auftrag.`;
    });

  return (
    <article className="card review">
      <header className="review__head">
        <h3>
          {target.name} {target.targetType === 'category' && <span className="muted">(Kategorie)</span>}
        </h3>
        {target.approved && <span className="muted">ersetzt das bisherige Icon</span>}
      </header>
      <div className="review__candidates">
        {target.candidates.map((c) => {
          const problems = (Object.keys(CHECK_TEXT) as (keyof Checks)[]).filter((k) => c.checks[k] === false);
          return (
            <figure key={c.id} className="review__candidate">
              <Preview src={`/api/v1/icons/${c.id}/image`} categoryId={target.categoryId} />
              {problems.length > 0 && <figcaption className="review__warn">⚠ {problems.map((p) => CHECK_TEXT[p]).join(', ')}</figcaption>}
              <button
                type="button"
                className="btn btn--primary"
                disabled={busy}
                onClick={() => void run(async () => void (await post(`/api/v1/icons/${c.id}/approve`, { anchor })))}
              >
                Nehmen
              </button>
            </figure>
          );
        })}
      </div>
      {neighbours.length > 0 && (
        <div className="review__neighbours">
          <span className="muted">Daneben:</span>
          {neighbours.map((n) => (
            <img key={n.id} src={`/api/v1/icons/${n.id}/image`} alt={n.name} title={n.name} width={48} height={48} />
          ))}
        </div>
      )}
      <label className="check">
        <input type="checkbox" checked={anchor} onChange={(e) => setAnchor(e.target.checked)} />
        Als Stil-Referenz ★ für alle weiteren Icons verwenden
      </label>
      <details className="review__more">
        <summary>Nicht dabei? Neu erzeugen …</summary>
        {target.targetType === 'item' && (
          <label className="field">
            <span>Was zu sehen ist (englisch)</span>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="z. B. group of three potatoes" />
          </label>
        )}
        <label className="field">
          <span>Zusätzlicher Wunsch (englisch, optional)</span>
          <input value={hint} onChange={(e) => setHint(e.target.value)} placeholder="z. B. only one carrot, lighter color" />
        </label>
        <div className="row">
          <button type="button" className="btn" disabled={busy} onClick={() => void regenerate(false)}>
            Alle verwerfen und neu erzeugen
          </button>
          {paidAvailable && (
            <button type="button" className="btn" disabled={busy} onClick={() => void regenerate(true)}>
              Mit Bezahl-Modell neu
            </button>
          )}
          <label className="btn">
            Eigenes Bild …
            <input
              type="file"
              accept="image/png,image/webp,image/jpeg"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                void run(async () => {
                  await post('/api/v1/icons/upload', { targetType: target.targetType, targetId: target.targetId, image: await fileToBase64(file) });
                  return 'Bild hochgeladen – es steht jetzt bei den Entwürfen.';
                });
              }}
            />
          </label>
        </div>
      </details>
    </article>
  );
}

interface GalleryProps {
  icons: GalleryIcon[];
  catalog: CatalogItem[];
  paidAvailable: boolean;
  busy: boolean;
  run: (fn: () => Promise<string | void>) => Promise<void>;
}

function Gallery({ icons, catalog, paidAvailable, busy, run }: GalleryProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const sel = icons.find((i) => i.id === selected);
  const shown = icons.filter((i) => !search || i.name.toLowerCase().includes(search.toLowerCase()));
  // Items without any icon yet, to order one directly.
  const without = useMemo(() => {
    if (search.length < 2) return [];
    const has = new Set(icons.map((i) => i.targetId));
    return catalog.filter((c) => !c.hidden && !has.has(c.id) && c.name.toLowerCase().includes(search.toLowerCase())).slice(0, 8);
  }, [catalog, icons, search]);

  return (
    <section className="card">
      <h2>Freigegeben ({icons.length})</h2>
      <input className="gallery__search" placeholder="Artikel suchen …" value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className="gallery">
        {shown.map((i) => (
          <button
            key={i.id}
            type="button"
            className={`gallery__item${i.id === selected ? ' gallery__item--selected' : ''}`}
            style={{ '--cat': getCategory(i.categoryId).color } as React.CSSProperties}
            onClick={() => setSelected(i.id === selected ? null : i.id)}
            title={i.name}
          >
            <img src={`/api/v1/icons/${i.id}/image`} alt="" width={56} height={56} loading="lazy" />
            <span>
              {i.isAnchor && '★ '}
              {i.name}
            </span>
          </button>
        ))}
      </div>
      {without.length > 0 && (
        <p>
          Noch ohne Icon:{' '}
          {without.map((c) => (
            <button
              key={c.id}
              type="button"
              className="chip"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await post('/api/v1/icons/generate', { targetType: 'item', targetId: c.id });
                  return `„${c.name}“ ist in Auftrag.`;
                })
              }
            >
              + {c.name}
            </button>
          ))}
        </p>
      )}
      {sel && (
        <div className="row">
          <strong>{sel.name}</strong>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => void run(async () => void (await post(`/api/v1/icons/${sel.id}/anchor`, { anchor: !sel.isAnchor })))}
          >
            {sel.isAnchor ? 'Keine Stil-Referenz mehr' : 'Als Stil-Referenz ★'}
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await post('/api/v1/icons/generate', { targetType: sel.targetType, targetId: sel.targetId });
                return `Neue Entwürfe für „${sel.name}“ sind in Auftrag. Bis zur Freigabe bleibt das jetzige Icon.`;
              })
            }
          >
            Neu erzeugen
          </button>
          {paidAvailable && (
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void run(async () => void (await post('/api/v1/icons/generate', { targetType: sel.targetType, targetId: sel.targetId, paid: true })))}
            >
              Mit Bezahl-Modell neu
            </button>
          )}
          <button
            type="button"
            className="btn btn--danger"
            disabled={busy}
            onClick={() => {
              if (!confirm(`Icon von „${sel.name}“ zurücknehmen? Die App zeigt dann wieder das Kategorie-Icon.`)) return;
              setSelected(null);
              void run(async () => void (await post(`/api/v1/icons/${sel.id}/reject`)));
            }}
          >
            Zurücknehmen
          </button>
        </div>
      )}
    </section>
  );
}

function SettingsForm({ status, open, onSaved }: { status: Status; open: boolean; onSaved: () => void }) {
  const s = status.settings;
  const [provider, setProvider] = useState(s.provider);
  const [accountId, setAccountId] = useState(s.cloudflare.accountId ?? '');
  const [cfToken, setCfToken] = useState('');
  const [cfModel, setCfModel] = useState(s.cloudflare.model);
  const [dailyLimit, setDailyLimit] = useState(String(s.cloudflare.dailyLimit));
  const [size, setSize] = useState(String(s.cloudflare.size));
  const [oaKey, setOaKey] = useState('');
  const [oaModel, setOaModel] = useState(s.openai.model);
  const [quality, setQuality] = useState(s.openai.quality);
  const [cap, setCap] = useState(String(s.openai.monthlyCapMilli / 1000));
  const [candidates, setCandidates] = useState(String(s.candidates));
  const [style, setStyle] = useState(s.style);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const save = async () => {
    setMessage(null);
    try {
      await api('/api/v1/icons/settings', {
        method: 'PUT',
        body: JSON.stringify({
          provider,
          candidates: Number(candidates),
          style,
          cloudflare: {
            accountId: accountId.trim() || null,
            ...(cfToken ? { token: cfToken } : {}),
            model: cfModel,
            dailyLimit: Number(dailyLimit) || 0,
            size: Number(size),
          },
          openai: {
            ...(oaKey ? { apiKey: oaKey } : {}),
            model: oaModel,
            quality,
            monthlyCapMilli: Math.round((Number(cap.replace(',', '.')) || 0) * 1000),
          },
        }),
      });
      setCfToken('');
      setOaKey('');
      setMessage({ kind: 'ok', text: 'Gespeichert.' });
      onSaved();
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message });
    }
  };

  return (
    <details className="card" open={open}>
      <summary>
        <h2>Bild-KI einrichten</h2>
      </summary>
      <label className="field">
        <span>Anbieter</span>
        <select value={provider} onChange={(e) => setProvider(e.target.value as 'cloudflare' | 'openai')}>
          <option value="cloudflare">Cloudflare Workers AI – FLUX.2 (Gratis-Kontingent)</option>
          <option value="openai">OpenAI gpt-image (bezahlt)</option>
        </select>
      </label>

      <h3>Cloudflare</h3>
      <p className="muted">
        Kostenloses Konto bei Cloudflare, dann <em>AI → Workers AI → REST API</em>: dort stehen die Account-ID und „API-Token erstellen“
        (Vorlage „Workers AI“). Das Gratis-Kontingent reicht für rund 150 Icons am Tag.
      </p>
      <label className="field">
        <span>Account-ID</span>
        <input value={accountId} onChange={(e) => setAccountId(e.target.value)} autoComplete="off" />
      </label>
      <label className="field">
        <span>API-Token</span>
        <input type="password" value={cfToken} onChange={(e) => setCfToken(e.target.value)} placeholder={s.cloudflare.hasToken ? 'gespeichert – leer lassen zum Behalten' : ''} autoComplete="off" />
      </label>
      <div className="field__row">
        <label className="field">
          <span>Modell</span>
          <select value={cfModel} onChange={(e) => setCfModel(e.target.value)}>
            <option value="flux-2-klein-4b">FLUX.2 klein 4B (sparsam)</option>
            <option value="flux-2-klein-9b">FLUX.2 klein 9B</option>
            <option value="flux-2-dev">FLUX.2 dev (teuer)</option>
          </select>
        </label>
        <label className="field">
          <span>Bilder pro Tag</span>
          <input inputMode="numeric" value={dailyLimit} onChange={(e) => setDailyLimit(e.target.value)} />
        </label>
        <label className="field">
          <span>Größe</span>
          <select value={size} onChange={(e) => setSize(e.target.value)}>
            <option value="512">512 px</option>
            <option value="768">768 px</option>
            <option value="1024">1024 px</option>
          </select>
        </label>
      </div>

      <h3>OpenAI (optional, bezahlt)</h3>
      <p className="muted">Für einzelne Artikel, die mit FLUX nicht gelingen („Mit Bezahl-Modell neu“), oder als Hauptanbieter.</p>
      <label className="field">
        <span>API-Key</span>
        <input type="password" value={oaKey} onChange={(e) => setOaKey(e.target.value)} placeholder={s.openai.hasKey ? 'gespeichert – leer lassen zum Behalten' : ''} autoComplete="off" />
      </label>
      <div className="field__row">
        <label className="field">
          <span>Modell</span>
          <select value={oaModel} onChange={(e) => setOaModel(e.target.value)}>
            <option value="gpt-image-1-mini">gpt-image-1-mini</option>
            <option value="gpt-image-1">gpt-image-1</option>
            <option value="gpt-image-1.5">gpt-image-1.5</option>
          </select>
        </label>
        <label className="field">
          <span>Qualität</span>
          <select value={quality} onChange={(e) => setQuality(e.target.value)}>
            <option value="low">niedrig</option>
            <option value="medium">mittel</option>
            <option value="high">hoch</option>
          </select>
        </label>
        <label className="field">
          <span>Höchstens € pro Monat</span>
          <input inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} />
        </label>
      </div>

      <h3>Erzeugung</h3>
      <label className="field">
        <span>Entwürfe pro Artikel</span>
        <select value={candidates} onChange={(e) => setCandidates(e.target.value)}>
          {[1, 2, 3, 4].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Stil (englisch, gilt für alle Icons – leer = Standard aus der Designrichtlinie)</span>
        <textarea rows={4} value={style} onChange={(e) => setStyle(e.target.value)} />
      </label>
      <button type="button" className="btn btn--primary" onClick={() => void save()}>
        Speichern
      </button>
      {message && <p className={message.kind === 'ok' ? 'success' : 'error'}>{message.text}</p>}
    </details>
  );
}
