import type { CatalogItem } from '@shopping/shared';
import { createContext, useContext } from 'react';

/** Approved icon versions, looked up by every tile (see docs/konzept/10-icons-plan.md). */
export interface IconIndex {
  items: Map<string, string>;
  categories: Record<string, string>;
  /** Catalog items and entries with drafts waiting for review. */
  pending: Set<string>;
}

export const IconContext = createContext<IconIndex>({ items: new Map(), categories: {}, pending: new Set() });

export function useIconIndex(): IconIndex {
  return useContext(IconContext);
}

export function buildIconIndex(catalog: CatalogItem[], categories: Record<string, string> | undefined, pending: string[] = []): IconIndex {
  const items = new Map<string, string>();
  for (const c of catalog) if (c.icon) items.set(c.id, c.icon);
  return { items, categories: categories ?? {}, pending: new Set(pending) };
}

/** Entry icon (Merkliste), else item icon, else category icon, else null (letter placeholder). */
export function iconUrl(
  index: IconIndex,
  catalogItemId: string | null | undefined,
  categoryId: string | null | undefined,
  entry?: { id: string; icon?: string | null },
): string | null {
  if (entry?.icon) return `/icons/entry/${entry.id}.webp?v=${entry.icon}`;
  const v = catalogItemId ? index.items.get(catalogItemId) : undefined;
  if (v) return `/icons/item/${catalogItemId}.webp?v=${v}`;
  const c = categoryId ? index.categories[categoryId] : undefined;
  return c ? `/icons/category/${categoryId}.webp?v=${c}` : null;
}

let warming = false;

/**
 * Loads all approved icons once in the background, so they are there offline in
 * the supermarket. The service worker keeps them (cache first, versioned URLs).
 */
export async function warmIconCache(index: IconIndex): Promise<void> {
  if (warming || !('caches' in window) || !navigator.serviceWorker?.controller) return;
  warming = true;
  try {
    const cache = await caches.open('icons');
    const urls = [
      ...Object.entries(index.categories).map(([id, v]) => `/icons/category/${id}.webp?v=${v}`),
      ...[...index.items].map(([id, v]) => `/icons/item/${id}.webp?v=${v}`),
    ];
    const missing: string[] = [];
    for (const url of urls) if (!(await cache.match(url))) missing.push(url);
    const worker = async () => {
      for (let url = missing.pop(); url; url = missing.pop()) {
        await fetch(url).catch(() => undefined);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
  } finally {
    warming = false;
  }
}
