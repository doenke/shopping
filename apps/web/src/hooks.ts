import { CatalogIndex, type CatalogItem, type CategoryRow, type ItemRow, type ListRow, type Me, type UserInfo } from '@shopping/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { db } from './db';
import { buildIconIndex, warmIconCache, type IconIndex } from './icons';
import { sync, type RemoteCheck } from './sync/engine';

export function useSyncStatus() {
  return useSyncExternalStore(sync.subscribe, sync.getStatus);
}

/** undefined while loading, null when nobody is logged in on this device. */
export function useMe(): Me | null | undefined {
  return useLiveQuery(async () => ((await db.meta.get('me'))?.value as Me | undefined) ?? null);
}

export function useLists(): ListRow[] {
  return (
    useLiveQuery(async () => {
      const all = await db.lists.toArray();
      return all.filter((l) => !l.deleted).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    }) ?? []
  );
}

export function useItems(listId: string | undefined): ItemRow[] | undefined {
  return useLiveQuery(async () => {
    if (!listId) return [];
    return (await db.items.where('listId').equals(listId).toArray()).filter((i) => !i.deleted);
  }, [listId]);
}

const NO_CATEGORIES: CategoryRow[] = [];

/** Own categories (deleted ones included; the category functions skip them). */
export function useCategoryRows(): CategoryRow[] {
  return useLiveQuery(() => db.categories.toArray()) ?? NO_CATEGORIES;
}

export function useUsers(): Map<string, UserInfo> {
  const users = useLiveQuery(() => db.users.toArray()) ?? [];
  return useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
}

export interface Catalog {
  items: CatalogItem[];
  byId: Map<string, CatalogItem>;
  /** Groceries. */
  index: CatalogIndex;
  /** Packing items (packing lists have their own catalog). */
  packingIndex: CatalogIndex;
  /** Merklisten have no catalog. */
  emptyIndex: CatalogIndex;
}

export function useCatalog(): Catalog {
  const items = useLiveQuery(() => db.catalog.toArray()) ?? [];
  return useMemo(() => {
    // Older cached rows have no kind yet: they are groceries.
    const packing = items.filter((i) => i.kind === 'packing');
    return {
      items,
      byId: new Map(items.map((i) => [i.id, i])),
      index: new CatalogIndex(items.filter((i) => i.kind !== 'packing')),
      packingIndex: new CatalogIndex(packing),
      emptyIndex: new CatalogIndex([]),
    };
  }, [items]);
}

export function useIcons(catalog: CatalogItem[]): IconIndex {
  const categories = useLiveQuery(async () => (await db.meta.get('categoryIcons'))?.value as Record<string, string> | undefined);
  const pending = useLiveQuery(async () => (await db.meta.get('pendingIcons'))?.value as string[] | undefined);
  const index = useMemo(() => buildIconIndex(catalog, categories, pending), [catalog, categories, pending]);
  useEffect(() => {
    if (index.items.size || Object.keys(index.categories).length) void warmIconCache(index);
  }, [index]);
  return index;
}

/** Items someone else just checked; shown for a moment with "✓ von …" before they move away. */
export function useRemoteChecks(ttl = 2500): Map<string, RemoteCheck> {
  const [checks, setChecks] = useState(new Map<string, RemoteCheck>());
  useEffect(
    () =>
      sync.onRemoteCheck((c) => {
        setChecks((prev) => new Map(prev).set(c.itemId, c));
        setTimeout(() => {
          setChecks((prev) => {
            const next = new Map(prev);
            if (next.get(c.itemId) === c) next.delete(c.itemId);
            return next;
          });
        }, ttl);
      }),
    [ttl],
  );
  return checks;
}

export const SETTINGS_SECTIONS = ['order', 'categories', 'mealie', 'api', 'webhooks'] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export type Route = { page: 'list'; listId?: string } | { page: 'settings'; section?: SettingsSection } | { page: 'icons' };

function parseRoute(): Route {
  const hash = location.hash.replace(/^#\/?/, '');
  if (hash === 'settings') return { page: 'settings' };
  const section = /^settings\/(\w+)$/.exec(hash)?.[1] as SettingsSection | undefined;
  if (section && SETTINGS_SECTIONS.includes(section)) return { page: 'settings', section };
  if (hash === 'icons') return { page: 'icons' };
  const m = /^list\/([0-9a-f-]{36})$/.exec(hash);
  return { page: 'list', listId: m?.[1] };
}

export function useRoute(): Route {
  const [route, setRoute] = useState(parseRoute);
  useEffect(() => {
    const onChange = () => setRoute(parseRoute());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export function navigate(route: Route): void {
  location.hash =
    route.page === 'settings' && route.section
      ? `#/settings/${route.section}`
      : route.page !== 'list'
        ? `#/${route.page}`
        : route.listId
          ? `#/list/${route.listId}`
          : '#/';
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

export type TileView = 'tiles' | 'rows';
const TILE_VIEW_KEY = 'tile-view';

function readTileView(): TileView {
  try {
    return localStorage.getItem(TILE_VIEW_KEY) === 'rows' ? 'rows' : 'tiles';
  } catch {
    return 'tiles';
  }
}

/** Tiles (pictures in a grid) or rows (picture, text next to it); per device. */
export function useTileView(): [TileView, (v: TileView) => void] {
  const view = useSyncExternalStore(
    (fn) => {
      window.addEventListener(TILE_VIEW_KEY, fn);
      return () => window.removeEventListener(TILE_VIEW_KEY, fn);
    },
    readTileView,
  );
  const set = (v: TileView) => {
    try {
      localStorage.setItem(TILE_VIEW_KEY, v);
    } catch {
      // Not stored: still switches for now.
    }
    window.dispatchEvent(new Event(TILE_VIEW_KEY));
  };
  return [view, set];
}
