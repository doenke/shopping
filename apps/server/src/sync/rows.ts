import { avatarPath } from '../auth/avatar.js';
import type { CatalogItem, ItemRow, ListRow, Me, UserInfo } from '@shopping/shared';
import type { catalogItems, listItems, lists, users } from '../db/schema.js';

type ListRecord = typeof lists.$inferSelect;
type ItemRecord = typeof listItems.$inferSelect;
type UserRecord = typeof users.$inferSelect;
type CatalogRecord = typeof catalogItems.$inferSelect;

function iso(ts: string): string {
  return new Date(ts).toISOString();
}

export function toListRow(r: ListRecord): ListRow {
  return {
    id: r.id,
    ownerId: r.ownerId,
    name: r.name,
    listType: r.listType as ListRow['listType'],
    isTemplate: r.isTemplate,
    icon: r.icon,
    color: r.color,
    settings: r.settings,
    archivedAt: r.archivedAt,
    deleted: r.deleted,
    visibility: r.visibility,
    createdAt: iso(r.createdAt),
    hlc: r.hlc,
    seq: r.seq,
  };
}

export function toItemRow(r: ItemRecord): ItemRow {
  return {
    id: r.id,
    listId: r.listId,
    catalogItemId: r.catalogItemId,
    name: r.name,
    amounts: r.amounts,
    properties: r.properties,
    note: r.note,
    categoryId: r.categoryId,
    checked: r.checked,
    checkedAt: r.checkedAt,
    checkedBy: r.checkedBy,
    position: r.position,
    optional: r.optional,
    attributes: r.attributes,
    createdBy: r.createdBy,
    createdAt: iso(r.createdAt),
    deleted: r.deleted,
    mergedInto: r.mergedInto,
    icon: r.icon,
    hlc: r.hlc,
    seq: r.seq,
  };
}

export function toUserInfo(r: UserRecord): UserInfo {
  return { id: r.id, displayName: r.displayName, avatarUrl: avatarPath(r.id, r.avatarVersion), isGuest: r.isGuest };
}

export function toMe(r: UserRecord, household: string | null = null): Me {
  return { ...toUserInfo(r), email: r.email, isAdmin: r.isAdmin, defaultListId: r.defaultListId, household, categoryOrder: r.categoryOrder, listOrder: r.listOrder, sectionOrder: r.sectionOrder };
}

export function toCatalogItem(r: CatalogRecord): CatalogItem {
  return {
    id: r.id,
    name: r.name,
    plural: r.plural,
    categoryId: r.categoryId,
    defaultUnit: r.defaultUnit,
    aliases: r.aliases,
    pantry: r.pantry,
    source: r.source,
    mealieFoodId: r.mealieFoodId,
    hidden: r.hidden,
    kind: r.kind,
    icon: r.icon,
    seq: r.seq,
  };
}
