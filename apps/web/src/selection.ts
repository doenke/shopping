import { useSyncExternalStore } from 'react';

/**
 * Several entries selected at once (desktop): Shift + arrow keys or Shift-/Ctrl-click. What is selected can
 * be moved together – into another Kanban column (Alt + arrows, dragging) or another list (dragging onto
 * the sidebar, V) – or deleted (Entf). The selection belongs to the open list and goes when it changes.
 */

let selected: ReadonlySet<string> = new Set();
let anchor: string | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function selection(): ReadonlySet<string> {
  return selected;
}

export function selectionAnchor(): string | null {
  return anchor;
}

export function setSelection(ids: Iterable<string>, newAnchor: string | null = anchor): void {
  selected = new Set(ids);
  anchor = selected.size ? newAnchor : null;
  emit();
}

export function toggleSelected(id: string): void {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  setSelection(next, id);
}

export function clearSelection(): void {
  if (!selected.size && !anchor) return;
  selected = new Set();
  anchor = null;
  emit();
}

export function useSelection(): ReadonlySet<string> {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => selected,
  );
}

/** The entries an action is about: the selection if the given one is part of it, else just that one. */
export function selectedOr(id: string): string[] {
  return selected.has(id) ? [...selected] : [id];
}
