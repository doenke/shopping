import { listStatuses, type CatalogIndex, type ItemRow, type ListRow, type UserInfo } from '@shopping/shared';
import { useEffect, useRef, useState } from 'react';
import { TaskDetail } from './TaskDetail';
import { TaskTable } from './TaskTable';
import { KanbanBoard } from './KanbanBoard';

interface Props {
  list: ListRow;
  items: ItemRow[];
  index: CatalogIndex;
  users: Map<string, UserInfo>;
  /** Phones: compact rows, the details as a full-screen page (tap a task). */
  compact?: boolean;
}

type View = 'table' | 'kanban';

function loadView(listId: string): View {
  try {
    return localStorage.getItem(`task-view:${listId}`) === 'kanban' ? 'kanban' : 'table';
  } catch {
    return 'table';
  }
}

/**
 * ToDo lists on the desktop: the tasks as a table, the selected task edited in place on the right.
 * Shown for every ToDo list (work or not) – the Arbeitsmodus only decides which lists are in the sidebar.
 */
export function TaskBoard({ list, items, index, users, compact = false }: Props) {
  // Kanban needs columns: without statuses of its own a list is just the table (no switch).
  const hasStatuses = listStatuses(list).length > 0 && !compact;
  const [stored, setView] = useState<View>(() => loadView(list.id));
  const view: View = hasStatuses ? stored : 'table';
  useEffect(() => setView(loadView(list.id)), [list.id]);
  const choose = (v: View) => {
    setView(v);
    try {
      localStorage.setItem(`task-view:${list.id}`, v);
    } catch {
      // Only a convenience.
    }
  };
  const viewSwitch = !hasStatuses ? undefined : (
    <div className="segmented" role="group" aria-label="Ansicht">
      {(['table', 'kanban'] as const).map((v) => (
        <button key={v} type="button" className={v === view ? 'active' : ''} aria-pressed={v === view} onClick={() => choose(v)}>
          {v === 'table' ? 'Tabelle' : 'Kanban'}
        </button>
      ))}
    </div>
  );
  const [selected, setSelected] = useState<string | null>(null);
  /** Enter/double click: edit this task's title (a plain selection leaves the focus in the table). */
  const [opened, setOpened] = useState<{ id: string; n: number } | null>(null);
  const item = items.find((i) => i.id === selected) ?? null;
  /** Kanban: a click only selects; the details open on double click / Enter and stay until closed. */
  const [detailsOpen, setDetailsOpen] = useState(false);
  const showDetails = view === 'table' || (detailsOpen && !!item);

  useEffect(() => {
    setSelected(null);
    setDetailsOpen(false);
  }, [list.id]);
  // Kanban: Esc closes the details (not while typing or in a dialog).
  useEffect(() => {
    if (view !== 'kanban') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('dialog[open]') || (e.target as HTMLElement).closest('input, textarea, select')) return;
      setDetailsOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view]);

  const select = (id: string) => {
    setSelected(id);
    setOpened((o) => (o?.id === id ? o : null));
  };
  const open = (id: string) => {
    setSelected(id);
    setDetailsOpen(true);
    setOpened((o) => ({ id, n: (o?.n ?? 0) + 1 }));
  };

  if (compact) {
    // Phones: a tap opens the task as a page of its own (back with ✕ or the back gesture).
    return (
      <>
        <TaskTable list={list} items={items} index={index} selected={null} onSelect={() => undefined} onOpen={open} compact />
        {detailsOpen && item && <TaskPage key={item.id} item={item} list={list} items={items} users={users} onClose={() => setDetailsOpen(false)} />}
      </>
    );
  }

  return (
    // Kanban needs the width: the details only show once opened (double click / Enter).
    <div className={`task-board${!showDetails ? ' task-board--full' : ''}`}>
      <div className="task-board__main">
        {view === 'kanban' ? (
          <KanbanBoard list={list} items={items} index={index} selected={selected} onSelect={select} onOpen={open} viewSwitch={viewSwitch} />
        ) : (
          <TaskTable list={list} items={items} index={index} selected={selected} onSelect={select} onOpen={open} viewSwitch={viewSwitch} />
        )}
      </div>
      {showDetails && (
        <div className="task-board__side">
          {item ? (
            <TaskDetail
              key={item.id}
              item={item}
              list={list}
              items={items}
              users={users}
              focusTitle={opened?.id === item.id ? opened.n : 0}
              onClose={view === 'kanban' ? () => setDetailsOpen(false) : undefined}
            />
          ) : (
            <p className="work-empty">Eine Aufgabe auswählen – mit der Maus oder ↑ ↓.</p>
          )}
        </div>
      )}
    </div>
  );
}

/** The details of a task as a full-screen page (phones). */
function TaskPage({
  item,
  list,
  items,
  users,
  onClose,
}: {
  item: ItemRow;
  list: ListRow;
  items: ItemRow[];
  users: Map<string, UserInfo>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => ref.current?.showModal(), []);
  return (
    <dialog ref={ref} className="task-page" onClose={onClose} aria-label={item.name}>
      <TaskDetail item={item} list={list} items={items} users={users} focusTitle={0} onClose={() => ref.current?.close()} />
    </dialog>
  );
}
