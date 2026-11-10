import { inUserOrder, type ListRow } from '@shopping/shared';
import { useEffect, useRef, useState } from 'react';
import { moveItems, undoMove } from '../actions';
import { useLists, useMe } from '../hooks';
import { clearSelection } from '../selection';
import { showToast } from '../toast';
import { LIST_TYPE_LABEL } from './NewListDialog';

interface Props {
  ids: string[];
  /** The list the entries are on (not offered). */
  fromListId?: string;
  onClose: () => void;
}

/** "Verschieben nach …" (V): pick a list, the entries move there – with "Rückgängig". */
export function MoveDialog({ ids, fromListId, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const me = useMe();
  const lists = inUserOrder(
    useLists().filter((l) => !l.isTemplate && !l.archivedAt && l.id !== fromListId),
    me?.listOrder,
    (l) => l.id,
  );
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  useEffect(() => ref.current?.showModal(), []);
  const shown = lists.filter((l) => l.name.toLowerCase().includes(query.trim().toLowerCase()));

  const choose = async (target: ListRow | undefined) => {
    if (!target) return;
    ref.current?.close();
    await moveAndTell(ids, target);
  };

  return (
    <dialog ref={ref} className="sheet palette" onClose={onClose} aria-label="Verschieben nach">
      <div className="sheet__body">
        <input
          className="palette__input"
          autoFocus
          value={query}
          aria-label="Liste suchen"
          placeholder={`${ids.length === 1 ? '1 Eintrag' : `${ids.length} Einträge`} verschieben nach …`}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(0, Math.min(shown.length - 1, a + (e.key === 'ArrowDown' ? 1 : -1))));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              // A hover from before the filtering can point past the end – then the first hit.
              void choose(shown[active] ?? shown[0]);
            }
          }}
        />
        <ul className="palette__results" role="listbox" aria-label="Listen">
          {shown.map((l, i) => (
            <li key={l.id}>
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                className={`palette__hit${i === active ? ' palette__hit--active' : ''}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => void choose(l)}
              >
                <span className="palette__name">{l.name}</span>
                <span className="muted">{LIST_TYPE_LABEL[l.listType]}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </dialog>
  );
}

/** Moves and says so, with "Rückgängig" (also used when dragging onto the sidebar). */
export async function moveAndTell(ids: string[], target: Pick<ListRow, 'id' | 'name'>): Promise<void> {
  const moved = await moveItems(ids, target.id);
  clearSelection();
  if (!moved.created.length) return;
  const what = moved.originals.length === 1 ? `„${moved.originals[0]!.name}“` : `${moved.originals.length} Einträge`;
  showToast(`${what} nach „${target.name}“ verschoben`, { label: 'Rückgängig', run: () => void undoMove(moved) });
}
