import { useEffect, useRef } from 'react';
import { deleteItem, restoreItem } from './actions';
import { db } from './db';
import { clearSelection, selection, selectionAnchor, setSelection, toggleSelected } from './selection';
import { showToast } from './toast';

/**
 * Keyboard use, in every mode:
 * N new entry · ↑↓←→ move between entries · Space tick off · Enter open · Entf delete (with undo)
 * Strg+K search · Strg+Shift+A Arbeitsmodus · ? or H overview.
 * Several at once: Shift + arrows (or Shift-/Ctrl-click) select, V moves them into another list, Esc clears.
 * Space and Enter are handled by the entries themselves (tiles, rows); entries carry `data-item-id`.
 */

const typing = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]');
const dialogOpen = () => !!document.querySelector('dialog[open]');

function entries(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-item-id]')].filter((el) => el.offsetParent !== null && !el.closest('dialog'));
}

/** The element to focus for an entry: itself if it can take focus, else its first button. */
function focusable(el: HTMLElement): HTMLElement {
  return el.matches('button, [tabindex]') ? el : (el.querySelector<HTMLElement>('[data-focus], button, [tabindex]') ?? el);
}

function current(): HTMLElement | null {
  return (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-item-id]') ?? null;
}

function focusEl(el: HTMLElement | undefined): void {
  if (!el) return;
  const f = focusable(el);
  f.focus();
  f.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

/** Arrow keys: left/right in reading order, up/down to the nearest entry in the row above/below (tiles and rows alike). */
function move(key: string, extend = false): boolean {
  const target = next(key);
  if (target === null) return false;
  if (target) {
    if (extend) selectRange(target);
    else clearSelection();
    focusEl(target);
  }
  return true;
}

/** Shift + arrows: everything between where the selection started and the new place (in reading order). */
function selectRange(to: HTMLElement): void {
  const all = entries();
  const here = current();
  const anchorId = selectionAnchor() ?? here?.getAttribute('data-item-id') ?? to.getAttribute('data-item-id');
  const a = all.findIndex((el) => el.getAttribute('data-item-id') === anchorId);
  const b = all.indexOf(to);
  if (a < 0 || b < 0) return;
  const [from, until] = a < b ? [a, b] : [b, a];
  setSelection(
    all.slice(from, until + 1).map((el) => el.getAttribute('data-item-id')!),
    anchorId,
  );
}

/** The entry an arrow key leads to (undefined: none there; null: no entries at all). */
function next(key: string): HTMLElement | undefined | null {
  const all = entries();
  if (!all.length) return null;
  const here = current();
  if (!here || !all.includes(here)) return key === 'ArrowUp' || key === 'ArrowLeft' ? all.at(-1) : all[0];
  const i = all.indexOf(here);
  if (key === 'ArrowLeft' || key === 'ArrowRight') return all[i + (key === 'ArrowRight' ? 1 : -1)];
  const r = here.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const down = key === 'ArrowDown';
  const candidates = all
    .filter((el) => el !== here)
    .map((el) => ({ el, rect: el.getBoundingClientRect() }))
    .filter(({ rect }) => (down ? rect.top >= r.bottom - 4 : rect.bottom <= r.top + 4));
  if (!candidates.length) return undefined;
  const rowY = down ? Math.min(...candidates.map((c) => c.rect.top)) : Math.max(...candidates.map((c) => c.rect.bottom));
  const row = candidates.filter((c) => (down ? c.rect.top - rowY < 8 : rowY - c.rect.bottom < 8));
  row.sort((a, b) => Math.abs(a.rect.left + a.rect.width / 2 - cx) - Math.abs(b.rect.left + b.rect.width / 2 - cx));
  return row[0]?.el;
}

/** Entf: the focused entry (or all selected ones) goes, with "Rückgängig"; focus moves on to the next one. */
async function deleteFocused(): Promise<void> {
  const el = current();
  const id = el?.getAttribute('data-item-id');
  if (!el || !id) return;
  const ids = selection().has(id) ? [...selection()] : [id];
  const items = (await db.items.bulkGet(ids)).filter((i) => !!i);
  if (!items.length) return;
  const all = entries();
  const after = all.slice(all.indexOf(el) + 1).find((e) => !ids.includes(e.getAttribute('data-item-id')!));
  const before = all
    .slice(0, all.indexOf(el))
    .reverse()
    .find((e) => !ids.includes(e.getAttribute('data-item-id')!));
  const focusNext = after ?? before;
  await Promise.all(ids.map((i) => deleteItem(i)));
  clearSelection();
  showToast(items.length === 1 ? `„${items[0]!.name}“ gelöscht` : `${items.length} Einträge gelöscht`, {
    label: 'Rückgängig',
    run: () => void Promise.all(items.map((i) => restoreItem(i))),
  });
  requestAnimationFrame(() => focusEl(focusNext && focusNext.isConnected ? focusNext : entries()[0]));
}

let pendingFocus: string | null = null;

/** Focus an entry once it is on screen (after switching lists from the search). */
export function focusItem(id: string): void {
  pendingFocus = id;
  let tries = 0;
  const attempt = () => {
    if (pendingFocus !== id) return;
    const el = document.querySelector<HTMLElement>(`[data-item-id="${CSS.escape(id)}"]`);
    if (el && el.offsetParent !== null) {
      pendingFocus = null;
      focusEl(el);
    } else if (tries++ < 40) requestAnimationFrame(attempt);
  };
  attempt();
}

/** Focus the field for new entries. */
export function focusAddField(): boolean {
  const field = [...document.querySelectorAll<HTMLInputElement>('[data-add-input], input[aria-label="Artikel hinzufügen"]')].find(
    (el) => el.offsetParent !== null && !el.closest('dialog'),
  );
  field?.focus();
  return !!field;
}

interface Handlers {
  onSearch: () => void;
  onHelp: () => void;
  onToggleWork: () => void;
  /** V: move these entries into another list (asks which). */
  onMove: (ids: string[]) => void;
}

export function useShortcuts(handlers: Handlers): void {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        ref.current.onSearch();
        return;
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        ref.current.onToggleWork();
        return;
      }
      if (mod || e.altKey || typing(e.target) || dialogOpen()) return;
      if (e.key === 'n' || e.key === 'N') {
        if (focusAddField()) e.preventDefault();
      } else if (e.key === '?' || e.key === 'h' || e.key === 'H') {
        e.preventDefault();
        ref.current.onHelp();
      } else if (e.key.startsWith('Arrow')) {
        if (move(e.key, e.shiftKey)) e.preventDefault();
      } else if ((e.key === 'v' || e.key === 'V') && current()) {
        e.preventDefault();
        const id = current()!.getAttribute('data-item-id')!;
        ref.current.onMove(selection().has(id) ? [...selection()] : [id]);
      } else if (e.key === 'Escape' && selection().size) {
        clearSelection();
      } else if (e.key === 'Delete' && current()) {
        e.preventDefault();
        void deleteFocused();
      }
    };
    // Mouse: Ctrl-/Cmd-click adds or removes an entry, Shift-click selects up to it; a plain click clears.
    const onClick = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-item-id]');
      if (!el || el.closest('dialog')) return;
      const id = el.getAttribute('data-item-id')!;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        toggleSelected(id);
        focusEl(el);
      } else if (e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        if (!selectionAnchor()) setSelection([current()?.getAttribute('data-item-id') ?? id], current()?.getAttribute('data-item-id') ?? id);
        selectRange(el);
        focusEl(el);
      } else if (selection().size && !selection().has(id)) {
        clearSelection();
      }
    };
    const onRoute = () => clearSelection();
    window.addEventListener('keydown', onKey);
    window.addEventListener('click', onClick, true);
    window.addEventListener('hashchange', onRoute);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('hashchange', onRoute);
    };
  }, []);
}

/**
 * For an entry element: Space ticks off (`toggle`), Enter opens (`open`). Buttons would otherwise
 * "click" on both, which means something else in each view.
 */
export function entryKeys(toggle: (() => void) | undefined, open: (() => void) | undefined) {
  return {
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === ' ' && toggle) {
        e.preventDefault();
        toggle();
      } else if (e.key === 'Enter' && open) {
        e.preventDefault();
        open();
      }
    },
    // Space "clicks" a button on key up – already handled above.
    onKeyUp: (e: React.KeyboardEvent) => {
      if (e.key === ' ' && toggle && e.target === e.currentTarget) e.preventDefault();
    },
  };
}
