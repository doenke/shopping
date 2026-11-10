import {
  dueOf,
  listReset,
  RESET_LABEL,
  formatDue,
  listDescription,
  itemDone,
  itemPersons,
  itemUrl,
  packingInfo,
  listStatuses,
  listDefaultStatus,
  peopleLabel,
  type CatalogIndex,
  type ItemRow,
  type ListRow,
  type UserInfo,
} from '@shopping/shared';
import { forwardRef, useEffect, useMemo, useState } from 'react';
import { setChecked, setPersonChecked } from '../actions';
import type { RemoteCheck } from '../sync/engine';
import { AddBar } from './AddBar';
import { useLinkDrop } from '../linkDrop';
import { ItemEditor } from './ItemEditor';
import { entryKeys } from '../keyboard';
import { PeopleDots, PersonCheckDialog } from './People';
import { StatusPicker } from './work/StatusPicker';
import { taskExample } from './work/TaskTable';
import { useSelection } from '../selection';
import { GROUP_LABEL, groupOptions, groupTasks, shownGroup, useGroupBy, type TaskEntry } from '../todoGroups';

interface Props {
  list: ListRow;
  items: ItemRow[];
  index: CatalogIndex;
  users: Map<string, UserInfo>;
  remoteChecks: Map<string, RemoteCheck>;
}

const noBoost = () => 0;

