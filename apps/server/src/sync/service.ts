import {
  Hlc,
  applyPatch,
  defaultVisibility,
  mergeAmounts,
  packingInfo,
  samePacking,
  type ChangeSet,
  type ItemPatch,
  type ItemRow,
  type ItemSource,
  type ListPatch,
  type ListRow,
  type Mutation,
} from '@shopping/shared';
import { MutationSchema } from '@shopping/shared/schemas';
import { and, eq, gt, inArray, ne, sql } from 'drizzle-orm';
import type { Db, Tx } from '../db/index.js';
import { currentSeq } from '../db/seed.js';
import { households, listItems, listMembers, lists, users } from '../db/schema.js';
import { Mutex } from './mutex.js';
import { toItemRow, toListRow, toMe, toUserInfo } from './rows.js';

export interface ApplyResult {
  acked: string[];
  rejected: { mid: string; reason: string }[];
  /** Users whose view changed and who should receive a delta. */
  affectedUsers: Set<string>;
}

class Rejection extends Error {}

const nextSeq = sql`nextval('sync_seq')`;

function sameProperties(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].map((s) => s.toLowerCase()).sort();
  const sb = [...b].map((s) => s.toLowerCase()).sort();
  return sa.every((v, i) => v === sb[i]);
}

/** Keeps the "für Lasagne, Chili" origin info when two items are merged. */
function mergeSources(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const sa = Array.isArray(a.sources) ? (a.sources as ItemSource[]) : [];
  const sb = Array.isArray(b.sources) ? (b.sources as ItemSource[]) : [];
  if (sb.length === 0) return a;
  const merged = [...sa];
  for (const src of sb) if (!merged.some((m) => m.type === src.type && m.label === src.label)) merged.push(src);
  return { ...a, sources: merged };
}

export class SyncService {
  readonly mutex = new Mutex();
  readonly clock = new Hlc('server');

  constructor(private readonly db: Db) {}

  /** Runs any other write that must be ordered with sync writes (e.g. catalog import). */
  exclusive<T>(fn: () => Promise<T>): Promise<T> {
    return this.mutex.run(fn);
  }

  async apply(userId: string, raw: unknown[]): Promise<ApplyResult> {
    return this.mutex.run(async () => {
      const result: ApplyResult = { acked: [], rejected: [], affectedUsers: new Set([userId]) };
      for (const entry of raw) {
        const parsed = MutationSchema.safeParse(entry);
        const mid = typeof entry === 'object' && entry && 'mid' in entry ? String(entry.mid) : 'unknown';
        if (!parsed.success) {
          result.rejected.push({ mid, reason: 'invalid' });
          continue;
        }
        const m = parsed.data;
        this.clock.receive(m.hlc);
        try {
          const touchedLists = await this.db.transaction((tx) => this.applyOne(tx, userId, m));
          result.acked.push(m.mid);
          if (touchedLists.length) {
            const members = await this.db
              .select({ userId: listMembers.userId })
              .from(listMembers)
              .where(inArray(listMembers.listId, touchedLists));
            for (const mem of members) result.affectedUsers.add(mem.userId);
          }
        } catch (err) {
          if (!(err instanceof Rejection)) throw err;
          result.rejected.push({ mid: m.mid, reason: err.message });
        }
      }
      return result;
    });
  }

  private async hasAccess(tx: Tx, userId: string, listId: string): Promise<boolean> {
    const [row] = await tx
      .select({ removed: listMembers.removed, deleted: lists.deleted })
      .from(listMembers)
      .innerJoin(lists, eq(lists.id, listMembers.listId))
      .where(and(eq(listMembers.listId, listId), eq(listMembers.userId, userId)));
    return !!row && !row.removed && !row.deleted;
  }

  /** Applies one mutation; returns the ids of lists whose members must be notified. */
  private async applyOne(tx: Tx, userId: string, m: Mutation): Promise<string[]> {
    switch (m.entity) {
      case 'list':
        return this.applyList(tx, userId, m.id, m.patch, m.hlc);
      case 'item':
        return this.applyItem(tx, userId, m.id, m.patch, m.hlc);
      case 'me':
        await this.applyMe(tx, userId, m.patch, m.hlc);
        return [];
    }
  }

