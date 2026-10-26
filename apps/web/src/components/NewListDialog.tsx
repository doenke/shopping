import { defaultVisibility, itemSpecification, SUGGESTED_LIST_GROUPS, packingInfo, type ListRow, type ListType } from '@shopping/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { addItems, createList, itemToNew } from '../actions';
import { navigate, useItems } from '../hooks';
import { ItemIcon } from './Tile';

export const LIST_TYPE_LABEL: Record<ListType, string> = {
  shopping: '🛒 Einkauf',
  packing: '🧳 Packliste',
  memo: '📌 Merkliste',
  todo: '✅ ToDo',
};

const DEFAULT_NAME: Record<ListType, string> = { shopping: 'Einkauf', packing: 'Urlaub', memo: 'Filme', todo: 'Aufgaben' };
const TEMPLATE_NAME: Record<ListType, string> = { shopping: 'Wocheneinkauf Basis', packing: 'Wochenend-Trip', memo: 'Merkliste', todo: 'Frühjahrsputz' };

interface Props {
  templates: ListRow[];
  /** Kategorien already used by ToDo lists (suggestions). */
  groups?: string[];
  initialType?: ListType;
  onClose: () => void;
}

/** One dialog for everything new: name, type, template, "as template", private, description. */
export function NewListDialog({ templates: allTemplates, groups = [], initialType = 'shopping', onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [type, setType] = useState<ListType>(initialType);
  const [asTemplate, setAsTemplate] = useState(false);
  const [name, setName] = useState(DEFAULT_NAME[initialType]);
  const [nameTouched, setNameTouched] = useState(false);
  const [isPrivate, setIsPrivate] = useState(defaultVisibility(initialType) === 'private');
  const [description, setDescription] = useState('');
  const [group, setGroup] = useState('');
  const templates = allTemplates.filter((t) => t.listType === type);
  const [templateId, setTemplateId] = useState('');
  const template = templates.find((t) => t.id === templateId);
  const items = useItems(template?.id);
  const sorted = useMemo(() => [...(items ?? [])].sort((a, b) => a.position.localeCompare(b.position)), [items]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => ref.current?.showModal(), []);
  // Optional template items (e.g. sun cream) start deselected.
  useEffect(() => setSelected(new Set(sorted.filter((i) => !i.optional).map((i) => i.id))), [sorted]);

  // Type change: sensible defaults, as long as the user has not typed a name.
  const chooseType = (t: ListType) => {
    setType(t);
    setTemplateId('');
    setIsPrivate(defaultVisibility(t) === 'private');
    if (!nameTouched) setName(asTemplate ? TEMPLATE_NAME[t] : DEFAULT_NAME[t]);
  };
  const chooseTemplateMode = (on: boolean) => {
    setAsTemplate(on);
    if (!nameTouched) setName(on ? TEMPLATE_NAME[type] : DEFAULT_NAME[type]);
  };

  const submit = async () => {
    if (!name.trim()) return;
    const id = await createList(
      name.trim(),
      asTemplate,
      type,
      description || listDescriptionOf(template),
      isPrivate ? 'private' : 'household',
      template?.id,
      type === 'todo' ? group : undefined,
    );
    const chosen = template ? sorted.filter((i) => selected.has(i.id)).map((i) => ({ ...itemToNew(i), optional: asTemplate ? i.optional : undefined })) : [];
    if (chosen.length) {
      await addItems(
        id,
        chosen.map((c) => (asTemplate ? c : { ...c, sources: [{ type: 'template' as const, label: template!.name }] })),
      );
    }
    navigate({ page: 'list', listId: id });
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
          <h2 className="spacer">{asTemplate ? 'Neue Vorlage' : 'Neue Liste'}</h2>
          <button type="button" className="icon-btn" aria-label="Schließen" onClick={() => ref.current?.close()}>
            ✕
          </button>
        </header>

        <div className="field">
          <span>Typ</span>
          <div className="segmented segmented--wrap" role="group" aria-label="Typ">
            {(Object.keys(LIST_TYPE_LABEL) as ListType[]).map((t) => (
              <button key={t} type="button" className={t === type ? 'active' : ''} aria-pressed={t === type} onClick={() => chooseType(t)}>
                {LIST_TYPE_LABEL[t]}
              </button>
            ))}
          </div>
        </div>

        <label className="field">
          <span>Name</span>
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setNameTouched(true);
            }}
            required
            autoFocus
          />
        </label>

        <label className="field">
          <span>Beschreibung {type === 'memo' ? '(hilft auch bei den Bildern)' : '(optional)'}</span>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={type === 'memo' ? 'z. B. Filme und Serien, die wir sehen wollen' : template ? 'wie die Vorlage' : ''}
          />
        </label>

        {type === 'todo' && (
          <label className="field">
            <span>Kategorie</span>
            <input value={group} onChange={(e) => setGroup(e.target.value)} list="todo-groups" placeholder="Allgemein" />
            <datalist id="todo-groups">
              {[...new Set([...groups, ...SUGGESTED_LIST_GROUPS])].map((g) => (
                <option key={g} value={g} />
              ))}
            </datalist>
          </label>
        )}

        {templates.length > 0 && (
          <label className="field">
            <span>{asTemplate ? 'Kopie von' : 'Aus Vorlage'}</span>
            <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              <option value="">leer starten</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  ◇ {t.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="check field">
          <input type="checkbox" checked={asTemplate} onChange={(e) => chooseTemplateMode(e.target.checked)} /> Als Vorlage anlegen (nicht abhakbar, füllt
          neue Listen vor)
        </label>
        <label className="check field">
          <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} /> Privat – nur für mich (sonst sieht der ganze
          Haushalt sie)
        </label>

        {template && (
          <ul className="checklist">
            {sorted.map((i) => {
              const p = packingInfo(i);
              return (
                <li key={i.id}>
                  <label>
                    <input type="checkbox" checked={selected.has(i.id)} onChange={() => toggle(i.id)} />
                    <ItemIcon name={i.name} categoryId={i.categoryId} catalogItemId={i.catalogItemId} size="sm" />
                    <span className="spacer">
                      {i.name}
                      <small className="muted"> {[itemSpecification(i), p.person, p.container].filter(Boolean).join(' · ')}</small>
                      {i.optional && <small className="muted"> · optional</small>}
                    </span>
                  </label>
                </li>
              );
            })}
            {sorted.length === 0 && <li className="muted">Die Vorlage ist noch leer.</li>}
          </ul>
        )}

        <footer className="sheet__actions">
          <span className="spacer" />
          <button type="submit" className="btn btn--primary">
            {template ? `Anlegen mit ${selected.size} Einträgen` : 'Anlegen'}
          </button>
        </footer>
      </form>
    </dialog>
  );
}

function listDescriptionOf(list: ListRow | undefined): string | null {
  const d = list?.settings.description;
  return typeof d === 'string' ? d : null;
}
