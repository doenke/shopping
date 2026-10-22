/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { ShoppingDb } from './db';

declare const self: ServiceWorkerGlobalScope;

// App shell: everything the build produced is cached, so the app starts without network.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/(api|auth|ws|s)\//, /^\/(healthz|ws)$/] }));

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting();
});

interface SyncEvent extends ExtendableEvent {
  tag: string;
}

/**
 * Background Sync: Android delivers pending changes as soon as the network is
 * back, even if the app was already closed (e.g. at the checkout).
 */
self.addEventListener('sync', (event) => {
  const e = event as SyncEvent;
  if (e.tag === 'outbox') e.waitUntil(flushOutbox());
});

async function flushOutbox(): Promise<void> {
  const db = new ShoppingDb();
  try {
    const entries = await db.outbox.orderBy('n').limit(200).toArray();
    if (entries.length === 0) return;
    const res = await fetch('/api/v1/sync/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ mutations: entries.map((e) => e.mutation) }),
    });
    // Throwing makes the browser retry the sync later.
    if (!res.ok) throw new Error(`push failed: ${res.status}`);
    const result = (await res.json()) as { acked: string[]; rejected: { mid: string }[] };
    await db.outbox.where('mid').anyOf([...result.acked, ...result.rejected.map((r) => r.mid)]).delete();
  } finally {
    db.close();
  }
}
