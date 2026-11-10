import { comparePositions } from '@shopping/shared';
import {
  dueOf,
  generateKeyBetween,
  formatDue,
  itemPersons,
  itemStatus,
  itemUrl,
  listDefaultStatus,
  listStatuses,
  kanbanShowsDone,
  packingInfo,
  peopleLabel,
  withStatus,
  type CatalogIndex,
  type ItemRow,
  type ListRow,
} from '@shopping/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { setChecked, updateItem } from '../../actions';
import { entryKeys, focusItem } from '../../keyboard';
import { PeopleDots, PersonCheckDialog } from '../People';
import { TaskAdd, TaskHeader } from './TaskTable';

interface Props {
  list: ListRow;
  items: ItemRow[];
  index: CatalogIndex;
  selected: string | null;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  viewSwitch?: React.ReactNode;
}

const DONE = '__done__';
/** The done column shows the latest ones; older ones stay in the table. */
const DONE_SHOWN = 30;

/**
 * Kanban (lists with statuses): one column per status, optionally "Erledigt" last. Drag a card to another
 * column or place (Alt + arrow keys do the same), Space ticks off; a click selects, double click / Enter
 * opens the details.
 */
export function KanbanBoard({ list, items, index, selected, onSelect, onOpen, viewSwitch }: Props) {
  const statuses = listStatuses(list);
  const showDone = kanbanShowsDone(list);
  const defaultStatus = listDefaultStatus(list, statuses);
  /** Where a dragged card would land: the column and the place in it. */
  const [over, setOver] = useState<{ column: string; index: number } | null>(null);
  /**
   * Dragging with the mouse (or a pen): own pointer handling instead of the browser's drag and drop,
   * which in Chrome can report the previously dragged card after cards moved columns.
   */
  const pending = useRef<{ id: string; x: number; y: number; dx: number; dy: number; width: number } | null>(null);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; dx: number; dy: number; width: number } | null>(null);
  const dragged = useRef(false);
  const [checking, setChecking] = useState<string | null>(null);
  /** A card moved by keyboard: give it the focus back after it was re-drawn. */
  const refocus = useRef<string | null>(null);
  useEffect(() => {
    if (!refocus.current) return;
    focusItem(refocus.current);
    refocus.current = null;
  }, [items]);

  const columns = useMemo(() => {
    const byStatus = new Map<string, ItemRow[]>(statuses.map((s) => [s.id, []]));
    const done: ItemRow[] = [];
    for (const i of items) {
      if (i.checked) done.push(i);
      else byStatus.get(itemStatus(i, statuses, defaultStatus)!.id)!.push(i);
    }
    return {
      // Open columns in the hand-made order (drag a card up or down); new ones come last.
      open: statuses.map((s) => ({ status: s, items: byStatus.get(s.id)!.sort((a, b) => comparePositions(a.position, b.position)) })),
      done: done.sort((a, b) => (b.checkedAt ?? '').localeCompare(a.checkedAt ?? '')),
    };
  }, [items, list.settings]);

  /** Into a column (at a place in it): status, done/open and order as one change. */
  const moveTo = (item: ItemRow, column: string, index?: number) => {
    if (column === DONE) {
      if (item.checked) return;
      if (itemPersons(item).length) return setChecking(item.id);
      return void setChecked(item, true);
    }
    const attributes = withStatus(item.attributes, column, statuses, defaultStatus);
    const same = JSON.stringify(attributes) === JSON.stringify(item.attributes);
    let position: string | undefined;
    if (index !== undefined) {
      const cards = columns.open.find((c) => c.status.id === column)?.items ?? [];
      const others = cards.filter((c) => c.id !== item.id);
      const at = Math.max(0, Math.min(index, others.length));
      const unchanged = !item.checked && cards.indexOf(item) === at && same;
      if (!unchanged) {
        try {
          position = generateKeyBetween(others[at - 1]?.position ?? null, others[at]?.position ?? null);
        } catch {
          // Two entries with the same place (old data): leave the order as it is.
        }
      }
    }
    if (!item.checked && same && !position) return;
    void updateItem(item.id, { ...(item.checked ? { checked: false } : {}), ...(same ? {} : { attributes }), ...(position ? { position } : {}) });
  };
  useEffect(() => {
    /** The column under the pointer, and before which card (the dragged one not counted). */
    const dropAt = (x: number, y: number, dragId: string) => {
      const col = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('[data-column]');
      if (!col) return null;
      const cards = [...col.querySelectorAll<HTMLElement>('[data-item-id]')].filter((c) => c.dataset.itemId !== dragId);
      const index = cards.filter((c) => {
        const r = c.getBoundingClientRect();
        return r.top + r.height / 2 < y;
      }).length;
      return { column: col.dataset.column ?? '', index };
    };
    const onMove = (e: PointerEvent) => {
      const p = pending.current;
      if (!p) return;
      if (!dragged.current && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 6) return;
      dragged.current = true;
      setDrag({ ...p, x: e.clientX, y: e.clientY });
      setOver(dropAt(e.clientX, e.clientY, p.id));
    };
    const onUp = (e: PointerEvent) => {
      const p = pending.current;
      pending.current = null;
      if (p && dragged.current) {
        const target = dropAt(e.clientX, e.clientY, p.id);
        const item = items.find((i) => i.id === p.id);
        if (item && target) moveTo(item, target.column, target.column === DONE ? undefined : target.index);
      }
      setDrag(null);
      setOver(null);
      // The click after a drag must not count; reset after it fired.
      setTimeout(() => (dragged.current = false), 0);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [items, list.settings, columns]);

  const toggle = (item: ItemRow) => (item.checked ? moveTo(item, defaultStatus!.id) : moveTo(item, DONE));

  /** Alt + arrow keys: ←/→ into the neighbouring column, ↑/↓ one place up or down. The card keeps the focus. */
  const moveByKey = (item: ItemRow, key: string) => {
    const ids = [...statuses.map((s) => s.id), ...(showDone ? [DONE] : [])];
    const here = item.checked ? DONE : itemStatus(item, statuses, defaultStatus)!.id;
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      const target = ids[ids.indexOf(here) + (key === 'ArrowRight' ? 1 : -1)];
      if (target === undefined) return;
      moveTo(item, target);
    } else if (here !== DONE) {
      const cards = columns.open.find((c) => c.status.id === here)?.items ?? [];
      const at = cards.indexOf(item) + (key === 'ArrowDown' ? 1 : -1);
      if (at < 0 || at >= cards.length) return;
      moveTo(item, here, at);
    }
    // The card is re-drawn in its new place once the change is in: focus it there (see the effect below).
    refocus.current = item.id;
  };

  const card = (item: ItemRow) => {
    const due = dueOf(item);
    const fmt = due ? formatDue(due) : null;
    const area = packingInfo(item).container;
    const url = itemUrl(item);
    const keys = entryKeys(
      () => toggle(item),
      () => onOpen(item.id),
    );
    return (
      <article
        key={item.id}
        data-item-id={item.id}
        tabIndex={0}
        className={`kanban-card${item.id === selected ? ' kanban-card--selected' : ''}${item.checked ? ' kanban-card--done' : ''}${drag?.id === item.id ? ' kanban-card--dragging' : ''}`}
        aria-selected={item.id === selected}
        onPointerDown={(e) => {
          if (e.pointerType === 'touch' || e.button !== 0 || (e.target as HTMLElement).closest('a')) return;
          const r = e.currentTarget.getBoundingClientRect();
          pending.current = { id: item.id, x: e.clientX, y: e.clientY, dx: e.clientX - r.left, dy: e.clientY - r.top, width: r.width };
        }}
        onFocus={() => onSelect(item.id)}
        onClick={() => {
          if (!dragged.current) onSelect(item.id);
        }}
        onDoubleClick={() => onOpen(item.id)}
        onKeyDown={(e) => {
          if (e.altKey && e.key.startsWith('Arrow')) {
            e.preventDefault();
            moveByKey(item, e.key);
          } else keys.onKeyDown(e);
        }}
        onKeyUp={keys.onKeyUp}
      >
        <div className="kanban-card__title">{item.name}</div>
        {item.note && <div className="kanban-card__note">{item.note}</div>}
        {(fmt || area || url || itemPersons(item).length || peopleLabel(item)) && (
          <div className="kanban-card__meta">
            {fmt && (
              <span className={`kanban-card__due${fmt.overdue && !item.checked ? ' work-row__due--overdue' : fmt.today ? ' work-row__due--today' : ''}`}>
                {fmt.label}
              </span>
            )}
            {area && <span className="work-tag">{area}</span>}
            {itemPersons(item).length ? <PeopleDots item={item} /> : peopleLabel(item) ? <span className="muted">{peopleLabel(item)}</span> : null}
            {url && (
              <a href={url} target="_blank" rel="noopener noreferrer" tabIndex={-1} title={url} onClick={(e) => e.stopPropagation()} aria-label="Link öffnen">
                ↗
              </a>
            )}
          </div>
        )}
      </article>
    );
  };

  /** The cards of a column, with a mark where the dragged card would go (open columns only). */
  const withDropMark = (id: string, cards: ItemRow[]): (ItemRow | 'drop')[] => {
    if (!drag || over?.column !== id || id === DONE) return cards;
    const out: (ItemRow | 'drop')[] = [];
    let n = 0;
    for (const c of cards) {
      if (c.id !== drag.id && n++ === over.index) out.push('drop');
      out.push(c);
    }
    if (!out.includes('drop')) out.push('drop');
    return out;
  };

  const column = (id: string, title: string, cards: ItemRow[], extra?: React.ReactNode) => (
    <section
      key={id || 'open'}
      className={`kanban-col${over?.column === id ? ' kanban-col--over' : ''}${id === DONE ? ' kanban-col--done' : ''}`}
      aria-label={title}
      data-column={id}
    >
      <h2 className="kanban-col__title">
        {title} <span className="kanban-col__count">{id === DONE ? columns.done.length : cards.length}</span>
      </h2>
      <div className="kanban-col__cards">
        {withDropMark(id, cards).map((c) => (typeof c === 'string' ? <div key="drop" className="kanban-drop" aria-hidden /> : card(c)))}
        {extra}
      </div>
    </section>
  );

  const checkItem = items.find((i) => i.id === checking);
  const dragItem = drag ? items.find((i) => i.id === drag.id) : undefined;
  const doneShown = columns.done.slice(0, DONE_SHOWN);

  return (
    <section className="work-tasks work-tasks--kanban" aria-label={list.name}>
      <TaskHeader list={list} open={items.length - columns.done.length} done={columns.done.length} viewSwitch={viewSwitch} />
      <TaskAdd list={list} index={index} />
      <div className="kanban">
        {columns.open.map((c) => column(c.status.id, c.status.name, c.items))}
        {/* "Erledigt" only when the list settings say so; otherwise done cards just leave the board. */}
        {showDone &&
          column(
            DONE,
            'Erledigt',
            doneShown,
            columns.done.length > DONE_SHOWN ? <p className="muted kanban-col__more">+ {columns.done.length - DONE_SHOWN} ältere (in der Tabelle)</p> : null,
          )}
      </div>
      {drag && dragItem && (
        <div className="kanban-ghost" style={{ left: drag.x - drag.dx, top: drag.y - drag.dy, width: drag.width }} aria-hidden>
          <div className="kanban-card">
            <div className="kanban-card__title">{dragItem.name}</div>
          </div>
        </div>
      )}
      {checkItem && <PersonCheckDialog item={checkItem} verb="erledigt" onClose={() => setChecking(null)} />}
    </section>
  );
}
