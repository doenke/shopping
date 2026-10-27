import {
  attributeLabels,
  inUserOrder,
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
import { addItems, createCategory, deleteItem, itemToNew, updateItem } from '../actions';
import { useCustomCategories } from '../categories';
import { useCatalog, useLists, useMe } from '../hooks';
import { Avatar } from './Avatar';
import { IconCheck } from './IconCheck';
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

const NEW_CATEGORY = '__new__';

export function ItemEditor({ item, list, items = [], users, onClose }: Props) {
  const isTemplate = list.isTemplate;
  const packing = list.listType === 'packing';
  const todo = list.listType === 'todo';
  // Merk- and ToDo lists: no amounts, no categories.
  const memo = list.listType === 'memo' || todo;
  const labels = attributeLabels(list.listType);
  const customCategories = useCustomCategories();
  const categories = categoriesFor(list.listType, customCategories);
  /** Name of a category being created right here ("+ Neue Kategorie …"); null = not creating. */
  const [newCategory, setNewCategory] = useState<string | null>(null);
  const canCreateCategory = list.listType === 'shopping' || list.listType === 'packing';
  const ref = useRef<HTMLDialogElement>(null);
  const first = item.amounts[0];
  const [name, setName] = useState(item.name);
  const [quantity, setQuantity] = useState(first?.q != null ? String(first.q).replace('.', ',') : '');
  const [unit, setUnit] = useState(first?.u ?? '');
  const [properties, setProperties] = useState(item.properties);
  const [custom, setCustom] = useState('');
  const [note, setNote] = useState(item.note ?? '');
  const [categoryId, setCategoryId] = useState(categoryInList(item.categoryId, list.listType, customCategories).id);
  const [person, setPerson] = useState(packingInfo(item).person ?? '');
  const [container, setContainer] = useState(packingInfo(item).container ?? '');
  const [due, setDue] = useState(dueOf(item) ?? '');
  // The date field only shows once a task has (or gets) a due date.
  const [showDue, setShowDue] = useState(!!dueOf(item));
  const [forAll, setForAll] = useState(false);
  const [optional, setOptional] = useState(item.optional);
  const [reported, setReported] = useState<'idle' | 'done' | 'error'>('idle');
  const me = useMe();
  const guest = !me || me.isGuest;

  // Packing lists, "Auf Einkaufsliste setzen": as the grocery catalog item where there is one (with its category).
  const allLists = useLists();
  const shoppingLists = inUserOrder(
    allLists.filter((l) => l.listType === 'shopping' && !l.isTemplate && !l.archivedAt),
    me?.listOrder,
    (l) => l.id,
  );
  const groceries = useCatalog().index;
  const [toShopping, setToShopping] = useState<string | null>(null);
  const [shoppingDone, setShoppingDone] = useState<string | null>(null);
  const putOnShopping = async () => {
    const target = shoppingLists.find((l) => l.id === toShopping);
    if (!target) return;
    const n = name.trim() || item.name;
    const hit = groceries.match(n, false);
    await addItems(target.id, [
      {
        name: hit?.name ?? n,
        catalogItemId: hit?.id ?? null,
        categoryId: hit?.categoryId ?? null,
        amounts: item.amounts,
        properties: [],
        note: null,
        sources: [{ type: 'list', label: list.name }],
      },
    ]);
    setShoppingDone(target.name);
  };

  // "Auf Vorlage setzen": the list's own template first (the one "Mit Vorlage abgleichen" remembers).
  const templates = allLists.filter((l) => l.isTemplate && l.listType === list.listType);
  const rememberedTemplate =
    typeof list.settings.templateId === 'string' && templates.some((t) => t.id === list.settings.templateId) ? list.settings.templateId : (templates[0]?.id ?? '');
  const [toTemplate, setToTemplate] = useState<string | null>(null);
  const [templateDone, setTemplateDone] = useState<string | null>(null);
  const putOnTemplate = async () => {
    const template = templates.find((t) => t.id === toTemplate);
    if (!template) return;
    // As it is now in the editor (unsaved changes included), without amounts checked off etc.
    await addItems(template.id, [{ ...itemToNew(item), name: name.trim() || item.name, properties: withCustom(properties), note: note.trim() || null, categoryId, person: person.trim() || null, container: container.trim() || null }]);
    setTemplateDone(template.name);
  };

  const addCategory = async () => {
    const name = newCategory?.trim();
    if (!name || !canCreateCategory) return;
    // Already there (built-in or own): just pick it.
    const existing = categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
    setCategoryId(existing ? existing.id : await createCategory(list.listType as 'shopping' | 'packing', name));
    setNewCategory(null);
  };

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const toggle = (p: string) => setProperties((ps) => (ps.includes(p) ? ps.filter((x) => x !== p) : [...ps, p]));
  /** A property typed in "+ eigene": becomes a chip (Enter, leaving the field, or saving). */
  const withCustom = (ps: string[]) => {
    const c = custom.trim();
    return c && !ps.some((p) => p.toLowerCase() === c.toLowerCase()) ? [...ps, c] : ps;
  };
  const addCustom = () => {
    setProperties(withCustom);
    setCustom('');
  };
  const remove = () => {
    void deleteItem(item.id);
    onClose();
  };

  const save = async () => {
    const q = parseQuantity(quantity);
    const amount: Amount | null = q !== null || unit ? { q, u: unit || null } : null;
    const amounts = [...(amount ? [amount] : []), ...item.amounts.slice(1)];
    await updateItem(item.id, {
      name: name.trim() || item.name,
      amounts,
      properties: withCustom(properties),
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

  // Own properties used on this list's other entries can be picked again.
  const allProps = [...new Set([...suggestedProperties(list.listType), ...items.flatMap((i) => i.properties), ...item.properties, ...properties])];
  const sources = Array.isArray(item.attributes.sources) ? (item.attributes.sources as ItemSource[]) : [];
  const checkedBy = item.checkedBy ? users.get(item.checkedBy) : undefined;
  const createdBy = item.createdBy ? users.get(item.createdBy) : undefined;

  return (
    <dialog ref={ref} className="sheet" onClose={onClose} onClick={(e) => e.target === ref.current && ref.current?.close()}>
      <form
        method="dialog"
        className="sheet__body sheet__body--editor"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <header className="sheet__header">
          {/* Phones: the actions sit up here, within reach and above the keyboard. */}
          <div className="sheet__quick">
            <button type="button" className="icon-btn" aria-label="Entfernen" title="Entfernen" onClick={remove}>
              🗑
            </button>
            <span className="spacer" />
            <button type="button" className="icon-btn" aria-label="Abbrechen" title="Abbrechen" onClick={onClose}>
              ✕
            </button>
            <button type="submit" className="btn btn--primary" aria-label="Speichern">
              ✓ Speichern
            </button>
          </div>
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
              enterKeyHint="done"
              onChange={(e) => setCustom(e.target.value)}
              onBlur={() => custom.trim() && addCustom()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && custom.trim()) {
                  e.preventDefault();
                  addCustom();
                }
              }}
            />
          </div>
        </div>

        <label className="field">
          <span>Notiz</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={NOTE_EXAMPLE[list.listType]} />
        </label>

        {todo && !showDue && (
          <button type="button" className="link field" onClick={() => setShowDue(true)}>
            + Fälligkeit
          </button>
        )}
        {todo && showDue && (
          <label className="field">
            <span>Fällig am</span>
            <div className="field__row">
              <input type="date" value={due} onChange={(e) => setDue(e.target.value)} autoFocus={!due} />
              <button
                type="button"
                className="link"
                onClick={() => {
                  setDue('');
                  setShowDue(false);
                }}
              >
                kein Datum
              </button>
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
            <select
              value={newCategory !== null ? NEW_CATEGORY : categoryId}
              onChange={(e) => (e.target.value === NEW_CATEGORY ? setNewCategory('') : (setNewCategory(null), setCategoryId(e.target.value)))}
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              {canCreateCategory && !guest && <option value={NEW_CATEGORY}>+ Neue Kategorie …</option>}
            </select>
            {newCategory !== null && (
              <span className="new-category">
                <input
                  autoFocus
                  value={newCategory}
                  maxLength={40}
                  placeholder={list.listType === 'packing' ? 'z. B. Angeln' : 'z. B. Asia-Laden'}
                  aria-label="Name der neuen Kategorie"
                  onChange={(e) => setNewCategory(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void addCategory();
                    }
                  }}
                />
                <button type="button" className="btn" disabled={!newCategory.trim()} onClick={() => void addCategory()}>
                  Anlegen
                </button>
              </span>
            )}
            {item.catalogItemId && categoryId !== categoryInList(item.categoryId, list.listType, customCategories).id && (
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

        {packing && shoppingLists.length > 0 && me && !me.isGuest && (
          <div className="sheet__meta">
            {toShopping === null ? (
              <button type="button" className="link" onClick={() => setToShopping(me.defaultListId && shoppingLists.some((l) => l.id === me.defaultListId) ? me.defaultListId : shoppingLists[0]!.id)}>
                🛒 Auf Einkaufsliste setzen …
              </button>
            ) : shoppingDone ? (
              <span>✓ Steht jetzt auf „{shoppingDone}“.</span>
            ) : (
              <span className="row">
                <select value={toShopping} onChange={(e) => setToShopping(e.target.value)} aria-label="Einkaufsliste">
                  {shoppingLists.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.id === me.defaultListId ? '⭐ ' : ''}
                      {l.name}
                    </option>
                  ))}
                </select>
                <button type="button" className="btn" onClick={() => void putOnShopping()}>
                  Übernehmen
                </button>
              </span>
            )}
          </div>
        )}

        {!list.isTemplate && templates.length > 0 && me && !me.isGuest && (
          <div className="sheet__meta">
            {toTemplate === null ? (
              <button type="button" className="link" onClick={() => setToTemplate(rememberedTemplate)}>
                ◇ Auf Vorlage setzen …
              </button>
            ) : templateDone ? (
              <span>✓ Steht jetzt auf „{templateDone}“.</span>
            ) : (
              <span className="row">
                <select value={toTemplate} onChange={(e) => setToTemplate(e.target.value)} aria-label="Vorlage">
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      ◇ {t.name}
                    </option>
                  ))}
                </select>
                <button type="button" className="btn" onClick={() => void putOnTemplate()}>
                  Übernehmen
                </button>
              </span>
            )}
          </div>
        )}

        {me && !me.isGuest && list.listType !== 'todo' && (
          <IconCheck targetType={item.catalogItemId ? 'item' : 'entry'} targetId={item.catalogItemId ?? item.id} />
        )}

        {/* Catalog items share their icon; Merkliste and free-text entries have one of their own. */}
        {(item.catalogItemId || memo || item.icon) && me && !me.isGuest && list.listType !== 'todo' && (
          <p className="sheet__meta">
            {reported === 'idle' ? (
              <button
                type="button"
                className="link"
                onClick={() => {
                  const req = item.catalogItemId
                    ? fetch(`/api/v1/catalog/${item.catalogItemId}/icon-report`, { method: 'POST' })
                    : fetch('/api/v1/icons/generate', {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({ targetType: 'entry', targetId: item.id }),
                      });
                  req.then((res) => setReported(res.ok ? 'done' : 'error')).catch(() => setReported('error'));
                }}
              >
                {item.catalogItemId || item.icon ? 'Icon gefällt mir nicht' : 'Icon erzeugen'}
              </button>
            ) : reported === 'done' ? (
              'Neues Icon ist in Auftrag – es erscheint in Kürze (oder in der Icon-Prüfung).'
            ) : (
              'Das ging gerade nicht (offline?).'
            )}
          </p>
        )}

        <footer className="sheet__actions">
          <button
            type="button"
            className="btn btn--danger"
            onClick={remove}
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