  private async applyList(tx: Tx, userId: string, id: string, patch: ListPatch, ts: string): Promise<string[]> {
    const [existing] = await tx.select().from(lists).where(eq(lists.id, id)).for('update');
    if (!existing) {
      if (!patch.name) throw new Rejection('missing_name');
      const [creator] = await tx.select({ isGuest: users.isGuest, householdId: users.householdId }).from(users).where(eq(users.id, userId));
      if (creator?.isGuest) throw new Rejection('guest');
      const row: ListRow = {
        id,
        ownerId: userId,
        name: patch.name,
        listType: 'shopping',
        isTemplate: false,
        icon: null,
        color: null,
        settings: {},
        archivedAt: null,
        deleted: false,
        visibility: 'household',
        createdAt: new Date().toISOString(),
        hlc: {},
        seq: 0,
      };
      applyPatch(row, patch, ts);
      // ToDo lists start private, everything else is for the household – unless chosen otherwise.
      if (patch.visibility === undefined) row.visibility = defaultVisibility(row.listType);
      await tx.insert(lists).values({
        id,
        ownerId: userId,
        name: row.name,
        listType: row.listType,
        isTemplate: row.isTemplate,
        icon: row.icon,
        color: row.color,
        settings: row.settings,
        archivedAt: row.archivedAt,
        deleted: row.deleted,
        visibility: row.visibility,
        householdId: creator?.householdId ?? null,
        hlc: row.hlc,
      });
      await tx.insert(listMembers).values({ listId: id, userId, via: 'owner' });
      // Shared with the household right away (unless created as private).
      await this.reconcileList(tx, id);
      // The first shopping list becomes the user's main list (not a packing, Merk- or ToDo list).
      if (!row.isTemplate && row.listType === 'shopping') {
        await tx
          .update(users)
          .set({ defaultListId: id, seq: nextSeq })
          .where(and(eq(users.id, userId), sql`${users.defaultListId} IS NULL`));
      }
      return [id];
    }

    if (!(await this.hasAccess(tx, userId, id))) throw new Rejection('forbidden');
    const { listType: _t, isTemplate: _i, ...mutable } = patch;
    if ((mutable.deleted !== undefined || mutable.visibility !== undefined) && existing.ownerId !== userId) throw new Rejection('owner_only');
    const row = toListRow(existing);
    const applied = applyPatch(row, mutable, ts);
    if (applied.length === 0) return [];
    await tx
      .update(lists)
      .set({
        name: row.name,
        icon: row.icon,
        color: row.color,
        settings: row.settings,
        archivedAt: row.archivedAt,
        deleted: row.deleted,
        visibility: row.visibility,
        hlc: row.hlc,
        seq: nextSeq,
      })
      .where(eq(lists.id, id));
    // Private ↔ household: the household's members come or go (apply() notifies former members too).
    if (applied.includes('visibility')) await this.reconcileList(tx, id, { revive: true });
    return [id];
  }

