import { dueOf, formatDue, isoDate, listDescription, packingInfo, type CatalogIndex, type ItemRow, type ListRow, type UserInfo } from '@shopping/shared';
import { forwardRef, useEffect, useMemo, useState } from 'react';
import { setChecked } from '../actions';
import type { RemoteCheck } from '../sync/engine';
import { AddBar } from './AddBar';
import { ItemEditor } from './ItemEditor';

type GroupBy = 'none' | 'due' | 'area' | 'who';

const GROUP_LABEL: Record<GroupBy, string> = { none: 'Alle', due: 'Fällig', area: 'Bereich', who: 'Wer' };

interface Props {
  list: ListRow;
  items: ItemRow[];
  index: CatalogIndex;
  users: Map<string, UserInfo>;
  remoteChecks: Map<string, RemoteCheck>;
}

function loadGroupBy(listId: string): GroupBy {
  try {
    const v = localStorage.getItem(`todo-group:${listId}`);
    if (v === 'none' || v === 'due' || v === 'area' || v === 'who') return v;
  } catch {
    // Storage unavailable: default grouping.
  }
  return 'due';
}

const noBoost = () => 0;

/** Bucket of a due date relative to today. */
function dueBucket(due: string | null, today: string, weekEnd: string): { key: string; title: string; order: number } {
  if (!due) return { key: 'none', title: 'Ohne Datum', order: 5 };
  if (due < today) return { key: 'overdue', title: 'Überfällig', order: 0 };
  if (due === today) return { key: 'today', title: 'Heute', order: 1 };
  if (due <= weekEnd) return { key: 'week', title: 'Diese Woche', order: 2 };
  return { key: 'later', title: 'Später', order: 3 };
}

/** ToDo list: tasks as a checklist, sorted by due date; done ones move to "Erledigt". */
export const TodoView = forwardRef<HTMLInputElement, Props>(function TodoView({ list, items, index, users, remoteChecks }, addRef) {
  const [editing, setEditing] = useState<string | null>(null);
  const [undo, setUndo] = useState<ItemRow | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [groupBy, setGroupBy] = useState<GroupBy>(() => loadGroupBy(list.id));
  const description = listDescription(list);

  useEffect(() => {
    try {
      localStorage.setItem(`todo-group:${list.id}`, groupBy);
    } catch {
      // Not important.
    }
  }, [groupBy, list.id]);

  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), 4000);
    return () => clearTimeout(t);
  }, [undo]);

  const open = items.filter((i) => !i.checked || remoteChecks.has(i.id));
  const done = items.filter((i) => i.checked && !remoteChecks.has(i.id)).sort((a, b) => (b.checkedAt ?? '').localeCompare(a.checkedAt ?? ''));

  // Due dates stay out of sight until a task has one: then a plain checklist instead of "Ohne Datum".
  const hasDue = open.some((i) => dueOf(i));
  const hasMeta = hasDue || open.some((i) => packingInfo(i).person || packingInfo(i).container);
  const options: GroupBy[] = hasDue ? ['due', 'area', 'who'] : ['none', 'area', 'who'];
  const shown: GroupBy = groupBy === 'due' && !hasDue ? 'none' : groupBy === 'none' && hasDue ? 'due' : groupBy;

  const groups = useMemo(() => {
    const now = new Date();
    const today = isoDate(now);
    const weekEnd = isoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + ((7 - now.getDay()) % 7)));
    const sorted = [...open].sort((a, b) => (dueOf(a) ?? '9999').localeCompare(dueOf(b) ?? '9999') || a.position.localeCompare(b.position));
    if (shown === 'none') return [{ key: 'all', title: null as string | null, order: 0, items: sorted }];
    const byKey = new Map<string, { title: string | null; order: number; items: ItemRow[] }>();
    for (const i of sorted) {
      const p = packingInfo(i);
      const g =
        shown === 'due'
          ? dueBucket(dueOf(i), today, weekEnd)
          : shown === 'area'
            ? { key: p.container ?? '', title: p.container ?? 'Ohne Bereich', order: p.container ? 0 : 1 }
            : { key: p.person ?? '', title: p.person ?? 'Ohne Zuständigkeit', order: p.person ? 0 : 1 };
      const entry = byKey.get(g.key) ?? { title: g.title, order: g.order, items: [] };
      entry.items.push(i);
      byKey.set(g.key, entry);
    }
    return [...byKey.entries()]
      .sort(([, a], [, b]) => a.order - b.order || (a.title ?? '').localeCompare(b.title ?? '', 'de'))
      .map(([key, g]) => ({ key, ...g }));
  }, [open, shown]);

  const toggle = (item: ItemRow) => {
    void setChecked(item, !item.checked);
    if (!item.checked) setUndo(item);
  };

  const row = (item: ItemRow) => {
    const p = packingInfo(item);
    const due = dueOf(item);
    const fmt = due ? formatDue(due) : null;
    const remote = remoteChecks.get(item.id);
    return (
      <li key={item.id} className={`task${item.checked ? ' task--done' : ''}${remote ? ' tile--remote' : ''}`}>
        <button type="button" className="task__check" aria-label={item.checked ? 'Wieder offen' : 'Erledigt'} aria-pressed={item.checked} onClick={() => toggle(item)}>
          {item.checked ? '✓' : ''}
        </button>
        <button type="button" className="task__body" onClick={() => setEditing(item.id)}>
          <span className="task__title">{item.name}</span>
          <span className="task__meta">
            {fmt && <span className={`due${fmt.overdue && !item.checked ? ' due--overdue' : fmt.today ? ' due--today' : ''}`}>{fmt.label}</span>}
            {p.person && shown !== 'who' && <span>@{p.person}</span>}
            {p.container && shown !== 'area' && <span>#{p.container}</span>}
            {item.note && <span className="muted">{item.note}</span>}
            {remote && <span>✓ {users.get(remote.by)?.displayName}</span>}
          </span>
        </button>
      </li>
    );
  };

  const editItem = items.find((i) => i.id === editing);

  return (
    <section className="listview">
      <AddBar ref={addRef} listId={list.id} listType={list.listType} index={index} boost={noBoost} placeholder="Neue Aufgabe, z. B. Reifen wechseln !Fr @Ben #Auto" />

      {description && <p className="list-description">{description}</p>}

      {items.length > 0 && (
        <div className="packing-head">
          <span className="muted">
            {open.length} offen{done.length ? ` · ${done.length} erledigt` : ''}
            {list.visibility === 'private' ? ' · 🔒 privat' : ''}
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
          <p>
            Tippe oben eine Aufgabe ein. „!morgen“, „!Fr“ oder „!12.11.“ setzt das Fälligkeitsdatum, „@Ben“ wer sich kümmert, „#Garten“ den
            Bereich.
          </p>
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
          {showDone && <ul className="tasks">{done.map(row)}</ul>}
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
    </section>
  );
});
