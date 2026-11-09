import type { CatalogIndex, ItemRow, ListRow, UserInfo } from '@shopping/shared';
import { useEffect, useState } from 'react';
import { TaskDetail } from './TaskDetail';
import { TaskTable } from './TaskTable';

interface Props {
  list: ListRow;
  items: ItemRow[];
  index: CatalogIndex;
  users: Map<string, UserInfo>;
}

/**
 * ToDo lists on the desktop: the tasks as a table, the selected task edited in place on the right.
 * Shown for every ToDo list (work or not) – the Arbeitsmodus only decides which lists are in the sidebar.
 */
export function TaskBoard({ list, items, index, users }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  /** Enter/double click: edit this task's title (a plain selection leaves the focus in the table). */
  const [opened, setOpened] = useState<{ id: string; n: number } | null>(null);
  const item = items.find((i) => i.id === selected) ?? null;

  useEffect(() => setSelected(null), [list.id]);

  const select = (id: string) => {
    setSelected(id);
    setOpened((o) => (o?.id === id ? o : null));
  };
  const open = (id: string) => {
    setSelected(id);
    setOpened((o) => ({ id, n: (o?.n ?? 0) + 1 }));
  };

  return (
    <div className="task-board">
      <div className="task-board__main">
        <TaskTable list={list} items={items} index={index} selected={selected} onSelect={select} onOpen={open} />
      </div>
      <div className="task-board__side">
        {item ? (
          <TaskDetail key={item.id} item={item} list={list} items={items} users={users} focusTitle={opened?.id === item.id ? opened.n : 0} />
        ) : (
          <p className="work-empty">Eine Aufgabe auswählen – mit der Maus oder ↑ ↓.</p>
        )}
      </div>
    </div>
  );
}