/** ToDo list: tasks as a checklist, sorted by due date; done ones move to "Erledigt". */
export const TodoView = forwardRef<HTMLInputElement, Props>(function TodoView({ list, items, index, users, remoteChecks }, addRef) {
  const [editing, setEditing] = useState<string | null>(null);
  // Drag a link onto an entry (adds it there) or onto free space (new entry).
  const linkDrop = useLinkDrop(list.id, items);
  /** Multi-person task being ticked off ("Für wen?"). */
  const [checking, setChecking] = useState<string | null>(null);
  const [undo, setUndo] = useState<ItemRow | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [groupBy, setGroupBy] = useGroupBy(list.id);
  const description = listDescription(list);

  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), 4000);
    return () => clearTimeout(t);
  }, [undo]);

  const open = items.filter((i) => !i.checked || remoteChecks.has(i.id));
  const done = items.filter((i) => i.checked && !remoteChecks.has(i.id)).sort((a, b) => (b.checkedAt ?? '').localeCompare(a.checkedAt ?? ''));

  // Due dates stay out of sight until a task has one: then a plain checklist instead of "Ohne Datum".
  const hasDue = open.some((i) => dueOf(i));
  const statuses = listStatuses(list);
  const picked = useSelection();
  const defaultStatus = listDefaultStatus(list, statuses);
  const hasMeta = hasDue || statuses.length > 0 || open.some((i) => packingInfo(i).person || packingInfo(i).container);
  const options = groupOptions(open, statuses);
  const shown = shownGroup(groupBy, options);

  const groups = useMemo(() => groupTasks(open, shown, statuses, defaultStatus), [open, shown, list.settings]);

  const toggle = ({ item, person }: TaskEntry) => {
    if (person) return void setPersonChecked(item, { [person]: !itemDone(item).includes(person) });
    if (itemPersons(item).length && !item.checked) return setChecking(item.id);
    void setChecked(item, !item.checked);
    if (!item.checked) setUndo(item);
  };

  const row = (entry: TaskEntry) => {
    const { item, person } = entry;
    const p = packingInfo(item);
    const many = itemPersons(item).length > 0 && !person;
    const due = dueOf(item);
    const fmt = due ? formatDue(due) : null;
    const remote = remoteChecks.get(item.id);
    return (
      <li
        key={`${item.id}:${person ?? ''}`}
        data-item-id={item.id}
        className={`task${picked.has(item.id) ? ' is-picked' : ''}${item.checked ? ' task--done' : ''}${remote ? ' tile--remote' : ''}`}
      >
        <button
          type="button"
          className="task__check"
          aria-label={item.checked ? 'Wieder offen' : 'Erledigt'}
          aria-pressed={item.checked}
          onClick={() => toggle(entry)}
        >
          {item.checked ? '✓' : ''}
        </button>
        <button
          type="button"
          className="task__body"
          onClick={() => setEditing(item.id)}
          {...entryKeys(
            () => toggle(entry),
            () => setEditing(item.id),
          )}
        >
          <span className="task__title">{item.name}</span>
          <span className="task__meta">
            {fmt && <span className={`due${fmt.overdue && !item.checked ? ' due--overdue' : fmt.today ? ' due--today' : ''}`}>{fmt.label}</span>}
            {!many && !itemPersons(item).length && p.person && shown !== 'who' && <span>@{peopleLabel(item)}</span>}
            {many && <PeopleDots item={item} />}
            {p.container && shown !== 'area' && <span>#{p.container}</span>}
            {item.note && <span className="muted">{item.note}</span>}
            {remote && <span>✓ {users.get(remote.by)?.displayName}</span>}
          </span>
        </button>
        {statuses.length > 0 && !item.checked && <StatusPicker item={item} statuses={statuses} defaultStatus={defaultStatus} />}
        {itemUrl(item) && (
          <a
            className="task__link"
            href={itemUrl(item)!}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Link öffnen: ${item.name}`}
            title={itemUrl(item)!}
          >
            🔗
          </a>
        )}
      </li>
    );
  };

  const editItem = items.find((i) => i.id === editing);
  const checkItem = items.find((i) => i.id === checking);

  return (
    <section className="listview" {...linkDrop}>
      <AddBar ref={addRef} listId={list.id} listType={list.listType} index={index} boost={noBoost} placeholder={taskExample(list)} />

      {description && <p className="list-description">{description}</p>}

      {items.length > 0 && (
        <div className="packing-head">
          <span className="muted">
            {open.length} offen{done.length ? ` · ${done.length} erledigt` : ''}
            {list.visibility === 'private' ? ' · 🔒 privat' : ''}
            {list.sharing === 'link' || list.sharing === 'both' ? ' · 🔗 per Link geteilt' : ''}
            {list.sharing === 'people' || list.sharing === 'both' ? ' · 👥 geteilt' : ''}
            {listReset(list) ? ` · ↺ ${RESET_LABEL[listReset(list)!]}` : ''}
          </span>
          {hasMeta && (
            <div className="segmented" role="group" aria-label="Gruppieren nach">
              {options.map((g) => (
                <button key={g} type="button" className={g === shown ? 'active' : ''} aria-pressed={g === shown} onClick={() => setGroupBy(g)}>
                  {GROUP_LABEL[g]}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {items.length === 0 && (
        <div className="empty">
          <p className="empty__title">Nichts zu tun</p>
          <p>Tippe oben eine Aufgabe ein. „!morgen“, „!Fr“ oder „!12.11.“ setzt das Fälligkeitsdatum, „@Ben“ wer sich kümmert, „#Garten“ den Bereich.</p>
        </div>
      )}

      {open.length === 0 && items.length > 0 && (
        <div className="empty empty--inline">
          <p className="empty__title">Alles erledigt 🎉</p>
        </div>
      )}

      {groups.map((g) => (
        <div key={g.key} className="group">
          {g.title && (
            <h2 className={`group__title${g.key === 'overdue' ? ' group__title--alert' : ''}`}>
              {g.title} <span className="group__count">{g.items.length}</span>
            </h2>
          )}
          <ul className="tasks">{g.items.map(row)}</ul>
        </div>
      ))}

      {done.length > 0 && (
        <div className="group group--recent">
          <div className="group__head">
            <button type="button" className="group__toggle" onClick={() => setShowDone((s) => !s)} aria-expanded={showDone}>
              {showDone ? '▾' : '▸'} Erledigt ({done.length})
            </button>
          </div>
          {showDone && <ul className="tasks">{done.map((i) => row({ item: i }))}</ul>}
        </div>
      )}

      {undo && (
        <div className="snackbar" role="status">
          <span>{undo.name} erledigt</span>
          <button
            type="button"
            onClick={() => {
              void setChecked(undo, false);
              setUndo(null);
            }}
          >
            Rückgängig
          </button>
        </div>
      )}

      {editItem && <ItemEditor key={editItem.id} item={editItem} list={list} items={items} users={users} onClose={() => setEditing(null)} />}
      {checkItem && <PersonCheckDialog key={checkItem.id} item={checkItem} verb="erledigt" onClose={() => setChecking(null)} />}
    </section>
  );
});
