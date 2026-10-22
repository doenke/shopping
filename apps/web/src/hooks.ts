import { CatalogIndex, type CatalogItem, type ItemRow, type ListRow, type Me, type UserInfo } from '@shopping/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { db } from './db';
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

export function useUsers(): Map<string, UserInfo> {
  const users = useLiveQuery(() => db.users.toArray()) ?? [];
  return useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
}

export function useCatalog(): { items: CatalogItem[]; byId: Map<string, CatalogItem>; index: CatalogIndex } {
  const items = useLiveQuery(() => db.catalog.toArray()) ?? [];
  return useMemo(() => ({ items, byId: new Map(items.map((i) => [i.id, i])), index: new CatalogIndex(items) }), [items]);
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

export type Route = { page: 'list'; listId?: string } | { page: 'settings' };

function parseRoute(): Route {
  const hash = location.hash.replace(/^#\/?/, '');
  if (hash === 'settings') return { page: 'settings' };
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
  location.hash = route.page === 'settings' ? '#/settings' : route.listId ? `#/list/${route.listId}` : '#/';
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
