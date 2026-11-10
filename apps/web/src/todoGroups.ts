import { comparePositions, dueOf, isoDate, itemDone, itemPersons, itemStatus, packingInfo, type ItemRow, type ListStatus } from '@shopping/shared';
import { useEffect, useState } from 'react';

/** How open tasks are grouped: by due date, status, area, person – or not at all. */
export type GroupBy = 'none' | 'due' | 'area' | 'who' | 'status';

/** A row: a task, or – grouped by "Wer" – one person's part of a task for several people. */
export interface TaskEntry {
  item: ItemRow;
  person?: string;
}

export interface TaskGroup {
  key: string;
  title: string | null;
  items: TaskEntry[];
}

export const GROUP_LABEL: Record<GroupBy, string> = { none: 'Alle', due: 'Fällig', area: 'Bereich', who: 'Wer', status: 'Status' };

const isGroupBy = (v: unknown): v is GroupBy => v === 'none' || v === 'due' || v === 'area' || v === 'who' || v === 'status';

/** The grouping of a list, remembered per device. */
export function useGroupBy(listId: string): [GroupBy, (g: GroupBy) => void] {
  const load = (): GroupBy => {
    try {
      const v = localStorage.getItem(`todo-group:${listId}`);
      if (isGroupBy(v)) return v;
    } catch {
      // Storage unavailable: default grouping.
    }
    return 'due';
  };
  const [state, setState] = useState<{ listId: string; groupBy: GroupBy }>(() => ({ listId, groupBy: load() }));
  // Another list opened in the same component: its own grouping.
  const groupBy = state.listId === listId ? state.groupBy : load();
  useEffect(() => {
    if (state.listId !== listId) setState({ listId, groupBy });
  }, [listId]);
  const set = (g: GroupBy) => {
    setState({ listId, groupBy: g });
    try {
      localStorage.setItem(`todo-group:${listId}`, g);
    } catch {
      // Not important.
    }
  };
  return [groupBy, set];
}

/** The groupings that make sense for these tasks ("Fällig" only once a task has a date). */
export function groupOptions(open: ItemRow[], statuses: ListStatus[]): GroupBy[] {
  const hasDue = open.some((i) => dueOf(i));
  return [...(hasDue ? (['due'] as const) : []), ...(statuses.length ? (['status'] as const) : []), 'area', 'who', 'none'];
}

/** The grouping in effect: a stored one that does not apply any more falls back to the first option. */
export function shownGroup(groupBy: GroupBy, options: GroupBy[]): GroupBy {
  return options.includes(groupBy) ? groupBy : options[0]!;
}

/** Bucket of a due date relative to today. */
function dueBucket(due: string | null, today: string, weekEnd: string): { key: string; title: string; order: number } {
  if (!due) return { key: 'none', title: 'Ohne Datum', order: 5 };
  if (due < today) return { key: 'overdue', title: 'Überfällig', order: 0 };
  if (due === today) return { key: 'today', title: 'Heute', order: 1 };
  if (due <= weekEnd) return { key: 'week', title: 'Nächste 7 Tage', order: 2 };
  return { key: 'later', title: 'Später', order: 3 };
}

/** Open tasks in groups, each sorted by due date, then by hand. */
export function groupTasks(open: ItemRow[], shown: GroupBy, statuses: ListStatus[], defaultStatus: ListStatus | null): TaskGroup[] {
  const now = new Date();
  const today = isoDate(now);
  // The coming seven days (not just until Sunday – on a Sunday "tomorrow" would otherwise be "later").
  const weekEnd = isoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7));
  const sorted = [...open].sort((a, b) => (dueOf(a) ?? '9999').localeCompare(dueOf(b) ?? '9999') || comparePositions(a.position, b.position));
  if (shown === 'none') return [{ key: 'all', title: null, items: sorted.map((item) => ({ item })) }];
  const byKey = new Map<string, { title: string; order: number; items: TaskEntry[] }>();
  // "Wer": a task for several people shows up with each of them who still has to do it.
  const entries: TaskEntry[] =
    shown === 'who'
      ? sorted.flatMap((i) =>
          itemPersons(i).length
            ? itemPersons(i)
                .filter((person) => !itemDone(i).includes(person))
                .map((person) => ({ item: i, person }))
            : [{ item: i }],
        )
      : sorted.map((item) => ({ item }));
  for (const e of entries) {
    const i = e.item;
    const p = packingInfo(i);
    const who = e.person ?? p.person;
    const g =
      shown === 'due'
        ? dueBucket(dueOf(i), today, weekEnd)
        : shown === 'status'
          ? (() => {
              const st = itemStatus(i, statuses, defaultStatus);
              return { key: st?.id ?? '', title: st?.name ?? '', order: statuses.findIndex((x) => x.id === st?.id) };
            })()
          : shown === 'area'
            ? { key: p.container ?? '', title: p.container ?? 'Ohne Bereich', order: p.container ? 0 : 1 }
            : { key: who ?? '', title: who ?? 'Ohne Zuständigkeit', order: who ? 0 : 1 };
    const entry = byKey.get(g.key) ?? { title: g.title, order: g.order, items: [] };
    entry.items.push(e);
    byKey.set(g.key, entry);
  }
  return [...byKey.entries()]
    .sort(([, a], [, b]) => a.order - b.order || a.title.localeCompare(b.title, 'de'))
    .map(([key, g]) => ({ key, title: g.title, items: g.items }));
}
