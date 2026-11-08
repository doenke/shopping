import {
  asksForTemplates,
  CatalogIndex,
  extractPackingTokens,
  extractUrl,
  type ListRow,
  isOwnName,
  itemSpecification,
  parseInput,
  type CatalogItem,
  type ListType,
} from '@shopping/shared';
import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import { addItems, catalogToParsed, linkTitle, stopAskingForTemplates, templatesMissing, type NewItem } from '../actions';
import { useLists, useTileView } from '../hooks';
import { RecipeUrlDialog } from './RecipeUrlDialog';
import { Tile } from './Tile';

interface Props {
  listId: string;
  /** Decides which words count as properties ("bio" on a shopping list, "Handgepäck" on a packing list). */
  listType: ListType;
  index: CatalogIndex;
  /** Ranks frequently used items higher. */
  boost: (item: CatalogItem) => number;
  placeholder?: string;
}

/** One input for everything: "2 kg Kartoffeln", "Milch, Butter, 6 Eier" or a search. */
export const AddBar = forwardRef<HTMLInputElement, Props>(function AddBar({ listId, listType, index, boost, placeholder }, ref) {
  const [text, setText] = useState('');
  const parsed = useMemo(() => parseInput(text, index, listType), [text, index, listType]);
  const single = parsed.length === 1 ? parsed[0] : undefined;
  const hasAmount = !!single && (single.amounts.length > 0 || single.properties.length > 0 || !!single.note);
  // "@Anna" / "#Koffer" (packing lists) are not part of the search.
  const packing = useMemo(() => extractPackingTokens(text), [text]);
  const suggestions = useMemo(
    () => (packing.text && !text.includes(',') && !hasAmount && !/https?:\/\//i.test(text) ? index.search(packing.text, 12, boost) : []),
    [text, packing, index, boost, hasAmount],
  );

  // Lists made from templates: "auch in die Vorlage?" after adding (until "Nicht mehr fragen").
  const list = useLists().find((l) => l.id === listId);
  const [offer, setOffer] = useState<{ items: NewItem[]; templates: { template: ListRow; items: NewItem[] }[]; done: string[] } | null>(null);
  const add = async (items: NewItem[]) => {
    await addItems(listId, items);
    if (!list || list.isTemplate || !asksForTemplates(list)) return;
    // Several quick entries collect in one question.
    const all = [...(offer && offer.done.length === 0 ? offer.items : []), ...items.map(({ sources: _s, ...i }) => i)];
    const templates = await templatesMissing(list, all);
    setOffer(templates.length ? { items: all, templates, done: [] } : null);
  };
  const intoTemplate = async (t: { template: ListRow; items: NewItem[] }) => {
    if (!offer) return;
    await addItems(t.template.id, t.items);
    const done = [...offer.done, t.template.id];
    setOffer({ ...offer, done });
    if (done.length === offer.templates.length) setTimeout(() => setOffer((o) => (o && o.done.length === o.templates.length ? null : o)), 1500);
  };

  // A pasted list (several lines, e.g. ingredients copied from a recipe page): one item per line.
  const [block, setBlock] = useState<string | null>(null);
  const blockItems = useMemo(() => (block ? parseInput(block, index, listType) : []), [block, index, listType]);
  const addBlock = async () => {
    if (!blockItems.length) return;
    setBlock(null);
    await add(blockItems);
  };

  // A recipe link (Chefkoch & co.) on a shopping list: its ingredients, not the link as an item.
  // Only a link: on shopping lists a recipe; elsewhere (or with a name: "Kaffeemaschine https://…") an entry with link.
  const typedLink = extractUrl(text);
  const recipeLink = listType === 'shopping' && typedLink.url && !typedLink.text ? typedLink.url : null;
  const [recipeUrl, setRecipeUrl] = useState<string | null>(null);

  // Clear the field first, so fast typing never loses the next entry.
  const submit = async () => {
    if (block && !text.trim()) return addBlock();
    if (recipeLink) {
      setRecipeUrl(recipeLink);
      setText('');
      return;
    }
    if (parsed.length === 0) return;
    setText('');
    // A bare link gets the page's title as its name (the site's name if that fails).
    if (typedLink.url && !typedLink.text && parsed.length === 1) {
      const title = await linkTitle(typedLink.url);
      return add([{ ...parsed[0]!, name: title ?? parsed[0]!.name }]);
    }
    await add(parsed);
  };

  const pick = async (c: CatalogItem) => {
    setText('');
    await add([
      {
        ...catalogToParsed(c),
        person: packing.person,
        container: packing.container,
        ...(listType !== 'memo' && packing.persons.length >= 2 ? { persons: packing.persons } : {}),
        ...(listType !== 'memo' && packing.forEach ? { forEach: true } : {}),
      },
    ]);
  };

  // Voice input (Chrome/Android, Safari; not Firefox): what is said lands in the field, Enter or a tap adds it.
  const [listening, setListening] = useState(false);
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const Recognition = speechRecognition();
  useEffect(() => () => recognition.current?.abort(), []);
  const listen = () => {
    if (listening) return recognition.current?.stop();
    if (!Recognition) return;
    const r = new Recognition();
    r.lang = 'de-DE';
    r.interimResults = true;
    r.continuous = false;
    r.onresult = (e) => {
      const said = Array.from({ length: e.results.length }, (_, i) => e.results[i]![0]!.transcript).join(' ');
      // "Milch und Butter" are two things on shopping and packing lists ("Krieg und Frieden" on a Merkliste is one).
      setText(listType === 'shopping' || listType === 'packing' ? said.replace(/\s+und\s+/gi, ', ') : said);
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    recognition.current = r;
    setText('');
    setListening(true);
    r.start();
  };

  // Found only via a synonym or a guess ("Stirnlampe" → Taschenlampe): also offer exactly what was typed.
  const asTyped = useMemo(() => {
    if (!single?.catalogItemId) return undefined;
    const free = parseInput(text, NO_CATALOG, listType)[0];
    const match = index.match(free?.name ?? '');
    if (!free || (match && isOwnName(match, free.name)) || free.name.toLowerCase() === single.name.toLowerCase()) return undefined;
    return { ...free, categoryId: single.categoryId };
  }, [single, text, listType, index]);
  const addAsTyped = async () => {
    if (!asTyped) return;
    setText('');
    await addItems(listId, [asTyped]);
  };

  const freeText = single && !single.catalogItemId && !suggestions.some((s) => s.name.toLowerCase() === single.name.toLowerCase());

  return (
    <div className="addbar">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="addbar__field">
          <input
            ref={ref}
            type="search"
            enterKeyHint="done"
            autoComplete="off"
            placeholder={placeholder ?? 'Was brauchst du? z. B. 2 kg Kartoffeln'}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              // A single-line field would turn line breaks into spaces: keep the lines as a block.
              const pasted = e.clipboardData.getData('text');
              if (!/\n/.test(pasted.trim())) return;
              e.preventDefault();
              setBlock((b) => (b ? `${b}\n${pasted}` : pasted));
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') text ? setText('') : setBlock(null);
            }}
            aria-label="Artikel hinzufügen"
          />
          {Recognition && (
            <button
              type="button"
              className={`addbar__mic${listening ? ' addbar__mic--on' : ''}`}
              aria-label={listening ? 'Zuhören beenden' : 'Sprechen'}
              aria-pressed={listening}
              onClick={listen}
            >
              🎤
            </button>
          )}
        </div>
        {listType !== 'todo' && <ViewToggle />}
      </form>
      {offer && !text && !block && list && (
        <div className="addbar__results template-offer">
          <p>
            {offer.items.length === 1 ? `„${offer.items[0]!.name}“` : `${offer.items.length} neue Dinge`} auch in{' '}
            {offer.templates.length === 1 ? 'die Vorlage' : 'eine Vorlage'}?
          </p>
          <div className="chips">
            {offer.templates.map((t) => {
              const done = offer.done.includes(t.template.id);
              return (
                <button key={t.template.id} type="button" className={`chip${done ? ' chip--on' : ''}`} disabled={done} onClick={() => void intoTemplate(t)}>
                  {done ? '✓' : '◇'} {t.template.name}
                </button>
              );
            })}
          </div>
          <div className="row">
            <button type="button" className="link" onClick={() => setOffer(null)}>
              {offer.done.length ? 'Fertig' : 'Nein'}
            </button>
            <span className="spacer" />
            <button
              type="button"
              className="link muted"
              onClick={() => {
                setOffer(null);
                void stopAskingForTemplates(list);
              }}
            >
              Nicht mehr fragen
            </button>
          </div>
        </div>
      )}
      {block && (
        <div className="addbar__results addbar__block">
          <textarea
            value={block}
            onChange={(e) => setBlock(e.target.value || null)}
            rows={Math.min(10, block.split('\n').length)}
            aria-label="Eingefügte Liste"
          />
          <div className="row">
            <button type="button" className="btn btn--primary" disabled={!blockItems.length} onClick={() => void addBlock()}>
              {blockItems.length} Artikel hinzufügen
            </button>
            <button type="button" className="btn" onClick={() => setBlock(null)}>
              Verwerfen
            </button>
          </div>
          <p className="addbar__hint">{blockItems.map((p) => (itemSpecification(p) ? `${p.name} (${itemSpecification(p)})` : p.name)).join(', ')}</p>
        </div>
      )}
      {recipeUrl && <RecipeUrlDialog url={recipeUrl} listId={listId} onClose={() => setRecipeUrl(null)} />}
      {text.trim() && recipeLink && (
        <div className="addbar__results">
          <button type="button" className="addbar__multi" onClick={() => void submit()}>
            🍲 Rezept übernehmen: Zutaten von {new URL(recipeLink).hostname.replace(/^www\./, '')} auswählen …
          </button>
        </div>
      )}
      {text.trim() && !recipeLink && (
        <div className="addbar__results">
          {parsed.length > 1 && (
            <button type="button" className="addbar__multi" onClick={() => void submit()}>
              {parsed.length} Artikel hinzufügen: {parsed.map((p) => p.name).join(', ')}
            </button>
          )}
          <div className="tiles tiles--compact">
            {hasAmount && single && <Tile item={single} variant="suggestion" onTap={() => void submit()} />}
            {suggestions.map((c) => (
              <Tile
                key={c.id}
                item={{ name: c.name, categoryId: c.categoryId, catalogItemId: c.id, amounts: [], properties: [], note: null }}
                variant="suggestion"
                onTap={() => void pick(c)}
              />
            ))}
            {freeText && !hasAmount && <Tile item={single} variant="suggestion" badge="neu" onTap={() => void submit()} />}
            {asTyped && <Tile item={asTyped} variant="suggestion" onTap={() => void addAsTyped()} />}
          </div>
          {single && hasAmount && <p className="addbar__hint">Enter fügt „{[single.name, itemSpecification(single)].filter(Boolean).join(' · ')}“ hinzu</p>}
        </div>
      )}
    </div>
  );
});

