import { listGroup, type ListRow } from '@shopping/shared';
import { useEffect, useState } from 'react';

/**
 * Arbeitsmodus (desktop): only ToDo lists, in a calm business look with three columns.
 * Remembered per device; on phones the normal app shows.
 */

const MODE_KEY = 'work-mode';
const SCOPE_KEY = 'work-scope';
const EVENT = 'work-mode-change';

export type WorkScope = 'arbeit' | 'all';

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

export function workScope(): WorkScope {
  return read(SCOPE_KEY) === 'all' ? 'all' : 'arbeit';
}

export function setWorkScope(scope: WorkScope): void {
  write(SCOPE_KEY, scope === 'all' ? 'all' : null);
}

export function useWorkScope(): WorkScope {
  return useStored(workScope);
}

/** The lists of the Arbeitsmodus: ToDo lists, by default only those in the Kategorie "Arbeit". */
export function isWorkList(list: ListRow, scope: WorkScope): boolean {
  if (list.listType !== 'todo' || list.isTemplate || list.archivedAt) return false;
  return scope === 'all' || (listGroup(list) ?? '').trim().toLowerCase() === 'arbeit';
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
