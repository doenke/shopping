import {
  applyPatch,
  Hlc,
  ITEM_FIELDS,
  LIST_FIELDS,
  mergeRow,
  type ChangeSet,
  type ItemPatch,
  type ItemRow,
  type ListPatch,
  type ListRow,
  type Me,
  type MePatch,
  type Mutation,
  type ServerMessage,
} from '@shopping/shared';
import { db, getMeta, setMeta } from '../db';

export type ConnectionState = 'connecting' | 'online' | 'offline' | 'unauthorized';

export interface SyncStatus {
  state: ConnectionState;
  pending: number;
  lastSyncAt: number | null;
}

export interface RemoteCheck {
  itemId: string;
  by: string;
  at: number;
}

const HEARTBEAT_MS = 10_000;
const PONG_TIMEOUT_MS = 5_000;
const ACK_TIMEOUT_MS = 8_000;
const MAX_BATCH = 200;

function uuid(): string {
  return crypto.randomUUID();
}

export class SyncEngine {
  private clock!: Hlc;
  private ws: WebSocket | null = null;
  private cursor = 0;
  private expectFull = false;
  private failures = 0;
  private inflight = new Set<string>();
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private pongTimer: ReturnType<typeof setTimeout> | undefined;
  private ackTimer: ReturnType<typeof setTimeout> | undefined;
  private started = false;
  private me: Me | null = null;

  private status: SyncStatus = { state: 'connecting', pending: 0, lastSyncAt: null };
  private statusListeners = new Set<() => void>();
  private checkListeners = new Set<(c: RemoteCheck) => void>();

  // ---- public API ---------------------------------------------------------

  getStatus = (): SyncStatus => this.status;

  subscribe = (fn: () => void): (() => void) => {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  };

