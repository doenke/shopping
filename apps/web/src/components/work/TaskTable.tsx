import { comparePositions, generateKeyBetween } from '@shopping/shared';
import { mobile } from '../../places';
import {
  dueOf,
  formatDue,
  itemDone,
  itemPersons,
  itemUrl,
  itemPlaces,
  itemFiles,
  placeLabel,
  placeUrl,
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
import { useEffect, useMemo, useRef, useState } from 'react';
import { addItems, setChecked, setPersonChecked, updateItem } from '../../actions';
import type { ReorderDetail } from '../../itemDrag';
import { entryKeys } from '../../keyboard';
import { useLinkDrop } from '../../linkDrop';
import { PeopleDots, PersonCheckDialog } from '../People';
import { StatusPicker } from './StatusPicker';
import { useSelection } from '../../selection';
import { MicButton, useVoice } from '../../voice';
import { GROUP_LABEL, groupOptions, groupTasks, shownGroup, useGroupBy, type TaskEntry } from '../../todoGroups';

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
  const linkDrop = useLinkDrop(list.id, items);
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
    link: items.some((i) => itemUrl(i) || itemPlaces(i).length || itemFiles(i).length),
  };
  const defaultStatus = listDefaultStatus(list, statuses);
  // Groups like the phone list used to have: Fällig, Status, Bereich, Wer – or all in one.
  const [groupBy, setGroupBy] = useGroupBy(list.id);
  const options = groupOptions(open, statuses);
  const shown = shownGroup(groupBy, options);
  const groups = useMemo(() => groupTasks(open, shown, statuses, defaultStatus), [open, shown, list.settings]);
  const grouping = (cols.status || cols.due || cols.who || cols.area) && (
    <div className="segmented work-group" role="group" aria-label="Gruppieren nach">
      {options.map((g) => (
        <button key={g} type="button" className={g === shown ? 'active' : ''} aria-pressed={g === shown} onClick={() => setGroupBy(g)}>
          {GROUP_LABEL[g]}
        </button>
      ))}
    </div>
  );
  const colSpan = 2 + Object.values(cols).filter(Boolean).length + (compact ? 1 : 0);

  // Dragging a row onto another one of its group (same due date): it takes that place. The order within
  // a due date is the list's own (position), so it shows the same in every grouping and on every device.
  const section = useRef<HTMLElement>(null);
  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  useEffect(() => {
    const el = section.current;
    if (!el) return;
    const onReorder = (e: Event) => {
      const { id, target, after } = (e as CustomEvent<ReorderDetail>).detail;
      const g = groupsRef.current.find((x) => x.items.some((t) => t.item.id === target));
      const moved = g?.items.find((t) => t.item.id === id)?.item;
      if (!g || !moved) return;
      const same = g.items.map((t) => t.item).filter((i) => i.id !== id && dueOf(i) === dueOf(moved));
      const at = same.findIndex((i) => i.id === target) + (after ? 1 : 0);
      try {
        const position = generateKeyBetween(same[at - 1]?.position ?? null, same[at]?.position ?? null);
        void updateItem(id, { position });
      } catch {
        // Two entries with the same place (old data): leave the order as it is.
      }
    };
    el.addEventListener('item-reorder', onReorder);
    return () => el.removeEventListener('item-reorder', onReorder);
  }, []);

  const toggle = ({ item, person }: TaskEntry) => {
    if (person) return void setPersonChecked(item, { [person]: !itemDone(item).includes(person) });
    if (itemPersons(item).length && !item.checked) return setChecking(item.id);
    void setChecked(item, !item.checked);
  };

  /** `reorder`: the group's key – rows with the same key and due date can be put in another order. */
  const row = (entry: TaskEntry, reorder?: string) => {
    const { item, person } = entry;
    const due = dueOf(item);
    const fmt = due ? formatDue(due) : null;
    const area = packingInfo(item).container;
    const url = itemUrl(item);
    const place = itemPlaces(item)[0];
    const files = itemFiles(item);
    return (
      <tr
        key={`${item.id}:${person ?? ''}`}
        data-item-id={item.id}
        data-reorder={reorder === undefined ? undefined : `${reorder}|${dueOf(item) ?? ''}`}
        tabIndex={0}
        className={`work-row${item.id === selected ? ' work-row--selected' : ''}${picked.has(item.id) ? ' is-picked' : ''}${item.checked ? ' work-row--done' : ''}`}
        aria-selected={item.id === selected}
        // Phones: a tap opens the task (focus alone must not – it comes back when the page closes).
        onFocus={() => !compact && onSelect(item.id)}
        onClick={() => (compact ? onOpen(item.id) : onSelect(item.id))}
        onDoubleClick={() => onOpen(item.id)}
        {...entryKeys(
          () => toggle(entry),
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
              toggle(entry);
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
        {cols.who && <td className="work-row__who">{person ?? (itemPersons(item).length ? <PeopleDots item={item} /> : peopleLabel(item))}</td>}
        {cols.area && <td className="work-row__area">{area ? <span className="work-tag">{area}</span> : null}</td>}
        {cols.link && (
          <td className="work-row__link">
            {url && (
              <a href={url} target="_blank" rel="noopener noreferrer" tabIndex={-1} title={url} onClick={(e) => e.stopPropagation()} aria-label="Link öffnen">
                ↗
              </a>
            )}
            {place && (
              <a
                href={placeUrl(place, mobile)}
                target="_blank"
                rel="noopener noreferrer"
                tabIndex={-1}
                title={placeLabel(place)}
                onClick={(e) => e.stopPropagation()}
                aria-label="Ort öffnen"
              >
                📍
              </a>
            )}
            {files.length > 0 && (
              <span className="work-files" title={files.map((f) => f.name).join(', ')} aria-label={`${files.length} Datei${files.length > 1 ? 'en' : ''}`}>
                📎
              </span>
            )}
          </td>
        )}
        {compact && (
          <td className="work-row__grip" data-drag-grip={reorder === undefined ? undefined : ''} aria-hidden>
            {reorder !== undefined && '⠿'}
          </td>
        )}
      </tr>
    );
  };

  const checkItem = items.find((i) => i.id === checking);

  return (
    <section ref={section} className={`work-tasks${compact ? ' work-tasks--compact' : ''}`} aria-label={list.name} {...linkDrop}>
      <TaskHeader
        list={list}
        open={open.length}
        done={done.length}
        viewSwitch={
          grouping || viewSwitch ? (
            <div className="work-tasks__tools">
              {grouping}
              {viewSwitch}
            </div>
          ) : undefined
        }
      />
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
          {groups.map((g) => (
            <tbody key={g.key}>
              {g.title && (
                <tr className={`work-table__group work-table__title${g.key === 'overdue' ? ' work-table__title--alert' : ''}`}>
                  <td colSpan={colSpan}>
                    {g.title} <span className="group__count">{g.items.length}</span>
                  </td>
                </tr>
              )}
              {g.items.map((e) => row(e, g.key))}
            </tbody>
          ))}
          {done.length > 0 && (
            <tbody>
              <tr className="work-table__group">
                <td colSpan={colSpan}>
                  <button type="button" className="link" onClick={() => setShowDone((s) => !s)} aria-expanded={showDone}>
                    {showDone ? '▾' : '▸'} Erledigt ({done.length})
                  </button>
                </td>
              </tr>
              {showDone && done.map((item) => row({ item }))}
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
  const voice = useVoice(setText, () => setText(''));
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
      <MicButton voice={voice} className="work-add__mic" />
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
