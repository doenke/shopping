import type { ItemRow } from './model.js';
import { itemUrl, withUrl } from './links.js';

/**
 * Attachments of an entry, any list type: links, places and files (pictures are files with an image type).
 *
 * They live in `attributes.attachments`, but every attachment has an own clock (`hlc["att:<id>"]`) and is
 * only changed through the `attachments` part of an item patch ({ id: attachment } adds or changes,
 * { id: null } removes). So two people attaching something at the same time both keep theirs, and an
 * `attributes` patch (status, due date, …) never drops one.
 *
 * The item's first link stays in `attributes.url` (CalDAV, API, the 🔗 on tiles use it); it is shown as a
 * link attachment with the id "url".
 */

export interface PlaceData {
  name: string;
  /** "Bahnhofstr. 3, 22767 Hamburg" – what Photon knows. */
  address: string | null;
  lat: number;
  lon: number;
}

interface AttachmentBase {
  id: string;
  /** When it was attached (ISO). */
  at: string;
  /** Who attached it (user id). */
  by?: string | null;
}

export type LinkAttachment = AttachmentBase & { type: 'link'; url: string; title?: string | null };
export type PlaceAttachment = AttachmentBase & { type: 'place' } & PlaceData;
/**
 * A file stored on the server (`/api/v1/files/<fileId>`). The attachment is synced right away; the file
 * itself may still be on its way (offline queue of the device that attached it).
 */
export type FileAttachment = AttachmentBase & { type: 'file'; fileId: string; name: string; mime: string; size: number };
export type Attachment = LinkAttachment | PlaceAttachment | FileAttachment;
export type AttachmentType = Attachment['type'];

