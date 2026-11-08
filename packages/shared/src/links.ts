import type { ItemRow } from './model.js';

/**
 * A web link on an item ("Dune https://…", shared from another app), kept in `attributes.url`.
 * Only http(s) links count.
 */

const URL_RE = /https?:\/\/[^\s<>"]+/i;

/** The first link in a text. Trailing punctuation ("…/film)." ) is not part of it. */
export function findUrl(text: string): string | null {
  const m = URL_RE.exec(text)?.[0];
  return m ? m.replace(/[),.;:!?»“"']+$/, '') : null;
}

/** Takes the link out of a typed line: "Dune https://x.de/dune" → { text: "Dune", url }. */
export function extractUrl(text: string): { text: string; url: string | null } {
  const url = findUrl(text);
  if (!url) return { text, url: null };
  return { text: text.replace(url, ' ').replace(/\s+/g, ' ').trim(), url };
}

/** The item's link, if it has a valid one. */
export function itemUrl(item: Pick<ItemRow, 'attributes'>): string | null {
  const u = item.attributes.url;
  if (typeof u !== 'string') return null;
  const v = u.trim();
  return /^https?:\/\/[^\s/?#]+\.[^\s]*$|^https?:\/\/[^\s/?#]+[/?#][^\s]*$/i.test(v) ? v : null;
}

/** Sets (or with null/empty removes) the link; "x.de/film" gets an https:// in front. */
export function withUrl(attributes: Record<string, unknown>, url: string | null | undefined): Record<string, unknown> {
  const next = { ...attributes };
  const v = (url ?? '').trim();
  if (!v) {
    delete next.url;
    return next;
  }
  next.url = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  return next;
}

/** Short name for a link: "imdb.com". */
export function linkLabel(url: string): string {
  return /^https?:\/\/(?:www\.)?([^/:?#\s]+)/i.exec(url)?.[1]?.toLowerCase() ?? url;
}
