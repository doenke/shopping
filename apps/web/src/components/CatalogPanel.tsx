import { useCustomCategories } from '../categories';
import { categoriesInOrder, type CatalogItem, type ItemRow, type ListType } from '@shopping/shared';
import { useMemo, useState } from 'react';
import { addItems, catalogToParsed } from '../actions';
import { useMe } from '../hooks';
import { Tile } from './Tile';

interface Props {
  listId: string;
  listType: ListType;
  catalog: CatalogItem[];
  items: ItemRow[];
}

/** Laptop: browse the catalog by category and add with one click. */
export function CatalogPanel({ listId, listType, catalog, items }: Props) {
  const me = useMe();
  const categories = categoriesInOrder(listType, me?.categoryOrder, useCustomCategories());
  const [category, setCategory] = useState(categories[0]!.id);
  const onList = useMemo(() => new Set(items.filter((i) => !i.checked && i.catalogItemId).map((i) => i.catalogItemId)), [items]);
  const shown = useMemo(
    () => catalog.filter((c) => !c.hidden && c.categoryId === category && (c.kind ?? 'shopping') === listType).sort((a, b) => a.name.localeCompare(b.name, 'de')),
    [catalog, category, listType],
  );

  return (
    <aside className="catalog-panel" aria-label="Katalog">
      <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Kategorie">
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <div className="tiles tiles--compact">
        {shown.map((c) => (
          <Tile
            key={c.id}
            item={{ name: c.name, categoryId: c.categoryId, catalogItemId: c.id, amounts: [], properties: [], note: null }}
            variant={onList.has(c.id) ? 'open' : 'suggestion'}
            onTap={() => void addItems(listId, [catalogToParsed(c)])}
          />
        ))}
        {shown.length === 0 && <p className="muted">Keine Artikel in dieser Kategorie.</p>}
      </div>
    </aside>
  );
}
