import { z } from 'zod';
import { CUSTOM_CATEGORY_TYPES, LIST_TYPES, type CategoryPatch, type ItemPatch, type ListPatch, type MePatch, type Mutation } from './model.js';

export const AmountSchema = z.object({
  q: z.number().positive().nullable(),
  u: z.string().max(32).nullable(),
});

// ---- Mutations -----------------------------------------------------------

const id = z.string().uuid();
const hlc = z.string().min(20).max(80);

const AttachmentSchema = z.discriminatedUnion('type', [
  z.object({
    id: z.string().min(1).max(40),
    at: z.string().max(40),
    by: z.string().max(64).nullish(),
    type: z.literal('link'),
    url: z.string().url().max(2000),
    title: z.string().max(300).nullish(),
  }),
  z.object({
    id: z.string().min(1).max(40),
    at: z.string().max(40),
    by: z.string().max(64).nullish(),
    type: z.literal('place'),
    name: z.string().max(200),
    address: z.string().max(300).nullable(),
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
  }),
  z.object({
    id: z.string().min(1).max(40),
    at: z.string().max(40),
    by: z.string().max(64).nullish(),
    type: z.literal('file'),
    fileId: z.string().uuid(),
    name: z.string().max(200),
    mime: z.string().max(100),
    size: z.number().int().min(0),
  }),
]);

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
    visibility: z.enum(['household', 'private']),
  })
  .partial()
  .strict();

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
    personChecks: z.record(z.string().trim().min(1).max(60), z.boolean()),
    attachments: z.record(z.string().min(1).max(40), AttachmentSchema.nullable()),
  })
  .partial()
  .strict();

export const MePatchSchema = z
  .object({
    defaultListId: id.nullable(),
    categoryOrder: z.array(z.string().min(1).max(64)).max(200),
    listOrder: z.array(id).max(1000),
    sectionOrder: z.array(z.enum(['shopping', 'packing', 'memo', 'todo', 'templates'])).max(5),
  })
  .partial()
  .strict();

export const CategoryPatchSchema = z
  .object({
    listType: z.enum(CUSTOM_CATEGORY_TYPES),
    name: z.string().trim().min(1).max(40),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    deleted: z.boolean(),
  })
  .partial()
  .strict();

export const MutationSchema = z.discriminatedUnion('entity', [
  z.object({ mid: id, entity: z.literal('list'), id, hlc, patch: ListPatchSchema }),
  z.object({ mid: id, entity: z.literal('item'), id, hlc, patch: ItemPatchSchema }),
  z.object({ mid: id, entity: z.literal('me'), id: z.string(), hlc, patch: MePatchSchema }),
  z.object({ mid: id, entity: z.literal('category'), id, hlc, patch: CategoryPatchSchema }),
]);

export const ClientMessageSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('hello'), since: z.number().int().min(0) }),
  z.object({ t: z.literal('push'), mutations: z.array(MutationSchema).max(500) }),
  z.object({ t: z.literal('ping') }),
]);

// Compile-time check that the schemas match the hand-written types.
type Assert<T extends true> = T;
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
export type _Checks = [
  Assert<Same<z.infer<typeof ListPatchSchema>, ListPatch>>,
  Assert<Same<z.infer<typeof ItemPatchSchema>, ItemPatch>>,
  Assert<Same<z.infer<typeof MePatchSchema>, MePatch>>,
  Assert<Same<z.infer<typeof CategoryPatchSchema>, CategoryPatch>>,
  Assert<Same<z.infer<typeof MutationSchema>, Mutation>>,
];