  /**
   * Brings a list's household memberships in line with its visibility and household:
   * shared → every OIDC user of the household is a member (via "household");
   * private → those memberships end. Owner and link members are never touched.
   * `only` limits it to one user; `revive` brings back household members who
   * had left (only when the list is shared anew, not on every login).
   * Returns the users whose access changed.
   */
  private async reconcileList(tx: Tx, listId: string, opts: { only?: string; revive?: boolean } = {}): Promise<string[]> {
    const [list] = await tx.select().from(lists).where(eq(lists.id, listId));
    if (!list) return [];
    const wanted =
      list.visibility === 'household' && list.householdId && !list.deleted
        ? (
            await tx
              .select({ id: users.id })
              .from(users)
              .where(and(eq(users.householdId, list.householdId), eq(users.isGuest, false)))
          )
            .map((u) => u.id)
            .filter((id) => id !== list.ownerId && (!opts.only || id === opts.only))
        : [];
    const changed: string[] = [];
    const current = await tx.select().from(listMembers).where(eq(listMembers.listId, listId));
    for (const m of current) {
      if (opts.only && m.userId !== opts.only) continue;
      if (m.via === 'household' && !m.removed && !wanted.includes(m.userId)) {
        await tx
          .update(listMembers)
          .set({ removed: true, seq: nextSeq })
          .where(and(eq(listMembers.listId, listId), eq(listMembers.userId, m.userId)));
        changed.push(m.userId);
      }
    }
    for (const userId of wanted) {
      const m = current.find((c) => c.userId === userId);
      if (!m) {
        await tx.insert(listMembers).values({ listId, userId, via: 'household' });
        changed.push(userId);
      } else if (m.removed && m.via === 'household' && opts.revive) {
        await tx
          .update(listMembers)
          .set({ removed: false, seq: nextSeq })
          .where(and(eq(listMembers.listId, listId), eq(listMembers.userId, userId)));
        changed.push(userId);
      }
    }
    return changed;
  }

  /**
   * Puts a user into a household (at login, from the OIDC tag). Their own lists
   * move with them; they see the shared lists of the new household and no longer
   * those of the old one. Returns everyone who must get a delta.
   */
  setHousehold(userId: string, householdId: string): Promise<Set<string>> {
    return this.mutex.run(() =>
      this.db.transaction(async (tx) => {
        const affected = new Set<string>([userId]);
        const [user] = await tx.select({ householdId: users.householdId, isGuest: users.isGuest }).from(users).where(eq(users.id, userId));
        if (!user || user.isGuest) return affected;
        const moved = user.householdId !== householdId;
        if (moved) {
          await tx.update(users).set({ householdId, seq: nextSeq }).where(eq(users.id, userId));
          await tx.update(lists).set({ householdId, seq: nextSeq }).where(eq(lists.ownerId, userId));
        }
        // Lists of both households (and the own ones) are brought in line.
        const touched = await tx
          .select({ id: lists.id })
          .from(lists)
          .where(
            and(
              eq(lists.deleted, false),
              sql`(${lists.householdId} = ${householdId} OR ${lists.ownerId} = ${userId} OR ${lists.id} IN (
                SELECT list_id FROM list_members WHERE user_id = ${userId} AND via = 'household'))`,
            ),
          );
        for (const l of touched) {
          const own = (await tx.select({ ownerId: lists.ownerId }).from(lists).where(eq(lists.id, l.id)))[0]?.ownerId === userId;
          // Own lists that moved: the whole new household comes in, the old one goes.
          // Other lists: only this user – and someone who left a list stays out unless they moved.
          const changed = await this.reconcileList(tx, l.id, own ? { revive: moved } : { only: userId, revive: moved });
          for (const id of changed) affected.add(id);
          if (moved && own) {
            const members = await tx.select({ userId: listMembers.userId }).from(listMembers).where(eq(listMembers.listId, l.id));
            for (const m of members) affected.add(m.userId);
          }
        }
        return affected;
      }),
    );
  }


