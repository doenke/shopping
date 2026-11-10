import { comparePositions } from '@shopping/shared';
import {
  dueOf,
  formatDue,
  itemPersons,
  itemUrl,
  listDescription,
  listGroup,
  listStatuses,
  listDefaultStatus,
  packingInfo,
  parseInput,
  peopleLabel,
  type CatalogIndex,
  type ItemRow,
  type ListRow,
} from '@shopping/shared';
import { useMemo, useState } from 'react';
import { addItems, setChecked } from '../../actions';
import { entryKeys } from '../../keyboard';
import { PeopleDots, PersonCheckDialog } from '../People';
import { StatusPicker } from './StatusPicker';
import { useSelection } from '../../selection';

interface Props {
  list: ListRow;
  items: ItemRow[];
  index: CatalogIndex;
  selected: string | null;
  onSelect: (id: string) => void;
  /** Enter on a row: edit it in the detail column. */
  onOpen: (id: string) => void;
  /** Table ↔ Kanban (top right). */
  viewSwitch?: React.ReactNode;
  /** Phones: each task as one row with the details in a second line (CSS), no column heads. */
  compact?: boolean;
}

const byDue = (a: ItemRow, b: ItemRow) => (dueOf(a) ?? '9999').localeCompare(dueOf(b) ?? '9999') || comparePositions(a.position, b.position);

/** The middle column: a field for new tasks and the tasks as a table (open ones, then "Erledigt"). */
export function TaskTable({ list, items, index, selected, onSelect, onOpen, viewSwitch, compact = false }: Props) {
  const [showDone, setShowDone] = useState(false);
  const [checking, setChecking] = useState<string | null>(null);
  const open = useMemo(() => items.filter((i) => !i.checked).sort(byDue), [items]);
  const done = useMemo(() => items.filter((i) => i.checked).sort((a, b) => (b.checkedAt ?? '').localeCompare(a.checkedAt ?? '')), [items]);
  const statuses = listStatuses(list);
  const picked = useSelection();
  // Only the columns some task uses (no empty "Wer" when nobody is assigned).
  const cols = {
    status: statuses.length > 0,
    due: items.some((i) => dueOf(i)),
    who: items.some((i) => peopleLabel(i)),
    area: items.some((i) => packingInfo(i).container),
    link: items.some((i) => itemUrl(i)),
  };
  const defaultStatus = listDefaultStatus(list, statuses);

  const toggle = (item: ItemRow) => {
    if (itemPersons(item).length && !item.checked) return setChecking(item.id);
    void setChecked(item, !item.checked);
  };

  const row = (item: ItemRow) => {
    const due = dueOf(item);
    const fmt = due ? formatDue(due) : null;
    const area = packingInfo(item).container;
    const url = itemUrl(item);
    return (
      <tr
        key={item.id}
        data-item-id={item.id}
        tabIndex={0}
        className={`work-row${item.id === selected ? ' work-row--selected' : ''}${picked.has(item.id) ? ' is-picked' : ''}${item.checked ? ' work-row--done' : ''}`}
        aria-selected={item.id === selected}
        // Phones: a tap opens the task (focus alone must not – it comes back when the page closes).
        onFocus={() => !compact && onSelect(item.id)}
        onClick={() => (compact ? onOpen(item.id) : onSelect(item.id))}
        onDoubleClick={() => onOpen(item.id)}
        {...entryKeys(
          () => toggle(item),
          () => onOpen(item.id),
        )}
      >
        <td className="work-row__check">
          <button
            type="button"
            tabIndex={-1}
            className={`work-check${item.checked ? ' work-check--on' : ''}`}
            aria-label={item.checked ? 'Wieder offen' : 'Erledigt'}
            aria-pressed={item.checked}
            onClick={(e) => {
              e.stopPropagation();
              toggle(item);
            }}
          >
            {item.checked ? '✓' : ''}
          </button>
        </td>
        <td className="work-row__title">
          {item.name}
          {item.note && <span className="work-row__note">{item.note}</span>}
        </td>
        {cols.status && <td className="work-row__status">{!item.checked && <StatusPicker item={item} statuses={statuses} defaultStatus={defaultStatus} />}</td>}
        {cols.due && (
          <td className={`work-row__due${fmt?.overdue && !item.checked ? ' work-row__due--overdue' : fmt?.today ? ' work-row__due--today' : ''}`}>
            {fmt?.label ?? ''}
          </td>
        )}
        {cols.who && <td className="work-row__who">{itemPersons(item).length ? <PeopleDots item={item} /> : peopleLabel(item)}</td>}
        {cols.area && <td className="work-row__area">{area ? <span className="work-tag">{area}</span> : null}</td>}
        {cols.link && (
          <td className="work-row__link">
            {url && (
              <a href={url} target="_blank" rel="noopener noreferrer" tabIndex={-1} title={url} onClick={(e) => e.stopPropagation()} aria-label="Link öffnen">
                ↗
              </a>
            )}
          </td>
        )}
      </tr>
    );
  };

  const checkItem = items.find((i) => i.id === checking);

  return (
    <section className="work-tasks" aria-label={list.name}>
      <TaskHeader list={list} open={open.length} done={done.length} viewSwitch={viewSwitch} />
      <TaskAdd list={list} index={index} />

      {open.length === 0 && done.length === 0 ? (
        <p className="work-empty">Keine Aufgaben. Oben eintippen – „!Fr“ setzt die Fälligkeit, „@Ben“ wer, „#Kunde“ den Bereich.</p>
      ) : (
        <table className={`work-table${compact ? ' work-table--compact' : ''}`}>
          <thead hidden={compact}>
            <tr>
              <th className="work-row__check" aria-label="Erledigt" />
              <th>Aufgabe</th>
              {cols.status && <th className="work-row__status">Status</th>}
              {cols.due && <th className="work-row__due">Fällig</th>}
              {cols.who && <th className="work-row__who">Wer</th>}
              {cols.area && <th className="work-row__area">Bereich</th>}
              {cols.link && <th className="work-row__link" aria-label="Link" />}
            </tr>
          </thead>
          <tbody>{open.map(row)}</tbody>
          {done.length > 0 && (
            <tbody>
              <tr className="work-table__group">
                <td colSpan={2 + Object.values(cols).filter(Boolean).length}>
                  <button type="button" className="link" onClick={() => setShowDone((s) => !s)} aria-expanded={showDone}>
                    {showDone ? '▾' : '▸'} Erledigt ({done.length})
                  </button>
                </td>
              </tr>
              {showDone && done.map(row)}
            </tbody>
          )}
        </table>
      )}

      {checkItem && <PersonCheckDialog item={checkItem} verb="erledigt" onClose={() => setChecking(null)} />}
    </section>
  );
}

