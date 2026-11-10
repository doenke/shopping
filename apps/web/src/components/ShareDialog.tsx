import { extractUrl, findUrl, inUserOrder, linkLabel, parseInput, type CatalogIndex, type ListRow } from '@shopping/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { addItems, addLink, linkTitle } from '../actions';
import { db } from '../db';
import { attachFiles } from '../files';
import { navigate, useLists, useMe } from '../hooks';
import { LIST_TYPE_LABEL } from './NewListDialog';

export interface Shared {
  title: string | null;
  text: string | null;
  url: string | null;
  /** Id of shared files waiting in `db.shared` (put there by the service worker). */
  files?: string | null;
}

/** What another app shared ("Teilen → Shopping"), from the start URL. */
export function readShared(search: string): Shared | null {
  const p = new URLSearchParams(search);
  const title = p.get('share_title')?.trim() || null;
  const text = p.get('share_text')?.trim() || null;
  const url = p.get('share_url')?.trim() || null;
  const files = p.get('share_files')?.trim() || null;
  return title || text || url || files ? { title, text, url, files } : null;
}

const LAST_TARGET = 'share-target';

type Kind = 'link' | 'text' | 'files';

function lastTarget(kind: Kind): string | null {
  try {
    return localStorage.getItem(`${LAST_TARGET}:${kind}`);
  } catch {
    return null;
  }
}

function rememberTarget(kind: Kind, id: string): void {
  try {
    localStorage.setItem(`${LAST_TARGET}:${kind}`, id);
  } catch {
    // Only a convenience.
  }
}

interface Props {
  shared: Shared;
  index: CatalogIndex;
  /** Recipe link onto a shopping list: read its ingredients instead. */
  onRecipe: (url: string, listId: string) => void;
  onClose: () => void;
}

/**
 * Shared from another app: which list, under which name. A link becomes an entry with 🔗
 * (Merklisten first – films, books, restaurants), plain text becomes items as if typed.
 * Photos and files become one entry with all of them attached (plus the link, if one came along).
 */
export function ShareDialog({ shared, index, onRecipe, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const me = useMe();
  // Many apps put the link into the text ("Schau mal: https://…").
  const url = shared.url ?? findUrl(shared.text ?? '');
  const textWithoutLink = shared.text ? extractUrl(shared.text).text : '';
  const sharedFiles = useLiveQuery(async () => (shared.files ? ((await db.shared.get(shared.files))?.files ?? []) : []), [shared.files]);
  const files = sharedFiles ?? [];
  const kind: Kind = shared.files ? 'files' : url ? 'link' : 'text';
  const firstFileName = files[0]?.name.replace(/\.[a-z0-9]{1,5}$/i, '') ?? '';
  const lists = inUserOrder(
    useLists().filter((l) => !l.isTemplate && !l.archivedAt),
    me?.listOrder,
    (l) => l.id,
  );
  const fallback =
    (kind === 'link' ? lists.find((l) => l.listType === 'memo') : kind === 'files' ? lists.find((l) => l.listType === 'todo') : undefined) ??
    lists.find((l) => l.id === me?.defaultListId) ??
    lists[0];
  const [targetId, setTargetId] = useState<string | null>(null);
  const target: ListRow | undefined = lists.find((l) => l.id === (targetId ?? lastTarget(kind))) ?? fallback;
  const [name, setName] = useState(url || shared.files ? (shared.title ?? textWithoutLink) : '');
  const [loadingTitle, setLoadingTitle] = useState(false);

  useEffect(() => ref.current?.showModal(), []);
  // A link without a name: the page's title.
  useEffect(() => {
    if (!url || shared.files || name.trim()) return;
    setLoadingTitle(true);
    void linkTitle(url)
      .then((t) => setName((n) => n || t || linkLabel(url)))
      .finally(() => setLoadingTitle(false));
  }, [url]);

  const text = [shared.title, shared.text].filter(Boolean).join(' ');
  const items = useMemo(
    () => (url || shared.files || !target ? [] : parseInput(text, index, target.listType)),
    [url, shared.files, text, index, target?.listType],
  );

  const submit = async () => {
    if (!target) return;
    rememberTarget(kind, target.id);
    if (kind === 'files') {
      const title = name.trim() || firstFileName || 'Datei';
      const [change] = await addItems(target.id, [
        { name: title, catalogItemId: null, categoryId: null, amounts: [], properties: [], note: null, ...(url ? { url } : {}) },
      ]);
      if (change)
        await attachFiles(
          change.id,
          files.map((f) => new File([f.blob], f.name, { type: f.type })),
        );
      await db.shared.delete(shared.files!);
    } else if (url) await addLink(target.id, url, name);
    else if (items.length) await addItems(target.id, items);
    navigate({ page: 'list', listId: target.id });
    ref.current?.close();
  };

  return (
    <dialog ref={ref} className="sheet" onClose={onClose}>
      <form
        className="sheet__body"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <header className="sheet__header row">
          <h2 className="spacer">Hinzufügen</h2>
          <button type="button" className="icon-btn" aria-label="Schließen" onClick={() => ref.current?.close()}>
            ✕
          </button>
        </header>

        {kind === 'files' ? (
          <>
            <label className="field">
              <span>Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder={firstFileName || 'Name des Eintrags'} />
            </label>
            <p className="muted share__link">
              {sharedFiles && !files.length
                ? 'Die geteilten Dateien sind nicht mehr da.'
                : files.map((f) => `${/^image\//.test(f.type) ? '🖼' : '📄'} ${f.name}`).join(' · ')}
            </p>
          </>
        ) : url ? (
          <>
            <label className="field">
              <span>Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder={loadingTitle ? 'Lese den Titel der Seite …' : linkLabel(url)} />
            </label>
            <p className="muted share__link">
              🔗{' '}
              <a href={url} target="_blank" rel="noopener noreferrer">
                {url}
              </a>
            </p>
          </>
        ) : (
          <p className="share__text">
            {items.length ? items.map((i) => i.name).join(', ') : text}
            <small className="muted"> – {items.length === 1 ? '1 Eintrag' : `${items.length} Einträge`}</small>
          </p>
        )}

        <label className="field">
          <span>Auf die Liste</span>
          <select value={target?.id ?? ''} onChange={(e) => setTargetId(e.target.value)}>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {LIST_TYPE_LABEL[l.listType].split(' ')[0]} {l.name}
                {l.id === me?.defaultListId ? ' ⭐' : ''}
              </option>
            ))}
          </select>
        </label>

        <footer className="sheet__actions">
          {url && kind === 'link' && target?.listType === 'shopping' && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                onRecipe(url, target.id);
                ref.current?.close();
              }}
            >
              🍳 Zutaten aus dem Rezept
            </button>
          )}
          <span className="spacer" />
          <button type="submit" className="btn btn--primary" disabled={!target || (kind === 'files' ? !files.length : !url && !items.length)}>
            {kind === 'files' ? 'Mit Anhang hinzufügen' : url ? 'Mit Link hinzufügen' : 'Hinzufügen'}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
