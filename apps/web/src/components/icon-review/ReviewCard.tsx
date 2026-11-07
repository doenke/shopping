import { useState } from 'react';
import { type Checks, type ProviderId, PROVIDER_LABEL, type ReviewTarget, type GalleryIcon, post, CHECK_TEXT, fileToBase64, Preview } from './common';

interface ReviewCardProps {
  target: ReviewTarget;
  stylePhase: boolean;
  neighbours: GalleryIcon[];
  alternatives: ProviderId[];
  busy: boolean;
  run: (fn: () => Promise<string | void>) => Promise<void>;
}

export function ReviewCard({ target, stylePhase, neighbours, alternatives, busy, run }: ReviewCardProps) {
  const [anchor, setAnchor] = useState(stylePhase);
  const [subject, setSubject] = useState(target.subject ?? '');
  const [hint, setHint] = useState('');
  const regenerate = (provider?: ProviderId) =>
    run(async () => {
      await post('/api/v1/icons/generate', {
        targetType: target.targetType,
        targetId: target.targetId,
        hint: hint || null,
        ...(provider ? { provider } : {}),
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
        {target.approved && (
          <figure className="review__candidate review__candidate--current">
            <Preview src={`/api/v1/icons/${target.approved}/image`} categoryId={target.categoryId} />
            <small className="muted">bisher</small>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await post('/api/v1/icons/discard', { targetType: target.targetType, targetId: target.targetId });
                  return `Neue Entwürfe für „${target.name}“ verworfen, das bisherige Icon bleibt.`;
                })
              }
            >
              Bisheriges behalten
            </button>
          </figure>
        )}
        {target.candidates.map((c) => {
          const problems = (Object.keys(CHECK_TEXT) as (keyof Checks)[]).filter((k) => c.checks[k] === false);
          return (
            <figure key={c.id} className={`review__candidate${c.aiReview?.ok === false ? ' review__candidate--doubtful' : ''}`}>
              <Preview src={`/api/v1/icons/${c.id}/image`} categoryId={target.categoryId} />
              {problems.length > 0 && <figcaption className="review__warn">⚠ {problems.map((p) => CHECK_TEXT[p]).join(', ')}</figcaption>}
              {c.aiReview && (
                <figcaption className={c.aiReview.ok ? 'review__ai' : 'review__warn'} title={c.aiReview.shows}>
                  {c.aiReview.ok ? '✓ KI-Vorprüfung' : '⚠ KI hat aussortiert'}: {c.aiReview.reason}
                </figcaption>
              )}
              <small className="muted">{PROVIDER_LABEL[c.provider as ProviderId] ?? 'eigenes Bild'}</small>
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
          <button type="button" className="btn" disabled={busy} onClick={() => void regenerate()}>
            Alle verwerfen und neu erzeugen
          </button>
          {!target.approved && (
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await post('/api/v1/icons/discard', { targetType: target.targetType, targetId: target.targetId });
                  return `Entwürfe für „${target.name}“ verworfen – es bleibt beim Kategorie-Icon bzw. Anfangsbuchstaben.`;
                })
              }
            >
              Alle verwerfen, keins nehmen
            </button>
          )}
          {alternatives.map((p) => (
            <button key={p} type="button" className="btn" disabled={busy} onClick={() => void regenerate(p)}>
              Mit {PROVIDER_LABEL[p]} neu
            </button>
          ))}
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
