import type { ListRow, Me } from '@shopping/shared';
import { useEffect, useRef, useState } from 'react';
import { shareList } from '../actions';
import { Avatar } from './Avatar';

interface Member {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  isGuest: boolean;
  isOwner: boolean;
  via: 'owner' | 'link' | 'household';
}

/** Who is on this list; the owner can remove people. */
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
          <h2 className="spacer">Wer ist dabei?</h2>
          <button type="button" className="icon-btn" aria-label="Schließen" onClick={() => ref.current?.close()}>
            ✕
          </button>
        </header>
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
        <p className="muted">
          {list.visibility === 'private' ? 'Diese Liste ist privat. ' : 'Der ganze Haushalt sieht diese Liste. '}
          Andere kommen über den Link dazu. Gäste ohne Account fliegen raus, wenn der Link erneuert wird.
        </p>
        <footer className="sheet__actions">
          <span className="spacer" />
          <button type="button" className="btn btn--primary" onClick={() => void shareList(list)}>
            Link teilen …
          </button>
        </footer>
      </div>
    </dialog>
  );
}
