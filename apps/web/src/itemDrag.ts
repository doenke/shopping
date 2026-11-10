import { useEffect, useRef } from 'react';
import { moveAndTell } from './components/MoveDialog';
import { listAt, markList } from './listDrop';
import { selectedOr } from './selection';

/**
 * Dragging entries onto another list in the sidebar (desktop, mouse or pen): tiles, ToDo rows and table
 * rows. The Kanban board has its own dragging (columns) and handles the sidebar itself. Several selected
 * entries move together. Below 6 px it stays a click.
 */
export function useItemDrag(listId: string | undefined): void {
  const current = useRef(listId);
  current.current = listId;
  useEffect(() => {
    let start: { id: string; x: number; y: number; label: string } | null = null;
    let ghost: HTMLElement | null = null;
    let dragging = false;

    const down = (e: PointerEvent) => {
      if (e.pointerType === 'touch' || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-item-id]');
      if (!el || el.closest('.kanban, dialog, .addbar')) return;
      // Controls inside an entry (check box, status, link) keep working as usual.
      const control = (e.target as HTMLElement).closest('button, a, input, select, textarea');
      if (control && control !== el && el.contains(control)) return;
      const label = el.querySelector('.tile__name, .task__title, .work-row__title')?.childNodes[0]?.textContent ?? el.textContent ?? '';
      start = { id: el.dataset.itemId!, x: e.clientX, y: e.clientY, label: label.trim() };
    };
    const move = (e: PointerEvent) => {
      if (!start) return;
      if (!dragging && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 6) return;
      if (!dragging) {
        dragging = true;
        const n = selectedOr(start.id).length;
        ghost = document.createElement('div');
        ghost.className = 'drag-ghost';
        ghost.textContent = n > 1 ? `${n} Einträge` : start.label;
        document.body.appendChild(ghost);
        document.body.classList.add('dragging-items');
      }
      ghost!.style.left = `${e.clientX + 12}px`;
      ghost!.style.top = `${e.clientY + 8}px`;
      markList(listAt(e.clientX, e.clientY, current.current)?.el ?? null);
    };
    const up = (e: PointerEvent) => {
      const s = start;
      start = null;
      if (!dragging || !s) return;
      dragging = false;
      ghost?.remove();
      ghost = null;
      document.body.classList.remove('dragging-items');
      markList(null);
      const target = listAt(e.clientX, e.clientY, current.current);
      if (target) void moveAndTell(selectedOr(s.id), target);
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
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, []);
}
