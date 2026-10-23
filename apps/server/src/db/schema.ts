import type { Amount, FieldClock } from '@shopping/shared';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgSequence,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/** One global, monotonically increasing sequence for all synced rows (delta sync cursor). */
export const syncSeq = pgSequence('sync_seq');

const seq = () =>
  bigint('seq', { mode: 'number' })
    .notNull()
    .default(sql`nextval('sync_seq')`);

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  oidcSubject: text('oidc_subject').notNull().unique(),
  email: text('email'),
  displayName: text('display_name').notNull(),
  avatarUrl: text('avatar_url'),
  isAdmin: boolean('is_admin').notNull().default(false),
  /** Guests come in through a list link without an account and only see that list. */
  isGuest: boolean('is_guest').notNull().default(false),
  defaultListId: uuid('default_list_id'),
  hlc: jsonb('hlc').$type<FieldClock>().notNull().default({}),
  seq: seq(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable('sessions', {
  idHash: text('id_hash').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

export const lists = pgTable(
  'lists',
  {
    id: uuid('id').primaryKey(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id),
    name: text('name').notNull(),
    listType: text('list_type').notNull().default('shopping'),
    isTemplate: boolean('is_template').notNull().default(false),
    icon: text('icon'),
    color: text('color'),
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
    archivedAt: text('archived_at'),
    deleted: boolean('deleted').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
    hlc: jsonb('hlc').$type<FieldClock>().notNull().default({}),
    seq: seq(),
  },
  (t) => [index('lists_seq_idx').on(t.seq)],
);

export const listMembers = pgTable(
  'list_members',
  {
    listId: uuid('list_id')
      .notNull()
      .references(() => lists.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    removed: boolean('removed').notNull().default(false),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    seq: seq(),
  },
  (t) => [primaryKey({ columns: [t.listId, t.userId] }), index('list_members_user_idx').on(t.userId)],
);

/** One active link per list; whoever opens it (logged in) becomes a member. */
export const shareLinks = pgTable('share_links', {
  listId: uuid('list_id')
    .primaryKey()
    .references(() => lists.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  /** Encrypted token, so every member can share the link again. */
  tokenSealed: text('token_sealed').notNull(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const listItems = pgTable(
  'list_items',
  {
    id: uuid('id').primaryKey(),
    listId: uuid('list_id')
      .notNull()
      .references(() => lists.id, { onDelete: 'cascade' }),
    catalogItemId: uuid('catalog_item_id'),
    name: text('name').notNull(),
    amounts: jsonb('amounts').$type<Amount[]>().notNull().default([]),
    properties: jsonb('properties').$type<string[]>().notNull().default([]),
    note: text('note'),
    categoryId: text('category_id'),
    checked: boolean('checked').notNull().default(false),
    checkedAt: text('checked_at'),
    checkedBy: uuid('checked_by'),
    position: text('position').notNull(),
    optional: boolean('optional').notNull().default(false),
    attributes: jsonb('attributes').$type<Record<string, unknown>>().notNull().default({}),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
    deleted: boolean('deleted').notNull().default(false),
    mergedInto: uuid('merged_into'),
    hlc: jsonb('hlc').$type<FieldClock>().notNull().default({}),
    seq: seq(),
  },
  (t) => [index('list_items_list_seq_idx').on(t.listId, t.seq)],
);

export const catalogItems = pgTable(
  'catalog_items',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    plural: text('plural'),
    categoryId: text('category_id').notNull(),
    defaultUnit: text('default_unit'),
    aliases: jsonb('aliases').$type<string[]>().notNull().default([]),
    pantry: boolean('pantry').notNull().default(false),
    source: text('source').$type<'seed' | 'mealie' | 'user'>().notNull(),
    mealieFoodId: text('mealie_food_id'),
    /** Category was changed by hand and must not be overwritten by imports. */
    categoryLocked: boolean('category_locked').notNull().default(false),
    hidden: boolean('hidden').notNull().default(false),
    /** English description of the picture for the icon generator, e.g. "group of three potatoes". */
    iconSubject: text('icon_subject'),
    /** Version token of the approved icon (changes the URL, so caches never serve an old one). */
    icon: text('icon'),
    seq: seq(),
  },
  (t) => [uniqueIndex('catalog_items_mealie_idx').on(t.mealieFoodId), index('catalog_items_seq_idx').on(t.seq)],
);

export const integrations = pgTable(
  'integrations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    status: text('status'),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('integrations_owner_type_idx').on(t.ownerId, t.type)],
);

/**
 * Bearer tokens: personal API tokens (Home Assistant, scripts) and OAuth
 * access tokens issued to MCP clients. Only hashes are stored.
 */
export const apiTokens = pgTable(
  'api_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kind: text('kind').$type<'pat' | 'oauth'>().notNull(),
    clientId: text('client_id'),
    tokenHash: text('token_hash').notNull().unique(),
    /** First characters of the token, to recognise it in the list. */
    prefix: text('prefix').notNull(),
    refreshHash: text('refresh_hash').unique(),
    scopes: jsonb('scopes').$type<string[]>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    refreshExpiresAt: timestamp('refresh_expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [index('api_tokens_user_idx').on(t.userId)],
);

/** OAuth clients registered dynamically (RFC 7591), e.g. Claude as MCP client. */
export const oauthClients = pgTable('oauth_clients', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  redirectUris: jsonb('redirect_uris').$type<string[]>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

/** Household-wide settings (not per user), e.g. the icon generator. */
export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type IconTarget = 'item' | 'category';
export type IconStatus = 'candidate' | 'approved' | 'rejected' | 'retired';

/** Generated icons: candidates waiting for review, the approved one, rejected ones (without image data). */
export const icons = pgTable(
  'icons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    targetType: text('target_type').$type<IconTarget>().notNull(),
    /** Catalog item id or category id. */
    targetId: text('target_id').notNull(),
    status: text('status').$type<IconStatus>().notNull().default('candidate'),
    /** Approved icons marked as style reference ("anchor set"). */
    isAnchor: boolean('is_anchor').notNull().default(false),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    prompt: text('prompt').notNull(),
    seed: integer('seed'),
    referenceSet: text('reference_set'),
    checks: jsonb('checks').$type<Record<string, boolean>>().notNull().default({}),
    /** 512 px master (WebP with alpha). */
    image: bytea('image'),
    /** 192 px WebP served to the app. */
    thumb: bytea('thumb'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [index('icons_target_idx').on(t.targetType, t.targetId), index('icons_status_idx').on(t.status)],
);

export type IconJobStatus = 'queued' | 'done' | 'failed';

export const iconJobs = pgTable(
  'icon_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    targetType: text('target_type').$type<IconTarget>().notNull(),
    targetId: text('target_id').notNull(),
    priority: integer('priority').notNull().default(0),
    candidates: integer('candidates').notNull().default(2),
    paid: boolean('paid').notNull().default(false),
    /** Optional extra instructions from the review ("rounder", "only one"). */
    hint: text('hint'),
    status: text('status').$type<IconJobStatus>().notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // At most one open job per target.
    uniqueIndex('icon_jobs_open_idx').on(t.targetType, t.targetId).where(sql`status = 'queued'`),
    index('icon_jobs_status_idx').on(t.status, t.priority),
  ],
);

/** Images generated per day and provider, for the daily budget and the cost cap. */
export const iconUsage = pgTable(
  'icon_usage',
  {
    day: date('day').notNull(),
    provider: text('provider').notNull(),
    images: integer('images').notNull().default(0),
    /** Estimated cost in tenths of a cent. */
    costMilli: integer('cost_milli').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.day, t.provider] })],
);
