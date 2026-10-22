import { itemSpecification, parseInput, type CatalogIndex, type CatalogItem } from '@shopping/shared';
import { forwardRef, useMemo, useState } from 'react';
import { addItems, catalogToParsed } from '../actions';
import { Tile } from './Tile';

interface Props {
  listId: string;
  index: CatalogIndex;
  /** Ranks frequently used items higher. */
  boost: (item: CatalogItem) => number;
}

/** One input for everything: "2 kg Kartoffeln", "Milch, Butter, 6 Eier" or a search. */
export const AddBar = forwardRef<HTMLInputElement, Props>(function AddBar({ listId, index, boost }, ref) {
  const [text, setText] = useState('');
  const parsed = useMemo(() => parseInput(text, index), [text, index]);
  const single = parsed.length === 1 ? parsed[0] : undefined;
  const hasAmount = !!single && (single.amounts.length > 0 || single.properties.length > 0 || !!single.note);
  const suggestions = useMemo(
    () => (text.trim() && !text.includes(',') && !hasAmount ? index.search(text, 12, boost) : []),
    [text, index, boost, hasAmount],
  );

  // Clear the field first, so fast typing never loses the next entry.
  const submit = async () => {
    if (parsed.length === 0) return;
    setText('');
    await addItems(listId, parsed);
  };

  const pick = async (c: CatalogItem) => {
    setText('');
    await addItems(listId, [catalogToParsed(c)]);
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
          placeholder="Was brauchst du? z. B. 2 kg Kartoffeln"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setText('');
          }}
          aria-label="Artikel hinzufügen"
        />
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
                item={{ name: c.name, categoryId: c.categoryId, amounts: [], properties: [], note: null }}
                variant="suggestion"
                onTap={() => void pick(c)}
              />
            ))}
            {freeText && !hasAmount && <Tile item={single} variant="suggestion" badge="neu" onTap={() => void submit()} />}
          </div>
          {single && hasAmount && <p className="addbar__hint">Enter fügt „{[single.name, itemSpecification(single)].filter(Boolean).join(' · ')}“ hinzu</p>}
        </div>
      )}
    </div>
  );
});
