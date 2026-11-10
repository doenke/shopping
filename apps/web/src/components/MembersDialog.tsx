import type { ListRow, Me } from '@shopping/shared';
import { useEffect, useRef, useState } from 'react';
import { setVisibility, shareList } from '../actions';
import { useHouseholds } from '../households';
import { Avatar } from './Avatar';

interface Member {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  isGuest: boolean;
  isOwner: boolean;
  via: 'owner' | 'link' | 'household' | 'shared' | 'invite';
}

async function send(url: string, method: 'POST' | 'DELETE', body?: unknown): Promise<boolean> {
  const res = await fetch(url, { method, ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) }).catch(() => null);
  return !!res?.ok;
}

/** Berechtigungen: who sees the list (household or private), other households and people it is shared with, who is on it, the share link. */
export function MembersDialog({ list, me, onClose }: { list: ListRow; me: Me; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isOwner = list.ownerId === me.id;

  const [shared, setShared] = useState<{ id: string; name: string }[]>([]);
  const [households, reloadHouseholds] = useHouseholds();
  const [picking, setPicking] = useState(false);
  /** The share link: undefined while loading, null if there is none yet, false offline. */
  const [link, setLink] = useState<string | null | false | undefined>(undefined);
  const [copied, setCopied] = useState(false);

  const load = () => {
    void fetch(`/api/v1/lists/${list.id}/households`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setShared)
      .catch(() => undefined);
    return fetch(`/api/v1/lists/${list.id}/members`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then(setMembers)
      .catch(() => setError('Mitglieder brauchen eine Verbindung zum Server.'));
  };
  const act = async (url: string, method: 'POST' | 'DELETE', body?: unknown) => {
    if (!(await send(url, method, body))) return setError('Dafür wird eine Verbindung zum Server gebraucht.');
    setError(null);
    await load();
    reloadHouseholds();
  };
  const memberIds = new Set(members?.map((m) => m.id) ?? []);
  // Own household: only single people (the whole household sees the list unless it is private).
  const candidates = (households ?? [])
    .filter((h) => !shared.some((s) => s.id === h.id))
    .map((h) => ({ ...h, people: h.members.filter((p) => !memberIds.has(p.id)) }))
    .filter((h) => (h.own ? h.people.length > 0 && list.visibility === 'private' : true));

  useEffect(() => {
    ref.current?.showModal();
    void load();
    void fetch(`/api/v1/lists/${list.id}/share-link?peek=1`)
      .then((r) => (r.ok ? (r.json() as Promise<{ url: string | null }>) : Promise.reject(new Error())))
      .then((r) => setLink(r.url))
      .catch(() => setLink(false));
  }, []);

  const remove = async (m: Member) => {
    if (!confirm(`${m.displayName} aus „${list.name}“ entfernen?`)) return;
    await fetch(`/api/v1/lists/${list.id}/members/${m.id}`, { method: 'DELETE' }).catch(() => undefined);
    void load();
  };

  return (
    <dialog ref={ref} className="sheet" onClose={onClose}>
      <div className="sheet__body">
        <header className="sheet__header row">
          <h2 className="spacer">Berechtigungen</h2>
          <button type="button" className="icon-btn" aria-label="Schließen" onClick={() => ref.current?.close()}>
            ✕
          </button>
        </header>
        {!me.isGuest && (
          <div className="field">
            <span>Sichtbar für</span>
            {isOwner ? (
              <div className="segmented" role="group" aria-label="Sichtbar für">
                {(['household', 'private'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    className={list.visibility === v ? 'active' : ''}
                    aria-pressed={list.visibility === v}
                    onClick={async () => {
                      await setVisibility(list.id, v);
                      // Who belongs to the list changes on the server; show the new state.
                      setTimeout(() => void load(), 600);
                    }}
                  >
                    {v === 'household' ? `🏠 ${me.household ?? 'Haushalt'}` : '🔒 Nur ich'}
                  </button>
                ))}
              </div>
            ) : (
              <p className="muted">{list.visibility === 'private' ? '🔒 Privat' : `🏠 ${me.household ?? 'Haushalt'}`} – das legt der Besitzer fest.</p>
            )}
          </div>
        )}

        {!me.isGuest && (
          <div className="field">
            <span>Mit anderen Haushalten und Personen teilen</span>
            {shared.length > 0 && (
              <div className="chips">
                {shared.map((h) => (
                  <span key={h.id} className="chip chip--on">
                    🏠 {h.name}
                    {isOwner && (
                      <button
                        type="button"
                        className="chip__remove"
                        aria-label={`Nicht mehr mit ${h.name} teilen`}
                        onClick={() => {
                          if (confirm(`Nicht mehr mit Haushalt „${h.name}“ teilen? Wer nur darüber dabei ist, verliert die Liste.`))
                            void act(`/api/v1/lists/${list.id}/households/${h.id}`, 'DELETE');
                        }}
                      >
                        ✕
                      </button>
                    )}
                  </span>
                ))}
              </div>
            )}
            {!picking ? (
              <div>
                <button type="button" className="btn" onClick={() => setPicking(true)}>
                  + Haushalt oder Person …
                </button>
              </div>
            ) : (
              <div className="share-picker">
                {households === null && <p className="muted">Lade …</p>}
                {households && candidates.length === 0 && <p className="muted">Es gibt niemanden mehr, mit dem du sie teilen könntest.</p>}
                {candidates.map((h) => (
                  <div key={h.id} className="share-picker__household">
                    <div className="row row--center">
                      <strong className="spacer">
                        🏠 {h.name}
                        {h.owner && <span className="owner-badge">👑 Owner</span>}
                      </strong>
                      {!h.own && (
                        <button type="button" className="btn" onClick={() => void act(`/api/v1/lists/${list.id}/households`, 'POST', { householdId: h.id })}>
                          Ganzen Haushalt
                        </button>
                      )}
                    </div>
                    <ul>
                      {h.people.map((p) => (
                        <li key={p.id} className="row row--center">
                          <Avatar user={p} size="xs" />
                          <span className="spacer">{p.displayName}</span>
                          <button type="button" className="link" onClick={() => void act(`/api/v1/lists/${list.id}/members`, 'POST', { userId: p.id })}>
                            Einladen
                          </button>
                        </li>
                      ))}
                      {h.people.length === 0 && <li className="muted">alle schon dabei</li>}
                    </ul>
                  </div>
                ))}
                <button type="button" className="link" onClick={() => setPicking(false)}>
                  Fertig
                </button>
              </div>
            )}
          </div>
        )}

        <h3>Wer ist dabei?</h3>
        {error && <p className="error">{error}</p>}
        <ul className="checklist">
          {members?.map((m) => (
            <li key={m.id}>
              <label>
                <Avatar user={m} />
                <span className="spacer">
                  {m.displayName}
                  {m.id === me.id && <small className="muted"> (du)</small>}
                  {m.isOwner && <small className="muted"> · Besitzer</small>}
                  {m.isGuest && <small className="muted"> · Gast</small>}
                  {m.via === 'household' && <small className="muted"> · Haushalt</small>}
                  {m.via === 'shared' && <small className="muted"> · geteilter Haushalt</small>}
                  {m.via === 'invite' && <small className="muted"> · eingeladen</small>}
                  {m.via === 'link' && !m.isGuest && <small className="muted"> · über Link</small>}
                </span>
                {isOwner && !m.isOwner && (
                  <button type="button" className="link danger" onClick={() => void remove(m)}>
                    entfernen
                  </button>
                )}
              </label>
            </li>
          ))}
        </ul>
        <h3>Einladungslink</h3>
        <p className="muted">
          {list.visibility === 'private' ? 'Diese Liste ist privat. ' : 'Der ganze Haushalt sieht diese Liste. '}
          Wer diesen Link öffnet, kommt dazu – auch ohne Konto als Gast.
        </p>
        {link === undefined ? (
          <p className="muted">Link wird geladen …</p>
        ) : link ? (
          <>
            <input className="input share-link" readOnly value={link} aria-label="Einladungslink" onFocus={(e) => e.currentTarget.select()} />
            <footer className="sheet__actions">
              {isOwner && (
                <button
                  type="button"
                  className="link danger"
                  title="Neuer Link; der alte funktioniert dann nicht mehr"
                  onClick={async () => {
                    if (!confirm('Neuen Link erzeugen? Der alte funktioniert dann nicht mehr. Gäste ohne Konto fliegen raus, wer ein Konto hat, bleibt.'))
                      return;
                    const res = await fetch(`/api/v1/lists/${list.id}/share-link/renew`, { method: 'POST' }).catch(() => null);
                    if (!res?.ok) return setError('Dafür wird eine Verbindung zum Server gebraucht.');
                    setLink(((await res.json()) as { url: string }).url);
                    void load();
                  }}
                >
                  Erneuern
                </button>
              )}
              <span className="spacer" />
              <button
                type="button"
                className="btn"
                onClick={() =>
                  void navigator.clipboard
                    ?.writeText(link)
                    .then(() => setCopied(true))
                    .catch(() => prompt('Zum Kopieren:', link))
                }
              >
                {copied ? 'Kopiert ✓' : 'Kopieren'}
              </button>
              {'share' in navigator && (
                <button type="button" className="btn btn--primary" onClick={() => void shareList(list)}>
                  Teilen …
                </button>
              )}
            </footer>
          </>
        ) : link === null ? (
          <footer className="sheet__actions">
            <span className="spacer" />
            <button
              type="button"
              className="btn btn--primary"
              onClick={async () => {
                const res = await fetch(`/api/v1/lists/${list.id}/share-link`).catch(() => null);
                if (!res?.ok) return setError('Dafür wird eine Verbindung zum Server gebraucht.');
                setLink(((await res.json()) as { url: string }).url);
              }}
            >
              Link erstellen
            </button>
          </footer>
        ) : (
          <p className="muted">Der Link braucht eine Verbindung zum Server.</p>
        )}
      </div>
    </dialog>
  );
}
