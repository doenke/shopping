import type { CatalogItem, CategoryRow, ItemRow, ListRow, Me, Mutation, UserInfo } from '@shopping/shared';
import Dexie, { type EntityTable } from 'dexie';

export interface OutboxEntry {
  /** Auto-increment keeps the original order of mutations. */
  n?: number;
  mid: string;
  mutation: Mutation;
}

/** A file attached on this device that is not on the server yet (offline queue). */
export interface UploadEntry {
  fileId: string;
  name: string;
  mime: string;
  blob: Blob;
  /** When it was queued (ms). */
  at: number;
}

/** Files shared to the app ("Teilen → Shopping"), held by the service worker until the app picks a list. */
export interface SharedFilesEntry {
  id: string;
  files: { name: string; type: string; blob: Blob }[];
  at: number;
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
  uploads!: EntityTable<UploadEntry, 'fileId'>;
  shared!: EntityTable<SharedFilesEntry, 'id'>;

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
    this.version(3).stores({ uploads: 'fileId', shared: 'id' });
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
