/**
 * Dropping entries onto a list in the sidebar (desktop): the links there carry `data-list-id`; while
 * dragging, the one under the pointer is marked.
 */

let marked: HTMLElement | null = null;

/** The sidebar list under the pointer (not the list the entries come from). */
export function listAt(x: number, y: number, fromListId?: string): { id: string; name: string; el: HTMLElement } | null {
  const el = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('[data-list-id]');
  const id = el?.dataset.listId;
  if (!el || !id || id === fromListId) return null;
  return { id, name: el.dataset.listName ?? '', el };
}

export function markList(el: HTMLElement | null): void {
  if (marked === el) return;
  marked?.classList.remove('drop-list');
  el?.classList.add('drop-list');
  marked = el;
}