const NO_CATALOG = new CatalogIndex([]);

/** The bits of the Web Speech API used here (not in TypeScript's DOM types everywhere). */
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

function speechRecognition(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Tiles ↔ rows, right next to the input (stays in reach while scrolling). Remembered per device. */
function ViewToggle() {
  const [view, setView] = useTileView();
  const rows = view === 'rows';
  return (
    <button
      type="button"
      className="addbar__view"
      aria-label={rows ? 'Als Kacheln anzeigen' : 'Als Liste anzeigen'}
      title={rows ? 'Als Kacheln anzeigen' : 'Als Liste anzeigen'}
      onClick={() => setView(rows ? 'tiles' : 'rows')}
    >
      <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden fill="currentColor">
        {rows ? (
          <>
            <rect x="2" y="2" width="7" height="7" rx="1.5" />
            <rect x="11" y="2" width="7" height="7" rx="1.5" />
            <rect x="2" y="11" width="7" height="7" rx="1.5" />
            <rect x="11" y="11" width="7" height="7" rx="1.5" />
          </>
        ) : (
          <>
            <rect x="2" y="3" width="4" height="4" rx="1" />
            <rect x="8" y="4" width="10" height="2" rx="1" />
            <rect x="2" y="8" width="4" height="4" rx="1" />
            <rect x="8" y="9" width="10" height="2" rx="1" />
            <rect x="2" y="13" width="4" height="4" rx="1" />
            <rect x="8" y="14" width="10" height="2" rx="1" />
          </>
        )}
      </svg>
    </button>
  );
}
