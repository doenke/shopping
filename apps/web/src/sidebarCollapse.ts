import { useState } from 'react';

/**
 * Collapsed groups of the sidebar (sections like „Packlisten“, ToDo-Kategorien). Remembered per device.
 * Keys: `sec:<section>`, `grp:<section>:<group>`. Groups in DEFAULT_COLLAPSED start folded away until opened.
 */
const KEY = 'sidebar-collapsed';
const DEFAULT_COLLAPSED = new Set(['sec:templates']);

/** Stored as { key: collapsed } – only groups that differ from their default. Older versions stored an array of collapsed keys. */
function load(): Record<string, boolean> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown;
    if (Array.isArray(raw)) return Object.fromEntries(raw.filter((k): k is string => typeof k === 'string').map((k) => [k, true]));
    if (raw && typeof raw === 'object') return Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === 'boolean')) as Record<string, boolean>;
  } catch {
    // Fall through to the defaults.
  }
  return {};
}

export function useSidebarCollapse(): { isCollapsed: (key: string) => boolean; toggle: (key: string) => void } {
  const [state, setState] = useState(load);
  const isCollapsed = (key: string) => state[key] ?? DEFAULT_COLLAPSED.has(key);
  const toggle = (key: string) =>
    setState((prev) => {
      const next = { ...prev };
      const collapsed = !(prev[key] ?? DEFAULT_COLLAPSED.has(key));
      if (collapsed === DEFAULT_COLLAPSED.has(key)) delete next[key];
      else next[key] = collapsed;
      try {
        if (Object.keys(next).length) localStorage.setItem(KEY, JSON.stringify(next));
        else localStorage.removeItem(KEY);
      } catch {
        // Not important enough to complain about.
      }
      return next;
    });
  return { isCollapsed, toggle };
}
