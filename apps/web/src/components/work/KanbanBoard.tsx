import {
  dueOf,
  formatDue,
  itemPersons,
  itemStatus,
  itemUrl,
  listDefaultStatus,
  listStatuses,
  packingInfo,
  peopleLabel,
  withStatus,
  type CatalogIndex,
  type ItemRow,
  type ListRow,
  type ListStatus,
} from '@shopping/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { setChecked, updateItem } from '../../actions';
import { entryKeys } from '../../keyboard';
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
  onEditList?: () => void;
}

const DONE = '__done__';
/** Without statuses of its own a list still has "Offen" and "Erledigt". */
const OPEN: ListStatus = { id: '', name: 'Offen' };
/** The done column shows the latest ones; older ones stay in the table. */
const DONE_SHOWN = 30;

const byDue = (a: ItemRow, b: ItemRow) => (dueOf(a) ?? '9999').localeCompare(dueOf(b) ?? '9999') || a.position.localeCompare(b.position);

/**
 * Kanban: one column per status, "Erledigt" last. Drag a card to another column (or Space to tick
 * off); click selects it for the detail column, double click / Enter edits it.
 */
export function KanbanBoard({ list, items, index, selected, onSelect, onOpen, viewSwitch, onEditList }: Props) {
  const own = listStatuses(list);
  const statuses = own.length ? own : [OPEN];
  const defaultStatus = own.length ? listDefaultStatus(list, own) : OPEN;
  const [over, setOver] = useState<string | null>(null);
  /**
   * Dragging with the mouse (or a pen): own pointer handling instead of the browser's drag and drop,
   * which in Chrome can report the previously dragged card after cards moved columns.
   */
  const pending = useRef<{ id: string; x: number; y: number; dx: number; dy: number; width: number } | null>(null);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; dx: number; dy: number; width: number } | null>(null);
  const dragged = useRef(false);
  const [checking, setChecking] = useState<string | null>(null);

  const columns = useMemo(() => {
    const byStatus = new Map<string, ItemRow[]>(statuses.map((s) => [s.id, []]));
    const done: ItemRow[] = [];
    for (const i of items) {
      if (i.checked) done.push(i);
      else byStatus.get((own.length ? itemStatus(i, own, defaultStatus) : OPEN)!.id)!.push(i);
    }
    return {
      open: statuses.map((s) => ({ status: s, items: byStatus.get(s.id)!.sort(byDue) })),
      done: done.sort((a, b) => (b.checkedAt ?? '').localeCompare(a.checkedAt ?? '')),
    };
  }, [items, list.settings]);

  /** Into a column: a status (open again if it was done), or done. One change, so it syncs as one. */
  const moveTo = (item: ItemRow, column: string) => {
    if (column === DONE) {
      if (item.checked) return;
      if (itemPersons(item).length) return setChecking(item.id);
      return void setChecked(item, true);
    }
    const attributes = own.length ? withStatus(item.attributes, column, own, defaultStatus) : item.attributes;
    const same = JSON.stringify(attributes) === JSON.stringify(item.attributes);
    if (!item.checked && same) return;
    void updateItem(item.id, { ...(item.checked ? { checked: false } : {}), ...(same ? {} : { attributes }) });
  };
  useEffect(() => {
    const columnAt = (x: number, y: number) =>
      (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('[data-column]')?.dataset.column ?? null;
    const onMove = (e: PointerEvent) => {
      const p = pending.current;
      if (!p) return;
      if (!dragged.current && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 6) return;
      dragged.current = true;
      setDrag({ ...p, x: e.clientX, y: e.clientY });
      setOver(columnAt(e.clientX, e.clientY));
    };
    const onUp = (e: PointerEvent) => {
      const p = pending.current;
      pending.current = null;
      if (p && dragged.current) {
        const target = columnAt(e.clientX, e.clientY);
        const item = items.find((i) => i.id === p.id);
        if (item && target !== null) moveTo(item, target);
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
  }, [items, list.settings]);

  const toggle = (item: ItemRow) => (item.checked ? moveTo(item, defaultStatus!.id) : moveTo(item, DONE));

  const card = (item: ItemRow) => {
    const due = dueOf(item);
    const fmt = due ? formatDue(due) : null;
    const area = packingInfo(item).container;
    const url = itemUrl(item);
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
        {...entryKeys(
          () => toggle(item),
          () => onOpen(item.id),
        )}
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

  const column = (id: string, title: string, cards: ItemRow[], extra?: React.ReactNode) => (
    <section
      key={id || 'open'}
      className={`kanban-col${over === id ? ' kanban-col--over' : ''}${id === DONE ? ' kanban-col--done' : ''}`}
      aria-label={title}
      data-column={id}
    >
      <h2 className="kanban-col__title">
        {title} <span className="kanban-col__count">{id === DONE ? columns.done.length : cards.length}</span>
      </h2>
      <div className="kanban-col__cards">
        {cards.map(card)}
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
      {!own.length && (
        <p className="kanban-hint">
          Eigene Spalten wie „In Arbeit“ oder „Wartet“:{' '}
          {onEditList ? (
            <button type="button" className="link" onClick={onEditList}>
              Status in den Listeneinstellungen festlegen
            </button>
          ) : (
            'Status in den Listeneinstellungen festlegen'
          )}
          .
        </p>
      )}
      <div className="kanban">
        {columns.open.map((c) => column(c.status.id, c.status.name, c.items))}
        {column(
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
