import { listGroup, type ListRow } from '@shopping/shared';
import { useEffect, useState } from 'react';

/**
 * Arbeitsmodus: only shows and hides lists – the sidebar (and the search) show just the work lists.
 * Remembered per device. How a ToDo list looks does not depend on it (desktop: table + details).
 */

const MODE_KEY = 'work-mode';
const EVENT = 'work-mode-change';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Not important enough to complain about.
  }
  window.dispatchEvent(new Event(EVENT));
}

function useStored<T>(get: () => T): T {
  const [value, setValue] = useState(get);
  useEffect(() => {
    const update = () => setValue(get());
    window.addEventListener(EVENT, update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener(EVENT, update);
      window.removeEventListener('storage', update);
    };
  }, []);
  return value;
}

export function isWorkMode(): boolean {
  return read(MODE_KEY) === '1';
}

export function setWorkMode(on: boolean): void {
  write(MODE_KEY, on ? '1' : null);
}

export function useWorkModeSetting(): boolean {
  return useStored(isWorkMode);
}

/** The lists of the Arbeitsmodus: ToDo lists in the Kategorie "Arbeit". */
export function isWorkList(list: ListRow): boolean {
  if (list.listType !== 'todo' || list.isTemplate || list.archivedAt) return false;
  return (listGroup(list) ?? '').trim().toLowerCase() === 'arbeit';
}

/** Start shortcuts of the installed app ("/?mode=work", "/?mode=home") switch the mode. */
export function applyModeFromUrl(): void {
  const mode = new URLSearchParams(location.search).get('mode');
  if (mode !== 'work' && mode !== 'home') return;
  setWorkMode(mode === 'work');
  const url = new URL(location.href);
  url.searchParams.delete('mode');
  history.replaceState(null, '', url.pathname + url.search + url.hash);
}
