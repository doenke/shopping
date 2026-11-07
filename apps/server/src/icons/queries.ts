import { iconToken } from './settings.js';
import { getCategory } from '@shopping/shared';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { catalogItems, customCategories, icons, listItems, lists, type IconTarget } from '../db/schema.js';
import { CATEGORY_SUBJECTS, PACKING_SUBJECTS, SEED_SUBJECTS } from './subjects.js';

/** Read-only lookups of the icon data (review queue, gallery, images); IconService builds on them. */
export class IconQueries {
  constructor(protected readonly db: Db) {}

  protected async names(targets: { targetType: IconTarget; targetId: string }[]) {
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
      ? await this.db
          .select({ id: customCategories.id, name: customCategories.name, subject: customCategories.iconSubject })
          .from(customCategories)
          .where(inArray(customCategories.id, catIds))
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
      return {
        name: r?.name ?? '?',
        categoryId: r?.categoryId ?? 'eigene',
        subject: r?.subject ?? (r ? (SEED_SUBJECTS[r.name] ?? PACKING_SUBJECTS[r.name] ?? null) : null),
      };
    };
  }

  /** Catalog items and entries with drafts waiting for review (the app marks their tiles). */
  async pendingTargets(): Promise<string[]> {
    const rows = await this.db.execute<{ target_id: string }>(sql`
      SELECT DISTINCT target_id FROM ${icons} WHERE status = 'candidate' AND target_type IN ('item', 'entry')`);
    return rows.map((r) => r.target_id);
  }

  /** Drafts of one target waiting for review, and its current picture (for the item editor). */
  async pendingFor(targetType: IconTarget, targetId: string) {
    // Free-text entries share one picture per name: the drafts may hang on another entry of that name.
    if (targetType === 'entry' && /^[0-9a-f-]{36}$/.test(targetId)) {
      const [shared] = await this.db.execute<{ target_id: string }>(sql`
        SELECT i.target_id FROM ${icons} i
        JOIN ${listItems} o ON i.target_id = o.id::text JOIN ${lists} ol ON ol.id = o.list_id
        JOIN ${listItems} e ON e.id = ${targetId}::uuid
        WHERE i.target_type = 'entry' AND i.status = 'candidate' AND o.id <> e.id
          AND ol.list_type IN ('shopping', 'packing') AND o.catalog_item_id IS NULL
          AND lower(trim(o.name)) = lower(trim(e.name))
          AND NOT EXISTS (SELECT 1 FROM ${icons} x WHERE x.target_type = 'entry' AND x.target_id = e.id::text AND x.status = 'candidate')
        ORDER BY i.created_at DESC LIMIT 1`);
      if (shared) targetId = shared.target_id;
    }
    const rows = await this.db
      .select({ id: icons.id, status: icons.status, aiReview: icons.aiReview, checks: icons.checks, provider: icons.provider })
      .from(icons)
      .where(and(eq(icons.targetType, targetType), eq(icons.targetId, targetId), inArray(icons.status, ['candidate', 'approved'])))
      .orderBy(asc(icons.createdAt));
    return {
      targetType,
      targetId,
      approved: rows.find((r) => r.status === 'approved')?.id ?? null,
      candidates: rows
        .filter((r) => r.status === 'candidate')
        .map((r) => ({ id: r.id, aiReview: r.aiReview, checks: r.checks, provider: r.provider }))
        .sort((a, b) => Number(a.aiReview?.ok === false) - Number(b.aiReview?.ok === false)),
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
    const targets = new Map<
      string,
      ReturnType<typeof name> & { targetType: IconTarget; targetId: string; approved: string | null; candidates: typeof rows; since: Date }
    >();
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
