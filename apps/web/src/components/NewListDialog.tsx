import { defaultVisibility, itemSpecification, SUGGESTED_LIST_GROUPS, packingInfo, type ItemRow, type ListRow, type ListType } from '@shopping/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { addItems, createList, itemToNew } from '../actions';
import { db } from '../db';
import { navigate } from '../hooks';
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
  // Several templates at once, e.g. "Basis" + "Ski" + "Kinder" – in the order they were picked.
  const [templateIds, setTemplateIds] = useState<string[]>([]);
  const chosenTemplates = templateIds.map((id) => templates.find((t) => t.id === id)).filter((t): t is ListRow => !!t);
  const template = chosenTemplates[0];
  const items = useLiveQuery(
    () => (templateIds.length ? db.items.where('listId').anyOf(templateIds).toArray() : Promise.resolve([] as ItemRow[])),
    [templateIds.join(',')],
  );
  /** All items of the chosen templates; the same thing in two templates comes once (the first one counts). */
  const sorted = useMemo(() => {
    const seen = new Map<string, { item: ItemRow; from: string[] }>();
    for (const t of chosenTemplates) {
      const own = (items ?? []).filter((i) => i.listId === t.id && !i.deleted).sort((a, b) => a.position.localeCompare(b.position));
      for (const i of own) {
        const p = packingInfo(i);
        const key = [i.catalogItemId ?? i.name.trim().toLowerCase(), p.person?.toLowerCase() ?? '', p.container?.toLowerCase() ?? ''].join('|');
        const hit = seen.get(key);
        if (hit) hit.from.push(t.name);
        else seen.set(key, { item: i, from: [t.name] });
      }
    }
    return [...seen.values()];
  }, [items, templateIds.join(',')]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => ref.current?.showModal(), []);
  // Optional template items (e.g. sun cream) start deselected.
  useEffect(() => setSelected(new Set(sorted.filter((e) => !e.item.optional).map((e) => e.item.id))), [sorted]);

  const toggleTemplate = (id: string) => setTemplateIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  // Type change: sensible defaults, as long as the user has not typed a name.
  const chooseType = (t: ListType) => {
    setType(t);
    setTemplateIds([]);
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
    const chosen = sorted.filter((e) => selected.has(e.item.id));
    if (chosen.length) {
      await addItems(
        id,
        chosen.map(({ item, from }) => {
          const c = { ...itemToNew(item), optional: asTemplate ? item.optional : undefined };
          return asTemplate ? c : { ...c, sources: from.map((label) => ({ type: 'template' as const, label })) };
        }),
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
          <div className="field">
            <span>{asTemplate ? 'Kopie von' : 'Aus Vorlagen'} – auch mehrere, z. B. Basis + Ski</span>
            <div className="chips">
              {templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`chip${templateIds.includes(t.id) ? ' chip--on' : ''}`}
                  aria-pressed={templateIds.includes(t.id)}
                  onClick={() => toggleTemplate(t.id)}
                >
                  ◇ {t.name}
                </button>
              ))}
            </div>
          </div>
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
            {sorted.map(({ item: i, from }) => {
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
                      {chosenTemplates.length > 1 && <small className="muted"> · {from.join(', ')}</small>}
                    </span>
                  </label>
                </li>
              );
            })}
            {sorted.length === 0 && items && <li className="muted">{chosenTemplates.length > 1 ? 'Die Vorlagen sind noch leer.' : 'Die Vorlage ist noch leer.'}</li>}
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
