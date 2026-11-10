import { addFilePatch, formatSize, MAX_FILE_SIZE } from '@shopping/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { updateItem } from './actions';
import { db } from './db';
import { sync } from './sync/engine';
import { showToast } from './toast';

/**
 * Files on entries (pictures, PDFs, …). Attaching one first keeps it on the device (`db.uploads`) and puts
 * the attachment on the entry at once – so it also works offline. The upload follows as soon as there is a
 * connection; until then the app shows the local copy.
 */

/** Some systems hand over files without a type; the name usually tells. */
function mimeOf(file: File): string {
  if (file.type) return file.type;
  const ext = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase();
  const known: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    heic: 'image/heic',
    pdf: 'application/pdf',
    txt: 'text/plain',
    csv: 'text/csv',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
  return (ext && known[ext]) || 'application/octet-stream';
}

/** A pasted picture is called "image.png" – a name with the time is more helpful. */
function nameOf(file: File): string {
  if (file.name && file.name !== 'image.png') return file.name;
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const ext = mimeOf(file).split('/')[1]?.replace('jpeg', 'jpg') ?? 'bin';
  return `Bild ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}.${ext}`;
}

/** Attaches files to an entry; returns how many were taken (too large ones are not). */
export async function attachFiles(itemId: string, list: Iterable<File>): Promise<number> {
  let n = 0;
  for (const file of list) {
    if (file.size > MAX_FILE_SIZE) {
      showToast(`„${file.name}“ ist zu groß (${formatSize(file.size)}, höchstens ${formatSize(MAX_FILE_SIZE)})`);
      continue;
    }
    if (file.size === 0) continue;
    const fileId = crypto.randomUUID();
    const name = nameOf(file);
    const mime = mimeOf(file);
    await db.uploads.put({ fileId, name, mime, blob: file, at: Date.now() });
    await updateItem(itemId, addFilePatch({ fileId, name, mime, size: file.size }));
    n++;
  }
  if (n) void uploadPending();
  return n;
}

let running: Promise<void> | null = null;

/** Sends what waits in the queue, one after the other; stops at the first network failure (retried later). */
export function uploadPending(): Promise<void> {
  running ??= (async () => {
    try {
      for (const up of await db.uploads.orderBy('fileId').toArray()) {
        let res: Response;
        try {
          res = await fetch(`/api/v1/files/${up.fileId}?name=${encodeURIComponent(up.name)}`, {
            method: 'PUT',
            headers: { 'content-type': up.mime },
            credentials: 'same-origin',
            body: up.blob,
          });
        } catch {
          return; // Offline: next time.
        }
        if (res.ok) await db.uploads.delete(up.fileId);
        else if (res.status === 401 || res.status >= 500) return;
        else {
          // Refused for good (too large, conflict): no point in trying again.
          await db.uploads.delete(up.fileId);
          showToast(`„${up.name}“ konnte nicht hochgeladen werden (${res.status})`);
        }
      }
    } finally {
      running = null;
    }
  })();
  return running;
}

/** Retries whenever the connection comes back, and now and then. */
let started = false;
export function startUploads(): void {
  if (started) return;
  started = true;
  let last = sync.getStatus().state;
  sync.subscribe(() => {
    const state = sync.getStatus().state;
    if (state === 'online' && last !== 'online') void uploadPending();
    last = state;
  });
  setInterval(() => void uploadPending(), 60_000);
  void uploadPending();
  // Shared files nobody put on a list (dialog closed) are not kept forever.
  void db.shared.filter((s) => s.at < Date.now() - 24 * 3_600_000).delete();
}

/** Has this device not sent the file yet? */
export function usePendingUpload(fileId: string): boolean {
  return useLiveQuery(async () => !!(await db.uploads.get(fileId)), [fileId]) ?? false;
}

/**
 * Where to show a file: the local copy while it waits for the upload, else the server's (`thumb` = preview).
 */
export function useFileSrc(fileId: string, thumb = false): string {
  const blob = useLiveQuery(async () => (await db.uploads.get(fileId))?.blob ?? null, [fileId]);
  const [local, setLocal] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) return setLocal(null);
    const url = URL.createObjectURL(blob);
    setLocal(url);
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  return local ?? `/api/v1/files/${fileId}${thumb ? '?thumb=1' : ''}`;
}

/** Dropping files onto an open entry (details dialog, detail column) attaches them. */
export function useFileDropOn(itemId: string | undefined) {
  const has = (e: React.DragEvent) => e.dataTransfer.types.includes('Files');
  return {
    onDragOver: (e: React.DragEvent<HTMLElement>) => {
      if (!itemId || !has(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      e.currentTarget.classList.add('drop-files');
    },
    onDragLeave: (e: React.DragEvent<HTMLElement>) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) e.currentTarget.classList.remove('drop-files');
    },
    onDrop: (e: React.DragEvent<HTMLElement>) => {
      e.currentTarget.classList.remove('drop-files');
      if (!itemId || !e.dataTransfer.files.length) return;
      e.preventDefault();
      e.stopPropagation();
      void attachFiles(itemId, Array.from(e.dataTransfer.files));
    },
  };
}
