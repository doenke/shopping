import { useEffect, useRef } from 'react';
import { moveAndTell } from './components/MoveDialog';
import { listAt, markList } from './listDrop';
import { selectedOr } from './selection';

/** Asked by the ToDo table when a row is dropped onto another one of the same group (`data-reorder`). */
export interface ReorderDetail {
  id: string;
  target: string;
  after: boolean;
}

/** The row under the pointer the dragged one may be placed next to (same `data-reorder` key), and on which side. */
function reorderAt(x: number, y: number, from: HTMLElement): { el: HTMLElement; after: boolean } | null {
  const key = from.dataset.reorder;
  if (!key) return null;
  const el = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('[data-reorder]');
  if (!el || el.dataset.reorder !== key || el.parentElement !== from.parentElement) return null;
  const r = el.getBoundingClientRect();
  return { el, after: y > r.top + r.height / 2 };
}

let marked: HTMLElement | null = null;
function markRow(at: { el: HTMLElement; after: boolean } | null): void {
  marked?.classList.remove('drop-before', 'drop-after');
  marked = at?.el ?? null;
  marked?.classList.add(at!.after ? 'drop-after' : 'drop-before');
}

/**
 * Dragging entries onto another list in the sidebar (desktop, mouse or pen): tiles, ToDo rows and table
 * rows. The Kanban board has its own dragging (columns) and handles the sidebar itself. Several selected
 * entries move together. Below 6 px it stays a click.
 *
 * ToDo rows can also be put into another order this way: dropped onto a row of the same group (same
 * `data-reorder` key), the table gets an `item-reorder` event. On touch screens only a grip
 * (`[data-drag-grip]`) starts dragging – everywhere else a finger scrolls.
 */
export function useItemDrag(listId: string | undefined): void {
  const current = useRef(listId);
  current.current = listId;
  useEffect(() => {
    let start: { id: string; el: HTMLElement; x: number; y: number; label: string } | null = null;
    let ghost: HTMLElement | null = null;
    let dragging = false;

    const down = (e: PointerEvent) => {
      if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const grip = (e.target as HTMLElement).closest('[data-drag-grip]');
      if (e.pointerType === 'touch' && !grip) return;
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-item-id]');
      if (!el || el.closest('.kanban, dialog, .addbar')) return;
      // Controls inside an entry (check box, status, link) keep working as usual.
      const control = (e.target as HTMLElement).closest('button, a, input, select, textarea');
      if (control && control !== el && el.contains(control)) return;
      // A finger on the grip: no scrolling, no text selection while it moves.
      if (grip) e.preventDefault();
      const label = el.querySelector('.tile__name, .task__title, .work-row__title')?.childNodes[0]?.textContent ?? el.textContent ?? '';
      start = { id: el.dataset.itemId!, el, x: e.clientX, y: e.clientY, label: label.trim() };
    };
    const move = (e: PointerEvent) => {
      if (!start) return;
      if (!dragging && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 6) return;
      if (!dragging) {
        dragging = true;
        const n = selectedOr(start.id).length;
        if (n === 1) start.el.classList.add('is-dragged');
        ghost = document.createElement('div');
        ghost.className = 'drag-ghost';
        ghost.textContent = n > 1 ? `${n} Einträge` : start.label;
        document.body.appendChild(ghost);
        document.body.classList.add('dragging-items');
      }
      ghost!.style.left = `${e.clientX + 12}px`;
      ghost!.style.top = `${e.clientY + 8}px`;
      // Several selected entries only go to another list; one alone can also change its place.
      const row = selectedOr(start.id).length === 1 ? reorderAt(e.clientX, e.clientY, start.el) : null;
      markRow(row && row.el !== start.el ? row : null);
      markList(row ? null : (listAt(e.clientX, e.clientY, current.current)?.el ?? null));
    };
    const up = (e: PointerEvent) => {
      const s = start;
      start = null;
      if (!dragging || !s) return;
      dragging = false;
      ghost?.remove();
      ghost = null;
      document.body.classList.remove('dragging-items');
      s.el.classList.remove('is-dragged');
      markList(null);
      markRow(null);
      // Cancelled (e.g. the browser took over the gesture): nothing moves.
      const row = e.type !== 'pointercancel' && selectedOr(s.id).length === 1 ? reorderAt(e.clientX, e.clientY, s.el) : null;
      if (e.type === 'pointercancel') {
        // Nothing.
      } else if (row) {
        if (row.el !== s.el) {
          const detail: ReorderDetail = { id: s.id, target: row.el.dataset.itemId!, after: row.after };
          row.el.dispatchEvent(new CustomEvent<ReorderDetail>('item-reorder', { bubbles: true, detail }));
        }
      } else {
        const target = listAt(e.clientX, e.clientY, current.current);
        if (target) void moveAndTell(selectedOr(s.id), target);
      }
      // The click that follows the drag must not tick anything off or open it.
      const swallow = (c: MouseEvent) => {
        c.stopPropagation();
        c.preventDefault();
      };
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointercancel', up);
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, []);
}