  private async applyItem(tx: Tx, userId: string, id: string, patch: ItemPatch, ts: string): Promise<string[]> {
    const [existing] = await tx.select().from(listItems).where(eq(listItems.id, id)).for('update');
    const listId = existing?.listId ?? patch.listId;
    if (!listId) throw new Rejection('missing_list');
    if (!(await this.hasAccess(tx, userId, listId))) throw new Rejection('forbidden');
    if (patch.checked) {
      // Templates only pre-fill new lists; nothing on them can be checked.
      const [list] = await tx.select({ isTemplate: lists.isTemplate }).from(lists).where(eq(lists.id, listId));
      if (list?.isTemplate) throw new Rejection('template_not_checkable');
    }

    const { listId: _l, ...rest } = patch;
    const effective: Partial<ItemRow> = { ...rest };
    if (patch.checked !== undefined) {
      effective.checkedBy = patch.checked ? userId : null;
      effective.checkedAt = patch.checked ? new Date().toISOString() : null;
    }

    if (!existing) {
      if (!patch.name) throw new Rejection('missing_name');
      const row: ItemRow = {
        id,
        listId,
        catalogItemId: null,
        name: patch.name,
        amounts: [],
        properties: [],
        note: null,
        categoryId: null,
        checked: false,
        checkedAt: null,
        checkedBy: null,
        position: patch.position ?? 'a0',
        optional: false,
        attributes: {},
        createdBy: userId,
        createdAt: new Date().toISOString(),
        deleted: false,
        mergedInto: null,
        hlc: {},
        seq: 0,
      };
      applyPatch(row, { listId, ...effective }, ts);

      // Two people added the same thing while offline: merge instead of duplicating.
      if (!row.checked && !row.deleted) {
        const duplicate = await this.findDuplicate(tx, row);
        if (duplicate) {
          const target = toItemRow(duplicate);
          const mergeTs = this.clock.tick();
          applyPatch(
            target,
            { amounts: mergeAmounts(target.amounts, row.amounts), attributes: mergeSources(target.attributes, row.attributes) },
            mergeTs,
          );
          await tx
            .update(listItems)
            .set({ amounts: target.amounts, attributes: target.attributes, hlc: target.hlc, seq: nextSeq })
            .where(eq(listItems.id, target.id));
          applyPatch(row, { deleted: true }, mergeTs);
          row.mergedInto = target.id;
        }
      }
      await tx.insert(listItems).values({ ...row, createdAt: row.createdAt, seq: undefined });
      return [listId];
    }

    const row = toItemRow(existing);
    const applied = applyPatch(row, effective, ts);
    if (applied.length === 0) return [];
    const { id: _id, seq: _seq, createdAt: _c, ...fields } = row;
    await tx
      .update(listItems)
      .set({ ...fields, seq: nextSeq })
      .where(eq(listItems.id, id));
    return [listId];
  }

  private async findDuplicate(tx: Tx, row: ItemRow) {
    const candidates = await tx
      .select()
      .from(listItems)
      .where(
        and(
          eq(listItems.listId, row.listId),
          eq(listItems.checked, false),
          eq(listItems.deleted, false),
          ne(listItems.id, row.id),
          row.catalogItemId
            ? eq(listItems.catalogItemId, row.catalogItemId)
            : sql`lower(${listItems.name}) = lower(${row.name}) AND ${listItems.catalogItemId} IS NULL`,
        ),
      );
    // Packing lists: Anna's and Ben's T-Shirts (or different Packstücke) are not duplicates.
    return candidates.find((c) => sameProperties(c.properties, row.properties) && samePacking(packingInfo(c), packingInfo(row)));
  }

