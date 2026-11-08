import { extractUrl, findUrl, inUserOrder, linkLabel, parseInput, type CatalogIndex, type ListRow } from '@shopping/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { addItems, addLink, linkTitle } from '../actions';
import { navigate, useLists, useMe } from '../hooks';
import { LIST_TYPE_LABEL } from './NewListDialog';

export interface Shared {
  title: string | null;
  text: string | null;
  url: string | null;
}

/** What another app shared ("Teilen → Shopping"), from the start URL. */
export function readShared(search: string): Shared | null {
  const p = new URLSearchParams(search);
  const title = p.get('share_title')?.trim() || null;
  const text = p.get('share_text')?.trim() || null;
  const url = p.get('share_url')?.trim() || null;
  return title || text || url ? { title, text, url } : null;
}

const LAST_TARGET = 'share-target';

function lastTarget(withLink: boolean): string | null {
  try {
    return localStorage.getItem(`${LAST_TARGET}:${withLink ? 'link' : 'text'}`);
  } catch {
    return null;
  }
}

function rememberTarget(withLink: boolean, id: string): void {
  try {
    localStorage.setItem(`${LAST_TARGET}:${withLink ? 'link' : 'text'}`, id);
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
 */
export function ShareDialog({ shared, index, onRecipe, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const me = useMe();
  // Many apps put the link into the text ("Schau mal: https://…").
  const url = shared.url ?? findUrl(shared.text ?? '');
  const textWithoutLink = shared.text ? extractUrl(shared.text).text : '';
  const lists = inUserOrder(
    useLists().filter((l) => !l.isTemplate && !l.archivedAt),
    me?.listOrder,
    (l) => l.id,
  );
  const fallback = (url ? lists.find((l) => l.listType === 'memo') : undefined) ?? lists.find((l) => l.id === me?.defaultListId) ?? lists[0];
  const [targetId, setTargetId] = useState<string | null>(null);
  const target: ListRow | undefined = lists.find((l) => l.id === (targetId ?? lastTarget(!!url))) ?? fallback;
  const [name, setName] = useState(url ? (shared.title ?? textWithoutLink) : '');
  const [loadingTitle, setLoadingTitle] = useState(false);

  useEffect(() => ref.current?.showModal(), []);
  // A link without a name: the page's title.
  useEffect(() => {
    if (!url || name.trim()) return;
    setLoadingTitle(true);
    void linkTitle(url)
      .then((t) => setName((n) => n || t || linkLabel(url)))
      .finally(() => setLoadingTitle(false));
  }, [url]);

  const text = [shared.title, shared.text].filter(Boolean).join(' ');
  const items = useMemo(() => (url || !target ? [] : parseInput(text, index, target.listType)), [url, text, index, target?.listType]);

  const submit = async () => {
    if (!target) return;
    rememberTarget(!!url, target.id);
    if (url) await addLink(target.id, url, name);
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

        {url ? (
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
          {url && target?.listType === 'shopping' && (
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
          <button type="submit" className="btn btn--primary" disabled={!target || (!url && !items.length)}>
            {url ? 'Mit Link hinzufügen' : 'Hinzufügen'}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
