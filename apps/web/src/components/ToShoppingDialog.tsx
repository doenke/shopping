import { inUserOrder, itemSpecification, packingInfo, type ItemRow, type ListRow, type Me } from '@shopping/shared';
import { useEffect, useRef, useState } from 'react';
import { addItems } from '../actions';
import { useCatalog, useItems, useLists } from '../hooks';
import { ItemIcon } from './Tile';

interface Props {
  /** The packing list the things come from. */
  list: ListRow;
  me: Me;
  /** Ticked from the start (opened from an item's editor). */
  preselected?: string[];
  onClose: (message?: string) => void;
}

const describe = (i: ItemRow) => {
  const p = packingInfo(i);
  return [itemSpecification(i), p.person, p.container].filter(Boolean).join(' · ');
};

/** Puts things of a packing list onto a shopping list of one's choice ("Sonnencreme muss noch gekauft werden"). */
export function ToShoppingDialog({ list, me, preselected = [], onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const items = useItems(list.id) ?? [];
  // Groceries catalog: "Sonnencreme" on the shopping list is that catalog item, with its category.
  const { index } = useCatalog();
  const targets = inUserOrder(
    useLists().filter((l) => l.listType === 'shopping' && !l.isTemplate && !l.archivedAt),
    me.listOrder,
    (l) => l.id,
  );
  const [targetId, setTargetId] = useState(me.defaultListId ?? '');
  const target = targets.find((l) => l.id === targetId) ?? targets[0];
  const [chosen, setChosen] = useState(new Set(preselected));
  // Not yet packed first: those are the ones that may still have to be bought.
  const rows = [...items].sort((a, b) => Number(a.checked) - Number(b.checked) || a.name.localeCompare(b.name, 'de'));

  useEffect(() => ref.current?.showModal(), []);

  const toggle = (id: string) =>
    setChosen((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const apply = async () => {
    if (!target || chosen.size === 0) return;
    const picked = items.filter((i) => chosen.has(i.id));
    await addItems(
      target.id,
      picked.map((i) => {
        const hit = index.match(i.name, false);
        return {
          name: hit?.name ?? i.name,
          catalogItemId: hit?.id ?? null,
          categoryId: hit?.categoryId ?? null,
          amounts: i.amounts,
          properties: [],
          note: null,
          sources: [{ type: 'list' as const, label: list.name }],
        };
      }),
    );
    ref.current?.close();
    onClose(`${picked.length === 1 ? `„${picked[0]!.name}“ steht` : `${picked.length} Dinge stehen`} jetzt auf „${target.name}“.`);
  };

  return (
    <dialog ref={ref} className="sheet" onClose={() => onClose()}>
      <form
        className="sheet__body"
        onSubmit={(e) => {
          e.preventDefault();
          void apply();
        }}
      >
        <header className="sheet__header row">
          <h2 className="spacer">Auf die Einkaufsliste</h2>
          <button type="button" className="icon-btn" aria-label="Schließen" onClick={() => ref.current?.close()}>
            ✕
          </button>
        </header>

        {targets.length === 0 ? (
          <p className="muted">Es gibt noch keine Einkaufsliste.</p>
        ) : (
          <>
            <label className="field">
              <span>Einkaufsliste</span>
              <select value={target?.id ?? ''} onChange={(e) => setTargetId(e.target.value)}>
                {targets.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.id === me.defaultListId ? '⭐ ' : ''}
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="muted">Was muss noch gekauft werden?</p>
            <ul className="checklist">
              {rows.map((i) => (
                <li key={i.id}>
                  <label>
                    <input type="checkbox" checked={chosen.has(i.id)} onChange={() => toggle(i.id)} />
                    <ItemIcon name={i.name} categoryId={i.categoryId} catalogItemId={i.catalogItemId} entry={i.icon ? { id: i.id, icon: i.icon } : undefined} size="sm" />
                    <span className="spacer">
                      {i.name}
                      {describe(i) && <small className="muted"> {describe(i)}</small>}
                      {i.checked && <small className="muted"> · eingepackt</small>}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}

        <footer className="sheet__actions">
          <span className="spacer" />
          <button type="button" className="btn" onClick={() => ref.current?.close()}>
            Abbrechen
          </button>
          <button type="submit" className="btn btn--primary" disabled={!target || chosen.size === 0}>
            {chosen.size ? `${chosen.size} auf „${target?.name ?? ''}“` : 'Auswählen …'}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
