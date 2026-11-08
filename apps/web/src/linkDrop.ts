import { findUrl, itemUrl, withUrl, type ItemRow } from '@shopping/shared';
import { useRef } from 'react';
import { addLink, updateItem } from './actions';

/** The dragged thing carries something that may be a link (from a browser tab, the address bar, a page). */
function mayBeLink(dt: DataTransfer | null): boolean {
  return !!dt && (dt.types.includes('text/uri-list') || dt.types.includes('text/plain'));
}

/** The dropped link, and the text of the dragged anchor as name where there is one. */
function droppedLink(dt: DataTransfer): { url: string; name: string | null } | null {
  const uriList = dt
    .getData('text/uri-list')
    .split(/\r?\n/)
    .find((l) => l.trim() && !l.startsWith('#'));
  const url = findUrl(uriList ?? '') ?? findUrl(dt.getData('text/plain'));
  if (!url) return null;
  let name: string | null = null;
  const html = dt.getData('text/html');
  if (html) {
    const text = new DOMParser().parseFromString(html, 'text/html').body.textContent?.replace(/\s+/g, ' ').trim();
    if (text && !/^https?:\/\//i.test(text) && text.length <= 120) name = text;
  }
  return { url, name };
}

const HOVER = 'drop-target';

/**
 * A list as drop target for links (laptop: drag a tab or a link onto the list):
 * onto an entry without link → the entry gets the link; onto an entry with a link → after asking, it is replaced;
 * onto free space → a new entry, named after the dragged link's text or the page title.
 * Entries are found by their `data-item-id`.
 */
export function useLinkDrop(listId: string, items: ItemRow[]) {
  const hovered = useRef<Element | null>(null);
  const section = useRef<Element | null>(null);

  const mark = (el: Element | null, area: Element | null) => {
    if (hovered.current !== el) {
      hovered.current?.classList.remove(HOVER);
      el?.classList.add(HOVER);
      hovered.current = el;
    }
    if (section.current !== area) {
      section.current?.classList.remove('listview--drop');
      area?.classList.add('listview--drop');
      section.current = area;
    }
  };
  const target = (e: React.DragEvent) => (e.target as Element).closest?.('[data-item-id]') ?? null;
  // Into the input field (or an open dialog) a link drops as text, as usual.
  const ownDrop = (e: React.DragEvent) => !!(e.target as Element).closest?.('input, textarea, dialog');

  return {
    onDragOver: (e: React.DragEvent<HTMLElement>) => {
      if (!mayBeLink(e.dataTransfer) || ownDrop(e)) return mark(null, null);
      e.preventDefault();
      e.dataTransfer.dropEffect = 'link';
      const tile = target(e);
      mark(tile, tile ? null : e.currentTarget);
    },
    onDragLeave: (e: React.DragEvent<HTMLElement>) => {
      // Only when leaving the list itself (not when moving from one tile to the next).
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) mark(null, null);
    },
    onDrop: (e: React.DragEvent<HTMLElement>) => {
      const tile = target(e);
      mark(null, null);
      if (ownDrop(e)) return;
      const link = droppedLink(e.dataTransfer);
      if (!link) return;
      e.preventDefault();
      const item = tile ? items.find((i) => i.id === tile.getAttribute('data-item-id')) : undefined;
      if (item) {
        const current = itemUrl(item);
        if (current === link.url) return;
        if (current && !confirm(`„${item.name}“ hat schon einen Link:\n${current}\n\nDurch den neuen ersetzen?`)) return;
        void updateItem(item.id, { attributes: withUrl(item.attributes, link.url) });
        return;
      }
      void addLink(listId, link.url, link.name);
    },
  };
}
