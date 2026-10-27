import { randomInt } from 'node:crypto';
import { ALL_CATEGORIES, CatalogIndex, categoriesFor, defaultCategoryFor, isOwnName, getCategory, listDescription, packingInfo } from '@shopping/shared';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import sharp from 'sharp';
import type { SecretBox } from '../crypto.js';
import type { Db } from '../db/index.js';
import { appSettings, catalogItems, customCategories, iconJobs, icons, iconUsage, listItems, listMembers, lists, type IconTarget } from '../db/schema.js';
import { currentSeq, stableUuid } from '../db/seed.js';
import { toCatalogItem } from '../sync/rows.js';
import type { SyncHub } from '../sync/hub.js';
import type { SyncService } from '../sync/service.js';
import { ApiError } from '../api/errors.js';
import { ClaudeReviewer, ClaudeSvgGenerator, renderSvg, entryContext, ENTRY_SYSTEM, LIST_SYSTEM, listContext, type EntryContext, type ReviewVerdict } from './anthropic.js';
import { CloudflareGenerator, OpenAiGenerator, QuotaExceeded, type IconDomain, type IconGenerator, type ProviderId } from './generators.js';
import { processIcon, referenceImage } from './image.js';
import { buildPrompt, DEFAULT_STYLE } from './prompt.js';
import { ANCHOR_ITEMS, CATEGORY_SUBJECTS, PACKING_SUBJECTS, SEED_SUBJECTS } from './subjects.js';
import { knownSpiceColor, spicePileSvg } from './spices.js';

/** Below this many anchors the style is still being found: only the anchor items are generated. */
export const MIN_ANCHORS = 4;
const TICK_MS = 5 * 60_000;
const CHANGE_DELAY_MS = 3_000;
/** Lists whose free-text entries get their own picture (Merklisten always do). */
const FREE_LIST = sql`l.list_type IN ('shopping', 'packing')`;

export interface IconSettings {
  /** Works through the queue on its own (daily budget permitting). */
  enabled: boolean;
  /** Approve the first candidate that passes all checks right away, no manual review. */
  autoApprove: boolean;
  provider: ProviderId;
  candidates: number;
  style: string;
  cloudflare: { accountId: string | null; token: string | null; model: string; dailyLimit: number; size: number };
  /** monthlyCap in € (or $) – stops paid generation for the rest of the month. */
  openai: { apiKey: string | null; model: string; quality: string; monthlyCap: number };
  /** Claude: draws SVG icons, pre-reviews pictures, describes items. One cap for all three. */
  anthropic: { apiKey: string | null; svgModel: string; review: boolean; categorize: boolean; fallback: boolean; reviewModel: string; monthlyCap: number };
  pausedUntil: string | null;
  pauseReason: string | null;
}

const DEFAULTS: IconSettings = {
  enabled: false,
  autoApprove: true,
  provider: 'cloudflare',
  candidates: 2,
  style: DEFAULT_STYLE,
  cloudflare: { accountId: null, token: null, model: 'flux-2-klein-4b', dailyLimit: 150, size: 512 },
  openai: { apiKey: null, model: 'gpt-image-1-mini', quality: 'medium', monthlyCap: 10 },
  anthropic: { apiKey: null, svgModel: 'claude-sonnet-5-5', review: true, categorize: true, fallback: true, reviewModel: 'claude-haiku-5-5', monthlyCap: 10 },
  pausedUntil: null,
  pauseReason: null,
};

export type SettingsUpdate = Partial<Omit<IconSettings, 'cloudflare' | 'openai' | 'anthropic' | 'pausedUntil' | 'pauseReason'>> & {
  cloudflare?: Partial<IconSettings['cloudflare']>;
  openai?: Partial<IconSettings['openai']>;
  anthropic?: Partial<IconSettings['anthropic']>;
};

const PROVIDER_NAMES: Record<ProviderId, string> = { cloudflare: 'Cloudflare', openai: 'OpenAI', claude: 'Claude' };

type RunResult = 'idle' | 'done' | 'paused' | 'budget' | 'failed' | 'unconfigured';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Good enough to go live without a person: all technical checks, and the AI pre-review if there was one. */
export function passesChecks(checks: Record<string, boolean>, aiReview: ReviewVerdict | null): boolean {
  return Object.values(checks).every(Boolean) && (aiReview === null || aiReview.ok);
}

/** Version token in icon URLs: a new approved icon gets a new URL, so caches never serve an old one. */
export function iconToken(iconId: string): string {
  return iconId.replace(/-/g, '').slice(0, 10);
}

