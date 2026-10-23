import { randomInt } from 'node:crypto';
import { getCategory, CATEGORIES } from '@shopping/shared';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import sharp from 'sharp';
import type { SecretBox } from '../crypto.js';
import type { Db } from '../db/index.js';
import { appSettings, catalogItems, iconJobs, icons, iconUsage, type IconTarget } from '../db/schema.js';
import { currentSeq, stableUuid } from '../db/seed.js';
import type { SyncHub } from '../sync/hub.js';
import type { SyncService } from '../sync/service.js';
import { ApiError } from '../api/errors.js';
import { CloudflareGenerator, OpenAiGenerator, QuotaExceeded, type IconGenerator } from './generators.js';
import { processIcon, referenceImage } from './image.js';
import { buildPrompt, DEFAULT_STYLE } from './prompt.js';
import { ANCHOR_ITEMS, CATEGORY_SUBJECTS, SEED_SUBJECTS } from './subjects.js';

/** Below this many anchors the style is still being found: only the anchor items are generated. */
export const MIN_ANCHORS = 4;
const TICK_MS = 5 * 60_000;

export interface IconSettings {
  /** Works through the queue on its own (daily budget permitting). */
  enabled: boolean;
  provider: 'cloudflare' | 'openai';
  candidates: number;
  style: string;
  cloudflare: { accountId: string | null; token: string | null; model: string; dailyLimit: number; size: number };
  openai: { apiKey: string | null; model: string; quality: string; monthlyCapMilli: number };
  pausedUntil: string | null;
  pauseReason: string | null;
}

const DEFAULTS: IconSettings = {
  enabled: false,
  provider: 'cloudflare',
  candidates: 2,
  style: DEFAULT_STYLE,
  cloudflare: { accountId: null, token: null, model: 'flux-2-klein-4b', dailyLimit: 150, size: 512 },
  openai: { apiKey: null, model: 'gpt-image-1-mini', quality: 'medium', monthlyCapMilli: 10_000 },
  pausedUntil: null,
  pauseReason: null,
};

export type SettingsUpdate = Partial<Omit<IconSettings, 'cloudflare' | 'openai' | 'pausedUntil' | 'pauseReason'>> & {
  cloudflare?: Partial<IconSettings['cloudflare']>;
  openai?: Partial<IconSettings['openai']>;
};

type RunResult = 'idle' | 'done' | 'paused' | 'budget' | 'failed' | 'unconfigured';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Version token in icon URLs: a new approved icon gets a new URL, so caches never serve an old one. */
export function iconToken(iconId: string): string {
  return iconId.replace(/-/g, '').slice(0, 10);
}

export class IconService {
  private timer: NodeJS.Timeout | undefined;
  private draining: Promise<void> | null = null;
  /** Pause between two jobs, so a free tier's per-minute limit is never hit. */
  delayMs = 3000;

  constructor(
    private readonly db: Db,
    private readonly secrets: SecretBox,
    private readonly sync: SyncService,
    private readonly hub: SyncHub,
    private readonly log: FastifyBaseLogger,
    private readonly fetchImpl?: typeof fetch,
  ) {}

  // ---- settings --------------------------------------------------------------

  async settings(): Promise<IconSettings> {
    const [row] = await this.db.select().from(appSettings).where(eq(appSettings.key, 'icons'));
    const v = (row?.value ?? {}) as Partial<IconSettings>;
    return {
      ...DEFAULTS,
      ...v,
      cloudflare: { ...DEFAULTS.cloudflare, ...v.cloudflare },
      openai: { ...DEFAULTS.openai, ...v.openai },
    };
  }

