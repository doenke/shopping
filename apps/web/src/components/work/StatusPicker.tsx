import { itemStatus, withStatus, type ItemRow, type ListStatus } from '@shopping/shared';
import { useEffect, useRef, useState } from 'react';
import { updateItem } from '../../actions';

interface Props {
  item: ItemRow;
  statuses: ListStatus[];
  defaultStatus: ListStatus | null;
}

/**
 * The status as a pill; a click shows all statuses as pills underneath to pick one.
 * Esc, a click outside or picking closes it. Clicks stay here (the row is not selected or opened by them).
 */
export function StatusPicker({ item, statuses, defaultStatus }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = itemStatus(item, statuses, defaultStatus);

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const choose = (st: ListStatus) => {
    setOpen(false);
    if (st.id === current?.id) return;
    void updateItem(item.id, { attributes: withStatus(item.attributes, st.id, statuses, defaultStatus) });
  };

  return (
    <div
      className="status-picker"
      ref={ref}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className={`status-tag status-tag--button${current?.id === defaultStatus?.id ? ' status-tag--first' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Status: ${current?.name ?? ''} – ändern`}
        onClick={() => setOpen((o) => !o)}
      >
        {current?.name}
      </button>
      {open && (
        <div className="status-picker__menu" role="listbox" aria-label="Status wählen">
          {statuses.map((st) => (
            <button
              key={st.id}
              type="button"
              role="option"
              aria-selected={st.id === current?.id}
              className={`status-tag status-tag--button${st.id === current?.id ? ' status-tag--on' : ''}`}
              onClick={() => choose(st)}
            >
              {st.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