  onRemoteCheck(fn: (c: RemoteCheck) => void): () => void {
    this.checkListeners.add(fn);
    return () => this.checkListeners.delete(fn);
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    let node = await getMeta<string>('node');
    if (!node) {
      node = uuid().slice(0, 8);
      await setMeta('node', node);
    }
    this.clock = new Hlc(node);
    const lastHlc = await getMeta<string>('hlc');
    if (lastHlc) this.clock.receive(lastHlc);
    this.cursor = (await getMeta<number>('cursor')) ?? 0;
    this.me = (await getMeta<Me>('me')) ?? null;
    await this.updatePending();

    window.addEventListener('online', () => this.reconnectNow());
    window.addEventListener('offline', () => this.setState('offline'));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.reconnectNow();
    });
    this.connect();
    void this.syncCatalog();
  }

  /** Records a local change: applied to the replica immediately, sent to the server in the background. */
  async mutateList(id: string, patch: ListPatch): Promise<void> {
    await this.mutate({ mid: uuid(), entity: 'list', id, hlc: this.clock.tick(), patch });
  }

  async mutateItem(id: string, patch: ItemPatch): Promise<void> {
    await this.mutate({ mid: uuid(), entity: 'item', id, hlc: this.clock.tick(), patch });
  }

  async mutateMe(patch: MePatch): Promise<void> {
    await this.mutate({ mid: uuid(), entity: 'me', id: 'me', hlc: this.clock.tick(), patch });
  }

  /** Several item changes as one local transaction (e.g. adding a parsed list). */
  async mutateItems(changes: { id: string; patch: ItemPatch }[]): Promise<void> {
    if (changes.length === 0) return;
    await db.transaction('rw', [db.lists, db.items, db.outbox, db.meta], async () => {
      for (const c of changes) await this.applyLocal({ mid: uuid(), entity: 'item', id: c.id, hlc: this.clock.tick(), patch: c.patch });
    });
    await this.afterMutate();
  }

  async refreshCatalog(): Promise<void> {
    await this.syncCatalog();
  }

  // ---- local changes ------------------------------------------------------

  private async mutate(m: Mutation): Promise<void> {
    await db.transaction('rw', [db.lists, db.items, db.outbox, db.meta], () => this.applyLocal(m));
    await this.afterMutate();
  }

  private async afterMutate(): Promise<void> {
    await this.updatePending();
    if (this.ws?.readyState === WebSocket.OPEN) this.flush();
    else void this.requestBackgroundSync();
  }

  private async applyLocal(m: Mutation): Promise<void> {
    if (m.entity === 'list') {
      const row: ListRow = (await db.lists.get(m.id)) ?? {
        id: m.id,
        ownerId: this.me?.id ?? '',
        name: '',
        listType: 'shopping',
        isTemplate: false,
        icon: null,
        color: null,
        settings: {},
        archivedAt: null,
        deleted: false,
        createdAt: new Date().toISOString(),
        hlc: {},
        seq: 0,
      };
      applyPatch(row, m.patch, m.hlc);
      if (row.deleted) {
        await db.lists.delete(row.id);
        await db.items.where('listId').equals(row.id).delete();
      } else {
        await db.lists.put(row);
      }
    } else if (m.entity === 'item') {
      const existing = await db.items.get(m.id);
      const row: ItemRow = existing ?? {
        id: m.id,
        listId: m.patch.listId ?? '',
        catalogItemId: null,
        name: '',
        amounts: [],
        properties: [],
        note: null,
        categoryId: null,
        checked: false,
        checkedAt: null,
        checkedBy: null,
        position: 'a0',
        optional: false,
        attributes: {},
        createdBy: this.me?.id ?? null,
        createdAt: new Date().toISOString(),
        deleted: false,
        mergedInto: null,
        hlc: {},
        seq: 0,
      };
      const patch: Partial<ItemRow> = { ...m.patch };
      if (m.patch.checked !== undefined) {
        patch.checkedBy = m.patch.checked ? (this.me?.id ?? null) : null;
        patch.checkedAt = m.patch.checked ? new Date().toISOString() : null;
      }
      applyPatch(row, patch, m.hlc);
      await db.items.put(row);
    } else {
      const me = this.me;
      if (me) {
        const state = { ...me, hlc: (await getMeta<Record<string, string>>('meHlc')) ?? {} };
        applyPatch(state, m.patch, m.hlc);
        const { hlc, ...next } = state;
        this.me = next;
        await setMeta('me', next);
        await setMeta('meHlc', hlc);
      }
    }
    await db.outbox.add({ mid: m.mid, mutation: m });
    await setMeta('hlc', m.hlc);
  }

  // ---- connection ---------------------------------------------------------

  private connect(): void {
    clearTimeout(this.reconnectTimer);
    if (this.ws) return;
    if (!navigator.onLine) {
      this.setState('offline');
      this.scheduleReconnect();
      return;
    }
    this.setState('connecting');
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    const ws = new WebSocket(url);
    this.ws = ws;
    let opened = false;

    ws.onopen = () => {
      opened = true;
      this.failures = 0;
      this.expectFull = this.cursor === 0;
      this.send({ t: 'hello', since: this.cursor });
      this.flush();
      this.startHeartbeat();
    };
    ws.onmessage = (ev) => {
      this.alive();
      void this.handle(JSON.parse(String(ev.data)) as ServerMessage);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.inflight.clear();
      this.stopHeartbeat();
      if (!opened) this.failures++;
      void this.afterDisconnect(opened);
    };
  }

  private async afterDisconnect(wasOpen: boolean): Promise<void> {
    if (!wasOpen) {
      // A failed upgrade may mean the session is gone, or WebSockets are blocked.
      const res = await fetch('/api/v1/me', { cache: 'no-store' }).catch(() => null);
      if (res?.status === 401) {
        this.setState('unauthorized');
        return;
      }
      if (res?.ok && this.failures >= 2) await this.httpSync();
    }
    this.setState(navigator.onLine ? 'connecting' : 'offline');
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    clearTimeout(this.reconnectTimer);
    const base = Math.min(30_000, 1000 * 2 ** Math.min(this.failures, 5));
    this.reconnectTimer = setTimeout(() => this.connect(), base / 2 + Math.random() * (base / 2));
  }

  private reconnectNow(): void {
    if (this.status.state === 'unauthorized') return;
    if (this.ws?.readyState === WebSocket.OPEN) {
      // Check that the connection still works; after sleep it often does not.
      this.ping();
      this.flush();
      return;
    }
    this.ws?.close();
    this.ws = null;
    this.failures = 0;
    this.connect();
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => this.ping(), HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    clearInterval(this.heartbeatTimer);
    clearTimeout(this.pongTimer);
    clearTimeout(this.ackTimer);
  }

  private ping(): void {
    if (this.pongTimer) return;
    this.send({ t: 'ping' });
    this.pongTimer = setTimeout(() => this.dropConnection(), PONG_TIMEOUT_MS);
  }

  /** Any message proves the connection is alive. */
  private alive(): void {
    clearTimeout(this.pongTimer);
    this.pongTimer = undefined;
  }

  /** The socket looks open but nothing comes back (typical in a supermarket): start over. */
  private dropConnection(): void {
    this.pongTimer = undefined;
    const ws = this.ws;
    if (!ws) return;
    this.ws = null;
    this.inflight.clear();
    this.stopHeartbeat();
    ws.onclose = null;
    ws.close();
    this.setState(navigator.onLine ? 'connecting' : 'offline');
    this.scheduleReconnect();
  }

  private send(msg: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private async flush(): Promise<void> {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    const entries = (await db.outbox.orderBy('n').limit(MAX_BATCH * 2).toArray()).filter((e) => !this.inflight.has(e.mid));
    const batch = entries.slice(0, MAX_BATCH);
    if (batch.length === 0) return;
    for (const e of batch) this.inflight.add(e.mid);
    this.send({ t: 'push', mutations: batch.map((e) => e.mutation) });
    clearTimeout(this.ackTimer);
    this.ackTimer = setTimeout(() => this.dropConnection(), ACK_TIMEOUT_MS);
  }

  // ---- incoming -----------------------------------------------------------

  private async handle(msg: ServerMessage): Promise<void> {
    switch (msg.t) {
      case 'changes':
        await this.applyChanges(msg, this.expectFull);
        this.expectFull = false;
        this.setState('online');
        break;
      case 'ack': {
        clearTimeout(this.ackTimer);
        const done = [...msg.mids, ...msg.rejected.map((r) => r.mid)];
        for (const mid of done) this.inflight.delete(mid);
        await db.outbox.where('mid').anyOf(done).delete();
        await this.updatePending();
        if (msg.rejected.length) {
          // The server refused something (e.g. access revoked): reload everything.
          console.warn('Änderungen abgelehnt', msg.rejected);
          this.cursor = 0;
          this.expectFull = true;
          this.send({ t: 'hello', since: 0 });
        }
        this.flush();
        break;
      }
      case 'catalog':
        void this.syncCatalog();
        break;
      case 'resync':
        this.cursor = 0;
        this.expectFull = true;
        this.send({ t: 'hello', since: 0 });
        break;
      case 'pong':
        break;
    }
  }

  private async applyChanges(cs: ChangeSet, full: boolean): Promise<void> {
    const remoteChecks: RemoteCheck[] = [];
    await db.transaction('rw', [db.lists, db.items, db.users, db.meta, db.outbox], async () => {
      const pendingIds = new Set((await db.outbox.toArray()).map((e) => e.mutation.id));
      for (const incoming of cs.lists) {
        const local = await db.lists.get(incoming.id);
        await db.lists.put(local ? mergeRow(local, incoming, LIST_FIELDS) : incoming);
      }
      for (const incoming of cs.items) {
        const local = await db.items.get(incoming.id);
        const merged = local ? mergeRow(local, incoming, ITEM_FIELDS) : incoming;
        if (merged.deleted && !pendingIds.has(merged.id)) await db.items.delete(merged.id);
        else await db.items.put(merged);
        if (local && !local.checked && merged.checked && merged.checkedBy && merged.checkedBy !== this.me?.id) {
          remoteChecks.push({ itemId: merged.id, by: merged.checkedBy, at: Date.now() });
        }
      }
      for (const id of cs.removedLists) {
        await db.lists.delete(id);
        await db.items.where('listId').equals(id).delete();
      }
      if (full) {
        // A full sync is the truth: drop local rows the server no longer knows (unless still unsent).
        const listIds = new Set(cs.lists.map((l) => l.id));
        const itemIds = new Set(cs.items.map((i) => i.id));
        await db.lists.filter((l) => !listIds.has(l.id) && !pendingIds.has(l.id)).delete();
        await db.items.filter((i) => !itemIds.has(i.id) && !pendingIds.has(i.id)).delete();
      }
      if (cs.users.length) await db.users.bulkPut(cs.users);
      if (cs.me) {
        this.me = cs.me;
        await setMeta('me', cs.me);
      }
      this.cursor = cs.seq;
      await setMeta('cursor', cs.seq);
    });
    this.status = { ...this.status, lastSyncAt: Date.now() };
    this.emitStatus();
    for (const c of remoteChecks) for (const fn of this.checkListeners) fn(c);
  }

  // ---- HTTP fallback & catalog --------------------------------------------

  /** Used when WebSockets do not get through (some proxies, captive portals). */
  private async httpSync(): Promise<void> {
    try {
      const entries = await db.outbox.orderBy('n').limit(MAX_BATCH).toArray();
      if (entries.length) {
        const res = await fetch('/api/v1/sync/push', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mutations: entries.map((e) => e.mutation) }),
          signal: AbortSignal.timeout(ACK_TIMEOUT_MS),
        });
        if (res.ok) {
          const r = (await res.json()) as { acked: string[]; rejected: { mid: string }[] };
          await db.outbox.where('mid').anyOf([...r.acked, ...r.rejected.map((x) => x.mid)]).delete();
          await this.updatePending();
        }
      }
      const res = await fetch(`/api/v1/sync/pull?since=${this.cursor}`, { signal: AbortSignal.timeout(ACK_TIMEOUT_MS) });
      if (res.ok) await this.applyChanges((await res.json()) as ChangeSet, this.cursor === 0);
    } catch {
      // Still offline – the next attempt will retry.
    }
  }

  private async syncCatalog(): Promise<void> {
    try {
      const since = (await getMeta<number>('catalogSeq')) ?? 0;
      const res = await fetch(`/api/v1/catalog?since=${since}`, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) return;
      const data = (await res.json()) as { items: import('@shopping/shared').CatalogItem[]; seq: number };
      await db.transaction('rw', [db.catalog, db.meta], async () => {
        await db.catalog.bulkPut(data.items);
        await setMeta('catalogSeq', data.seq);
      });
    } catch {
      // Offline: the cached catalog keeps working.
    }
  }

  private async requestBackgroundSync(): Promise<void> {
    try {
      const reg = await navigator.serviceWorker?.ready;
      await (reg as ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } })?.sync?.register('outbox');
    } catch {
      // Background Sync is not available everywhere; the next connect flushes the outbox anyway.
    }
  }

  // ---- status -------------------------------------------------------------

  private async updatePending(): Promise<void> {
    const pending = await db.outbox.count();
    if (pending !== this.status.pending) {
      this.status = { ...this.status, pending };
      this.emitStatus();
    }
  }

  private setState(state: ConnectionState): void {
    if (state === this.status.state) return;
    this.status = { ...this.status, state };
    this.emitStatus();
  }

  private emitStatus(): void {
    for (const fn of this.statusListeners) fn();
  }
}

export const sync = new SyncEngine();
