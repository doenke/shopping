import { itemSpecification, type ItemSource, type ParsedItem } from '@shopping/shared';
import { useEffect, useRef, useState } from 'react';
import { addItems, type NewItem } from '../actions';
import { ItemIcon } from './Tile';

interface Candidate extends ParsedItem {
  pantry: boolean;
  sources: string[];
}

interface RecipeHit {
  slug: string;
  name: string;
  servings: number | null;
}

async function api<T>(path: string): Promise<T> {
  const res = await fetch(path);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const b = body as { detail?: string; error?: string };
    throw new Error(b.detail ?? b.error ?? 'Mealie ist gerade nicht erreichbar');
  }
  return body as T;
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Next Monday to Sunday (or the current week from Saturday on). */
function nextWeek(): { from: string; to: string } {
  const d = new Date();
  const day = (d.getDay() + 6) % 7; // 0 = Monday
  const start = new Date(d);
  start.setDate(d.getDate() + (day >= 5 ? 7 - day : -day));
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { from: isoDate(start), to: isoDate(end) };
}

interface Props {
  listId: string;
  onClose: () => void;
}

/** "Aus Mealie hinzufügen": a recipe (with servings) or the meal plan, as a checklist. */
export function ImportDialog({ listId, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<'recipe' | 'plan'>('recipe');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<RecipeHit[]>([]);
  const [recipe, setRecipe] = useState<RecipeHit | null>(null);
  const [servings, setServings] = useState<number | null>(null);
  const [range, setRange] = useState(nextWeek);
  const [plan, setPlan] = useState<{ date: string; name: string }[] | null>(null);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => ref.current?.showModal(), []);

  // Recipe search, slightly debounced.
  useEffect(() => {
    if (tab !== 'recipe' || recipe) return;
    const t = setTimeout(() => {
      api<RecipeHit[]>(`/api/v1/integrations/mealie/recipes?q=${encodeURIComponent(query)}`)
        .then((r) => {
          setHits(r);
          setError(null);
        })
        .catch((e: Error) => setError(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [query, tab, recipe]);

  const show = (items: Candidate[]) => {
    setCandidates(items);
    setSelected(new Set(items.map((c, i) => (c.pantry ? -1 : i)).filter((i) => i >= 0)));
  };

  const load = async (fn: () => Promise<void>) => {
    setLoading(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const loadRecipe = (r: RecipeHit, n: number | null) =>
    load(async () => {
      const res = await api<{ servings: number | null; items: Candidate[] }>(
        `/api/v1/integrations/mealie/recipes/${encodeURIComponent(r.slug)}${n ? `?servings=${n}` : ''}`,
      );
      setServings(res.servings);
      show(res.items);
    });

  const loadPlan = () =>
    load(async () => {
      const res = await api<{ recipes: { date: string; name: string }[]; items: Candidate[] }>(
        `/api/v1/integrations/mealie/mealplan?from=${range.from}&to=${range.to}`,
      );
      setPlan(res.recipes);
      show(res.items);
    });

  const submit = async () => {
    if (!candidates) return;
    const type: ItemSource['type'] = tab === 'plan' ? 'mealie_mealplan' : 'mealie_recipe';
    const chosen: NewItem[] = candidates
      .filter((_, i) => selected.has(i))
      .map(({ pantry: _p, sources, ...p }) => ({ ...p, sources: sources.map((label) => ({ type, label })) }));
    await addItems(listId, chosen);
    ref.current?.close();
  };

  const toggle = (i: number) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <dialog ref={ref} className="sheet sheet--tall" onClose={onClose}>
      <div className="sheet__body">
        <header className="sheet__header row">
          <h2 className="spacer">Aus Mealie</h2>
          <button type="button" className="icon-btn" aria-label="Schließen" onClick={() => ref.current?.close()}>
            ✕
          </button>
        </header>

        <div className="tabs" role="tablist">
          {(['recipe', 'plan'] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              className={`tab${tab === t ? ' tab--on' : ''}`}
              onClick={() => {
                setTab(t);
                setCandidates(null);
                setRecipe(null);
                setPlan(null);
              }}
            >
              {t === 'recipe' ? 'Rezept' : 'Wochenplan'}
            </button>
          ))}
        </div>

        {error && <p className="error">{error}</p>}

        {tab === 'recipe' && !recipe && (
          <>
            <input className="input" type="search" placeholder="Rezept suchen …" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
            <ul className="pick-list">
              {hits.map((h) => (
                <li key={h.slug}>
                  <button
                    type="button"
                    onClick={() => {
                      setRecipe(h);
                      void loadRecipe(h, h.servings);
                    }}
                  >
                    {h.name}
                    {h.servings && <span className="muted"> · {h.servings} Portionen</span>}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {tab === 'recipe' && recipe && (
          <div className="row row--center">
            <button type="button" className="link" onClick={() => (setRecipe(null), setCandidates(null))}>
              ‹ Suche
            </button>
            <strong className="spacer">{recipe.name}</strong>
            {servings !== null && (
              <span className="stepper" aria-label="Portionen">
                <button type="button" onClick={() => servings > 1 && void loadRecipe(recipe, servings - 1)}>
                  −
                </button>
                <span>{servings} P.</span>
                <button type="button" onClick={() => void loadRecipe(recipe, servings + 1)}>
                  +
                </button>
              </span>
            )}
          </div>
        )}

        {tab === 'plan' && (
          <div className="row row--center">
            <input className="input input--date" type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} aria-label="Von" />
            <span>bis</span>
            <input className="input input--date" type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} aria-label="Bis" />
            <button type="button" className="btn" onClick={() => void loadPlan()} disabled={loading}>
              Laden
            </button>
          </div>
        )}
        {plan && <p className="muted">{plan.length ? plan.map((p) => p.name).join(' · ') : 'Keine Rezepte in diesem Zeitraum.'}</p>}

        {loading && <p className="muted">Lade …</p>}

        {candidates && (
          <>
            <ul className="checklist">
              {candidates.map((c, i) => (
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
              <span className="spacer" />
              <button type="button" className="btn btn--primary" disabled={selected.size === 0} onClick={() => void submit()}>
                {selected.size} Artikel hinzufügen
              </button>
            </footer>
          </>
        )}
      </div>
    </dialog>
  );
}
