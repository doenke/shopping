/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { ExpirationPlugin } from 'workbox-expiration';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';
import { ShoppingDb } from './db';

declare const self: ServiceWorkerGlobalScope;

// App shell: everything the build produced is cached, so the app starts without network.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), {
    denylist: [/^\/(api|auth|ws|s|oauth|mcp|icons|avatars|\.well-known)\//, /^\/(healthz|ws|mcp)$/],
  }),
);

// Icons and profile pictures: versioned URLs, so the cached copy is always right. Kept for offline use in the shop.
registerRoute(
  ({ url }) => url.origin === self.location.origin && (url.pathname.startsWith('/icons/') || url.pathname.startsWith('/avatars/')),
  new CacheFirst({
    cacheName: 'icons',
    plugins: [new ExpirationPlugin({ maxEntries: 3000, purgeOnQuotaError: true })],
  }),
);

/**
 * "Teilen → Shopping" with files: the share sheet POSTs them here. They wait in IndexedDB, and the app opens
 * with the usual share parameters plus `share_files` (see ShareDialog).
 */
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || url.origin !== self.location.origin || url.pathname !== '/share') return;
  event.respondWith(receiveShare(event.request));
});

async function receiveShare(request: Request): Promise<Response> {
  const params = new URLSearchParams();
  try {
    const form = await request.formData();
    for (const key of ['share_title', 'share_text', 'share_url']) {
      const v = form.get(key);
      if (typeof v === 'string' && v.trim()) params.set(key, v.trim());
    }
    const files = form.getAll('share_files').filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length) {
      const id = crypto.randomUUID();
      const db = new ShoppingDb();
      try {
        await db.shared.put({ id, at: Date.now(), files: files.map((f) => ({ name: f.name, type: f.type, blob: f })) });
      } finally {
        db.close();
      }
      params.set('share_files', id);
    }
  } catch {
    // Nothing readable: the app just opens.
  }
  return Response.redirect(`/?${params}`, 303);
}

// A new version takes over at once instead of waiting until every window of the app is closed
// (an installed app practically never is). The page then reloads itself (see main.tsx).
self.addEventListener('install', () => void self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
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
    await db.outbox
      .where('mid')
      .anyOf([...result.acked, ...result.rejected.map((r) => r.mid)])
      .delete();
  } finally {
    db.close();
  }
}
