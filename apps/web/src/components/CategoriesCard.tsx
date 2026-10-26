import { CATEGORY_COLORS, categoriesFor, type CategoryRow, type CustomCategoryType } from '@shopping/shared';
import { useState } from 'react';
import { createCategory, editCategory } from '../actions';
import { useCustomCategories } from '../categories';
import { ItemIcon } from './Tile';

const TYPES: [CustomCategoryType, string][] = [
  ['packing', 'Packliste'],
  ['shopping', 'Einkauf'],
];

/** Own categories for shopping and packing lists, shared with the household. */
export function CategoriesCard() {
  const custom = useCustomCategories();
  const [type, setType] = useState<CustomCategoryType>('packing');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const own = custom.filter((c) => !c.deleted && c.listType === type).sort((a, b) => a.name.localeCompare(b.name, 'de'));

  const add = async () => {
    const n = name.trim();
    if (!n) return;
    if (categoriesFor(type, custom).some((c) => c.name.toLowerCase() === n.toLowerCase())) {
      setError(`„${n}“ gibt es schon.`);
      return;
    }
    setError(null);
    await createCategory(type, n);
    setName('');
  };

  return (
    <div className="card">
      <h2>Eigene Kategorien</h2>
      <p className="muted">
        Zusätzlich zu den eingebauten, für alle im Haushalt. Sie bekommen ein eigenes Icon und stehen vor „Sonstiges“; die Reihenfolge stellst du unter
        „Reihenfolge“ ein.
      </p>
      <div className="chips">
        {TYPES.map(([id, label]) => (
          <button key={id} type="button" className={`chip${type === id ? ' chip--on' : ''}`} onClick={() => setType(id)}>
            {label}
          </button>
        ))}
      </div>

      {own.length > 0 ? (
        <ul className="own-categories">
          {own.map((c) => (
            <CategoryRowEdit key={c.id} category={c} />
          ))}
        </ul>
      ) : (
        <p className="muted">Noch keine eigenen Kategorien für {type === 'packing' ? 'Packlisten' : 'Einkaufslisten'}.</p>
      )}

      <form
        className="new-category"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <input
          value={name}
          maxLength={40}
          placeholder={type === 'packing' ? 'z. B. Angeln, Camping, Baby' : 'z. B. Asia-Laden, Wochenmarkt'}
          aria-label="Name der neuen Kategorie"
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" className="btn btn--primary" disabled={!name.trim()}>
          Anlegen
        </button>
      </form>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function CategoryRowEdit({ category }: { category: CategoryRow }) {
  const [name, setName] = useState(category.name);
  const save = () => {
    const n = name.trim();
    if (!n) setName(category.name);
    else if (n !== category.name) void editCategory(category.id, { name: n });
  };
  const nextColor = () => {
    const i = CATEGORY_COLORS.findIndex((c) => c.toUpperCase() === category.color.toUpperCase());
    void editCategory(category.id, { color: CATEGORY_COLORS[(i + 1) % CATEGORY_COLORS.length]! });
  };
  const remove = () => {
    if (confirm(`Kategorie „${category.name}“ löschen? Ihre Einträge stehen danach unter „Sonstiges“.`)) void editCategory(category.id, { deleted: true });
  };

  return (
    <li>
      <ItemIcon name={category.name} categoryId={category.id} size="sm" />
      <input value={name} maxLength={40} aria-label="Name" onChange={(e) => setName(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
      <button type="button" className="own-categories__color" style={{ background: category.color }} aria-label="Farbe wechseln" title="Farbe wechseln" onClick={nextColor} />
      <button type="button" className="icon-btn" aria-label={`${category.name} löschen`} onClick={remove}>
        🗑
      </button>
    </li>
  );
}