/** The id the item's first link (attributes.url) has as an attachment. */
export const URL_ATTACHMENT_ID = 'url';

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** A valid attachment (data from the server or typed in), or null. */
export function toAttachment(v: unknown): Attachment | null {
  if (!v || typeof v !== 'object') return null;
  const a = v as Record<string, unknown>;
  if (typeof a.id !== 'string' || !a.id || typeof a.at !== 'string') return null;
  const base = { id: a.id, at: a.at, ...(typeof a.by === 'string' ? { by: a.by } : {}) };
  if (a.type === 'link' && typeof a.url === 'string' && itemUrl({ attributes: { url: a.url } })) {
    return { ...base, type: 'link', url: a.url, ...(typeof a.title === 'string' && a.title ? { title: a.title } : {}) };
  }
  if (a.type === 'place' && typeof a.name === 'string' && isNum(a.lat) && isNum(a.lon) && Math.abs(a.lat) <= 90 && Math.abs(a.lon) <= 180) {
    return { ...base, type: 'place', name: a.name, address: typeof a.address === 'string' && a.address ? a.address : null, lat: a.lat, lon: a.lon };
  }
  if (
    a.type === 'file' &&
    typeof a.fileId === 'string' &&
    UUID.test(a.fileId) &&
    typeof a.name === 'string' &&
    typeof a.mime === 'string' &&
    isNum(a.size) &&
    a.size >= 0
  ) {
    return { ...base, type: 'file', fileId: a.fileId, name: a.name.slice(0, 200) || 'Datei', mime: a.mime.slice(0, 100), size: a.size };
  }
  return null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Largest file that can be attached (bytes). */
export const MAX_FILE_SIZE = 25 * 1024 * 1024;

/** Pictures get a preview and open large in the app. */
export const isImage = (a: Pick<FileAttachment, 'mime'>): boolean => /^image\/(jpeg|png|gif|webp|avif|heic|heif|bmp)$/i.test(a.mime);

/** The files (and pictures) of an entry. */
export function itemFiles(item: Pick<ItemRow, 'attributes'>): FileAttachment[] {
  return stored(item.attributes).filter((a): a is FileAttachment => a.type === 'file');
}

/** Where the app (and CalDAV clients) get a file; `thumb` for the small preview of a picture. */
export function fileUrl(fileId: string, thumb = false): string {
  return `/api/v1/files/${fileId}${thumb ? '?thumb=1' : ''}`;
}

/** "1,2 MB" */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

/** The patch that attaches a file (already uploaded or waiting in the queue). */
export function addFilePatch(file: { fileId: string; name: string; mime: string; size: number }, by?: string | null): { attachments: AttachmentChanges } {
  const id = newAttachmentId();
  return { attachments: { [id]: { id, type: 'file', ...file, at: new Date().toISOString(), ...(by ? { by } : {}) } } };
}

/** The stored attachments (without the first link). */
function stored(attributes: Record<string, unknown>): Attachment[] {
  const raw = attributes.attachments;
  return Array.isArray(raw) ? raw.map(toAttachment).filter((a): a is Attachment => a !== null) : [];
}

/** All attachments of an entry, the first link first, then in the order they were attached. */
export function itemAttachments(item: Pick<ItemRow, 'attributes' | 'createdAt'> | Pick<ItemRow, 'attributes'>): Attachment[] {
  const url = itemUrl(item);
  const first: Attachment[] = url
    ? [
        {
          id: URL_ATTACHMENT_ID,
          type: 'link',
          url,
          at: 'createdAt' in item ? item.createdAt : '',
          ...(typeof item.attributes.urlTitle === 'string' ? { title: item.attributes.urlTitle } : {}),
        },
      ]
    : [];
  return [...first, ...stored(item.attributes)];
}

/** The places of an entry. */
export function itemPlaces(item: Pick<ItemRow, 'attributes'>): PlaceAttachment[] {
  return stored(item.attributes).filter((a): a is PlaceAttachment => a.type === 'place');
}

/** One small symbol per kind of attachment the entry has (🔗, 📍, 🖼, 📄), for tiles and rows. */
export function attachmentBadges(item: Pick<ItemRow, 'attributes'>): string[] {
  const all = itemAttachments(item);
  const types = new Set(all.map((a) => a.type));
  const files = all.filter((a): a is FileAttachment => a.type === 'file');
  return [
    ...(types.has('link') ? ['🔗'] : []),
    ...(types.has('place') ? ['📍'] : []),
    ...(files.some(isImage) ? ['🖼'] : []),
    ...(files.some((f) => !isImage(f)) ? ['📄'] : []),
  ];
}

/** "Hornbach · Bahnhofstr. 3, Hamburg" (or the coordinates). */
export function placeLabel(p: PlaceData): string {
  return p.name || p.address || `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`;
}

/** Where tapping a place goes: the phone's maps app (geo:), elsewhere OpenStreetMap. */
export function placeUrl(p: PlaceData, mobile: boolean): string {
  const lat = p.lat.toFixed(6);
  const lon = p.lon.toFixed(6);
  if (mobile) return `geo:${lat},${lon}?q=${lat},${lon}(${encodeURIComponent(placeLabel(p))})`;
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`;
}

/** A new attachment id (also unique when two devices attach at the same moment). */
export function newAttachmentId(): string {
  return `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Changes of attachments as they travel in an item patch: { id: attachment } or { id: null } (remove). */
export type AttachmentChanges = Record<string, Attachment | null>;

/**
 * Applies attachment changes to a row, each attachment with its own clock. The first link ("url") is a
 * plain attribute and is handled by the caller. Returns true when something changed.
 */
export function applyAttachmentChanges(row: Pick<ItemRow, 'attributes' | 'hlc'>, changes: AttachmentChanges, ts: string): boolean {
  let list = stored(row.attributes);
  let changed = false;
  for (const [id, value] of Object.entries(changes)) {
    if (id === URL_ATTACHMENT_ID) continue;
    const key = `att:${id}`;
    const current = row.hlc[key];
    if (current !== undefined && current >= ts) continue;
    row.hlc[key] = ts;
    const att = value === null ? null : toAttachment({ ...value, id });
    const at = list.findIndex((a) => a.id === id);
    if (att && at >= 0) list = list.map((a) => (a.id === id ? att : a));
    else if (att) list = [...list, att];
    else if (at >= 0) list = list.filter((a) => a.id !== id);
    else continue;
    changed = true;
  }
  if (!changed) return false;
  const attrs = { ...row.attributes };
  if (list.length) attrs.attachments = list;
  else delete attrs.attachments;
  row.attributes = attrs;
  return true;
}

/**
 * Keeps attachments whose local clock is newer than the server's (not sent yet) when the server's copy of
 * an item comes in.
 */
export function mergeAttachments(local: Pick<ItemRow, 'attributes' | 'hlc'>, merged: Pick<ItemRow, 'attributes' | 'hlc'>): void {
  const localList = stored(local.attributes);
  const changes: AttachmentChanges = {};
  const stamps: Record<string, string> = {};
  for (const [key, l] of Object.entries(local.hlc)) {
    if (!key.startsWith('att:')) continue;
    const r = merged.hlc[key];
    if (r !== undefined && l <= r) continue;
    const id = key.slice(4);
    changes[id] = localList.find((a) => a.id === id) ?? null;
    stamps[id] = l;
  }
  for (const [id, att] of Object.entries(changes)) applyAttachmentChanges(merged, { [id]: att }, stamps[id]!);
}

/** The attributes without the stored attachments – an `attributes` patch never decides those. */
export function keepAttachments(next: Record<string, unknown>, current: Record<string, unknown>): Record<string, unknown> {
  const { attachments: _drop, ...rest } = next;
  return current.attachments !== undefined ? { ...rest, attachments: current.attachments } : rest;
}

/** The patch that adds a link: the first one goes into attributes.url, more become attachments. */
export function addLinkPatch(
  item: Pick<ItemRow, 'attributes'>,
  url: string,
  by?: string | null,
): { attributes?: Record<string, unknown>; attachments?: AttachmentChanges } {
  if (!itemUrl(item)) return { attributes: withUrl(item.attributes, url) };
  const id = newAttachmentId();
  const fixed = withUrl({}, url).url as string;
  return { attachments: { [id]: { id, type: 'link', url: fixed, at: new Date().toISOString(), ...(by ? { by } : {}) } } };
}

/** The patch that removes an attachment (the first link is an attribute). */
export function removeAttachmentPatch(
  item: Pick<ItemRow, 'attributes'>,
  id: string,
): { attributes?: Record<string, unknown>; attachments?: AttachmentChanges } {
  if (id === URL_ATTACHMENT_ID) {
    const { urlTitle: _t, ...rest } = item.attributes;
    return { attributes: withUrl(rest, null) };
  }
  return { attachments: { [id]: null } };
}

/** The patch that adds a place. */
export function addPlacePatch(place: PlaceData, by?: string | null): { attachments: AttachmentChanges } {
  const id = newAttachmentId();
  return { attachments: { [id]: { id, type: 'place', ...place, at: new Date().toISOString(), ...(by ? { by } : {}) } } };
}

/** "Auto geparkt *" → current location; "Baumarkt *Hornbach Altona !Fr" → search "Hornbach Altona". */
export function extractPlace(text: string): { text: string; place: { query: string | null } | null } {
  const m = /(^|\s)\*([^!@#*\n]*)/.exec(text);
  if (!m) return { text, place: null };
  const query = m[2]!.trim();
  const rest = (text.slice(0, m.index) + m[1] + text.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim();
  return { text: rest, place: { query: query || null } };
}
