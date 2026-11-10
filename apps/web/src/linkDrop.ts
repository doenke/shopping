import { findUrl, itemUrl, withUrl, type ItemRow } from '@shopping/shared';
import { useEffect, useRef } from 'react';
import { selection } from './selection';
import { addFileEntries, addLink, updateItem } from './actions';
import { attachFiles } from './files';

/** Files from the desktop, the file manager or a mail program. */
export const hasFiles = (dt: DataTransfer | null): boolean => !!dt && dt.types.includes('Files');

/** The dragged thing carries something that may be a link (from a browser tab, the address bar, a page) – or files. */
function mayBeLink(dt: DataTransfer | null): boolean {
  return !!dt && (hasFiles(dt) || dt.types.includes('text/uri-list') || dt.types.includes('text/plain'));
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
 * A list as drop target for links and files (laptop: drag a tab, a link or a file onto the list):
 * a link onto an entry without link → the entry gets the link; onto an entry with a link → after asking, it is replaced;
 * onto free space → a new entry, named after the dragged link's text or the page title.
 * Files onto an entry are attached to it; onto free space each becomes a new entry named after the file.
 * Entries are found by their `data-item-id`.
 */
export function useLinkDrop(listId: string, items: ItemRow[]) {
  const hovered = useRef<Element | null>(null);
  const known = useRef(items);
  known.current = items;

  // Strg+V with files (a screenshot, files copied in the file manager): onto the marked or focused entry,
  // else each as a new entry. With the details open, they take it (see Attachments).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (!files.length || e.defaultPrevented || document.querySelector('.attachments')) return;
      const focused = (document.activeElement as HTMLElement | null)?.closest?.('[data-item-id]')?.getAttribute('data-item-id');
      const marked = [...selection()];
      const id = marked.length === 1 ? marked[0] : focused;
      e.preventDefault();
      if (id && known.current.some((i) => i.id === id)) void attachFiles(id, files);
      else void addFileEntries(listId, files);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [listId]);
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
      e.dataTransfer.dropEffect = hasFiles(e.dataTransfer) ? 'copy' : 'link';
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
      const files = Array.from(e.dataTransfer.files);
      if (files.length) {
        e.preventDefault();
        const id = tile?.getAttribute('data-item-id');
        if (id && items.some((i) => i.id === id)) void attachFiles(id, files);
        else void addFileEntries(listId, files);
        return;
      }
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
