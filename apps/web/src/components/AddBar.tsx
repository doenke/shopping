import { CatalogIndex, extractPackingTokens, isOwnName, itemSpecification, parseInput, type CatalogItem, type ListType } from '@shopping/shared';
import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import { addItems, catalogToParsed } from '../actions';
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
    () => (packing.text && !text.includes(',') && !hasAmount ? index.search(packing.text, 12, boost) : []),
    [text, packing, index, boost, hasAmount],
  );

  // Clear the field first, so fast typing never loses the next entry.
  const submit = async () => {
    if (parsed.length === 0) return;
    setText('');
    await addItems(listId, parsed);
  };

  const pick = async (c: CatalogItem) => {
    setText('');
    await addItems(listId, [{ ...catalogToParsed(c), person: packing.person, container: packing.container }]);
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
        <input
          ref={ref}
          type="search"
          enterKeyHint="done"
          autoComplete="off"
          placeholder={placeholder ?? 'Was brauchst du? z. B. 2 kg Kartoffeln'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setText('');
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
      </form>
      {text.trim() && (
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
            {asTyped && <Tile item={asTyped} variant="suggestion" badge="so" onTap={() => void addAsTyped()} />}
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
