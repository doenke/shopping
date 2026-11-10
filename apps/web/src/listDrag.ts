import { useEffect, useRef } from 'react';

/**
 * Sorting the lists in the sidebar by dragging them (desktop, mouse or pen). A list moves within its own
 * group (the same `<ul>`: section or ToDo-Kategorie). Below 6 px it stays a click.
 * `onMove(id, beforeId)` puts `id` in front of `beforeId` (null: at the end of the group).
 */
export function useListDrag(onMove: (id: string, beforeId: string | null, afterId: string | null) => void): void {
  const handler = useRef(onMove);
  handler.current = onMove;
  useEffect(() => {
    let start: { li: HTMLElement; x: number; y: number } | null = null;
    let dragging = false;
    let marked: HTMLElement | null = null;
    let place: 'before' | 'after' = 'before';

    const mark = (el: HTMLElement | null, where: 'before' | 'after') => {
      marked?.classList.remove('sort-before', 'sort-after');
      marked = el;
      place = where;
      el?.classList.add(where === 'before' ? 'sort-before' : 'sort-after');
    };
    const siblings = (li: HTMLElement) =>
      [...(li.parentElement?.children ?? [])].filter((c): c is HTMLElement => c instanceof HTMLElement && !!c.dataset.sortId);

    const down = (e: PointerEvent) => {
      if (e.pointerType === 'touch' || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const li = (e.target as HTMLElement).closest<HTMLElement>('.sidebar li[data-sort-id]');
      if (!li) return;
      start = { li, x: e.clientX, y: e.clientY };
    };
    const move = (e: PointerEvent) => {
      if (!start) return;
      if (!dragging && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 6) return;
      if (!dragging) {
        dragging = true;
        start.li.classList.add('sort-dragging');
        document.body.classList.add('sorting-lists');
      }
      // The nearest list of the same group, above or below its middle.
      const others = siblings(start.li).filter((li) => li !== start!.li);
      let best: { li: HTMLElement; where: 'before' | 'after'; d: number } | null = null;
      for (const li of others) {
        const r = li.getBoundingClientRect();
        const mid = r.top + r.height / 2;
        const d = Math.abs(e.clientY - mid);
        if (!best || d < best.d) best = { li, where: e.clientY < mid ? 'before' : 'after', d };
      }
      const box = start.li.parentElement!.getBoundingClientRect();
      const inside = e.clientY >= box.top - 24 && e.clientY <= box.bottom + 24;
      mark(best && inside ? best.li : null, best?.where ?? 'before');
    };
    const up = () => {
      const s = start;
      start = null;
      if (!s || !dragging) return;
      dragging = false;
      s.li.classList.remove('sort-dragging');
      document.body.classList.remove('sorting-lists');
      const target = marked;
      const where = place;
      mark(null, 'before');
      // The click that follows the drag must not open the list.
      const swallow = (c: MouseEvent) => {
        c.stopPropagation();
        c.preventDefault();
      };
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
      if (!target) return;
      const order = siblings(s.li).filter((li) => li !== s.li);
      const at = order.indexOf(target) + (where === 'after' ? 1 : 0);
      handler.current(s.li.dataset.sortId!, order[at]?.dataset.sortId ?? null, order[at - 1]?.dataset.sortId ?? null);
    };
    // Links would otherwise be dragged by the browser itself.
    const nativeDrag = (e: DragEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('.sidebar li[data-sort-id]')) e.preventDefault();
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('dragstart', nativeDrag, true);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('dragstart', nativeDrag, true);
    };
  }, []);
}

/** The whole list order after moving `id` next to its new neighbours (ids not given stay where they are). */
export function moveInOrder(all: string[], id: string, beforeId: string | null, afterId: string | null): string[] {
  const rest = all.filter((x) => x !== id);
  const at = beforeId ? rest.indexOf(beforeId) : afterId ? rest.indexOf(afterId) + 1 : -1;
  if (at < 0) return all;
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}
