import { itemSpecification, type ItemRow, type ListRow } from '@shopping/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { addItems, createList, type NewItem } from '../actions';
import { navigate, useItems } from '../hooks';
import { ItemIcon } from './Tile';

interface Props {
  templates: ListRow[];
  /** Apply into this list; without it a new list is created. */
  targetList?: ListRow;
  onClose: () => void;
}

function toNewItem(i: ItemRow, template: ListRow): NewItem {
  return {
    name: i.name,
    catalogItemId: i.catalogItemId,
    categoryId: i.categoryId,
    amounts: i.amounts,
    properties: i.properties,
    note: i.note,
    sources: [{ type: 'template', label: template.name }],
  };
}

/** "Neue Liste" (optionally from a template) and "Vorlage übernehmen" with a checklist. */
export function TemplateDialog({ templates, targetList, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState('Einkauf');
  const [templateId, setTemplateId] = useState(targetList ? (templates[0]?.id ?? '') : '');
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
      listId = await createList(name.trim());
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
          <h2 className="spacer">{targetList ? `Vorlage in „${targetList.name}“` : 'Neue Liste'}</h2>
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
                  <ItemIcon name={i.name} categoryId={i.categoryId} size="sm" />
                  <span className="spacer">
                    {i.name}
                    <small className="muted"> {itemSpecification(i)}</small>
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
