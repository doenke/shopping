import type { CatalogItem, CategoryRow, ItemRow, ListRow, Me, Mutation, UserInfo } from '@shopping/shared';
import Dexie, { type EntityTable } from 'dexie';

export interface OutboxEntry {
  /** Auto-increment keeps the original order of mutations. */
  n?: number;
  mid: string;
  mutation: Mutation;
}

export interface MetaEntry {
  key: string;
  value: unknown;
}

/** Local replica of everything the user can see. The app reads only from here. */
export class ShoppingDb extends Dexie {
  lists!: EntityTable<ListRow, 'id'>;
  items!: EntityTable<ItemRow, 'id'>;
  catalog!: EntityTable<CatalogItem, 'id'>;
  users!: EntityTable<UserInfo, 'id'>;
  /** Own categories of the household (and of lists shared with the user). */
  categories!: EntityTable<CategoryRow, 'id'>;
  outbox!: EntityTable<OutboxEntry, 'n'>;
  meta!: EntityTable<MetaEntry, 'key'>;

  constructor(name = 'shopping') {
    super(name);
    this.version(1).stores({
      lists: 'id',
      items: 'id, listId',
      catalog: 'id, mealieFoodId',
      users: 'id',
      outbox: '++n, mid',
      meta: 'key',
    });
    this.version(2).stores({ categories: 'id' });
  }
}

export const db = new ShoppingDb();

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}

export type { Me };
