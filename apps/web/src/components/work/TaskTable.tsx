import {
  dueOf,
  formatDue,
  itemPersons,
  itemUrl,
  itemStatus,
  listDescription,
  listStatuses,
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

interface Props {
  list: ListRow;
  items: ItemRow[];
  index: CatalogIndex;
  selected: string | null;
  onSelect: (id: string) => void;
  /** Enter on a row: edit it in the detail column. */
  onOpen: (id: string) => void;
}

const byDue = (a: ItemRow, b: ItemRow) => (dueOf(a) ?? '9999').localeCompare(dueOf(b) ?? '9999') || a.position.localeCompare(b.position);

/** The middle column: a field for new tasks and the tasks as a table (open ones, then "Erledigt"). */
export function TaskTable({ list, items, index, selected, onSelect, onOpen }: Props) {
  const [text, setText] = useState('');
  const [showDone, setShowDone] = useState(false);
  const [checking, setChecking] = useState<string | null>(null);
  const open = useMemo(() => items.filter((i) => !i.checked).sort(byDue), [items]);
  const done = useMemo(() => items.filter((i) => i.checked).sort((a, b) => (b.checkedAt ?? '').localeCompare(a.checkedAt ?? '')), [items]);
  const description = listDescription(list);
  const statuses = listStatuses(list);

  const add = async () => {
    const parsed = parseInput(text, index, 'todo');
    if (!parsed.length) return;
    setText('');
    await addItems(list.id, parsed);
  };
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
        className={`work-row${item.id === selected ? ' work-row--selected' : ''}${item.checked ? ' work-row--done' : ''}`}
        aria-selected={item.id === selected}
        onFocus={() => onSelect(item.id)}
        onClick={() => onSelect(item.id)}
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
        {statuses.length > 0 && (
          <td className="work-row__status">
            {!item.checked && (
              <span className={`status-tag${itemStatus(item, statuses)?.id === statuses[0]!.id ? ' status-tag--first' : ''}`}>
                {itemStatus(item, statuses)?.name}
              </span>
            )}
          </td>
        )}
        <td className={`work-row__due${fmt?.overdue && !item.checked ? ' work-row__due--overdue' : fmt?.today ? ' work-row__due--today' : ''}`}>
          {fmt?.label ?? ''}
        </td>
        <td className="work-row__who">{itemPersons(item).length ? <PeopleDots item={item} /> : peopleLabel(item)}</td>
        <td className="work-row__area">{area ? <span className="work-tag">{area}</span> : null}</td>
        <td className="work-row__link">
          {url && (
            <a href={url} target="_blank" rel="noopener noreferrer" tabIndex={-1} title={url} onClick={(e) => e.stopPropagation()} aria-label="Link öffnen">
              ↗
            </a>
          )}
        </td>
      </tr>
    );
  };

  const checkItem = items.find((i) => i.id === checking);

  return (
    <section className="work-tasks" aria-label={list.name}>
      <header className="work-tasks__head">
        <div>
          <p className="work-tasks__sub">
            {open.length} offen{done.length ? ` · ${done.length} erledigt` : ''}
            {description ? ` · ${description}` : ''}
          </p>
        </div>
      </header>

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
          placeholder="Neue Aufgabe – z. B. Angebot schicken !Fr @Ben #Kunde"
          aria-label="Neue Aufgabe"
        />
        <kbd className="work-add__key" aria-hidden>
          N
        </kbd>
      </form>

      {open.length === 0 && done.length === 0 ? (
        <p className="work-empty">Keine Aufgaben. Oben eintippen – „!Fr“ setzt die Fälligkeit, „@Ben“ wer, „#Kunde“ den Bereich.</p>
      ) : (
        <table className="work-table">
          <thead>
            <tr>
              <th className="work-row__check" aria-label="Erledigt" />
              <th>Aufgabe</th>
              {statuses.length > 0 && <th className="work-row__status">Status</th>}
              <th>Fällig</th>
              <th>Wer</th>
              <th>Bereich</th>
              <th className="work-row__link" aria-label="Link" />
            </tr>
          </thead>
          <tbody>{open.map(row)}</tbody>
          {done.length > 0 && (
            <tbody>
              <tr className="work-table__group">
                <td colSpan={statuses.length ? 7 : 6}>
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
