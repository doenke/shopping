import type { CatalogIndex, ItemRow, ListRow, UserInfo } from '@shopping/shared';
import { useEffect, useState } from 'react';
import { TaskDetail } from './TaskDetail';
import { TaskTable } from './TaskTable';
import { KanbanBoard } from './KanbanBoard';

interface Props {
  list: ListRow;
  items: ItemRow[];
  index: CatalogIndex;
  users: Map<string, UserInfo>;
  /** Opens the list settings (statuses). */
  onEditList?: () => void;
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
export function TaskBoard({ list, items, index, users, onEditList }: Props) {
  const [view, setView] = useState<View>(() => loadView(list.id));
  useEffect(() => setView(loadView(list.id)), [list.id]);
  const choose = (v: View) => {
    setView(v);
    try {
      localStorage.setItem(`task-view:${list.id}`, v);
    } catch {
      // Only a convenience.
    }
  };
  const viewSwitch = (
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

  useEffect(() => setSelected(null), [list.id]);
  // Kanban: Esc closes the details (not while typing or in a dialog).
  useEffect(() => {
    if (view !== 'kanban') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('dialog[open]') || (e.target as HTMLElement).closest('input, textarea, select')) return;
      setSelected(null);
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
    setOpened((o) => ({ id, n: (o?.n ?? 0) + 1 }));
  };

  return (
    // Kanban needs the width: the details only show while a card is selected.
    <div className={`task-board${view === 'kanban' && !item ? ' task-board--full' : ''}`}>
      <div className="task-board__main">
        {view === 'kanban' ? (
          <KanbanBoard
            list={list}
            items={items}
            index={index}
            selected={selected}
            onSelect={select}
            onOpen={open}
            viewSwitch={viewSwitch}
            onEditList={onEditList}
          />
        ) : (
          <TaskTable list={list} items={items} index={index} selected={selected} onSelect={select} onOpen={open} viewSwitch={viewSwitch} />
        )}
      </div>
      {(item || view === 'table') && (
        <div className="task-board__side">
          {item ? (
            <TaskDetail
              key={item.id}
              item={item}
              list={list}
              items={items}
              users={users}
              focusTitle={opened?.id === item.id ? opened.n : 0}
              onClose={view === 'kanban' ? () => setSelected(null) : undefined}
            />
          ) : (
            <p className="work-empty">Eine Aufgabe auswählen – mit der Maus oder ↑ ↓.</p>
          )}
        </div>
      )}
    </div>
  );
}
