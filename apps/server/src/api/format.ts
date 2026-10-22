import { formatAmounts, getCategory, itemSpecification, type ItemRow, type ItemSource, type ListRow } from '@shopping/shared';

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
}

export interface ApiList {
  id: string;
  name: string;
  isTemplate: boolean;
  isMain: boolean;
  isOwner: boolean;
  openItems: number;
}

export function toApiItem(i: ItemRow, userNames: Map<string, string>): ApiItem {
  const cat = getCategory(i.categoryId);
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
  };
}

export function toApiList(l: ListRow, userId: string, mainListId: string | null, openItems: number): ApiList {
  return { id: l.id, name: l.name, isTemplate: l.isTemplate, isMain: l.id === mainListId, isOwner: l.ownerId === userId, openItems };
}
