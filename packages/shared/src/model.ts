import { z } from 'zod';

export const AmountSchema = z.object({
  q: z.number().positive().nullable(),
  u: z.string().max(32).nullable(),
});
export type Amount = z.infer<typeof AmountSchema>;

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
  seq: number;
}

// ---- Mutations -----------------------------------------------------------

const id = z.string().uuid();
const hlc = z.string().min(20).max(80);

export const ListPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    listType: z.enum(LIST_TYPES),
    isTemplate: z.boolean(),
    icon: z.string().max(16).nullable(),
    color: z.string().max(16).nullable(),
    settings: z.record(z.string(), z.unknown()),
    archivedAt: z.string().datetime().nullable(),
    deleted: z.boolean(),
  })
  .partial()
  .strict();
export type ListPatch = z.infer<typeof ListPatchSchema>;

export const ItemPatchSchema = z
  .object({
    listId: id,
    catalogItemId: id.nullable(),
    name: z.string().trim().min(1).max(120),
    amounts: z.array(AmountSchema).max(10),
    properties: z.array(z.string().trim().min(1).max(40)).max(20),
    note: z.string().max(500).nullable(),
    categoryId: z.string().max(40).nullable(),
    checked: z.boolean(),
    position: z.string().min(1).max(200),
    optional: z.boolean(),
    attributes: z.record(z.string(), z.unknown()),
    deleted: z.boolean(),
  })
  .partial()
  .strict();
export type ItemPatch = z.infer<typeof ItemPatchSchema>;

export const MePatchSchema = z
  .object({ defaultListId: id.nullable() })
  .partial()
  .strict();
export type MePatch = z.infer<typeof MePatchSchema>;

export const MutationSchema = z.discriminatedUnion('entity', [
  z.object({ mid: id, entity: z.literal('list'), id, hlc, patch: ListPatchSchema }),
  z.object({ mid: id, entity: z.literal('item'), id, hlc, patch: ItemPatchSchema }),
  z.object({ mid: id, entity: z.literal('me'), id: z.string(), hlc, patch: MePatchSchema }),
]);
export type Mutation = z.infer<typeof MutationSchema>;

export const PushSchema = z.object({ mutations: z.array(MutationSchema).max(500) });

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

export const ClientMessageSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('hello'), since: z.number().int().min(0) }),
  z.object({ t: z.literal('push'), mutations: z.array(MutationSchema).max(500) }),
  z.object({ t: z.literal('ping') }),
]);
