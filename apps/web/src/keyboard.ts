import { useEffect, useRef } from 'react';
import { deleteItem, restoreItem } from './actions';
import { db } from './db';
import { showToast } from './toast';

/**
 * Keyboard use, in every mode:
 * N new entry · ↑↓←→ move between entries · Space tick off · Enter open · Entf delete (with undo)
 * Strg+K search · Strg+Shift+A Arbeitsmodus · ? or H overview.
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
function move(key: string): boolean {
  const all = entries();
  if (!all.length) return false;
  const here = current();
  if (!here || !all.includes(here)) {
    focusEl(key === 'ArrowUp' || key === 'ArrowLeft' ? all.at(-1) : all[0]);
    return true;
  }
  const i = all.indexOf(here);
  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    focusEl(all[i + (key === 'ArrowRight' ? 1 : -1)]);
    return true;
  }
  const r = here.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const down = key === 'ArrowDown';
  const candidates = all
    .filter((el) => el !== here)
    .map((el) => ({ el, rect: el.getBoundingClientRect() }))
    .filter(({ rect }) => (down ? rect.top >= r.bottom - 4 : rect.bottom <= r.top + 4));
  if (!candidates.length) return true;
  const rowY = down ? Math.min(...candidates.map((c) => c.rect.top)) : Math.max(...candidates.map((c) => c.rect.bottom));
  const row = candidates.filter((c) => (down ? c.rect.top - rowY < 8 : rowY - c.rect.bottom < 8));
  row.sort((a, b) => Math.abs(a.rect.left + a.rect.width / 2 - cx) - Math.abs(b.rect.left + b.rect.width / 2 - cx));
  focusEl(row[0]?.el);
  return true;
}

/** Entf: the focused entry goes, with "Rückgängig"; focus moves on to the next one. */
async function deleteFocused(): Promise<void> {
  const el = current();
  const id = el?.getAttribute('data-item-id');
  if (!el || !id) return;
  const item = await db.items.get(id);
  if (!item) return;
  const all = entries();
  const next = all[all.indexOf(el) + 1] ?? all[all.indexOf(el) - 1];
  await deleteItem(id);
  showToast(`„${item.name}“ gelöscht`, { label: 'Rückgängig', run: () => void restoreItem(item) });
  requestAnimationFrame(() => focusEl(next && next.isConnected ? next : entries()[0]));
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
        if (move(e.key)) e.preventDefault();
      } else if (e.key === 'Delete' && current()) {
        e.preventDefault();
        void deleteFocused();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
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
