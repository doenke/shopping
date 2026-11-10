import { comparePositions } from '@shopping/shared';
import { randomUUID } from 'node:crypto';
import {
  generateKeyBetween,
  listDefaultStatus,
  listStatuses,
  parseItem,
  taskPatch,
  withStatus,
  withUrl,
  type TaskStatuses,
  type IncomingTask,
  type ItemPatch,
  type ItemRow,
  type ListRow,
} from '@shopping/shared';
import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import type { ShoppingApi } from '../api/service.js';
import type { Db } from '../db/index.js';
import { listItems, lists, users } from '../db/schema.js';
import { toItemRow } from '../sync/rows.js';

/**
 * Lists and entries as tasks for other apps (CalDAV and JMAP share this): which lists, which entries,
 * and turning a task app's changes into normal item changes (same rules as the app, everyone is notified).
 */
export class TaskService {
  constructor(
    private readonly db: Db,
    private readonly api: ShoppingApi,
  ) {}

  /** Lists offered as task lists: everything the user sees, except templates and archived ones; in the user's order. */
  async lists(userId: string): Promise<ListRow[]> {
    const all = (await this.api.visibleLists(userId)).filter((l) => !l.isTemplate && !l.archivedAt && !l.deleted);
    const [u] = await this.db.select({ order: users.listOrder }).from(users).where(eq(users.id, userId));
    const order = u?.order ?? [];
    const rank = (id: string) => (order.includes(id) ? order.indexOf(id) : order.length);
    return all.sort((a, b) => rank(a.id) - rank(b.id) || a.createdAt.localeCompare(b.createdAt));
  }

  async list(userId: string, id: string): Promise<ListRow | null> {
    return (await this.lists(userId)).find((l) => l.id === id) ?? null;
  }

  /** Entries of lists; deleted ones only when asked for changes (`since`). */
  async items(listIds: string[], since?: number): Promise<ItemRow[]> {
    if (!listIds.length) return [];
    const rows = await this.db
      .select()
      .from(listItems)
      .where(and(inArray(listItems.listId, listIds), since === undefined ? eq(listItems.deleted, false) : gt(listItems.seq, since)));
    return rows.map(toItemRow).sort((a, b) => comparePositions(a.position, b.position));
  }

  /** A change counter over lists and their entries (CalDAV ctag/sync-token, JMAP state). */
  async state(listIds: string[]): Promise<number> {
    if (!listIds.length) return 0;
    const [i] = await this.db
      .select({ seq: sql<number>`coalesce(max(${listItems.seq}), 0)::bigint` })
      .from(listItems)
      .where(inArray(listItems.listId, listIds));
    const [l] = await this.db
      .select({ seq: sql<number>`coalesce(max(${lists.seq}), 0)::bigint` })
      .from(lists)
      .where(inArray(lists.id, listIds));
    return Math.max(Number(i?.seq ?? 0), Number(l?.seq ?? 0));
  }

  /** The list's statuses for task apps (default = "needs action", others = "in process"). */
  static statusesOf(list: ListRow): TaskStatuses {
    const statuses = listStatuses(list);
    return { statuses, defaultStatus: listDefaultStatus(list, statuses) };
  }

  /** File name of an entry in a CalDAV collection: the app's own name if it created it, else "<id>.ics". */
  static fileName(item: Pick<ItemRow, 'id' | 'attributes'>): string {
    return typeof item.attributes.davName === 'string' ? item.attributes.davName : `${item.id}.ics`;
  }

  async byFileName(listId: string, name: string): Promise<ItemRow | null> {
    const id = name.replace(/\.ics$/i, '');
    const rows = await this.db
      .select()
      .from(listItems)
      .where(
        and(
          eq(listItems.listId, listId),
          eq(listItems.deleted, false),
          /^[0-9a-f-]{36}$/i.test(id)
            ? sql`(${listItems.id} = ${id} OR ${listItems.attributes} ->> 'davName' = ${name})`
            : sql`${listItems.attributes} ->> 'davName' = ${name}`,
        ),
      );
    return rows[0] ? toItemRow(rows[0]) : null;
  }

  async byId(itemId: string): Promise<ItemRow | null> {
    if (!/^[0-9a-f-]{36}$/i.test(itemId)) return null;
    const [row] = await this.db.select().from(listItems).where(eq(listItems.id, itemId));
    return row && !row.deleted ? toItemRow(row) : null;
  }

  private parser(list: ListRow) {
    return this.api.indexFor(list.listType).then((index) => (text: string) => parseItem(text, index, list.listType));
  }

  /** A new entry from a task app; returns its id. `fileName`/`uid`: how the app refers to it. */
  async create(userId: string, list: ListRow, task: IncomingTask, opts: { fileName?: string } = {}): Promise<string> {
    const parse = await this.parser(list);
    const parsed = parse(task.summary.split(' – ')[0]!.trim() || 'Neue Aufgabe') ?? {
      name: task.summary.trim() || 'Neue Aufgabe',
      catalogItemId: null,
      categoryId: null,
      amounts: [],
      properties: [],
      note: null,
    };
    const id = task.uid && /^[0-9a-f-]{36}$/i.test(task.uid) && !(await this.byId(task.uid)) ? task.uid.toLowerCase() : randomUUID();
    const existing = await this.items([list.id]);
    const last = existing.reduce<string | null>((max, i) => (max === null || i.position > max ? i.position : max), null);
    let attributes: Record<string, unknown> = {};
    if (task.uid && task.uid.toLowerCase() !== id) attributes.icalUid = task.uid;
    if (opts.fileName && opts.fileName !== `${id}.ics`) attributes.davName = opts.fileName;
    if (task.due && list.listType === 'todo') attributes.due = task.due;
    if (task.url) attributes = withUrl(attributes, task.url);
    // Created as "in process": the first status after the default.
    const st = TaskService.statusesOf(list);
    const other = st.statuses.find((s) => s.id !== st.defaultStatus?.id);
    if (task.inProcess && !task.completed && other) attributes = withStatus(attributes, other.id, st.statuses, st.defaultStatus);
    const patch: ItemPatch = {
      listId: list.id,
      name: parsed.name,
      catalogItemId: parsed.catalogItemId,
      categoryId: parsed.categoryId,
      amounts: parsed.amounts,
      properties: parsed.properties,
      note: task.description ?? parsed.note,
      position: generateKeyBetween(last, null),
      ...(Object.keys(attributes).length ? { attributes } : {}),
      ...(task.completed ? { checked: true } : {}),
    };
    await this.api.applyItems(userId, [{ id, patch }]);
    return id;
  }

  /** A task app changed an entry. */
  async update(userId: string, list: ListRow, item: ItemRow, task: IncomingTask): Promise<void> {
    const patch = taskPatch(item, list.listType, task, await this.parser(list), TaskService.statusesOf(list));
    if (Object.keys(patch).length) await this.api.applyItems(userId, [{ id: item.id, patch }]);
  }

  async remove(userId: string, item: ItemRow): Promise<void> {
    await this.api.applyItems(userId, [{ id: item.id, patch: { deleted: true } }]);
  }

  async rename(userId: string, list: ListRow, name: string): Promise<void> {
    if (name.trim() && name.trim() !== list.name) await this.api.applyLists(userId, [{ id: list.id, patch: { name: name.trim() } }]);
  }
}
