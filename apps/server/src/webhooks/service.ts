import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { ServerMessage } from '@shopping/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { toApiItem, toApiList } from '../api/format.js';
import { ApiError } from '../api/errors.js';
import type { SecretBox } from '../crypto.js';
import type { Db } from '../db/index.js';
import { currentSeq } from '../db/seed.js';
import { users, webhooks, WEBHOOK_EVENTS, type WebhookEvent } from '../db/schema.js';
import type { SyncHub } from '../sync/hub.js';

/** After this many failed deliveries in a row a webhook is switched off. */
const MAX_FAILURES = 20;

export interface WebhookPayload {
  id: string;
  timestamp: string;
  events: { type: WebhookEvent | 'ping'; data: unknown }[];
}

/** `t=<unix>,v1=<hex HMAC-SHA256 of "<t>.<body>">` – like Stripe, checkable in n8n with a Crypto node. */
export function signature(secret: string, body: string, timestamp: number): string {
  return `t=${timestamp},v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

type Row = typeof webhooks.$inferSelect;

/**
 * Outgoing webhooks: each one listens to its owner's change stream (like SSE)
 * and POSTs the changes, signed. The stream position is stored, so nothing is
 * lost when the receiver is down or the server restarts – it is sent again.
 */
export class WebhookService {
  private readonly attached = new Map<string, () => void>();
  /** Retry delays; shortened in tests. */
  retryDelaysMs = [5_000, 30_000, 120_000];

  constructor(
    private readonly db: Db,
    private readonly secrets: SecretBox,
    private readonly hub: SyncHub,
    private readonly log: FastifyBaseLogger,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async start(): Promise<void> {
    const rows = await this.db.select().from(webhooks).where(eq(webhooks.active, true));
    for (const row of rows) this.attach(row);
    // Changes made while the server was down.
    this.hub.notify(new Set(rows.map((r) => r.userId)));
  }

  stop(): void {
    for (const detach of this.attached.values()) detach();
    this.attached.clear();
  }

  private attach(row: Row): void {
    this.attached.get(row.id)?.();
    let open = true;
    let chain = Promise.resolve();
    const detach = this.hub.attachStream(row.userId, row.cursor, {
      isOpen: () => open,
      ping: () => true,
      close: () => undefined,
      send: (msg) => {
        if (msg.t !== 'changes') return;
        // One delivery at a time, in order.
        chain = chain.then(() => this.deliverChanges(row.id, msg)).catch((err) => this.log.error({ err }, 'Webhook'));
      },
    });
    this.attached.set(row.id, () => {
      open = false;
      detach();
    });
  }

  private async deliverChanges(id: string, msg: Extract<ServerMessage, { t: 'changes' }>): Promise<void> {
    const [row] = await this.db.select().from(webhooks).where(eq(webhooks.id, id));
    if (!row?.active) return;
    const [owner] = await this.db.select({ mainId: users.defaultListId }).from(users).where(eq(users.id, row.userId));
    const names = new Map(msg.users.map((u) => [u.id, u.displayName]));
    const listTypes = new Map(msg.lists.map((l) => [l.id, l.listType]));
    const events: WebhookPayload['events'] = [];
    for (const l of msg.lists) events.push({ type: 'list.changed', data: toApiList(l, row.userId, owner?.mainId ?? null, -1) });
    for (const listId of msg.removedLists) events.push({ type: 'list.removed', data: { id: listId } });
    for (const i of msg.items) {
      events.push(
        i.deleted ? { type: 'item.removed', data: { id: i.id, listId: i.listId } } : { type: 'item.changed', data: toApiItem(i, names, listTypes.get(i.listId)) },
      );
    }
    const wanted = events.filter((e) => row.events.includes(e.type as WebhookEvent));
    const ok = wanted.length === 0 || (await this.post(row, wanted));
    if (ok) await this.db.update(webhooks).set({ cursor: msg.seq }).where(and(eq(webhooks.id, id), sql`${webhooks.cursor} < ${msg.seq}`));
  }

  /** POSTs with retries; records the outcome. */
  private async post(row: Row, events: WebhookPayload['events'], retries = this.retryDelaysMs): Promise<boolean> {
    const payload: WebhookPayload = { id: randomUUID(), timestamp: new Date().toISOString(), events };
    const body = JSON.stringify(payload);
    const secret = this.secrets.open(row.secret);
    let status = '';
    for (let attempt = 0; attempt <= retries.length; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, retries[attempt - 1]));
      const ts = Math.floor(Date.now() / 1000);
      try {
        const res = await this.fetchImpl(row.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'user-agent': 'Shopping-Webhook/1',
            'x-shopping-event-id': payload.id,
            'x-shopping-signature': signature(secret, body, ts),
          },
          body,
          signal: AbortSignal.timeout(10_000),
        });
        status = `HTTP ${res.status}`;
        if (res.ok) {
          await this.db.update(webhooks).set({ lastStatus: status, lastDeliveryAt: sql`now()`, failures: 0 }).where(eq(webhooks.id, row.id));
          return true;
        }
        // The receiver does not want it (bad URL, rejected signature): retrying will not help.
        if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) break;
      } catch (err) {
        status = (err as Error).message;
      }
    }
    const failures = row.failures + 1;
    const off = failures >= MAX_FAILURES;
    await this.db
      .update(webhooks)
      .set({ lastStatus: off ? `${status} – abgeschaltet nach ${MAX_FAILURES} Fehlschlägen` : status, lastDeliveryAt: sql`now()`, failures, active: !off })
      .where(eq(webhooks.id, row.id));
    if (off) this.attached.get(row.id)?.();
    this.log.warn({ webhook: row.id, status }, 'Webhook nicht zugestellt');
    return false;
  }

  // ---- management ------------------------------------------------------------------

  private view(r: Row) {
    return {
      id: r.id,
      url: r.url,
      events: r.events,
      active: r.active,
      lastStatus: r.lastStatus,
      lastDeliveryAt: r.lastDeliveryAt,
      failures: r.failures,
      createdAt: r.createdAt,
    };
  }

  async list(userId: string) {
    return (await this.db.select().from(webhooks).where(eq(webhooks.userId, userId)).orderBy(webhooks.createdAt)).map((r) => this.view(r));
  }

  /** Creates a webhook; the signing secret is shown only now. */
  async create(userId: string, url: string, events: WebhookEvent[]) {
    const secret = `whsec_${randomBytes(24).toString('base64url')}`;
    const [row] = await this.db
      .insert(webhooks)
      .values({ userId, url, events: events.length ? events : [...WEBHOOK_EVENTS], secret: this.secrets.seal(secret), cursor: await currentSeq(this.db) })
      .returning();
    this.attach(row!);
    return { ...this.view(row!), secret };
  }

  private async own(userId: string, id: string): Promise<Row> {
    const [row] = await this.db.select().from(webhooks).where(and(eq(webhooks.id, id), eq(webhooks.userId, userId)));
    if (!row) throw new ApiError(404, 'not_found', 'Webhook nicht gefunden');
    return row;
  }

  async update(userId: string, id: string, patch: { active?: boolean; events?: WebhookEvent[]; url?: string }) {
    const row = await this.own(userId, id);
    // Switching it back on starts from now: what happened while it was off is not sent.
    const reactivate = patch.active === true && !row.active;
    const [next] = await this.db
      .update(webhooks)
      .set({ ...patch, ...(reactivate ? { failures: 0, cursor: await currentSeq(this.db) } : {}) })
      .where(eq(webhooks.id, id))
      .returning();
    if (next!.active) this.attach(next!);
    else this.attached.get(id)?.();
    return this.view(next!);
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.own(userId, id);
    this.attached.get(id)?.();
    this.attached.delete(id);
    await this.db.delete(webhooks).where(eq(webhooks.id, id));
  }

  /** Sends a "ping" right away (no retries), to check URL and signature. */
  async test(userId: string, id: string) {
    const row = await this.own(userId, id);
    const ok = await this.post(row, [{ type: 'ping', data: { message: 'Hallo von Shopping' } }], []);
    const [after] = await this.db.select().from(webhooks).where(eq(webhooks.id, id));
    return { ok, status: after?.lastStatus ?? null };
  }
}