  private async applyMe(tx: Tx, userId: string, patch: { defaultListId?: string | null }, ts: string): Promise<void> {
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).for('update');
    if (!user) throw new Rejection('unknown_user');
    if (patch.defaultListId && !(await this.hasAccess(tx, userId, patch.defaultListId))) throw new Rejection('forbidden');
    const state = { defaultListId: user.defaultListId, hlc: { ...user.hlc } };
    if (applyPatch(state, patch, ts).length === 0) return;
    await tx.update(users).set({ defaultListId: state.defaultListId, hlc: state.hlc, seq: nextSeq }).where(eq(users.id, userId));
  }

  /** Adds the user to a list (opening its link). Returns false if the list is gone. */
  join(userId: string, listId: string): Promise<boolean> {
    return this.mutex.run(async () => {
      const [list] = await this.db.select({ deleted: lists.deleted }).from(lists).where(eq(lists.id, listId));
      if (!list || list.deleted) return false;
      await this.db
        .insert(listMembers)
        .values({ listId, userId })
        .onConflictDoUpdate({
          target: [listMembers.listId, listMembers.userId],
          set: { removed: false, seq: nextSeq },
          setWhere: sql`${listMembers.removed} = true`,
        });
      return true;
    });
  }

  /** Removes a member; the owner cannot leave their own list. */
  leave(userId: string, listId: string): Promise<'ok' | 'owner' | 'not_member'> {
    return this.mutex.run(async () => {
      const [list] = await this.db.select({ ownerId: lists.ownerId }).from(lists).where(eq(lists.id, listId));
      if (!list) return 'not_member';
      if (list.ownerId === userId) return 'owner';
      const updated = await this.db
        .update(listMembers)
        .set({ removed: true, seq: nextSeq })
        .where(and(eq(listMembers.listId, listId), eq(listMembers.userId, userId), eq(listMembers.removed, false)))
        .returning({ listId: listMembers.listId });
      if (updated.length) {
        // Unset the main list if it was this one.
        await this.db
          .update(users)
          .set({ defaultListId: null, seq: nextSeq })
          .where(and(eq(users.id, userId), eq(users.defaultListId, listId)));
      }
      return updated.length ? 'ok' : 'not_member';
    });
  }

  setDefaultList(userId: string, listId: string): Promise<void> {
    return this.mutex.run(async () => {
      await this.db.update(users).set({ defaultListId: listId, seq: nextSeq }).where(eq(users.id, userId));
    });
  }

  async isMember(userId: string, listId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ removed: listMembers.removed })
      .from(listMembers)
      .where(and(eq(listMembers.listId, listId), eq(listMembers.userId, userId)));
    return !!row && !row.removed;
  }

  /** Everything the user has not seen since `since`. */
  pull(userId: string, since: number): Promise<ChangeSet> {
    return this.mutex.run(() => this.pullUnlocked(userId, since));
  }

  private async householdName(id: string | null): Promise<string | null> {
    if (!id) return null;
    const [h] = await this.db.select({ name: households.name }).from(households).where(eq(households.id, id));
    return h?.name ?? null;
  }

  async pullUnlocked(userId: string, since: number): Promise<ChangeSet> {
    const db = this.db;
    const seq = await currentSeq(db);
    const memberships = await db.select().from(listMembers).where(eq(listMembers.userId, userId));
    const active = memberships.filter((m) => !m.removed).map((m) => m.listId);
    const fresh = new Set(memberships.filter((m) => !m.removed && (since === 0 || m.seq > since)).map((m) => m.listId));
    const removedLists = memberships.filter((m) => m.removed && m.seq > since).map((m) => m.listId);

    const listRows = active.length
      ? await db
          .select()
          .from(lists)
          .where(and(inArray(lists.id, active), since === 0 ? undefined : gt(lists.seq, since)))
      : [];
    // Newly visible lists are sent in full, regardless of their row sequence.
    const missing = [...fresh].filter((id) => !listRows.some((l) => l.id === id));
    if (missing.length) listRows.push(...(await db.select().from(lists).where(inArray(lists.id, missing))));

    const known = active.filter((id) => !fresh.has(id));
    const itemRows = [
      ...(fresh.size
        ? await db
            .select()
            .from(listItems)
            .where(and(inArray(listItems.listId, [...fresh]), eq(listItems.deleted, false)))
        : []),
      ...(known.length
        ? await db
            .select()
            .from(listItems)
            .where(and(inArray(listItems.listId, known), gt(listItems.seq, since)))
        : []),
    ];

    const lists_ = listRows.map(toListRow);
    for (const l of lists_) if (l.deleted) removedLists.push(l.id);

    const memberIds = active.length
      ? await db.selectDistinct({ userId: listMembers.userId }).from(listMembers).where(inArray(listMembers.listId, active))
      : [];
    const ids = [...new Set([userId, ...memberIds.map((m) => m.userId)])];
    const userRows = await db.select().from(users).where(inArray(users.id, ids));
    const me = userRows.find((u) => u.id === userId);

    return {
      lists: lists_.filter((l) => !l.deleted),
      items: itemRows.map(toItemRow),
      removedLists,
      users: userRows.map(toUserInfo),
      me: me && (since === 0 || me.seq > since) ? toMe(me, await this.householdName(me.householdId)) : undefined,
      seq,
    };
  }
}
