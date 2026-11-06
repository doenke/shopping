import { inUserOrder, itemSpecification, type ParsedItem } from '@shopping/shared';
import { useEffect, useRef, useState } from 'react';
import { addItems, type NewItem } from '../actions';
import { useLists, useMe } from '../hooks';
import { ItemIcon } from './Tile';

interface Candidate extends ParsedItem {
  pantry: boolean;
  sources: string[];
}

interface Recipe {
  name: string;
  url: string;
  image: string | null;
  servings: number | null;
  items: Candidate[];
}

/** A web address in a text ("Käsespätzle – chefkoch.de https://…" when shared from an app). */
export function findUrl(text: string): string | null {
  return /https?:\/\/[^\s<>"]+/i.exec(text)?.[0] ?? null;
}

interface Props {
  url: string;
  /** Shopping list preselected as target. */
  listId?: string;
  onClose: () => void;
}

/**
 * "Rezept aus dem Web": a recipe page (Chefkoch, Lecker, BBC Good Food …) read from its structured
 * data, the ingredients as a checklist – like importing a Mealie recipe.
 */
export function RecipeUrlDialog({ url, listId, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const me = useMe();
  const targets = inUserOrder(
    useLists().filter((l) => l.listType === 'shopping' && !l.isTemplate && !l.archivedAt),
    me?.listOrder,
    (l) => l.id,
  );
  const [targetId, setTargetId] = useState(listId ?? me?.defaultListId ?? '');
  const target = targets.find((l) => l.id === targetId) ?? targets.find((l) => l.id === me?.defaultListId) ?? targets[0];
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => ref.current?.showModal(), []);

  const load = async (servings?: number | null) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/recipes/from-url?url=${encodeURIComponent(url)}${servings ? `&servings=${servings}` : ''}`);
      const body = (await res.json().catch(() => ({}))) as Recipe & { detail?: string };
      if (!res.ok) throw new Error(body.detail ?? 'Das Rezept ließ sich nicht laden');
      // A new number of servings keeps what was ticked off.
      if (!recipe) setSelected(new Set(body.items.map((c, i) => (c.pantry ? -1 : i)).filter((i) => i >= 0)));
      setRecipe(body);
    } catch (e) {
      setError((e as Error).message === 'Failed to fetch' ? 'Zum Laden eines Rezepts wird eine Verbindung gebraucht.' : (e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => void load(), [url]);

  const toggle = (i: number) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const submit = async () => {
    if (!recipe || !target) return;
    const chosen: NewItem[] = recipe.items
      .filter((_, i) => selected.has(i))
      .map(({ pantry: _p, sources, ...p }) => ({ ...p, sources: sources.map((label) => ({ type: 'recipe' as const, label })) }));
    await addItems(target.id, chosen);
    ref.current?.close();
  };

  return (
    <dialog ref={ref} className="sheet sheet--tall" onClose={onClose}>
      <div className="sheet__body">
        <header className="sheet__header row">
          <h2 className="spacer">Rezept übernehmen</h2>
          <button type="button" className="icon-btn" aria-label="Schließen" onClick={() => ref.current?.close()}>
            ✕
          </button>
        </header>

        {error && (
          <>
            <p className="error">{error}</p>
            <p className="muted">
              Gelesen werden die Rezeptdaten, die Seiten wie Chefkoch, Lecker oder BBC Good Food für Suchmaschinen mitliefern. <br />
              <a href={url} target="_blank" rel="noreferrer">
                {url}
              </a>
            </p>
          </>
        )}
        {loading && !recipe && <p className="muted">Lese das Rezept …</p>}

        {recipe && (
          <>
            <div className="recipe-head">
              {recipe.image && (
                <img src={recipe.image} alt="" width={64} height={64} referrerPolicy="no-referrer" onError={(e) => (e.currentTarget.style.display = 'none')} />
              )}
              <div className="spacer">
                <strong>{recipe.name}</strong>
                <br />
                <a className="muted" href={recipe.url} target="_blank" rel="noreferrer">
                  {new URL(recipe.url).hostname.replace(/^www\./, '')}
                </a>
              </div>
              {recipe.servings !== null && (
                <span className="stepper" aria-label="Portionen">
                  <button type="button" disabled={loading} onClick={() => recipe.servings! > 1 && void load(recipe.servings! - 1)}>
                    −
                  </button>
                  <span>{recipe.servings} P.</span>
                  <button type="button" disabled={loading} onClick={() => void load(recipe.servings! + 1)}>
                    +
                  </button>
                </span>
              )}
            </div>

            <ul className="checklist">
              {recipe.items.map((c, i) => (
                <li key={i}>
                  <label>
                    <input type="checkbox" checked={selected.has(i)} onChange={() => toggle(i)} />
                    <ItemIcon name={c.name} categoryId={c.categoryId} catalogItemId={c.catalogItemId} size="sm" />
                    <span className="spacer">
                      {c.name}
                      <small className="muted"> {itemSpecification(c)}</small>
                      {c.pantry && <small className="muted"> · meist vorrätig</small>}
                    </span>
                  </label>
                </li>
              ))}
            </ul>

            <footer className="sheet__actions">
              {targets.length > 1 && (
                <select value={target?.id ?? ''} onChange={(e) => setTargetId(e.target.value)} aria-label="Einkaufsliste">
                  {targets.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.id === me?.defaultListId ? '⭐ ' : ''}
                      {l.name}
                    </option>
                  ))}
                </select>
              )}
              <span className="spacer" />
              <button type="button" className="btn btn--primary" disabled={selected.size === 0 || !target} onClick={() => void submit()}>
                {selected.size} Artikel hinzufügen
              </button>
            </footer>
          </>
        )}
      </div>
    </dialog>
  );
}
