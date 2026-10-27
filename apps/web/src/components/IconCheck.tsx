import { useEffect, useState } from 'react';
import { sync } from '../sync/engine';

interface Pending {
  targetType: string;
  targetId: string;
  approved: string | null;
  candidates: { id: string; aiReview: { ok: boolean; reason: string } | null }[];
}

async function post(path: string, body?: unknown): Promise<boolean> {
  const res = await fetch(path, {
    method: 'POST',
    ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
  }).catch(() => null);
  return !!res?.ok;
}

/**
 * In the item editor: icon drafts of this thing that wait for review (e.g. they failed a check).
 * Anyone with an account can take one or keep the current picture right here.
 */
export function IconCheck({ targetType, targetId }: { targetType: 'item' | 'entry'; targetId: string }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const load = () =>
    fetch(`/api/v1/icons/pending/${targetType}/${targetId}`)
      .then((r) => (r.ok ? (r.json() as Promise<Pending>) : null))
      .then(setPending)
      .catch(() => setPending(null));
  useEffect(() => void load(), [targetType, targetId]);

  if (done) return <p className="sheet__meta">{done}</p>;
  if (!pending?.candidates.length) return null;

  const act = async (fn: () => Promise<boolean>, message: string) => {
    setBusy(true);
    const ok = await fn();
    setBusy(false);
    if (!ok) return;
    void sync.refreshCatalog();
    setDone(message);
  };

  const n = pending.candidates.length;
  return (
    <div className="icon-check">
      <p>
        <strong>🖼 {n === 1 ? 'Ein neues Icon wartet' : `${n} neue Icons warten`} auf Prüfung</strong>
      </p>
      <div className="icon-check__row">
        {pending.approved && (
          <figure className="icon-check__current">
            <img src={`/api/v1/icons/${pending.approved}/image`} alt="Bisheriges Icon" width={64} height={64} />
            <figcaption>bisher</figcaption>
          </figure>
        )}
        {pending.candidates.map((c) => (
          <figure key={c.id} className={c.aiReview?.ok === false ? 'icon-check__doubtful' : undefined}>
            <img src={`/api/v1/icons/${c.id}/image`} alt="Entwurf" width={64} height={64} title={c.aiReview?.reason} />
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void act(() => post(`/api/v1/icons/${c.id}/approve`, {}), '✓ Neues Icon übernommen.')}
            >
              Nehmen
            </button>
          </figure>
        ))}
      </div>
      <button
        type="button"
        className="link"
        disabled={busy}
        onClick={() =>
          void act(
            () => post('/api/v1/icons/discard', { targetType: pending.targetType, targetId: pending.targetId }),
            pending.approved ? 'Entwürfe verworfen, das bisherige Icon bleibt.' : 'Entwürfe verworfen.',
          )
        }
      >
        {pending.approved ? 'Bisheriges behalten' : 'Alle verwerfen'}
      </button>
    </div>
  );
}
