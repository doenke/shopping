import { itemSpecification, type ItemRow, type ListRow } from '@shopping/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { db } from '../db';
import { navigate } from '../hooks';
import { focusItem } from '../keyboard';

interface Props {
  /** The lists to search (in the Arbeitsmodus only its lists). */
  lists: ListRow[];
  onClose: () => void;
}

type Hit = { kind: 'list'; list: ListRow } | { kind: 'item'; item: ItemRow; list: ListRow };

const norm = (s: string) =>
  s
    .toLocaleLowerCase('de')
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '');

/** Strg+K: find a list or an entry by name and jump there. */
export function CommandPalette({ lists, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  useEffect(() => ref.current?.showModal(), []);
  const byId = useMemo(() => new Map(lists.map((l) => [l.id, l])), [lists]);
  const items = useLiveQuery(
    () =>
      db.items
        .where('listId')
        .anyOf([...byId.keys()])
        .toArray(),
    [byId],
  );

  const hits = useMemo<Hit[]>(() => {
    const q = norm(query.trim());
    if (!q) return lists.slice(0, 8).map((list) => ({ kind: 'list' as const, list }));
    const listHits = lists.filter((l) => norm(l.name).includes(q)).map((list) => ({ kind: 'list' as const, list }));
    const itemHits = (items ?? [])
      .filter((i) => !i.deleted && (norm(i.name).includes(q) || norm(i.note ?? '').includes(q)))
      // Open ones first, then by name.
      .sort((a, b) => Number(a.checked) - Number(b.checked) || a.name.localeCompare(b.name, 'de'))
      .slice(0, 30)
      .map((item) => ({ kind: 'item' as const, item, list: byId.get(item.listId)! }));
    return [...listHits.slice(0, 8), ...itemHits];
  }, [query, lists, items, byId]);

  useEffect(() => setActive(0), [query]);

  const choose = (h: Hit | undefined) => {
    if (!h) return;
    ref.current?.close();
    navigate({ page: 'list', listId: h.list.id });
    if (h.kind === 'item') focusItem(h.item.id);
  };

  return (
    <dialog ref={ref} className="sheet palette" onClose={onClose} aria-label="Suchen">
      <div className="sheet__body">
        <input
          className="palette__input"
          autoFocus
          value={query}
          placeholder="Liste oder Eintrag suchen …"
          aria-label="Suchen"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(0, Math.min(hits.length - 1, a + (e.key === 'ArrowDown' ? 1 : -1))));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              choose(hits[active]);
            }
          }}
        />
        <ul className="palette__results" role="listbox">
          {hits.map((h, i) => (
            <li key={h.kind === 'list' ? `l:${h.list.id}` : `i:${h.item.id}`}>
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                className={`palette__hit${i === active ? ' palette__hit--active' : ''}${h.kind === 'item' && h.item.checked ? ' palette__hit--done' : ''}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(h)}
              >
                {h.kind === 'list' ? (
                  <>
                    <span className="palette__name">{h.list.name}</span>
                    <span className="muted">Liste</span>
                  </>
                ) : (
                  <>
                    <span className="palette__name">
                      {h.item.name}
                      {itemSpecification(h.item) && <small className="muted"> {itemSpecification(h.item)}</small>}
                    </span>
                    <span className="muted">{h.list.name}</span>
                  </>
                )}
              </button>
            </li>
          ))}
          {query && !hits.length && <li className="muted palette__empty">Nichts gefunden</li>}
        </ul>
        <p className="muted palette__hint">↑↓ auswählen · Enter öffnen · Esc schließen</p>
      </div>
    </dialog>
  );
}
