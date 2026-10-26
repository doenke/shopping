import {
  attributeLabels,
  categoriesFor,
  categoryInList,
  dueOf,
  formatAmount,
  packingInfo,
  suggestedProperties,
  UNITS,
  withPacking,
  type Amount,
  type ItemRow,
  type ItemSource,
  type ListRow,
  type ListType,
  type UserInfo,
} from '@shopping/shared';
import { useEffect, useRef, useState } from 'react';
import { deleteItem, updateItem } from '../actions';
import { useMe } from '../hooks';
import { Avatar } from './Avatar';
import { sync } from '../sync/engine';

interface Props {
  item: ItemRow;
  users: Map<string, UserInfo>;
  list: ListRow;
  /** The other items of the list, for person/Packstück suggestions. */
  items?: ItemRow[];
  onClose: () => void;
}

/** Sets or removes the due date (undefined: leave as is). */
function withDue(attributes: Record<string, unknown>, due: string | undefined): Record<string, unknown> {
  if (due === undefined) return attributes;
  const next = { ...attributes };
  if (due) next.due = due;
  else delete next.due;
  return next;
}

const NOTE_EXAMPLE: Record<ListType, string> = {
  shopping: 'z. B. die von Oma',
  packing: 'z. B. liegt im Keller',
  memo: 'z. B. ab Staffel 2',
  todo: 'z. B. Schrauben liegen in der Garage',
};

function parseQuantity(s: string): number | null {
  const n = Number(s.replace(',', '.'));
  return s.trim() && Number.isFinite(n) && n > 0 ? n : null;
}

export function ItemEditor({ item, list, items = [], users, onClose }: Props) {
  const isTemplate = list.isTemplate;
  const packing = list.listType === 'packing';
  const todo = list.listType === 'todo';
  // Merk- and ToDo lists: no amounts, no categories.
  const memo = list.listType === 'memo' || todo;
  const labels = attributeLabels(list.listType);
  const categories = categoriesFor(list.listType);
  const ref = useRef<HTMLDialogElement>(null);
  const first = item.amounts[0];
  const [name, setName] = useState(item.name);
  const [quantity, setQuantity] = useState(first?.q != null ? String(first.q).replace('.', ',') : '');
  const [unit, setUnit] = useState(first?.u ?? '');
  const [properties, setProperties] = useState(item.properties);
  const [custom, setCustom] = useState('');
  const [note, setNote] = useState(item.note ?? '');
  const [categoryId, setCategoryId] = useState(categoryInList(item.categoryId, list.listType).id);
  const [person, setPerson] = useState(packingInfo(item).person ?? '');
  const [container, setContainer] = useState(packingInfo(item).container ?? '');
  const [due, setDue] = useState(dueOf(item) ?? '');
  const [forAll, setForAll] = useState(false);
  const [optional, setOptional] = useState(item.optional);
  const [reported, setReported] = useState<'idle' | 'done' | 'error'>('idle');
  const me = useMe();

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
      ...(isTemplate ? { optional } : {}),
      ...(labels ? { attributes: withDue(withPacking(item.attributes, { person, container }), todo ? due : undefined) } : {}),
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

  const allProps = [...new Set([...suggestedProperties(list.listType), ...item.properties, ...properties])];
  const sources = Array.isArray(item.attributes.sources) ? (item.attributes.sources as ItemSource[]) : [];
  const checkedBy = item.checkedBy ? users.get(item.checkedBy) : undefined;
  const createdBy = item.createdBy ? users.get(item.createdBy) : undefined;

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

        {!memo && (
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
        )}

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
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={NOTE_EXAMPLE[list.listType]} />
        </label>

        {todo && (
          <label className="field">
            <span>Fällig am</span>
            <div className="field__row">
              <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
              {due && (
                <button type="button" className="link" onClick={() => setDue('')}>
                  kein Datum
                </button>
              )}
            </div>
          </label>
        )}

        {labels && (
          <div className="field__row">
            <label className="field">
              <span>{labels.person}</span>
              <input value={person} onChange={(e) => setPerson(e.target.value)} list="packing-people" placeholder={todo ? 'z. B. Anna' : memo ? 'z. B. Ben' : 'alle'} />
            </label>
            <label className="field">
              <span>{labels.container}</span>
              <input
                value={container}
                onChange={(e) => setContainer(e.target.value)}
                list="packing-containers"
                placeholder={todo ? 'z. B. Garten' : memo ? 'z. B. Netflix' : 'z. B. Koffer'}
              />
            </label>
            <datalist id="packing-people">
              {[...new Set(items.map((i) => packingInfo(i).person).filter(Boolean))].map((p) => (
                <option key={p} value={p!} />
              ))}
            </datalist>
            <datalist id="packing-containers">
              {[...new Set(items.map((i) => packingInfo(i).container).filter(Boolean))].map((c) => (
                <option key={c} value={c!} />
              ))}
            </datalist>
          </div>
        )}

        {!memo && (
          <label className="field">
            <span>Kategorie</span>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {item.catalogItemId && categoryId !== categoryInList(item.categoryId, list.listType).id && (
              <label className="check">
                <input type="checkbox" checked={forAll} onChange={(e) => setForAll(e.target.checked)} /> für diesen Artikel immer verwenden
              </label>
            )}
          </label>
        )}

        {isTemplate && (
          <label className="check field">
            <input type="checkbox" checked={optional} onChange={(e) => setOptional(e.target.checked)} /> optional – beim Übernehmen erst einmal
            abgewählt
          </label>
        )}

        {sources.length > 0 && <p className="sources">Für: {sources.map((s) => s.label).join(', ')}</p>}

        <p className="sheet__meta">
          {createdBy && (
            <>
              Hinzugefügt von <Avatar user={createdBy} size="xs" /> {createdBy.displayName}
              {typeof item.attributes.via === 'string' && <> über {item.attributes.via}</>}.{' '}
            </>
          )}
          {item.checked && checkedBy && (
            <>
              {packing ? 'Eingepackt von' : 'Gekauft von'} <Avatar user={checkedBy} size="xs" /> {checkedBy.displayName}.
            </>
          )}
        </p>

        {item.catalogItemId && me && !me.isGuest && (
          <p className="sheet__meta">
            {reported === 'idle' ? (
              <button
                type="button"
                className="link"
                onClick={() => {
                  fetch(`/api/v1/catalog/${item.catalogItemId}/icon-report`, {
                    method: 'POST',
                  })
                    .then((res) => setReported(res.ok ? 'done' : 'error'))
                    .catch(() => setReported('error'));
                }}
              >
                Icon gefällt mir nicht
              </button>
            ) : reported === 'done' ? (
              'Danke – neue Entwürfe kommen in die Icon-Prüfung.'
            ) : (
              'Das ging gerade nicht (offline?).'
            )}
          </p>
        )}

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
