import { useEffect, useState } from 'react';
import { Avatar } from './Avatar';

interface Person {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

const MAX = 4;

function cached(listId: string): Person[] {
  try {
    return JSON.parse(localStorage.getItem(`members:${listId}`) ?? '[]') as Person[];
  } catch {
    return [];
  }
}

/**
 * Everyone with access to the list, as a row of profile pictures in the title bar.
 * The last known state is kept per list, so it also shows offline.
 */
export function ListAvatars({ listId, refresh, onClick }: { listId: string; refresh: number; onClick: () => void }) {
  const [people, setPeople] = useState<Person[]>(() => cached(listId));

  useEffect(() => {
    setPeople(cached(listId));
    let cancelled = false;
    const load = () =>
      fetch(`/api/v1/lists/${listId}/members`)
        .then((r) => (r.ok ? (r.json() as Promise<Person[]>) : Promise.reject(new Error())))
        .then((rows) => {
          if (cancelled) return;
          const list = rows.map(({ id, displayName, avatarUrl }) => ({ id, displayName, avatarUrl }));
          setPeople(list);
          try {
            localStorage.setItem(`members:${listId}`, JSON.stringify(list));
          } catch {
            // Not important.
          }
        })
        .catch(() => undefined);
    void load();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [listId, refresh]);

  if (people.length === 0) return null;
  const shown = people.length > MAX ? people.slice(0, MAX - 1) : people;
  const more = people.length - shown.length;
  return (
    <button type="button" className="avatar-stack" onClick={onClick} title={people.map((p) => p.displayName).join(', ')} aria-label={`Zugriff: ${people.map((p) => p.displayName).join(', ')}`}>
      {shown.map((p) => (
        <Avatar key={p.id} user={p} />
      ))}
      {more > 0 && <span className="avatar avatar-stack__more">+{more}</span>}
    </button>
  );
}