/** "3 offen · 2 erledigt · description" and the view switch. */
export function TaskHeader({ list, open, done, viewSwitch }: { list: ListRow; open: number; done: number; viewSwitch?: React.ReactNode }) {
  const description = listDescription(list);
  return (
    <header className="work-tasks__head">
      <p className="work-tasks__sub">
        {open} offen{done ? ` · ${done} erledigt` : ''}
        {description ? ` · ${description}` : ''}
      </p>
      {viewSwitch}
    </header>
  );
}

/** The field for new tasks (N focuses it); "!Fr" due, "@Ben" who, "#Kunde" area. */
export function TaskAdd({ list, index }: { list: ListRow; index: CatalogIndex }) {
  const [text, setText] = useState('');
  const add = async () => {
    const parsed = parseInput(text, index, 'todo');
    if (!parsed.length) return;
    setText('');
    await addItems(list.id, parsed);
  };
  return (
    <form
      className="work-add"
      onSubmit={(e) => {
        e.preventDefault();
        void add();
      }}
    >
      <span className="work-add__plus" aria-hidden>
        +
      </span>
      <input
        data-add-input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') e.currentTarget.blur();
        }}
        placeholder={taskExample(list)}
        aria-label="Neue Aufgabe"
      />
      {/* The hint is for an empty field; once typing it would only be in the way. */}
      {!text && (
        <kbd className="work-add__key" aria-hidden>
          N
        </kbd>
      )}
    </form>
  );
}

/** Example in the field for new tasks: work things in the Kategorie "Arbeit", home things otherwise. */
export function taskExample(list: ListRow): string {
  return (listGroup(list) ?? '').toLowerCase() === 'arbeit'
    ? 'Neue Aufgabe – z. B. Report vorbereiten !Fr @Ben #Kunde'
    : 'Neue Aufgabe – z. B. Reifen wechseln !Fr @Ben #Auto';
}
