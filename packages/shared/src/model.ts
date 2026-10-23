export interface Amount {
  q: number | null;
  u: string | null;
}

export const LIST_TYPES = ['shopping'] as const;
export type ListType = (typeof LIST_TYPES)[number];

/** Per-field HLC timestamps, used for last-writer-wins merging per field. */
export type FieldClock = Record<string, string>;

export interface ListRow {
  id: string;
  ownerId: string;
  name: string;
  listType: ListType;
  isTemplate: boolean;
  icon: string | null;
  color: string | null;
  settings: Record<string, unknown>;
  archivedAt: string | null;
  deleted: boolean;
  createdAt: string;
  hlc: FieldClock;
  seq: number;
}

/** Where (part of) an item came from, kept in `attributes.sources`. */
export interface ItemSource {
  type: 'mealie_recipe' | 'mealie_list' | 'mealie_mealplan' | 'template' | 'api' | 'mcp';
  label: string;
}

export interface ItemRow {
  id: string;
  listId: string;
  catalogItemId: string | null;
  name: string;
  amounts: Amount[];
  properties: string[];
  note: string | null;
  categoryId: string | null;
  checked: boolean;
  checkedAt: string | null;
  checkedBy: string | null;
  position: string;
  optional: boolean;
  attributes: Record<string, unknown>;
  createdBy: string | null;
  createdAt: string;
  deleted: boolean;
  /** Set when the server merged this item into another one (duplicate added offline). */
  mergedInto: string | null;
  hlc: FieldClock;
  seq: number;
}

export interface UserInfo {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  isGuest: boolean;
}

export interface Me extends UserInfo {
  email: string | null;
  isAdmin: boolean;
  defaultListId: string | null;
}

export interface CatalogItem {
  id: string;
  name: string;
  plural: string | null;
  categoryId: string;
  defaultUnit: string | null;
  aliases: string[];
  pantry: boolean;
  source: 'seed' | 'mealie' | 'user';
  mealieFoodId: string | null;
  hidden: boolean;
  /** Version token of the approved icon, null = category icon / letter. */
  icon: string | null;
  seq: number;
}

// ---- Mutations -----------------------------------------------------------

export interface ListPatch {
  name?: string;
  listType?: ListType;
  isTemplate?: boolean;
  icon?: string | null;
  color?: string | null;
  settings?: Record<string, unknown>;
  archivedAt?: string | null;
  deleted?: boolean;
}

export interface ItemPatch {
  listId?: string;
  catalogItemId?: string | null;
  name?: string;
  amounts?: Amount[];
  properties?: string[];
  note?: string | null;
  categoryId?: string | null;
  checked?: boolean;
  position?: string;
  optional?: boolean;
  attributes?: Record<string, unknown>;
  deleted?: boolean;
}

export interface MePatch {
  defaultListId?: string | null;
}

interface MutationBase {
  mid: string;
  id: string;
  hlc: string;
}

export type Mutation =
  | (MutationBase & { entity: 'list'; patch: ListPatch })
  | (MutationBase & { entity: 'item'; patch: ItemPatch })
  | (MutationBase & { entity: 'me'; patch: MePatch });

// ---- Sync messages -------------------------------------------------------

export interface ChangeSet {
  lists: ListRow[];
  items: ItemRow[];
  /** Lists the user lost access to (deleted or left). */
  removedLists: string[];
  users: UserInfo[];
  me?: Me;
  /** Highest server sequence covered by this change set. */
  seq: number;
}

export type ClientMessage =
  | { t: 'hello'; since: number }
  | { t: 'push'; mutations: Mutation[] }
  | { t: 'ping' };

export type ServerMessage =
  | ({ t: 'changes' } & ChangeSet)
  | { t: 'ack'; mids: string[]; rejected: { mid: string; reason: string }[] }
  | { t: 'pong' }
  /** The shared catalog changed – fetch it again. */
  | { t: 'catalog'; seq: number }
  | { t: 'resync' };
