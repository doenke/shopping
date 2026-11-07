import { ALL_CATEGORIES, type CatalogItem } from '@shopping/shared';
import { useCustomCategories } from '../categories';
import { useEffect, useMemo, useState } from 'react';
import { sync } from '../sync/engine';
import { type ReviewTarget, type GalleryIcon, type Status, api, post, euro, readyProviders } from './icon-review/common';
import { ReviewCard } from './icon-review/ReviewCard';
import { Gallery } from './icon-review/Gallery';
import { SettingsForm } from './icon-review/SettingsForm';

/** `admin`: may change the server-wide settings (image AI, budget, automatic generation); everyone may review. */
export function IconReview({ catalog, admin }: { catalog: CatalogItem[]; admin: boolean }) {
  const custom = useCustomCategories();
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

  const ready = status ? readyProviders(status.settings) : [];
  const configured = !!status && ready.includes(status.settings.provider);
  // Other set-up providers than the main one, for single re-tries.
  const alternatives = status ? ready.filter((p) => p !== status.settings.provider) : [];
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
    return (
      <div className="settings">
        {message ? <p className={message.kind === 'ok' ? 'success' : 'error'}>{message.text}</p> : <p className="muted">Lädt …</p>}
      </div>
    );
  }

  return (
    <div className="settings icons-page">
      <section className="card">
        <h2>Stand</h2>
        {status.phase === 'style' ? (
          <p>
            <strong>Schritt 1: Stil finden.</strong> Für zwölf typische Artikel entstehen Entwürfe ohne Vorlage.{' '}
            {status.settings.autoApprove ? (
              <>
                Die ersten {status.minAnchors}, die alle Prüfungen bestehen, werden automatisch zur <strong>Stil-Referenz ★</strong>.
              </>
            ) : (
              <>
                Nimm die, die gut zusammenpassen, als <strong>Stil-Referenz ★</strong>.
              </>
            )}{' '}
            Ab {status.minAnchors} Stil-Referenzen ({status.anchors} bisher) werden alle weiteren Icons mit diesen Referenzbildern im selben Stil erzeugt.
          </p>
        ) : (
          <>
            <progress max={status.items} value={status.withIcon} />
            <p>
              {status.withIcon} von {status.items} Artikeln haben ein Icon, {status.categoriesWithIcon} von{' '}
              {ALL_CATEGORIES.length + custom.filter((c) => !c.deleted).length} Kategorien. {status.anchors} Stil-Referenzen.
            </p>
          </>
        )}
        <p className="muted">
          {status.candidates} Entwürfe warten auf Prüfung · {status.queued} Aufträge in der Warteschlange · heute {status.usage.cloudflareToday} von{' '}
          {status.settings.cloudflare.dailyLimit} Gratis-Bildern
          {status.settings.openai.hasKey && ` · OpenAI diesen Monat ${euro(status.usage.openaiMonth)} von ${euro(status.settings.openai.monthlyCap)}`}
          {status.settings.anthropic.hasKey && ` · Claude diesen Monat ${euro(status.usage.claudeMonth)} von ${euro(status.settings.anthropic.monthlyCap)}`}
        </p>
        {paused && (
          <p className="error">
            Pausiert bis {paused.toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}: {status.settings.pauseReason}
          </p>
        )}
        {!admin && (
          <p className="muted">
            Bild-KI, Budget und Automatik gelten für alle auf diesem Server und werden von den Admins eingestellt. Prüfen und freigeben kannst du trotzdem.
          </p>
        )}
        {admin && (
          <div className="row">
            <button type="button" className="btn btn--primary" disabled={busy || !configured} onClick={() => void runNow()}>
              {busy ? 'Erzeuge …' : 'Nächsten Auftrag jetzt erzeugen'}
            </button>
            <label className="check">
              <input
                type="checkbox"
                checked={status.settings.enabled}
                disabled={!configured}
                onChange={(e) =>
                  void run(async () => void (await api('/api/v1/icons/settings', { method: 'PUT', body: JSON.stringify({ enabled: e.target.checked }) })))
                }
              />
              Automatisch im Hintergrund (bis zum Tageslimit)
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={status.settings.autoApprove}
                onChange={(e) =>
                  void run(async () => void (await api('/api/v1/icons/settings', { method: 'PUT', body: JSON.stringify({ autoApprove: e.target.checked }) })))
                }
              />
              Automatisch freigeben (was alle Prüfungen besteht)
            </label>
          </div>
        )}
        {message && <p className={message.kind === 'ok' ? 'success' : 'error'}>{message.text}</p>}
      </section>

      {admin && <SettingsForm status={status} open={!configured} onSaved={() => void load()} />}

      <section>
        <h2 className="section-title">
          {status.settings.autoApprove ? 'Nicht bestanden' : 'Zur Prüfung'} {targets.length > 0 && <span className="count">{targets.length}</span>}
        </h2>
        {status.settings.autoApprove && targets.length > 0 && (
          <p className="muted">
            Diese Entwürfe sind bei einer Prüfung durchgefallen und deshalb nicht freigegeben – die App zeigt dort das Kategorie-Icon. Du kannst einen trotzdem
            nehmen, neu erzeugen lassen oder es dabei belassen.
          </p>
        )}
        {targets.length === 0 && <p className="muted">{status.settings.autoApprove ? 'Alles bestanden.' : 'Gerade gibt es nichts zu prüfen.'}</p>}
        {targets.map((t) => (
          <ReviewCard
            key={`${t.targetType}:${t.targetId}`}
            target={t}
            stylePhase={status.phase === 'style'}
            neighbours={neighbours.filter((n) => n.targetId !== t.targetId)}
            alternatives={alternatives}
            busy={busy}
            run={run}
          />
        ))}
      </section>

      <Gallery icons={gallery} catalog={catalog} run={run} busy={busy} alternatives={alternatives} />

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
          <button
            type="button"
            className="btn"
            style={admin ? undefined : { display: 'none' }}
            disabled={busy}
            onClick={() => void run(async () => void (await post('/api/v1/icons/retry-failed')))}
          >
            Noch einmal versuchen
          </button>
        </section>
      )}
    </div>
  );
}
