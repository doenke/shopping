import { categoryInList, formatAmounts, getCategory, itemSpecification, listDescription, packingInfo, type ItemRow, type ItemSource, type ListRow, type ListType } from '@shopping/shared';

/** The public shape of an item in the REST API, SSE and MCP. */
export interface ApiItem {
  id: string;
  listId: string;
  name: string;
  /** Human-readable, e.g. "500 g · gemischt · bio". */
  specification: string;
  quantity: string;
  amounts: { quantity: number | null; unit: string | null }[];
  properties: string[];
  note: string | null;
  category: { id: string; name: string };
  checked: boolean;
  checkedAt: string | null;
  checkedBy: string | null;
  optional: boolean;
  sources: string[];
  catalogItemId: string | null;
  /** Packing lists: for whom, and in which Packstück. */
  person: string | null;
  container: string | null;
  /** Merklisten: who the tip is from, and where to find it (same values as person/container). */
  tipFrom: string | null;
  where: string | null;
  /** Token or AI assistant the item was added through ("Claude", "Home Assistant"). */
  addedVia: string | null;
}

export interface ApiList {
  id: string;
  name: string;
  /** "shopping", "packing" or "memo" (Merkliste). */
  type: ListType;
  description: string | null;
  /** "household" (everyone in the household) or "private". */
  visibility: 'household' | 'private';
  isTemplate: boolean;
  archived: boolean;
  isMain: boolean;
  isOwner: boolean;
  openItems: number;
}

export function toApiItem(i: ItemRow, userNames: Map<string, string>, listType?: ListType): ApiItem {
  // Category ids are unique across list types; with the type known, foreign ones go to "Sonstiges".
  const cat = listType ? categoryInList(i.categoryId, listType) : getCategory(i.categoryId);
  const packing = packingInfo(i);
  const sources = Array.isArray(i.attributes.sources) ? (i.attributes.sources as ItemSource[]).map((s) => s.label) : [];
  return {
    id: i.id,
    listId: i.listId,
    name: i.name,
    specification: itemSpecification(i),
    quantity: formatAmounts(i.amounts),
    amounts: i.amounts.map((a) => ({ quantity: a.q, unit: a.u })),
    properties: i.properties,
    note: i.note,
    category: { id: cat.id, name: cat.name },
    checked: i.checked,
    checkedAt: i.checkedAt,
    checkedBy: i.checkedBy ? (userNames.get(i.checkedBy) ?? null) : null,
    optional: i.optional,
    sources,
    catalogItemId: i.catalogItemId,
    person: packing.person,
    container: packing.container,
    tipFrom: packing.person,
    where: packing.container,
    addedVia: typeof i.attributes.via === 'string' ? i.attributes.via : null,
  };
}

export function toApiList(l: ListRow, userId: string, mainListId: string | null, openItems: number): ApiList {
  return {
    id: l.id,
    name: l.name,
    type: l.listType,
    description: listDescription(l),
    visibility: l.visibility,
    isTemplate: l.isTemplate,
    archived: !!l.archivedAt,
    isMain: l.id === mainListId,
    isOwner: l.ownerId === userId,
    openItems,
  };
}