  private async saveSettings(s: IconSettings): Promise<void> {
    await this.db
      .insert(appSettings)
      .values({ key: 'icons', value: s as unknown as Record<string, unknown> })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: s as unknown as Record<string, unknown>, updatedAt: sql`now()` } });
  }

  /** Settings without secrets, for the app. */
  async publicSettings() {
    const s = await this.settings();
    return {
      ...s,
      cloudflare: { ...s.cloudflare, token: undefined, hasToken: !!s.cloudflare.token },
      openai: { ...s.openai, apiKey: undefined, hasKey: !!s.openai.apiKey },
    };
  }

  async updateSettings(u: SettingsUpdate): Promise<void> {
    const s = await this.settings();
    const next: IconSettings = {
      ...s,
      ...u,
      cloudflare: { ...s.cloudflare, ...u.cloudflare },
      openai: { ...s.openai, ...u.openai },
    };
    // Secrets: empty string removes, undefined keeps.
    if (u.cloudflare?.token !== undefined) next.cloudflare.token = u.cloudflare.token ? this.secrets.seal(u.cloudflare.token) : null;
    if (u.openai?.apiKey !== undefined) next.openai.apiKey = u.openai.apiKey ? this.secrets.seal(u.openai.apiKey) : null;
    if (u.style !== undefined && !u.style.trim()) next.style = DEFAULT_STYLE;
    // New credentials or provider: try again right away instead of waiting for the pause to end.
    if (u.cloudflare?.token || u.openai?.apiKey || u.provider) {
      next.pausedUntil = null;
      next.pauseReason = null;
    }
    await this.saveSettings(next);
    if (next.enabled) this.kick();
  }

  private async pause(until: Date, reason: string): Promise<void> {
    const s = await this.settings();
    await this.saveSettings({ ...s, pausedUntil: until.toISOString(), pauseReason: reason });
    this.log.info({ until, reason }, 'Icon-Erzeugung pausiert');
  }

  generator(s: IconSettings, paid: boolean): IconGenerator | null {
    const cf = s.cloudflare;
    const oa = s.openai;
    const cloudflare =
      cf.accountId && cf.token
        ? new CloudflareGenerator({ accountId: cf.accountId, token: this.secrets.open(cf.token), model: cf.model, size: cf.size, fetchImpl: this.fetchImpl })
        : null;
    const openai = oa.apiKey ? new OpenAiGenerator({ apiKey: this.secrets.open(oa.apiKey), model: oa.model, quality: oa.quality, fetchImpl: this.fetchImpl }) : null;
    if (paid) return openai;
    return s.provider === 'openai' ? openai : cloudflare;
  }

  // ---- budget ------------------------------------------------------------------

  private async usage(provider: string) {
    const month = today().slice(0, 7);
    const [row] = await this.db
      .select({
        today: sql<number>`coalesce(sum(${iconUsage.images}) FILTER (WHERE ${iconUsage.day} = ${today()}), 0)::int`,
        monthCost: sql<number>`coalesce(sum(${iconUsage.costMilli}) FILTER (WHERE to_char(${iconUsage.day}, 'YYYY-MM') = ${month}), 0)::int`,
      })
      .from(iconUsage)
      .where(eq(iconUsage.provider, provider));
    return { today: row?.today ?? 0, monthCost: row?.monthCost ?? 0 };
  }

  private async withinBudget(s: IconSettings, gen: IconGenerator): Promise<boolean> {
    const u = await this.usage(gen.provider);
    if (gen.paid) return u.monthCost + gen.costMilli <= s.openai.monthlyCapMilli;
    return u.today < s.cloudflare.dailyLimit;
  }

  private async recordUsage(gen: IconGenerator): Promise<void> {
    await this.db
      .insert(iconUsage)
      .values({ day: today(), provider: gen.provider, images: 1, costMilli: gen.costMilli })
      .onConflictDoUpdate({
        target: [iconUsage.day, iconUsage.provider],
        set: { images: sql`${iconUsage.images} + 1`, costMilli: sql`${iconUsage.costMilli} + ${gen.costMilli}` },
      });
  }

  // ---- queue -----------------------------------------------------------------------

  private async anchors() {
    return this.db
      .select({ id: icons.id, targetType: icons.targetType, targetId: icons.targetId, image: icons.image })
      .from(icons)
      .where(and(eq(icons.status, 'approved'), eq(icons.isAnchor, true)))
      .orderBy(asc(icons.reviewedAt));
  }

  async enqueue(
    targetType: IconTarget,
    targetId: string,
    opts: { priority?: number; candidates?: number; paid?: boolean; hint?: string | null } = {},
  ): Promise<void> {
    await this.assertTarget(targetType, targetId);
    const s = await this.settings();
    const values = {
      targetType,
      targetId,
      priority: opts.priority ?? 2000,
      candidates: Math.min(4, Math.max(1, opts.candidates ?? s.candidates)),
      paid: opts.paid ?? false,
      hint: opts.hint ?? null,
    };
    await this.db
      .insert(iconJobs)
      .values(values)
      .onConflictDoUpdate({
        target: [iconJobs.targetType, iconJobs.targetId],
        targetWhere: sql`status = 'queued'`,
        set: { priority: sql`greatest(${iconJobs.priority}, ${values.priority})`, candidates: values.candidates, paid: values.paid, hint: values.hint, updatedAt: sql`now()` },
      });
  }

  /**
   * Plans automatic work. While the style is being found only the anchor items;
   * afterwards category icons first, then catalog items by how often they are bought.
   * Targets that ever had an icon or a job are left to the review ("neu erzeugen").
   */
  async enqueueMissing(): Promise<number> {
    const s = await this.settings();
    const anchorCount = (await this.anchors()).length;
    const untouched = (type: IconTarget, id: unknown) => sql`
      NOT EXISTS (SELECT 1 FROM ${icons} i WHERE i.target_type = ${type} AND i.target_id = ${id}::text)
      AND NOT EXISTS (SELECT 1 FROM ${iconJobs} j WHERE j.target_type = ${type} AND j.target_id = ${id}::text)`;

    let jobs: { targetType: IconTarget; targetId: string; priority: number; candidates: number }[] = [];
    if (anchorCount < MIN_ANCHORS) {
      const ids = ANCHOR_ITEMS.map((n) => stableUuid('shopping-seed', n.toLowerCase()));
      const rows = await this.db
        .select({ id: catalogItems.id })
        .from(catalogItems)
        .where(and(inArray(catalogItems.id, ids), untouched('item', catalogItems.id)));
      jobs = rows.map((r) => ({ targetType: 'item', targetId: r.id, priority: 1000, candidates: Math.max(3, s.candidates) }));
    } else {
      const used = await this.db.execute<{ id: string }>(sql`
        SELECT i.target_id AS id FROM ${icons} i WHERE i.target_type = 'category'
        UNION SELECT j.target_id FROM ${iconJobs} j WHERE j.target_type = 'category'`);
      const usedCats = new Set(used.map((r) => r.id));
      jobs = CATEGORIES.filter((c) => !usedCats.has(c.id)).map((c) => ({ targetType: 'category', targetId: c.id, priority: 1100, candidates: s.candidates }));
      const items = await this.db.execute<{ id: string; uses: number }>(sql`
        SELECT c.id, (SELECT count(*) FROM list_items li WHERE li.catalog_item_id = c.id)::int AS uses
        FROM ${catalogItems} c
        WHERE c.hidden = false AND ${untouched('item', sql`c.id`)}
        ORDER BY uses DESC, c.source = 'seed' DESC, c.name
        LIMIT 1000`);
      jobs.push(...items.map((r) => ({ targetType: 'item' as const, targetId: r.id, priority: Math.min(800, r.uses), candidates: s.candidates })));
    }
    if (!jobs.length) return 0;
    const inserted = await this.db.insert(iconJobs).values(jobs).onConflictDoNothing().returning({ id: iconJobs.id });
    return inserted.length;
  }

  private async assertTarget(targetType: IconTarget, targetId: string): Promise<void> {
    if (targetType === 'category') {
      if (!CATEGORIES.some((c) => c.id === targetId)) throw new ApiError(404, 'not_found', 'Unbekannte Kategorie');
      return;
    }
    if (!/^[0-9a-f-]{36}$/.test(targetId)) throw new ApiError(404, 'not_found', 'Unbekannter Artikel');
    const [row] = await this.db.select({ id: catalogItems.id }).from(catalogItems).where(eq(catalogItems.id, targetId));
    if (!row) throw new ApiError(404, 'not_found', 'Unbekannter Artikel');
  }

  /** What the picture shows: catalog description, built-in list, a text model, or the German name. */
  private async subject(targetType: IconTarget, targetId: string, gen: IconGenerator): Promise<{ subject: string; name: string }> {
    if (targetType === 'category') {
      return { subject: CATEGORY_SUBJECTS[targetId] ?? 'plain shopping bag', name: getCategory(targetId).name };
    }
    const [item] = await this.db.select().from(catalogItems).where(eq(catalogItems.id, targetId));
    if (!item) throw new Error('Artikel nicht gefunden');
    if (item.iconSubject) return { subject: item.iconSubject, name: item.name };
    let subject = SEED_SUBJECTS[item.name];
    if (!subject && gen instanceof CloudflareGenerator) {
      subject = await gen.describe(item.name, getCategory(item.categoryId).name).catch((err: Error) => {
        if (err instanceof QuotaExceeded) throw err;
        this.log.warn({ err: err.message }, 'Bildbeschreibung fehlgeschlagen');
        return undefined;
      });
    }
    subject ??= `the German grocery item "${item.name}"`;
    await this.db.update(catalogItems).set({ iconSubject: subject }).where(eq(catalogItems.id, item.id));
    return { subject, name: item.name };
  }

  /** Generates the candidates of the most important open job. */
  async runNext(): Promise<RunResult> {
    const s = await this.settings();
    if (s.pausedUntil && new Date(s.pausedUntil) > new Date()) return 'paused';
    const [job] = await this.db
      .select()
      .from(iconJobs)
      .where(eq(iconJobs.status, 'queued'))
      .orderBy(desc(iconJobs.priority), asc(iconJobs.createdAt))
      .limit(1);
    if (!job) return 'idle';

    const gen = this.generator(s, job.paid);
    if (!gen) {
      if (job.paid) {
        await this.finishJob(job.id, 'failed', 'Kein Bezahl-Anbieter (OpenAI) eingerichtet');
        return 'failed';
      }
      return 'unconfigured';
    }

    let made = 0;
    try {
      const { subject } = await this.subject(job.targetType, job.targetId, gen);
      const anchors = (await this.anchors()).filter((a) => !(a.targetType === job.targetType && a.targetId === job.targetId) && a.image);
      // The most recently approved anchors are used, at most as many as the provider takes.
      const refs = anchors.slice(-gen.maxReferences);
      const references = await Promise.all(
        refs.map((a) => (gen.background === 'key' ? referenceImage(a.image!) : sharp(a.image!).resize(448, 448).png().toBuffer())),
      );
      const referenceSet = refs.map((a) => iconToken(a.id)).join(',') || null;
      const prompt = buildPrompt({ subject, style: s.style, background: gen.background, withReferences: references.length > 0, hint: job.hint });

      for (let n = 0; n < job.candidates; n++) {
        if (!(await this.withinBudget(s, gen))) break;
        const seed = randomInt(1, 2 ** 31 - 1);
        const raw = await gen.generate({ prompt, references, seed });
        await this.recordUsage(gen);
        const processed = await processIcon(raw).catch((err: Error) => {
          this.log.warn({ err: err.message, target: job.targetId }, 'Icon unbrauchbar');
          return null;
        });
        if (!processed) continue;
        await this.db.insert(icons).values({
          targetType: job.targetType,
          targetId: job.targetId,
          provider: gen.provider,
          model: gen.model,
          prompt,
          seed,
          referenceSet,
          checks: { ...processed.checks },
          image: processed.image,
          thumb: processed.thumb,
        });
        made++;
      }
    } catch (err) {
      if (err instanceof QuotaExceeded) {
        await this.pause(err.until, err.message);
        if (made) await this.finishJob(job.id, 'done');
        return 'paused';
      }
      const attempts = job.attempts + 1;
      const message = (err as Error).message;
      this.log.warn({ err: message, target: job.targetId, attempts }, 'Icon-Erzeugung fehlgeschlagen');
      if (made) await this.finishJob(job.id, 'done');
      else if (attempts >= 3) await this.finishJob(job.id, 'failed', message);
      else await this.db.update(iconJobs).set({ attempts, error: message, updatedAt: sql`now()` }).where(eq(iconJobs.id, job.id));
      return 'failed';
    }

    if (!made && !(await this.withinBudget(s, gen))) return 'budget';
    await this.finishJob(job.id, made ? 'done' : 'failed', made ? null : 'Kein brauchbares Bild entstanden');
    return made ? 'done' : 'failed';
  }

  private async finishJob(id: string, status: 'done' | 'failed', error: string | null = null): Promise<void> {
    await this.db.update(iconJobs).set({ status, error, updatedAt: sql`now()` }).where(eq(iconJobs.id, id));
  }

  /** Works through the queue until it is empty, paused or out of budget. */
  async drain(): Promise<void> {
    if (this.draining) return this.draining;
    this.draining = (async () => {
      try {
        const s = await this.settings();
        if (!s.enabled) return;
        await this.enqueueMissing();
        let failures = 0;
        for (;;) {
          const r = await this.runNext();
          if (r === 'failed') failures++;
          if (r !== 'done' && r !== 'failed') break;
          if (failures >= 5) break; // something is broken; the next tick tries again
          if (!(await this.settings()).enabled) break;
          await new Promise((res) => setTimeout(res, this.delayMs));
        }
      } catch (err) {
        this.log.error({ err }, 'Icon-Warteschlange');
      } finally {
        this.draining = null;
      }
    })();
    return this.draining;
  }

  kick(): void {
    void this.drain();
  }

  startScheduler(): void {
    this.timer = setInterval(() => this.kick(), TICK_MS);
    this.timer.unref();
    this.kick();
  }

  async stop(): Promise<void> {
    clearInterval(this.timer);
    await this.draining;
  }

  // ---- review ----------------------------------------------------------------------

  private async broadcastCatalog(): Promise<void> {
    this.hub.broadcast({ t: 'catalog', seq: await currentSeq(this.db) });
  }

  async approve(iconId: string, userId: string, anchor?: boolean): Promise<void> {
    await this.sync.exclusive(() =>
      this.db.transaction(async (tx) => {
        const [icon] = await tx.select({ id: icons.id, targetType: icons.targetType, targetId: icons.targetId, status: icons.status }).from(icons).where(eq(icons.id, iconId));
        if (!icon || icon.status === 'rejected' || icon.status === 'retired') throw new ApiError(404, 'not_found', 'Icon nicht gefunden');
        const sameTarget = and(eq(icons.targetType, icon.targetType), eq(icons.targetId, icon.targetId), sql`${icons.id} <> ${iconId}`);
        // The previous icon and the other candidates are done with; their pictures are dropped.
        await tx
          .update(icons)
          .set({ status: sql`CASE WHEN ${icons.status} = 'approved' THEN 'retired' ELSE 'rejected' END`, isAnchor: false, image: null, thumb: null })
          .where(and(sameTarget, inArray(icons.status, ['approved', 'candidate'])));
        await tx
          .update(icons)
          .set({ status: 'approved', reviewedAt: sql`now()`, reviewedBy: userId, ...(anchor !== undefined ? { isAnchor: anchor } : {}) })
          .where(eq(icons.id, iconId));
        if (icon.targetType === 'item') {
          await tx.update(catalogItems).set({ icon: iconToken(iconId), seq: sql`nextval('sync_seq')` }).where(eq(catalogItems.id, icon.targetId));
        }
      }),
    );
    await this.broadcastCatalog();
  }

  async reject(iconId: string, userId: string): Promise<void> {
    await this.sync.exclusive(() =>
      this.db.transaction(async (tx) => {
        const [icon] = await tx.select({ targetType: icons.targetType, targetId: icons.targetId, status: icons.status }).from(icons).where(eq(icons.id, iconId));
        if (!icon) throw new ApiError(404, 'not_found', 'Icon nicht gefunden');
        await tx
          .update(icons)
          .set({ status: 'rejected', isAnchor: false, image: null, thumb: null, reviewedAt: sql`now()`, reviewedBy: userId })
          .where(eq(icons.id, iconId));
        // Taking back an approved icon: the app falls back to the category icon.
        if (icon.status === 'approved' && icon.targetType === 'item') {
          await tx.update(catalogItems).set({ icon: null, seq: sql`nextval('sync_seq')` }).where(eq(catalogItems.id, icon.targetId));
        }
      }),
    );
    await this.broadcastCatalog();
  }

  async setAnchor(iconId: string, anchor: boolean): Promise<void> {
    const res = await this.db
      .update(icons)
      .set({ isAnchor: anchor })
      .where(and(eq(icons.id, iconId), eq(icons.status, 'approved')))
      .returning({ id: icons.id });
    if (!res.length) throw new ApiError(404, 'not_found', 'Nur freigegebene Icons können Stil-Referenz sein');
    if (anchor) this.kick();
  }

  /** "Neu erzeugen" from the review, or "Icon gefällt mir nicht" from the app. */
  async regenerate(
    targetType: IconTarget,
    targetId: string,
    opts: { hint?: string | null; subject?: string | null; paid?: boolean; candidates?: number; priority?: number },
  ): Promise<void> {
    await this.assertTarget(targetType, targetId);
    if (targetType === 'item' && opts.subject !== undefined) {
      await this.db.update(catalogItems).set({ iconSubject: opts.subject?.trim() || null }).where(eq(catalogItems.id, targetId));
    }
    // Unreviewed candidates of the target make way for the new ones.
    await this.db
      .update(icons)
      .set({ status: 'rejected', image: null, thumb: null })
      .where(and(eq(icons.targetType, targetType), eq(icons.targetId, targetId), eq(icons.status, 'candidate')));
    await this.enqueue(targetType, targetId, { hint: opts.hint, paid: opts.paid, candidates: opts.candidates, priority: opts.priority ?? 2000 });
    this.kick();
  }

  /** Own picture (e.g. made in the AI Studio / ChatGPT web UI while finding the style). */
  async upload(targetType: IconTarget, targetId: string, data: Buffer): Promise<string> {
    await this.assertTarget(targetType, targetId);
    const processed = await processIcon(data).catch((err: Error) => {
      throw new ApiError(422, 'invalid_image', `Bild nicht verwendbar: ${err.message}`);
    });
    const [row] = await this.db
      .insert(icons)
      .values({ targetType, targetId, provider: 'upload', model: 'manual', prompt: '', checks: { ...processed.checks }, image: processed.image, thumb: processed.thumb })
      .returning({ id: icons.id });
    return row!.id;
  }

  private async names(targets: { targetType: IconTarget; targetId: string }[]) {
    const ids = targets.filter((t) => t.targetType === 'item').map((t) => t.targetId);
    const rows = ids.length
      ? await this.db
          .select({ id: catalogItems.id, name: catalogItems.name, categoryId: catalogItems.categoryId, subject: catalogItems.iconSubject })
          .from(catalogItems)
          .where(inArray(catalogItems.id, ids))
      : [];
    const byId = new Map(rows.map((r) => [r.id, r]));
    return (t: { targetType: IconTarget; targetId: string }) => {
      if (t.targetType === 'category') {
        return { name: getCategory(t.targetId).name, categoryId: t.targetId, subject: CATEGORY_SUBJECTS[t.targetId] ?? null };
      }
      const r = byId.get(t.targetId);
      return { name: r?.name ?? '?', categoryId: r?.categoryId ?? 'eigene', subject: r?.subject ?? (r ? (SEED_SUBJECTS[r.name] ?? null) : null) };
    };
  }

  /** Targets with candidates waiting for review, oldest first. */
  async reviewQueue(limit = 20) {
    const rows = await this.db
      .select({
        id: icons.id,
        targetType: icons.targetType,
        targetId: icons.targetId,
        status: icons.status,
        checks: icons.checks,
        provider: icons.provider,
        model: icons.model,
        createdAt: icons.createdAt,
      })
      .from(icons)
      .where(
        and(
          inArray(icons.status, ['candidate', 'approved']),
          sql`(${icons.targetType}, ${icons.targetId}) IN (
            SELECT target_type, target_id FROM ${icons} WHERE status = 'candidate'
            GROUP BY target_type, target_id ORDER BY min(created_at) LIMIT ${limit})`,
        ),
      )
      .orderBy(asc(icons.createdAt));
    const name = await this.names(rows);
    const targets = new Map<string, ReturnType<typeof name> & { targetType: IconTarget; targetId: string; approved: string | null; candidates: typeof rows; since: Date }>();
    for (const r of rows) {
      const key = `${r.targetType}:${r.targetId}`;
      let t = targets.get(key);
      if (!t) {
        t = { targetType: r.targetType, targetId: r.targetId, ...name(r), approved: null, candidates: [], since: r.createdAt };
        targets.set(key, t);
      }
      if (r.status === 'approved') t.approved = r.id;
      else t.candidates.push(r);
    }
    return [...targets.values()]
      .filter((t) => t.candidates.length)
      .map((t) => ({ ...t, candidates: t.candidates.map((c) => ({ id: c.id, checks: c.checks, provider: c.provider, model: c.model, createdAt: c.createdAt })) }));
  }

  /** All approved icons, for the overview and to pick style references. */
  async gallery() {
    const rows = await this.db
      .select({ id: icons.id, targetType: icons.targetType, targetId: icons.targetId, isAnchor: icons.isAnchor, reviewedAt: icons.reviewedAt })
      .from(icons)
      .where(eq(icons.status, 'approved'))
      .orderBy(desc(icons.isAnchor), desc(icons.reviewedAt));
    const name = await this.names(rows);
    return rows.map((r) => ({ ...r, ...name(r) }));
  }

  async status() {
    const s = await this.publicSettings();
    const [counts] = await this.db.execute<{ items: number; with_icon: number; candidates: number; queued: number; failed: number }>(sql`
      SELECT
        (SELECT count(*) FROM ${catalogItems} WHERE hidden = false)::int AS items,
        (SELECT count(*) FROM ${catalogItems} WHERE hidden = false AND icon IS NOT NULL)::int AS with_icon,
        (SELECT count(*) FROM ${icons} WHERE status = 'candidate')::int AS candidates,
        (SELECT count(*) FROM ${iconJobs} WHERE status = 'queued')::int AS queued,
        (SELECT count(*) FROM ${iconJobs} WHERE status = 'failed')::int AS failed`);
    const anchors = (await this.anchors()).length;
    const cf = await this.usage('cloudflare');
    const oa = await this.usage('openai');
    const failedJobs = await this.db
      .select({ id: iconJobs.id, targetType: iconJobs.targetType, targetId: iconJobs.targetId, error: iconJobs.error, updatedAt: iconJobs.updatedAt })
      .from(iconJobs)
      .where(eq(iconJobs.status, 'failed'))
      .orderBy(desc(iconJobs.updatedAt))
      .limit(20);
    const name = await this.names(failedJobs);
    return {
      settings: s,
      phase: anchors < MIN_ANCHORS ? ('style' as const) : ('mass' as const),
      anchors,
      minAnchors: MIN_ANCHORS,
      items: counts?.items ?? 0,
      withIcon: counts?.with_icon ?? 0,
      categoriesWithIcon: Object.keys(await this.categoryIcons()).length,
      candidates: counts?.candidates ?? 0,
      queued: counts?.queued ?? 0,
      failed: failedJobs.map((j) => ({ ...j, name: name(j).name })),
      usage: { cloudflareToday: cf.today, openaiMonthCostMilli: oa.monthCost },
      running: this.draining !== null,
    };
  }

  /** Clears failed jobs so they are planned again. */
  async retryFailed(): Promise<void> {
    await this.db.delete(iconJobs).where(eq(iconJobs.status, 'failed'));
    this.kick();
  }

  // ---- delivery ----------------------------------------------------------------------

  async categoryIcons(): Promise<Record<string, string>> {
    const rows = await this.db
      .select({ id: icons.id, targetId: icons.targetId })
      .from(icons)
      .where(and(eq(icons.targetType, 'category'), eq(icons.status, 'approved')));
    return Object.fromEntries(rows.map((r) => [r.targetId, iconToken(r.id)]));
  }

  async approvedImage(targetType: IconTarget, targetId: string): Promise<{ token: string; thumb: Buffer } | null> {
    const [row] = await this.db
      .select({ id: icons.id, thumb: icons.thumb })
      .from(icons)
      .where(and(eq(icons.targetType, targetType), eq(icons.targetId, targetId), eq(icons.status, 'approved')))
      .limit(1);
    return row?.thumb ? { token: iconToken(row.id), thumb: row.thumb } : null;
  }

  async image(iconId: string, size: 'master' | 'thumb'): Promise<Buffer | null> {
    const [row] = await this.db.select({ image: icons.image, thumb: icons.thumb }).from(icons).where(eq(icons.id, iconId));
    return (size === 'master' ? row?.image : row?.thumb) ?? null;
  }
}
