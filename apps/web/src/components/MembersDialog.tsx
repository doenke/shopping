import type { ListRow, Me } from '@shopping/shared';
import { useEffect, useRef, useState } from 'react';
import { setVisibility, shareList } from '../actions';
import { Avatar } from './Avatar';

interface Member {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  isGuest: boolean;
  isOwner: boolean;
  via: 'owner' | 'link' | 'household';
}

/** Berechtigungen: who sees the list (household or private), who is on it, the share link. */
export function MembersDialog({ list, me, onClose }: { list: ListRow; me: Me; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isOwner = list.ownerId === me.id;

  const load = () =>
    fetch(`/api/v1/lists/${list.id}/members`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then(setMembers)
      .catch(() => setError('Mitglieder brauchen eine Verbindung zum Server.'));

  useEffect(() => {
    ref.current?.showModal();
    void load();
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
              <p className="muted">
                {list.visibility === 'private' ? '🔒 Privat' : `🏠 ${me.household ?? 'Haushalt'}`} – das legt der Besitzer fest.
              </p>
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
        <h3>Link</h3>
        <p className="muted">
          {list.visibility === 'private' ? 'Diese Liste ist privat. ' : 'Der ganze Haushalt sieht diese Liste. '}
          Andere kommen über den Link dazu, auch ohne Konto als Gast.
          {isOwner && ' Ein neuer Link macht den alten ungültig: Gäste fliegen raus, wer ein Konto hat, bleibt.'}
        </p>
        <footer className="sheet__actions">
          {isOwner && (
            <button
              type="button"
              className="link danger"
              onClick={async () => {
                if (!confirm('Neuen Link erzeugen? Der alte funktioniert dann nicht mehr. Gäste ohne Konto fliegen raus.')) return;
                await shareList(list, true);
                void load();
              }}
            >
              Link erneuern
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn btn--primary" onClick={() => void shareList(list)}>
            Link teilen …
          </button>
        </footer>
      </div>
    </dialog>
  );
}
