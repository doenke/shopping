import { CATEGORIES, formatAmount, SUGGESTED_PROPERTIES, UNITS, type Amount, type ItemRow, type UserInfo } from '@shopping/shared';
import { useEffect, useRef, useState } from 'react';
import { deleteItem, updateItem } from '../actions';
import { sync } from '../sync/engine';

interface Props {
  item: ItemRow;
  users: Map<string, UserInfo>;
  onClose: () => void;
}

function parseQuantity(s: string): number | null {
  const n = Number(s.replace(',', '.'));
  return s.trim() && Number.isFinite(n) && n > 0 ? n : null;
}

export function ItemEditor({ item, users, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const first = item.amounts[0];
  const [name, setName] = useState(item.name);
  const [quantity, setQuantity] = useState(first?.q != null ? String(first.q).replace('.', ',') : '');
  const [unit, setUnit] = useState(first?.u ?? '');
  const [properties, setProperties] = useState(item.properties);
  const [custom, setCustom] = useState('');
  const [note, setNote] = useState(item.note ?? '');
  const [categoryId, setCategoryId] = useState(item.categoryId ?? 'eigene');
  const [forAll, setForAll] = useState(false);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const toggle = (p: string) => setProperties((ps) => (ps.includes(p) ? ps.filter((x) => x !== p) : [...ps, p]));

  const save = async () => {
    const q = parseQuantity(quantity);
    const amount: Amount | null = q !== null || unit ? { q, u: unit || null } : null;
    const amounts = [...(amount ? [amount] : []), ...item.amounts.slice(1)];
    await updateItem(item.id, {
      name: name.trim() || item.name,
      amounts,
      properties,
      note: note.trim() || null,
      categoryId,
    });
    if (forAll && item.catalogItemId && categoryId !== item.categoryId) {
      await fetch(`/api/v1/catalog/${item.catalogItemId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ categoryId }),
      }).catch(() => undefined);
      void sync.refreshCatalog();
    }
    onClose();
  };

  const allProps = [...new Set([...SUGGESTED_PROPERTIES, ...item.properties, ...properties])];
  const checkedBy = item.checkedBy ? users.get(item.checkedBy)?.displayName : undefined;
  const createdBy = item.createdBy ? users.get(item.createdBy)?.displayName : undefined;

  return (
    <dialog ref={ref} className="sheet" onClose={onClose} onClick={(e) => e.target === ref.current && ref.current?.close()}>
      <form
        method="dialog"
        className="sheet__body"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <header className="sheet__header">
          <input className="sheet__title" value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" />
        </header>

        <label className="field">
          <span>Menge</span>
          <div className="field__row">
            <input inputMode="decimal" placeholder="–" value={quantity} onChange={(e) => setQuantity(e.target.value)} aria-label="Menge" />
            <select value={unit} onChange={(e) => setUnit(e.target.value)} aria-label="Einheit">
              <option value="">Stück / ohne</option>
              {UNITS.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
          {item.amounts.length > 1 && <small>Dazu: {item.amounts.slice(1).map(formatAmount).join(' + ')}</small>}
        </label>

        <div className="field">
          <span>Eigenschaften</span>
          <div className="chips">
            {allProps.map((p) => (
              <button type="button" key={p} className={`chip${properties.includes(p) ? ' chip--on' : ''}`} onClick={() => toggle(p)}>
                {p}
              </button>
            ))}
            <input
              className="chip chip--input"
              placeholder="+ eigene"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && custom.trim()) {
                  e.preventDefault();
                  if (!properties.includes(custom.trim())) setProperties([...properties, custom.trim()]);
                  setCustom('');
                }
              }}
            />
          </div>
        </div>

        <label className="field">
          <span>Notiz</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="z. B. die von Oma" />
        </label>

        <label className="field">
          <span>Kategorie</span>
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {item.catalogItemId && categoryId !== (item.categoryId ?? 'eigene') && (
            <label className="check">
              <input type="checkbox" checked={forAll} onChange={(e) => setForAll(e.target.checked)} /> für diesen Artikel immer verwenden
            </label>
          )}
        </label>

        <p className="sheet__meta">
          {createdBy && <>Hinzugefügt von {createdBy}. </>}
          {item.checked && checkedBy && <>Gekauft von {checkedBy}.</>}
        </p>

        <footer className="sheet__actions">
          <button
            type="button"
            className="btn btn--danger"
            onClick={() => {
              void deleteItem(item.id);
              onClose();
            }}
          >
            Entfernen
          </button>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button type="submit" className="btn btn--primary">
            Speichern
          </button>
        </footer>
      </form>
    </dialog>
  );
}
