import { createHash } from 'node:crypto';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import sharp from 'sharp';
import type { Db } from '../db/index.js';
import { listMembers, users } from '../db/schema.js';
import type { SyncHub } from '../sync/hub.js';
import type { SyncService } from '../sync/service.js';

const MAX_BYTES = 5 * 1024 * 1024;
export const AVATAR_SIZE = 128;

/** Local URL of a user's picture; the version makes caching forever safe. */
export function avatarPath(userId: string, version: string | null): string | null {
  return version ? `/avatars/${userId}.webp?v=${version}` : null;
}

/**
 * Keeps a small local copy of the OIDC profile picture (Pocket ID: claim "picture").
 * The apps never talk to the identity provider: the picture also shows up for guests,
 * offline in the shop, and without leaking the provider's address.
 */
export class AvatarService {
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly db: Db,
    private readonly sync: SyncService,
    private readonly hub: SyncHub,
    private readonly log: FastifyBaseLogger,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async download(url: string, accessToken?: string): Promise<Buffer | null> {
    const get = (auth: boolean) =>
      this.fetchImpl(url, {
        headers: { accept: 'image/*', ...(auth && accessToken ? { authorization: `Bearer ${accessToken}` } : {}) },
        signal: AbortSignal.timeout(8000),
      });
    let res = await get(false);
    // Some providers only hand out the picture with the user's token.
    if ((res.status === 401 || res.status === 403) && accessToken) res = await get(true);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (!/^image\//.test(res.headers.get('content-type') ?? 'image/')) throw new Error(`kein Bild: ${res.headers.get('content-type')}`);
    const data = Buffer.from(await res.arrayBuffer());
    if (data.length > MAX_BYTES) throw new Error('Bild zu groß');
    return data;
  }

  /** Called after each OIDC login. Never fails the login: errors only keep the old picture. */
  async refresh(userId: string, url: string | null, accessToken?: string): Promise<void> {
    try {
      let avatar: Buffer | null = null;
      if (url && /^https?:\/\//.test(url)) {
        const raw = await this.download(url, accessToken);
        if (raw) {
          avatar = await sharp(raw, { failOn: 'error' })
            .rotate()
            .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover' })
            .webp({ quality: 85 })
            .toBuffer();
        }
      }
      const version = avatar ? createHash('sha1').update(avatar).digest('hex').slice(0, 10) : null;
      const changed = await this.sync.exclusive(() =>
        this.db
          .update(users)
          .set({ avatar, avatarVersion: version, seq: sql`nextval('sync_seq')` })
          .where(and(eq(users.id, userId), sql`${users.avatarVersion} IS DISTINCT FROM ${version}`))
          .returning({ id: users.id }),
      );
      if (changed.length) await this.notifyPeople(userId);
    } catch (err) {
      this.log.warn({ err: (err as Error).message }, 'Profilbild nicht übernommen');
    }
  }

  /** The user and everyone sharing a list with them see the new picture right away. */
  private async notifyPeople(userId: string): Promise<void> {
    const mine = this.db.select({ listId: listMembers.listId }).from(listMembers).where(eq(listMembers.userId, userId));
    const people = await this.db.selectDistinct({ userId: listMembers.userId }).from(listMembers).where(inArray(listMembers.listId, mine));
    this.hub.notify(new Set([userId, ...people.map((p) => p.userId)]));
  }

  /** Existing sessions last 90 days: pictures are also picked up at start and once a day. */
  async refreshAll(): Promise<void> {
    const rows = await this.db.select({ id: users.id, url: users.avatarUrl }).from(users).where(isNotNull(users.avatarUrl));
    for (const r of rows) await this.refresh(r.id, r.url);
  }

  startScheduler(): void {
    void this.refreshAll();
    this.timer = setInterval(() => void this.refreshAll(), 24 * 3600_000);
    this.timer.unref();
  }

  stop(): void {
    clearInterval(this.timer);
  }

  async get(userId: string): Promise<{ version: string; data: Buffer } | null> {
    const [row] = await this.db
      .select({ data: users.avatar, version: users.avatarVersion })
      .from(users)
      .where(and(eq(users.id, userId), isNotNull(users.avatar)));
    return row?.data && row.version ? { data: row.data, version: row.version } : null;
  }
}
