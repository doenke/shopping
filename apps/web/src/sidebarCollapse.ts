import { useState } from 'react';

/**
 * Collapsed groups of the sidebar (sections like „Packlisten“, ToDo-Kategorien). Remembered per device.
 * Keys: `sec:<section>`, `grp:<section>:<group>`.
 */
const KEY = 'sidebar-collapsed';

function load(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return new Set(Array.isArray(raw) ? raw.filter((k): k is string => typeof k === 'string') : []);
  } catch {
    return new Set();
  }
}

export function useSidebarCollapse(): { isCollapsed: (key: string) => boolean; toggle: (key: string) => void } {
  const [collapsed, setCollapsed] = useState(load);
  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        if (next.size) localStorage.setItem(KEY, JSON.stringify([...next]));
        else localStorage.removeItem(KEY);
      } catch {
        // Not important enough to complain about.
      }
      return next;
    });
  return { isCollapsed: (key) => collapsed.has(key), toggle };
}