export class IconService {
  private timer: NodeJS.Timeout | undefined;
  private draining: Promise<void> | null = null;
  /** Something changed since the queue was last planned (e.g. a new entry). */
  private dirty = true;
  private changeTimer: NodeJS.Timeout | undefined;
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
    const openai = { ...DEFAULTS.openai, ...v.openai } as IconSettings['openai'] & { monthlyCapMilli?: number };
    // Older settings stored the cap in thousandths.
    if (openai.monthlyCapMilli !== undefined && v.openai?.monthlyCap === undefined) openai.monthlyCap = openai.monthlyCapMilli / 1000;
    delete openai.monthlyCapMilli;
    return {
      ...DEFAULTS,
      ...v,
      cloudflare: { ...DEFAULTS.cloudflare, ...v.cloudflare },
      openai,
      anthropic: { ...DEFAULTS.anthropic, ...v.anthropic },
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
      anthropic: { ...s.anthropic, apiKey: undefined, hasKey: !!s.anthropic.apiKey },
    };
  }

  async updateSettings(u: SettingsUpdate): Promise<void> {
    const s = await this.settings();
    const next: IconSettings = {
      ...s,
      ...u,
      cloudflare: { ...s.cloudflare, ...u.cloudflare },
      openai: { ...s.openai, ...u.openai },
      anthropic: { ...s.anthropic, ...u.anthropic },
    };
    // Secrets: empty string removes, undefined keeps.
    if (u.cloudflare?.token !== undefined) next.cloudflare.token = u.cloudflare.token ? this.secrets.seal(u.cloudflare.token) : null;
    if (u.openai?.apiKey !== undefined) next.openai.apiKey = u.openai.apiKey ? this.secrets.seal(u.openai.apiKey) : null;
    if (u.anthropic?.apiKey !== undefined) next.anthropic.apiKey = u.anthropic.apiKey ? this.secrets.seal(u.anthropic.apiKey) : null;
    if (u.style !== undefined && !u.style.trim()) next.style = DEFAULT_STYLE;
    // New credentials or provider: try again right away instead of waiting for the pause to end.
    if (u.cloudflare?.token || u.openai?.apiKey || u.anthropic?.apiKey || u.provider) {
      next.pausedUntil = null;
      next.pauseReason = null;
    }
    await this.saveSettings(next);
    if (u.autoApprove && !s.autoApprove) await this.autoApprovePending();
    if (next.enabled) this.kick();
  }

  private async pause(until: Date, reason: string): Promise<void> {
    const s = await this.settings();
    await this.saveSettings({ ...s, pausedUntil: until.toISOString(), pauseReason: reason });
    this.log.info({ until, reason }, 'Icon-Erzeugung pausiert');
  }

  /** The generator for a provider, or null when it is not set up. */
  generator(s: IconSettings, provider: ProviderId): IconGenerator | null {
    const cf = s.cloudflare;
    const oa = s.openai;
    const an = s.anthropic;
    switch (provider) {
      case 'cloudflare':
        return cf.accountId && cf.token
          ? new CloudflareGenerator({ accountId: cf.accountId, token: this.secrets.open(cf.token), model: cf.model, size: cf.size, fetchImpl: this.fetchImpl })
          : null;
      case 'openai':
        return oa.apiKey ? new OpenAiGenerator({ apiKey: this.secrets.open(oa.apiKey), model: oa.model, quality: oa.quality, fetchImpl: this.fetchImpl }) : null;
      case 'claude':
        return an.apiKey ? new ClaudeSvgGenerator({ apiKey: this.secrets.open(an.apiKey), model: an.svgModel, fetchImpl: this.fetchImpl }) : null;
    }
  }

  private claude(s: IconSettings, model = s.anthropic.reviewModel): ClaudeReviewer | null {
    return s.anthropic.apiKey ? new ClaudeReviewer(this.secrets.open(s.anthropic.apiKey), model, this.fetchImpl) : null;
  }

  // ---- budget ------------------------------------------------------------------

  private async usage(provider: string) {
    const month = today().slice(0, 7);
    const [row] = await this.db
      .select({
        today: sql<number>`coalesce(sum(${iconUsage.images}) FILTER (WHERE ${iconUsage.day} = ${today()}), 0)::int`,
        monthCost: sql<number>`coalesce(sum(${iconUsage.costMicro}) FILTER (WHERE to_char(${iconUsage.day}, 'YYYY-MM') = ${month}), 0)::int`,
      })
      .from(iconUsage)
      .where(eq(iconUsage.provider, provider));
    return { today: row?.today ?? 0, monthCost: row?.monthCost ?? 0 };
  }

  private monthlyCapMicro(s: IconSettings, provider: ProviderId): number {
    return Math.round((provider === 'openai' ? s.openai.monthlyCap : s.anthropic.monthlyCap) * 1_000_000);
  }

  /** Free tier: images per day. Paid providers: estimated cost against the monthly cap. */
  private async withinBudget(s: IconSettings, provider: ProviderId, nextCostMicro: number): Promise<boolean> {
    const u = await this.usage(provider);
    if (provider === 'cloudflare') return u.today < s.cloudflare.dailyLimit;
    return u.monthCost + nextCostMicro <= this.monthlyCapMicro(s, provider);
  }

  private async recordUsage(provider: ProviderId, images: number, costMicro: number): Promise<void> {
    await this.db
      .insert(iconUsage)
      .values({ day: today(), provider, images, costMicro })
      .onConflictDoUpdate({
        target: [iconUsage.day, iconUsage.provider],
        set: { images: sql`${iconUsage.images} + ${images}`, costMicro: sql`${iconUsage.costMicro} + ${costMicro}` },
      });
  }

  // ---- queue -----------------------------------------------------------------------

  private async anchors() {
    return this.db
      .select({ id: icons.id, targetType: icons.targetType, targetId: icons.targetId, image: icons.image, svg: icons.svg })
      .from(icons)
      .where(and(eq(icons.status, 'approved'), eq(icons.isAnchor, true)))
      .orderBy(asc(icons.reviewedAt));
  }

  async enqueue(
    targetType: IconTarget,
    targetId: string,
    opts: { priority?: number; candidates?: number; provider?: ProviderId | null; hint?: string | null } = {},
  ): Promise<void> {
    await this.assertTarget(targetType, targetId);
    const s = await this.settings();
    const values = {
      targetType,
      targetId,
      priority: opts.priority ?? 2000,
      candidates: Math.min(4, Math.max(1, opts.candidates ?? s.candidates)),
      provider: opts.provider ?? null,
      paid: !!opts.provider && opts.provider !== 'cloudflare',
      hint: opts.hint ?? null,
    };
    await this.db
      .insert(iconJobs)
      .values(values)
      .onConflictDoUpdate({
        target: [iconJobs.targetType, iconJobs.targetId],
        targetWhere: sql`status = 'queued'`,
        set: { priority: sql`greatest(${iconJobs.priority}, ${values.priority})`, candidates: values.candidates, provider: values.provider, paid: values.paid, hint: values.hint, attempts: 0, updatedAt: sql`now()` },
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
      // In their usual order (Obst & Gemüse first), the catch-all ones last.
      jobs = ALL_CATEGORIES.map((c, i) => ({ c, i }))
        .filter(({ c }) => !usedCats.has(c.id))
        .map(({ c, i }) => ({ targetType: 'category', targetId: c.id, priority: 1100 - i, candidates: s.candidates }));
      // Same thing to buy and to pack: one picture.
      await this.alignTwins();
      // Only items that are or were on a list; the rest of the catalog shows its category icon
      // (and gets its own picture once it is used). Jobs planned earlier for unused items go.
      await this.db.execute(sql`DELETE FROM ${iconJobs} WHERE status = 'queued' AND target_type = 'item' AND priority = 0`);
      const items = await this.db.execute<{ id: string; uses: number }>(sql`
        SELECT * FROM (
          SELECT c.id, (SELECT count(*) FROM list_items li WHERE li.catalog_item_id = c.id)::int AS uses
          FROM ${catalogItems} c
          WHERE c.hidden = false AND ${untouched('item', sql`c.id`)}
        ) used WHERE uses > 0
        ORDER BY uses DESC
        LIMIT 1000`);
      jobs.push(...items.map((r) => ({ targetType: 'item' as const, targetId: r.id, priority: Math.min(800, r.uses), candidates: s.candidates })));
      // Merkliste entries: each gets its own picture (a film, a book …), right after the categories.
      const entries = await this.db.execute<{ id: string }>(sql`
        SELECT li.id FROM ${listItems} li JOIN ${lists} l ON l.id = li.list_id
        WHERE l.list_type = 'memo' AND l.deleted = false AND li.deleted = false AND li.icon IS NULL
          AND ${untouched('entry', sql`li.id`)}
        LIMIT 500`);
      jobs.push(...entries.map((r) => ({ targetType: 'entry' as const, targetId: r.id, priority: 950, candidates: s.candidates })));
      // Free-text entries on shopping and packing lists (not in the catalog): one picture per name,
      // shared by every entry of that name. Already drawn names get theirs right away.
      await this.shareFreeIcons();
      const free = await this.db.execute<{ id: string }>(sql`
        SELECT DISTINCT ON (lower(trim(li.name))) li.id FROM ${listItems} li JOIN ${lists} l ON l.id = li.list_id
        WHERE ${FREE_LIST} AND l.deleted = false AND li.deleted = false AND li.icon IS NULL AND li.catalog_item_id IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM ${listItems} o JOIN ${lists} ol ON ol.id = o.list_id
            WHERE ol.list_type IN ('shopping', 'packing') AND o.catalog_item_id IS NULL AND lower(trim(o.name)) = lower(trim(li.name))
              AND (EXISTS (SELECT 1 FROM ${icons} i WHERE i.target_type = 'entry' AND i.target_id = o.id::text)
                OR EXISTS (SELECT 1 FROM ${iconJobs} j WHERE j.target_type = 'entry' AND j.target_id = o.id::text)))
        ORDER BY lower(trim(li.name)), li.created_at
        LIMIT 500`);
      jobs.push(...free.map((r) => ({ targetType: 'entry' as const, targetId: r.id, priority: 950, candidates: s.candidates })));
      // Lists: a picture from the name, again after a rename. The name is noted right away, so a failed
      // or rejected picture is not drawn over and over.
      const named = await this.db.execute<{ id: string }>(sql`
        UPDATE ${lists} SET icon_name = name
        WHERE deleted = false AND archived_at IS NULL AND icon_name IS DISTINCT FROM name
        RETURNING id`);
      jobs.push(...named.map((r) => ({ targetType: 'list' as const, targetId: r.id, priority: 970, candidates: s.candidates })));
      // Own categories: same as lists – a picture from the name, again after a rename.
      const cats = await this.db.execute<{ id: string }>(sql`
        UPDATE ${customCategories} SET icon_name = name, icon_subject = NULL
        WHERE deleted = false AND icon_name IS DISTINCT FROM name
        RETURNING id`);
      jobs.push(...cats.map((r) => ({ targetType: 'category' as const, targetId: r.id, priority: 1100, candidates: s.candidates })));
    }
    if (!jobs.length) return 0;
    const inserted = await this.db.insert(iconJobs).values(jobs).onConflictDoNothing().returning({ id: iconJobs.id });
    return inserted.length;
  }

  /** Free-text entries without a picture get the one already drawn for the same name. */
  private async shareFreeIcons(): Promise<void> {
    const rows = await this.sync.exclusive(() =>
      this.db.execute<{ list_id: string }>(sql`
        UPDATE ${listItems} li SET icon = src.icon, seq = nextval('sync_seq')
        FROM (
          SELECT DISTINCT ON (lower(trim(s.name))) lower(trim(s.name)) AS key, s.icon
          FROM ${listItems} s JOIN ${lists} sl ON sl.id = s.list_id
          WHERE sl.list_type IN ('shopping', 'packing') AND s.catalog_item_id IS NULL AND s.icon IS NOT NULL
          ORDER BY lower(trim(s.name)), s.created_at DESC
        ) src
        WHERE li.icon IS NULL AND li.deleted = false AND li.catalog_item_id IS NULL AND lower(trim(li.name)) = src.key
          AND li.list_id IN (SELECT l.id FROM ${lists} l WHERE ${FREE_LIST} AND l.deleted = false)
        RETURNING li.list_id`),
    );
    if (rows.length) await this.notifyLists([...new Set(rows.map((r) => r.list_id))]);
  }

  private async notifyLists(listIds: string[]): Promise<void> {
    if (!listIds.length) return;
    const members = await this.db.select({ userId: listMembers.userId }).from(listMembers).where(inArray(listMembers.listId, listIds));
    this.hub.notify(new Set(members.map((m) => m.userId)));
  }

  private async assertTarget(targetType: IconTarget, targetId: string): Promise<void> {
    if (targetType === 'category') {
      if (!ALL_CATEGORIES.some((c) => c.id === targetId) && !(await this.customCategory(targetId))) throw new ApiError(404, 'not_found', 'Unbekannte Kategorie');
      return;
    }
    if (!/^[0-9a-f-]{36}$/.test(targetId)) throw new ApiError(404, 'not_found', 'Unbekannter Artikel');
    if (targetType === 'entry') {
      if (!(await this.entry(targetId))) throw new ApiError(404, 'not_found', 'Unbekannter Eintrag');
      return;
    }
    if (targetType === 'list') {
      if (!(await this.listOf(targetId))) throw new ApiError(404, 'not_found', 'Unbekannte Liste');
      return;
    }
    const [row] = await this.db.select({ id: catalogItems.id }).from(catalogItems).where(eq(catalogItems.id, targetId));
    if (!row) throw new ApiError(404, 'not_found', 'Unbekannter Artikel');
  }

  private async isUserItem(id: string): Promise<boolean> {
    const [row] = await this.db.select({ source: catalogItems.source }).from(catalogItems).where(eq(catalogItems.id, id));
    return row?.source === 'user';
  }

  private async customCategory(id: string) {
    if (!/^[0-9a-f-]{36}$/.test(id)) return null;
    const [row] = await this.db.select().from(customCategories).where(and(eq(customCategories.id, id), eq(customCategories.deleted, false)));
    return row ?? null;
  }

  private async listOf(listId: string) {
    const [row] = await this.db.select().from(lists).where(and(eq(lists.id, listId), eq(lists.deleted, false)));
    return row
      ? {
          name: row.name,
          listType: row.listType,
          description: typeof row.settings.description === 'string' ? row.settings.description : null,
          group: typeof row.settings.group === 'string' ? row.settings.group : null,
        }
      : null;
  }

  /** A Merkliste entry or a free-text entry with its list (for the context of its picture). */
  private async entry(itemId: string): Promise<(EntryContext & { listId: string; listType: string; categoryId: string | null }) | null> {
    const [row] = await this.db
      .select({ item: listItems, list: lists })
      .from(listItems)
      .innerJoin(lists, eq(lists.id, listItems.listId))
      .where(and(eq(listItems.id, itemId), eq(listItems.deleted, false), eq(lists.deleted, false)));
    if (!row) return null;
    // Shopping/packing: free text (or just turned into a catalog item of the household).
    if (row.list.listType !== 'memo' && !(['shopping', 'packing'].includes(row.list.listType) && (!row.item.catalogItemId || (await this.isUserItem(row.item.catalogItemId))))) return null;
    const info = packingInfo(row.item);
    return {
      listId: row.list.id,
      listType: row.list.listType,
      categoryId: row.item.categoryId,
      name: row.item.name,
      listName: row.list.name,
      description: listDescription(row.list),
      where: info.container,
      note: row.item.note,
    };
  }

  /** What the picture shows: catalog description, built-in list, a text model, or the German name. */
  private async subject(
    targetType: IconTarget,
    targetId: string,
    gen: IconGenerator,
    s: IconSettings,
  ): Promise<{ subject: string; name: string; context?: string; domain: IconDomain }> {
    if (targetType === 'category') {
      const own = CATEGORY_SUBJECTS[targetId] ? null : await this.customCategory(targetId);
      if (!own) return { subject: CATEGORY_SUBJECTS[targetId] ?? 'plain shopping bag', name: getCategory(targetId).name, domain: 'category' };
      // An own category ("Angeln", "Asia-Laden"): described from its name like a thing of that list type.
      if (own.iconSubject) return { subject: own.iconSubject, name: own.name, domain: 'category' };
      const subject = await this.describeThing(own.name, defaultCategoryFor(own.listType), own.listType, gen, s);
      await this.db.update(customCategories).set({ iconSubject: subject }).where(eq(customCategories.id, own.id));
      return { subject, name: own.name, domain: 'category' };
    }
    if (targetType === 'list') {
      const l = await this.listOf(targetId);
      if (!l) throw new Error('Liste nicht gefunden');
      const context = listContext(l);
      let subject: string | undefined;
      const claude = this.claude(s);
      if (claude && (await this.withinBudget(s, 'claude', 1_000))) {
        subject = await claude
          .describeList(l)
          .then(async (r) => {
            await this.recordUsage('claude', 0, r.costMicro);
            return r.subject;
          })
          .catch((err: Error) => {
            this.log.warn({ err: err.message }, 'Bildbeschreibung (Claude) fehlgeschlagen');
            return undefined;
          });
      }
      if (!subject && gen instanceof CloudflareGenerator) {
        subject = await gen.describeEntry(LIST_SYSTEM, context).catch((err: Error) => {
          if (err instanceof QuotaExceeded) throw err;
          this.log.warn({ err: err.message }, 'Bildbeschreibung fehlgeschlagen');
          return undefined;
        });
      }
      return { subject: subject ?? `a simple object that stands for ${context}`, name: l.name, context, domain: 'list' };
    }
    if (targetType === 'entry') {
      // Merkliste: the list's description tells what "Dune" is (a film here, a book elsewhere).
      const e = await this.entry(targetId);
      if (!e) throw new Error('Eintrag nicht gefunden');
      if (e.listType !== 'memo') {
        // Free text on a shopping or packing list: an object like a catalog item.
        const kind = e.listType === 'packing' ? 'packing' : 'shopping';
        // The list's name helps: "Mutter" on "Baumarkt" is a nut, not a mother.
        const subject = await this.describeThing(e.name, e.categoryId, kind, gen, s, e.listName);
        return { subject, name: e.name, domain: kind, context: `"${e.name}" on the list "${e.listName}"` };
      }
      const context = entryContext(e);
      let subject: string | undefined;
      const claude = this.claude(s);
      if (claude && (await this.withinBudget(s, 'claude', 1_000))) {
        subject = await claude
          .describeEntry(e)
          .then(async (r) => {
            await this.recordUsage('claude', 0, r.costMicro);
            return r.subject;
          })
          .catch((err: Error) => {
            this.log.warn({ err: err.message }, 'Bildbeschreibung (Claude) fehlgeschlagen');
            return undefined;
          });
      }
      if (!subject && gen instanceof CloudflareGenerator) {
        subject = await gen.describeEntry(ENTRY_SYSTEM, context).catch((err: Error) => {
          if (err instanceof QuotaExceeded) throw err;
          this.log.warn({ err: err.message }, 'Bildbeschreibung fehlgeschlagen');
          return undefined;
        });
      }
      return { subject: subject ?? `a simple object that evokes ${context}`, name: e.name, context, domain: 'memo' };
    }
    const [item] = await this.db.select().from(catalogItems).where(eq(catalogItems.id, targetId));
    if (!item) throw new Error('Artikel nicht gefunden');
    const domain: IconDomain = item.kind === 'packing' ? 'packing' : 'shopping';
    // A spice asked for anew by hand: the AI draws a small heap of it.
    if (item.iconSubject?.startsWith('spice:')) return { subject: `a small heap of the ground spice "${item.name}"`, name: item.name, domain };
    if (item.iconSubject) return { subject: item.iconSubject, name: item.name, domain };
    const subject = await this.describeThing(item.name, item.categoryId, item.kind, gen, s);
    await this.db.update(catalogItems).set({ iconSubject: subject }).where(eq(catalogItems.id, item.id));
    return { subject, name: item.name, domain };
  }

  /** English picture description of a thing to buy or pack: built-in list, Claude, a text model, or the German name. */
  private async describeThing(name: string, categoryId: string | null, kind: string, gen: IconGenerator, s: IconSettings, listName?: string): Promise<string> {
    let subject = kind === 'packing' ? (PACKING_SUBJECTS[name] ?? SEED_SUBJECTS[name]) : SEED_SUBJECTS[name];
    const category = getCategory(categoryId ?? 'eigene').name;
    const claude = this.claude(s);
    if (!subject && claude && (await this.withinBudget(s, 'claude', 1_000))) {
      subject = await claude
        .describe(name, category, kind, listName)
        .then(async (r) => {
          await this.recordUsage('claude', 0, r.costMicro);
          return r.subject;
        })
        .catch((err: Error) => {
          this.log.warn({ err: err.message }, 'Bildbeschreibung (Claude) fehlgeschlagen');
          return undefined;
        });
    }
    if (!subject && gen instanceof CloudflareGenerator) {
      subject = await gen.describe(name, category, kind, listName).catch((err: Error) => {
        if (err instanceof QuotaExceeded) throw err;
        this.log.warn({ err: err.message }, 'Bildbeschreibung fehlgeschlagen');
        return undefined;
      });
    }
    return subject ?? (kind === 'packing' ? `the travel item "${name}"` : `the German grocery item "${name}"`);
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

    // The same thing on the other kind of list (Zahnpasta to buy and to pack) already has a picture: that one.
    if (job.targetType === 'item' && job.priority < 2000 && (await this.shareFromTwin(job.targetId))) {
      await this.finishJob(job.id, 'done');
      return 'done';
    }

    // Spices: the coloured pile, no image AI (unless someone asked for a new one by hand).
    if (job.targetType === 'item' && job.priority < 2000) {
      const color = await this.spiceColor(job.targetId, s);
      if (color) {
        await this.drawSpice(job.id, job.targetId, color);
        return 'done';
      }
    }

    // Older jobs only knew "paid" (= OpenAI).
    const providerId = (job.provider as ProviderId | null) ?? (job.paid ? 'openai' : s.provider);
    const gen = this.generator(s, providerId);
    if (!gen) {
      if (providerId !== s.provider) {
        await this.finishJob(job.id, 'failed', `${PROVIDER_NAMES[providerId]} ist nicht eingerichtet`);
        return 'failed';
      }
      return 'unconfigured';
    }

    let made = 0;
    let passed = 0;
    const verdicts: ReviewVerdict[] = [];
    try {
      const { subject, name, context, domain } = await this.subject(job.targetType, job.targetId, gen, s);
      const anchors = (await this.anchors()).filter((a) => !(a.targetType === job.targetType && a.targetId === job.targetId) && a.image);
      // The most recently approved anchors are used, at most as many as the provider takes.
      const refs = anchors.slice(-gen.maxReferences);
      const references = await Promise.all(
        refs.map((a) => (gen.background === 'key' ? referenceImage(a.image!) : sharp(a.image!).resize(448, 448).png().toBuffer())),
      );
      // SVG anchors are the best reference for SVG drawing; the pictures for everything else.
      const svgAnchors = anchors.filter((a) => a.svg).slice(-gen.maxReferences);
      const referenceSvgs = gen.provider === 'claude' && svgAnchors.length ? svgAnchors.map((a) => a.svg!) : undefined;
      const referenceSet = (referenceSvgs ? svgAnchors : refs).map((a) => iconToken(a.id)).join(',') || null;
      const prompt =
        gen.provider === 'claude'
          ? `Claude SVG: ${subject}${job.hint ? ` · ${job.hint}` : ''}`
          : buildPrompt({ subject, style: s.style, background: gen.background, withReferences: references.length > 0, hint: job.hint, context });
      const reviewer = s.anthropic.review ? this.claude(s) : null;
      const reviewRefs = await Promise.all(anchors.slice(-3).map((a) => sharp(a.image!).png().toBuffer()));

      // Claude is paid per drawing: one at a time (a second round follows only if the pre-review refuses it).
      // While the style is still being found, and when asked for by hand, as many as wanted.
      const count = gen.provider === 'claude' && job.priority < 2000 && anchors.length >= MIN_ANCHORS ? 1 : job.candidates;
      for (let n = 0; n < count; n++) {
        if (!(await this.withinBudget(s, gen.provider, gen.costMicro))) break;
        const seed = randomInt(1, 2 ** 31 - 1);
        const result = await gen.generate({ prompt, references, referenceSvgs, seed, subject, style: s.style, hint: job.hint, context, domain }).catch((err: Error) => {
          // A broken SVG is one bad candidate, not a broken provider.
          if (gen.provider === 'claude' && !(err instanceof QuotaExceeded) && /SVG|Element|Verweis|url\(|Inhalt|JSON/.test(err.message)) {
            this.log.warn({ err: err.message }, 'SVG unbrauchbar');
            return null;
          }
          throw err;
        });
        if (!result) continue;
        await this.recordUsage(gen.provider, 1, result.costMicro);
        const processed = await processIcon(result.image).catch((err: Error) => {
          this.log.warn({ err: err.message, target: job.targetId }, 'Icon unbrauchbar');
          return null;
        });
        if (!processed) continue;
        // AI pre-review: catches unrecognisable pictures, text and broken ones before a person looks.
        let aiReview: ReviewVerdict | null = null;
        if (reviewer && (await this.withinBudget(s, 'claude', 2_000))) {
          aiReview = await reviewer
            .review(processed.image, { name, subject, domain }, reviewRefs)
            .then(async (r) => {
              await this.recordUsage('claude', 0, r.costMicro);
              return r.verdict;
            })
            .catch((err: Error) => {
              this.log.warn({ err: err.message }, 'KI-Vorprüfung fehlgeschlagen');
              return null;
            });
        }
        if (aiReview) verdicts.push(aiReview);
        if (!aiReview || aiReview.ok) passed++;
        const [inserted] = await this.db.insert(icons).values({
          targetType: job.targetType,
          targetId: job.targetId,
          provider: gen.provider,
          model: gen.model,
          prompt,
          seed,
          referenceSet,
          checks: { ...processed.checks },
          aiReview,
          svg: result.svg ?? null,
          image: processed.image,
          thumb: processed.thumb,
        }).returning({ id: icons.id });
        made++;
        // Automatic approval: the first good one goes live, no further candidates are paid for.
        if (s.autoApprove && passesChecks({ ...processed.checks }, aiReview)) {
          await this.approve(inserted!.id, null, anchors.length < MIN_ANCHORS ? true : undefined);
          await this.finishJob(job.id, 'done');
          return 'done';
        }
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
      else if (attempts >= 3 && !(await this.fallbackToClaude(job, s))) await this.finishJob(job.id, 'failed', message);
      else await this.db.update(iconJobs).set({ attempts, error: message, updatedAt: sql`now()` }).where(eq(iconJobs.id, job.id));
      return 'failed';
    }

    if (!made && !(await this.withinBudget(s, gen.provider, gen.costMicro))) return 'budget';
    // Everything failed the AI pre-review: one more round, with what was wrong as a hint.
    if (made && !passed && job.attempts === 0) {
      const reason = verdicts.map((v) => v.shows).filter(Boolean).slice(0, 2).join('; ');
      await this.db
        .update(iconJobs)
        .set({ attempts: 1, hint: [job.hint, reason ? `clearly recognisable, not like: ${reason}` : null].filter(Boolean).join('. '), updatedAt: sql`now()` })
        .where(eq(iconJobs.id, job.id));
      return 'done';
    }
    // Nothing usable from the free provider, even after the second round: Claude has one go.
    if ((!made || !passed) && (await this.fallbackToClaude(job, s))) return 'done';
    await this.finishJob(job.id, made ? 'done' : 'failed', made ? null : 'Kein brauchbares Bild entstanden');
    return made ? 'done' : 'failed';
  }

  /** Hands a job FLUX (or OpenAI) could not do to Claude, once. Returns false if that is not possible. */
  private async fallbackToClaude(job: typeof iconJobs.$inferSelect, s: IconSettings): Promise<boolean> {
    const provider = (job.provider as ProviderId | null) ?? s.provider;
    if (provider === 'claude' || !s.anthropic.fallback || !s.anthropic.apiKey) return false;
    await this.db
      .update(iconJobs)
      .set({ provider: 'claude', candidates: 1, attempts: 1, error: null, updatedAt: sql`now()` })
      .where(eq(iconJobs.id, job.id));
    return true;
  }

  /** Colour of the pile if the item is a spice: built-in list, else Haiku (once; the answer is kept). */
  private async spiceColor(itemId: string, s: IconSettings): Promise<string | null> {
    const [item] = await this.db.select().from(catalogItems).where(eq(catalogItems.id, itemId));
    if (!item || item.kind !== 'shopping') return null;
    if (item.iconSubject?.startsWith('spice:')) return item.iconSubject.slice(6);
    if (item.iconSubject) return null;
    let color = knownSpiceColor([item.name, item.plural, ...item.aliases]) ?? null;
    const claude = this.claude(s, 'claude-haiku-5-5');
    if (!color && item.categoryId === 'zutaten-gewuerze' && claude && (await this.withinBudget(s, 'claude', 500))) {
      color = await claude
        .spiceColor(item.name)
        .then(async (r) => {
          await this.recordUsage('claude', 0, r.costMicro);
          return r.color;
        })
        .catch(() => null);
    }
    if (color) await this.db.update(catalogItems).set({ iconSubject: `spice:${color}` }).where(eq(catalogItems.id, itemId));
    return color;
  }

  private async drawSpice(jobId: string, itemId: string, color: string): Promise<void> {
    const svg = spicePileSvg(color);
    const processed = await processIcon(await renderSvg(svg));
    const [icon] = await this.db
      .insert(icons)
      .values({ targetType: 'item', targetId: itemId, provider: 'builtin', model: 'spice', prompt: `Gewürz ${color}`, checks: { ...processed.checks }, svg, image: processed.image, thumb: processed.thumb })
      .returning({ id: icons.id });
    await this.approve(icon!.id, null);
    await this.finishJob(jobId, 'done');
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
        if (s.autoApprove) await this.autoApprovePending();
        this.dirty = false;
        await this.enqueueMissing();
        let failures = 0;
        for (;;) {
          // New entries while a long queue is being worked through: plan them in now, not hours later.
          if (this.dirty) {
            this.dirty = false;
            await this.enqueueMissing();
          }
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
    this.timer = setInterval(() => {
      void this.categorizeNew();
      this.kick();
    }, TICK_MS);
    this.timer.unref();
    this.hub.onChange(() => this.changed());
    this.kick();
  }

  /** A list changed: plan icons for new entries shortly (collected, not per keystroke). */
  changed(): void {
    this.dirty = true;
    if (this.changeTimer) return;
    this.changeTimer = setTimeout(() => {
      this.changeTimer = undefined;
      void this.categorizeNew();
      this.kick();
    }, CHANGE_DELAY_MS);
    this.changeTimer.unref();
  }

  // ---- categories of new entries ----------------------------------------------------

  private categorizing: Promise<number> | null = null;
  /** Entries already looked at (once is enough; a failure is not retried until restart). */
  private readonly categorized = new Set<string>();

  /**
   * New free-text entries on shopping and packing lists come without a category ("Sonstiges"). The same
   * name with a category elsewhere (also chosen by hand) is taken over; otherwise Claude picks one of
   * the list type's categories, own ones included. Returns how many were sorted in.
   */
  categorizeNew(): Promise<number> {
    if (this.categorizing) return this.categorizing;
    this.categorizing = (async () => {
      let done = 0;
      try {
        const s = await this.settings();
        const rows = await this.db.execute<{ id: string; name: string; list_type: string; list_name: string; owner_id: string }>(sql`
          SELECT li.id, li.name, l.list_type, l.name AS list_name, l.owner_id
          FROM ${listItems} li JOIN ${lists} l ON l.id = li.list_id
          WHERE ${FREE_LIST} AND l.deleted = false AND li.deleted = false AND li.checked = false
            AND li.catalog_item_id IS NULL AND li.category_id IS NULL
          ORDER BY li.created_at DESC
          LIMIT 50`);
        if (this.categorized.size > 50_000) this.categorized.clear();
        for (const r of rows.filter((r) => !this.categorized.has(r.id)).slice(0, 20)) {
          this.categorized.add(r.id);
          const categories = categoriesFor(r.list_type, await this.sync.visibleCategories(r.owner_id));
          const [known] = await this.db.execute<{ category_id: string }>(sql`
            SELECT li.category_id FROM ${listItems} li JOIN ${lists} l ON l.id = li.list_id
            WHERE l.list_type = ${r.list_type} AND li.catalog_item_id IS NULL AND li.category_id IS NOT NULL
              AND lower(trim(li.name)) = lower(trim(${r.name}))
            ORDER BY li.created_at DESC LIMIT 1`);
          let categoryId = known && categories.some((c) => c.id === known.category_id) ? known.category_id : undefined;
          const claude = s.anthropic.categorize ? this.claude(s, 'claude-haiku-5-5') : null;
          if (!categoryId && claude && (await this.withinBudget(s, 'claude', 1_000))) {
            categoryId = await claude
              .categorize({ name: r.name, listType: r.list_type, listName: r.list_name }, categories.map((c) => ({ id: c.id, name: c.name })))
              .then(async (res) => {
                await this.recordUsage('claude', 0, res.costMicro);
                return res.categoryId;
              })
              .catch((err: Error) => {
                this.log.warn({ err: err.message }, 'Kategorie (Claude) nicht gefunden');
                return undefined;
              });
          }
          if (!categoryId) continue;
          const listId = await this.sync.suggestCategory(r.id, categoryId);
          if (listId) {
            done++;
            await this.notifyLists([listId]);
          }
        }
        await this.adoptFreeEntries();
      } catch (err) {
        this.log.error({ err }, 'Kategorien für neue Einträge');
      } finally {
        this.categorizing = null;
      }
      return done;
    })();
    return this.categorizing;
  }

  /**
   * Free-text entries become catalog items of the household (source "user"), after `categorizeNew` had its
   * go (without Claude: in the catch-all category, changeable "für alle"): next time
   * they are suggested while typing, keep their category and their picture. Entries of the same name are
   * linked to the new item. Names that already are a catalog item's own name stay as they are.
   */
  async adoptFreeEntries(): Promise<number> {
    const rows = await this.db.execute<{ id: string; name: string; list_type: 'shopping' | 'packing'; category_id: string | null; icon: string | null }>(sql`
      SELECT DISTINCT ON (l.list_type, lower(trim(li.name))) li.id, trim(li.name) AS name, l.list_type, li.category_id, li.icon
      FROM ${listItems} li JOIN ${lists} l ON l.id = li.list_id
      WHERE ${FREE_LIST} AND l.deleted = false AND li.deleted = false
        AND li.catalog_item_id IS NULL AND length(trim(li.name)) > 1
      ORDER BY l.list_type, lower(trim(li.name)), (li.category_id IS NOT NULL) DESC, (li.icon IS NOT NULL) DESC, li.created_at DESC
      LIMIT 200`);
    if (!rows.length) return 0;
    const catalog = (await this.db.select().from(catalogItems)).map(toCatalogItem);
    const index = { shopping: new CatalogIndex(catalog.filter((c) => c.kind !== 'packing')), packing: new CatalogIndex(catalog.filter((c) => c.kind === 'packing')) };
    const touched = new Set<string>();
    let adopted = 0;
    for (const r of rows) {
      const hit = index[r.list_type].match(r.name, false);
      const existing = hit && isOwnName(hit, r.name) ? hit : undefined;
      const id = existing?.id ?? stableUuid(`shopping-user-${r.list_type}`, r.name.toLowerCase());
      if (!existing) {
        const created = await this.db
          .insert(catalogItems)
          .values({ id, name: r.name, categoryId: r.category_id ?? defaultCategoryFor(r.list_type), kind: r.list_type, source: 'user', aliases: [], categoryLocked: true })
          .onConflictDoNothing()
          .returning({ id: catalogItems.id });
        if (created.length) adopted++;
        // The picture already drawn for the entry is the item's picture too.
        if (created.length && r.icon) await this.copyEntryIcon(r.id, id);
      }
      // Entries of that name now point to the catalog item (their own picture stays).
      const linked = await this.sync.exclusive(() =>
        this.db.execute<{ id: string; list_id: string }>(sql`
          UPDATE ${listItems} li SET catalog_item_id = ${id}::uuid,
            hlc = li.hlc || jsonb_build_object('catalogItemId', coalesce(li.hlc->>'catalogItemId', li.hlc->>'name', '')),
            seq = nextval('sync_seq')
          FROM ${lists} l
          WHERE l.id = li.list_id AND l.list_type = ${r.list_type} AND li.catalog_item_id IS NULL AND li.deleted = false
            AND lower(trim(li.name)) = lower(${r.name})
          RETURNING li.id, li.list_id`),
      );
      for (const l of linked) touched.add(l.list_id);
      // Pictures still waiting for those entries: the catalog item gets one instead.
      if (linked.length) {
        await this.db
          .delete(iconJobs)
          .where(and(eq(iconJobs.targetType, 'entry'), eq(iconJobs.status, 'queued'), inArray(iconJobs.targetId, linked.map((l) => l.id))));
      }
    }
    if (adopted) await this.broadcastCatalog();
    if (touched.size) await this.notifyLists([...touched]);
    return adopted;
  }

  /** Copies an entry's approved picture to a catalog item (no second picture is drawn). */
  private async copyEntryIcon(entryId: string, catalogItemId: string): Promise<void> {
    const [icon] = await this.db
      .select()
      .from(icons)
      .where(and(eq(icons.targetType, 'entry'), eq(icons.targetId, entryId), eq(icons.status, 'approved')));
    const source =
      icon ??
      // Free entries share one picture per name; the approved one may hang on another entry.
      (
        await this.db.execute<{ id: string }>(sql`
          SELECT i.id FROM ${icons} i JOIN ${listItems} o ON i.target_id = o.id::text JOIN ${listItems} e ON e.id = ${entryId}::uuid
          WHERE i.target_type = 'entry' AND i.status = 'approved' AND o.icon = e.icon LIMIT 1`)
      )[0];
    if (!source) return;
    const [full] = icon ? [icon] : await this.db.select().from(icons).where(eq(icons.id, source.id));
    if (!full) return;
    const { id: _id, targetType: _t, targetId: _i, isAnchor: _a, ...rest } = full;
    const [copy] = await this.db.insert(icons).values({ ...rest, targetType: 'item', targetId: catalogItemId }).returning({ id: icons.id });
    await this.db.update(catalogItems).set({ icon: iconToken(copy!.id), seq: sql`nextval('sync_seq')` }).where(eq(catalogItems.id, catalogItemId));
  }

  /**
   * Catalog items of the other kind with the same name ("Zahnpasta" to buy and to pack) are twins:
   * they show the same picture.
   */
  private async twinsOf(itemId: string): Promise<{ id: string; iconId: string | null }[]> {
    return this.db.execute<{ id: string; iconId: string | null }>(sql`
      SELECT o.id, (SELECT i.id FROM ${icons} i WHERE i.target_type = 'item' AND i.target_id = o.id::text AND i.status = 'approved' LIMIT 1) AS "iconId"
      FROM ${catalogItems} c JOIN ${catalogItems} o ON o.id <> c.id AND o.kind <> c.kind
        AND lower(trim(o.name)) IN (lower(trim(c.name)), lower(trim(coalesce(c.plural, ''))))
      WHERE c.id = ${itemId}::uuid`);
  }

  /** Copies an approved picture to another target and approves it there (without passing it on again). */
  private async copyIcon(sourceIconId: string, targetType: IconTarget, targetId: string): Promise<void> {
    const [full] = await this.db.select().from(icons).where(eq(icons.id, sourceIconId));
    if (!full?.image) return;
    const { id: _id, targetType: _t, targetId: _i, isAnchor: _a, status: _s, ...rest } = full;
    const [copy] = await this.db.insert(icons).values({ ...rest, status: 'candidate', targetType, targetId }).returning({ id: icons.id });
    await this.approve(copy!.id, null, undefined, false);
  }

  /** Takes the twin's picture, if it has one. */
  private async shareFromTwin(itemId: string): Promise<boolean> {
    const twin = (await this.twinsOf(itemId)).find((t) => t.iconId);
    if (!twin?.iconId) return false;
    await this.copyIcon(twin.iconId, 'item', itemId);
    return true;
  }

  /** A new picture for a catalog item goes to its twins too. */
  private async shareWithTwins(iconId: string): Promise<void> {
    const [icon] = await this.db.select({ targetType: icons.targetType, targetId: icons.targetId }).from(icons).where(eq(icons.id, iconId));
    if (icon?.targetType !== 'item') return;
    for (const twin of await this.twinsOf(icon.targetId)) await this.copyIcon(iconId, 'item', twin.id);
  }

  /**
   * Once: twins that got different pictures before they were shared take the most recently approved one;
   * twins without a picture get their twin's.
   */
  async alignTwins(): Promise<number> {
    const rows = await this.db.execute<{ target: string; source: string }>(sql`
      SELECT DISTINCT ON (c.id) c.id AS target, oi.id AS source
      FROM ${catalogItems} c
      JOIN ${catalogItems} o ON o.id <> c.id AND o.kind <> c.kind
        AND lower(trim(o.name)) IN (lower(trim(c.name)), lower(trim(coalesce(c.plural, ''))))
      JOIN ${icons} oi ON oi.target_type = 'item' AND oi.target_id = o.id::text AND oi.status = 'approved'
      LEFT JOIN ${icons} ci ON ci.target_type = 'item' AND ci.target_id = c.id::text AND ci.status = 'approved'
      WHERE ci.id IS NULL OR (ci.image IS DISTINCT FROM oi.image AND coalesce(oi.reviewed_at, oi.created_at) > coalesce(ci.reviewed_at, ci.created_at))
      ORDER BY c.id, coalesce(oi.reviewed_at, oi.created_at) DESC`);
    for (const r of rows) await this.copyIcon(r.source, 'item', r.target);
    return rows.length;
  }

  async stop(): Promise<void> {
    clearInterval(this.timer);
    clearTimeout(this.changeTimer);
    await this.draining;
  }

  // ---- review ----------------------------------------------------------------------

  private async broadcastCatalog(): Promise<void> {
    this.hub.broadcast({ t: 'catalog', seq: await currentSeq(this.db) });
  }

  /**
   * Approves the best waiting candidate of every target that has none approved yet
   * (after switching on automatic approval). Candidates that failed a check stay for a person.
   */
  async autoApprovePending(): Promise<number> {
    const rows = await this.db
      .select({ id: icons.id, targetType: icons.targetType, targetId: icons.targetId, checks: icons.checks, aiReview: icons.aiReview })
      .from(icons)
      .where(eq(icons.status, 'candidate'))
      .orderBy(asc(icons.createdAt));
    const done = new Set<string>();
    let anchors = (await this.anchors()).length;
    for (const r of rows) {
      const key = `${r.targetType}:${r.targetId}`;
      if (done.has(key) || !passesChecks(r.checks, r.aiReview)) continue;
      done.add(key);
      await this.approve(r.id, null, anchors < MIN_ANCHORS ? true : undefined);
      anchors++;
    }
    return done.size;
  }

  async approve(iconId: string, userId: string | null, anchor?: boolean, twins = true): Promise<void> {
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
        if (icon.targetType === 'list') {
          await tx.update(lists).set({ icon: iconToken(iconId), seq: sql`nextval('sync_seq')` }).where(eq(lists.id, icon.targetId));
        }
        if (icon.targetType === 'entry') {
          // A free-text entry's picture also goes to every other free-text entry of that name.
          await tx.execute(sql`
            UPDATE ${listItems} li SET icon = ${iconToken(iconId)}, seq = nextval('sync_seq')
            FROM ${listItems} t JOIN ${lists} tl ON tl.id = t.list_id
            WHERE t.id = ${icon.targetId}::uuid
              AND (li.id = t.id OR (tl.list_type IN ('shopping', 'packing') AND t.catalog_item_id IS NULL
                AND li.catalog_item_id IS NULL AND lower(trim(li.name)) = lower(trim(t.name))
                AND li.list_id IN (SELECT l.id FROM ${lists} l WHERE ${FREE_LIST})))`);
        }
      }),
    );
    await this.shareWithUserItem(iconId);
    if (twins) await this.shareWithTwins(iconId);
    if (await this.notifyEntry(iconId)) return;
    await this.broadcastCatalog();
  }

  /** An entry's picture approved after it became a catalog item: the item gets it too. */
  private async shareWithUserItem(iconId: string): Promise<void> {
    const [row] = await this.db.execute<{ entry: string; item: string }>(sql`
      SELECT li.id AS entry, c.id AS item FROM ${icons} i
      JOIN ${listItems} li ON i.target_type = 'entry' AND li.id::text = i.target_id
      JOIN ${catalogItems} c ON c.id = li.catalog_item_id
      WHERE i.id = ${iconId}::uuid AND c.source = 'user' AND c.icon IS NULL`);
    if (!row) return;
    await this.copyEntryIcon(row.entry, row.item);
    await this.broadcastCatalog();
  }

  /** None of the new drafts is better: they all go, the current icon (if any) stays, nothing more is drawn. */
  async discardCandidates(targetType: IconTarget, targetId: string, userId: string): Promise<number> {
    const dropped = await this.db
      .update(icons)
      .set({ status: 'rejected', isAnchor: false, image: null, thumb: null, reviewedAt: sql`now()`, reviewedBy: userId })
      .where(and(eq(icons.targetType, targetType), eq(icons.targetId, targetId), eq(icons.status, 'candidate')))
      .returning({ id: icons.id });
    await this.db
      .update(iconJobs)
      .set({ status: 'done', updatedAt: sql`now()` })
      .where(and(eq(iconJobs.targetType, targetType), eq(iconJobs.targetId, targetId), eq(iconJobs.status, 'queued')));
    return dropped.length;
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
        if (icon.status === 'approved' && icon.targetType === 'list') {
          await tx.update(lists).set({ icon: null, seq: sql`nextval('sync_seq')` }).where(eq(lists.id, icon.targetId));
        }
        if (icon.status === 'approved' && icon.targetType === 'entry') {
          await tx.update(listItems).set({ icon: null, seq: sql`nextval('sync_seq')` }).where(eq(listItems.icon, iconToken(iconId)));
        }
      }),
    );
    if (await this.notifyEntry(iconId)) return;
    await this.broadcastCatalog();
  }

  /** Entry and list icons travel with the lists (sync), not with the catalog. Returns true if it was one. */
  private async notifyEntry(iconId: string): Promise<boolean> {
    const [icon] = await this.db.select({ targetType: icons.targetType, targetId: icons.targetId }).from(icons).where(eq(icons.id, iconId));
    if (icon?.targetType === 'list') {
      await this.notifyLists([icon.targetId]);
      return true;
    }
    if (icon?.targetType !== 'entry') return false;
    // Shared pictures reach several lists: everyone on a list holding the entry or one of the same name.
    const rows = await this.db.execute<{ list_id: string }>(sql`
      SELECT DISTINCT li.list_id FROM ${listItems} li, ${listItems} t
      WHERE t.id = ${icon.targetId}::uuid AND (li.id = t.id OR (t.catalog_item_id IS NULL AND li.catalog_item_id IS NULL AND lower(trim(li.name)) = lower(trim(t.name))))`);
    await this.notifyLists(rows.map((r) => r.list_id));
    return true;
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
    opts: { hint?: string | null; subject?: string | null; provider?: ProviderId | null; paid?: boolean; candidates?: number; priority?: number },
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
    const provider = opts.provider ?? (opts.paid ? 'openai' : null);
    await this.enqueue(targetType, targetId, { hint: opts.hint, provider, candidates: opts.candidates, priority: opts.priority ?? 2000 });
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
    const entryIds = targets.filter((t) => t.targetType === 'entry').map((t) => t.targetId);
    const entries = entryIds.length
      ? await this.db
          .select({ id: listItems.id, name: listItems.name, list: lists.name, listType: lists.listType, categoryId: listItems.categoryId })
          .from(listItems)
          .innerJoin(lists, eq(lists.id, listItems.listId))
          .where(inArray(listItems.id, entryIds))
      : [];
    const entryById = new Map(entries.map((e) => [e.id, e]));
    const listIds = targets.filter((t) => t.targetType === 'list').map((t) => t.targetId);
    const listRows = listIds.length ? await this.db.select({ id: lists.id, name: lists.name }).from(lists).where(inArray(lists.id, listIds)) : [];
    const listById = new Map(listRows.map((l) => [l.id, l.name]));
    const catIds = targets.filter((t) => t.targetType === 'category' && /^[0-9a-f-]{36}$/.test(t.targetId)).map((t) => t.targetId);
    const ownCats = catIds.length
      ? await this.db.select({ id: customCategories.id, name: customCategories.name, subject: customCategories.iconSubject }).from(customCategories).where(inArray(customCategories.id, catIds))
      : [];
    const ownCatById = new Map(ownCats.map((c) => [c.id, c]));
    return (t: { targetType: IconTarget; targetId: string }) => {
      if (t.targetType === 'list') return { name: `${listById.get(t.targetId) ?? '?'} (Liste)`, categoryId: 'eigene', subject: null };
      if (t.targetType === 'entry') {
        const e = entryById.get(t.targetId);
        return { name: e ? `${e.name} (${e.list})` : '?', categoryId: e && e.listType !== 'memo' ? (e.categoryId ?? 'eigene') : 'merkliste', subject: null };
      }
      if (t.targetType === 'category') {
        const own = ownCatById.get(t.targetId);
        if (own) return { name: `${own.name} (eigene Kategorie)`, categoryId: t.targetId, subject: own.subject };
        return { name: getCategory(t.targetId).name, categoryId: t.targetId, subject: CATEGORY_SUBJECTS[t.targetId] ?? null };
      }
      const r = byId.get(t.targetId);
      return { name: r?.name ?? '?', categoryId: r?.categoryId ?? 'eigene', subject: r?.subject ?? (r ? (SEED_SUBJECTS[r.name] ?? PACKING_SUBJECTS[r.name] ?? null) : null) };
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
        aiReview: icons.aiReview,
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
      .map((t) => ({
        ...t,
        // What the AI pre-review sorted out comes last – still visible, a person has the last word.
        candidates: t.candidates
          .map((c) => ({ id: c.id, checks: c.checks, aiReview: c.aiReview, provider: c.provider, model: c.model, createdAt: c.createdAt }))
          .sort((a, b) => Number(a.aiReview?.ok === false) - Number(b.aiReview?.ok === false)),
      }));
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
    const an = await this.usage('claude');
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
      usage: { cloudflareToday: cf.today, openaiMonth: oa.monthCost / 1_000_000, claudeMonth: an.monthCost / 1_000_000 },
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
    if (row?.thumb) return { token: iconToken(row.id), thumb: row.thumb };
    if (targetType !== 'entry' || !/^[0-9a-f-]{36}$/.test(targetId)) return null;
    // A free-text entry may show the picture drawn for another entry of the same name.
    const [shared] = await this.db.execute<{ id: string; thumb: Buffer | null }>(sql`
      SELECT i.id, i.thumb FROM ${listItems} li JOIN ${icons} i
        ON i.target_type = 'entry' AND i.status = 'approved' AND replace(i.id::text, '-', '') LIKE li.icon || '%'
      WHERE li.id = ${targetId}::uuid AND li.icon IS NOT NULL
      LIMIT 1`);
    return shared?.thumb ? { token: iconToken(shared.id), thumb: shared.thumb } : null;
  }

  async image(iconId: string, size: 'master' | 'thumb'): Promise<Buffer | null> {
    const [row] = await this.db.select({ image: icons.image, thumb: icons.thumb }).from(icons).where(eq(icons.id, iconId));
    return (size === 'master' ? row?.image : row?.thumb) ?? null;
  }
}
