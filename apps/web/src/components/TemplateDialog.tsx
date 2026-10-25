import { itemSpecification, packingInfo, type ItemRow, type ListRow, type ListType } from '@shopping/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { addItems, createList, itemToNew, type NewItem } from '../actions';
import { navigate, useItems } from '../hooks';
import { ItemIcon } from './Tile';

interface Props {
  templates: ListRow[];
  /** Apply into this list; without it a new list is created. */
  targetList?: ListRow;
  /** Type of a new list (packing lists only use packing templates). */
  listType?: ListType;
  onClose: () => void;
}

function toNewItem(i: ItemRow, template: ListRow): NewItem {
  return { ...itemToNew(i), sources: [{ type: 'template', label: template.name }] };
}

/** "Neue Liste" (optionally from a template) and "Vorlage übernehmen" with a checklist. */
export function TemplateDialog({ templates: allTemplates, targetList, listType: newType = 'shopping', onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const listType = targetList?.listType ?? newType;
  const packing = listType === 'packing';
  const templates = allTemplates.filter((t) => t.listType === listType);
  const [name, setName] = useState(packing ? 'Urlaub' : 'Einkauf');
  // A new packing list is "new from template": the first packing template is preselected.
  const [templateId, setTemplateId] = useState(targetList || packing ? (templates[0]?.id ?? '') : '');
  const template = templates.find((t) => t.id === templateId);
  const items = useItems(template?.id);
  const sorted = useMemo(() => [...(items ?? [])].sort((a, b) => a.position.localeCompare(b.position)), [items]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => ref.current?.showModal(), []);
  // Optional items (e.g. sun cream) start deselected.
  useEffect(() => setSelected(new Set(sorted.filter((i) => !i.optional).map((i) => i.id))), [sorted]);

  const submit = async () => {
    const chosen = template ? sorted.filter((i) => selected.has(i.id)).map((i) => toNewItem(i, template)) : [];
    let listId = targetList?.id;
    if (!listId) {
      if (!name.trim()) return;
      listId = await createList(name.trim(), false, listType);
      navigate({ page: 'list', listId });
    }
    if (chosen.length) await addItems(listId, chosen);
    ref.current?.close();
  };

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <dialog ref={ref} className="sheet" onClose={onClose}>
      <form
        className="sheet__body"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <header className="sheet__header row">
          <h2 className="spacer">{targetList ? `Vorlage in „${targetList.name}“` : packing ? 'Neue Packliste' : 'Neue Liste'}</h2>
          <button type="button" className="icon-btn" aria-label="Schließen" onClick={() => ref.current?.close()}>
            ✕
          </button>
        </header>

        {!targetList && (
          <label className="field">
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </label>
        )}

        {packing && templates.length === 0 && !targetList && (
          <p className="muted">Tipp: Lege unter „Vorlagen“ eine Packvorlage an (z. B. „Wochenend-Trip“) – neue Packlisten entstehen dann daraus.</p>
        )}

        {templates.length > 0 && (
          <label className="field">
            <span>Vorlage</span>
            <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              {!targetList && <option value="">leer starten</option>}
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  ◇ {t.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {template && (
          <ul className="checklist">
            {sorted.map((i) => (
              <li key={i.id}>
                <label>
                  <input type="checkbox" checked={selected.has(i.id)} onChange={() => toggle(i.id)} />
                  <ItemIcon name={i.name} categoryId={i.categoryId} catalogItemId={i.catalogItemId} size="sm" />
                  <span className="spacer">
                    {i.name}
                    <small className="muted"> {[itemSpecification(i), packingInfo(i).person, packingInfo(i).container].filter(Boolean).join(' · ')}</small>
                    {i.optional && <small className="muted"> · optional</small>}
                  </span>
                </label>
              </li>
            ))}
            {sorted.length === 0 && <li className="muted">Die Vorlage ist noch leer.</li>}
          </ul>
        )}

        <footer className="sheet__actions">
          <span className="spacer" />
          <button type="submit" className="btn btn--primary" disabled={!!targetList && selected.size === 0}>
            {targetList ? `${selected.size} Artikel übernehmen` : template ? `Anlegen mit ${selected.size} Artikeln` : 'Anlegen'}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
