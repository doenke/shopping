import { MAX_FILE_SIZE } from '@shopping/shared';
import { and, eq, lt, sql } from 'drizzle-orm';
import sharp from 'sharp';
import type { Db } from '../db/index.js';
import { files } from '../db/schema.js';

/** How long a file may wait for an entry to point to it (offline devices) or stay after the last one let go. */
const GRACE_DAYS = 7;
/** Long side of the preview of a picture (the app shows it at up to ~160 css px, sharp on 2x screens). */
const THUMB_SIZE = 320;

export type StoredFile = { name: string; mime: string; size: number; data: Buffer };

/** "Lampe (1).jpg" without path, control characters or quotes. */
export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const clean = base.replace(/[\u0000-\u001f\u007f"]/g, '').trim();
  return clean.slice(0, 200) || 'Datei';
}

/** Files attached to entries, kept in PostgreSQL. */
export class FileService {
  private timer?: ReturnType<typeof setInterval>;

  constructor(private readonly db: Db) {}

  /**
   * Stores a file under the id the device chose. Uploading the same id again (a retry from the offline
   * queue) is fine for the one who uploaded it first; for anyone else it is a conflict.
   */
  async put(userId: string, id: string, file: StoredFile): Promise<'created' | 'exists' | 'conflict'> {
    const [existing] = await this.db.select({ createdBy: files.createdBy }).from(files).where(eq(files.id, id));
    if (existing) return existing.createdBy === userId ? 'exists' : 'conflict';
    if (file.size > MAX_FILE_SIZE) throw new Error('too large');
    const thumb = /^image\//.test(file.mime) ? await this.thumbnail(file.data) : null;
    await this.db
      .insert(files)
      .values({ id, name: cleanFileName(file.name), mime: file.mime, size: file.data.length, data: file.data, thumb, createdBy: userId })
      .onConflictDoNothing();
    return 'created';
  }

  /** A small WebP of a picture, upright (EXIF); null if sharp cannot read it (e.g. HEIC). */
  private async thumbnail(data: Buffer): Promise<Buffer | null> {
    try {
      return await sharp(data, { failOn: 'none' })
        .rotate()
        .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 75 })
        .toBuffer();
    } catch {
      return null;
    }
  }

  /**
   * The file if the user may see it: they uploaded it, or an entry on one of their lists has it attached.
   * `thumb` returns the preview (or the picture itself when there is none).
   */
  async get(userId: string, id: string, thumb = false): Promise<{ name: string; mime: string; data: Buffer } | null> {
    const [row] = await this.db
      .select({
        name: files.name,
        mime: files.mime,
        createdBy: files.createdBy,
        data: thumb ? sql<Buffer>`coalesce(${files.thumb}, ${files.data})` : files.data,
        hasThumb: sql<boolean>`${files.thumb} is not null`,
      })
      .from(files)
      .where(eq(files.id, id));
    if (!row) return null;
    if (row.createdBy !== userId && !(await this.visible(userId, id))) return null;
    return { name: row.name, mime: thumb && row.hasThumb ? 'image/webp' : row.mime, data: row.data };
  }

  /** Is the file attached to an entry on a list the user is on? */
  private async visible(userId: string, id: string): Promise<boolean> {
    const rows = await this.db.execute(sql`
      select 1 from list_items i
      join lists l on l.id = i.list_id and not l.deleted
      join list_members m on m.list_id = i.list_id and m.user_id = ${userId} and not m.removed
      where i.attributes -> 'attachments' @> ${JSON.stringify([{ fileId: id }])}::jsonb
      limit 1`);
    return rows.length > 0;
  }

  /** Removes files no living entry points to (after the grace period). Returns how many. */
  async prune(): Promise<number> {
    const gone = await this.db
      .delete(files)
      .where(
        and(
          lt(files.createdAt, sql`now() - make_interval(days => ${GRACE_DAYS})`),
          sql`not exists (
            select 1 from list_items i
            where not i.deleted and i.attributes -> 'attachments' @> jsonb_build_array(jsonb_build_object('fileId', ${files.id}::text))
          )`,
        ),
      )
      .returning({ id: files.id });
    return gone.length;
  }

  start(log: { warn: (o: unknown, msg: string) => void }): void {
    const run = () => void this.prune().catch((err) => log.warn({ err }, 'Aufräumen der Dateien fehlgeschlagen'));
    this.timer = setInterval(run, 24 * 3_600_000);
    this.timer.unref();
    setTimeout(run, 120_000).unref();
  }

  stop(): void {
    clearInterval(this.timer);
  }
}
