import { formatAmounts, itemSpecification, packingInfo, type ItemRow, type ListRow } from '@shopping/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { addItems, itemToNew, updateItem } from '../actions';
import { useItems } from '../hooks';
import { sync } from '../sync/engine';
import { ItemIcon } from './Tile';

interface Props {
  list: ListRow;
  /** Templates of the same list type. */
  templates: ListRow[];
  onClose: () => void;
}

/** Same thing: same catalog item (or name), same person and Packstück. */
function keyOf(i: ItemRow): string {
  const p = packingInfo(i);
  return [i.catalogItemId ?? i.name.trim().toLowerCase(), p.person?.toLowerCase() ?? '', p.container?.toLowerCase() ?? ''].join('|');
}

const describe = (i: ItemRow) => {
  const p = packingInfo(i);
  return [itemSpecification(i), p.person, p.container].filter(Boolean).join(' · ');
};

type Direction = 'none' | 'toList' | 'toTemplate';

/**
 * Compares a list with a template, in both directions: what the template has
 * and the list lacks, what the list has and the template lacks, and where the
 * amounts differ. Everything is ticked off individually.
 */
export function SyncTemplateDialog({ list, templates, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const remembered = typeof list.settings.templateId === 'string' ? list.settings.templateId : '';
  const [templateId, setTemplateId] = useState(templates.some((t) => t.id === remembered) ? remembered : (templates[0]?.id ?? ''));
  const template = templates.find((t) => t.id === templateId);
  const listItems = useItems(list.id);
  const templateItems = useItems(template?.id);
  const [toList, setToList] = useState<Set<string>>(new Set());
  const [toTemplate, setToTemplate] = useState<Set<string>>(new Set());
  const [diffChoice, setDiffChoice] = useState<Map<string, Direction>>(new Map());

  useEffect(() => ref.current?.showModal(), []);

  const diff = useMemo(() => {
    const items = listItems ?? [];
    const tpl = templateItems ?? [];
    // On a shopping list, something already bought is "missing" again; elsewhere (packed, seen, done) it is there.
    const present = new Map(items.filter((i) => list.listType !== 'shopping' || !i.checked).map((i) => [keyOf(i), i]));
    const inTemplate = new Map(tpl.map((i) => [keyOf(i), i]));
    return {
      missingInList: tpl.filter((i) => !present.has(keyOf(i))).sort((a, b) => a.position.localeCompare(b.position)),
      missingInTemplate: items.filter((i) => !inTemplate.has(keyOf(i))).sort((a, b) => a.position.localeCompare(b.position)),
      different: tpl
        .map((t) => ({ t, l: present.get(keyOf(t)) }))
        .filter((x): x is { t: ItemRow; l: ItemRow } => !!x.l && formatAmounts(x.l.amounts) !== formatAmounts(x.t.amounts)),
    };
  }, [listItems, templateItems, list.listType]);

  // Preselect: everything the template has (except optional items), everything the list has.
  useEffect(() => {
    setToList(new Set(diff.missingInList.filter((i) => !i.optional).map((i) => i.id)));
    setToTemplate(new Set(diff.missingInTemplate.map((i) => i.id)));
    setDiffChoice(new Map());
  }, [templateId, listItems === undefined, templateItems === undefined]);

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  };

  const count = toList.size + toTemplate.size + [...diffChoice.values()].filter((d) => d !== 'none').length;

  const apply = async () => {
    if (!template) return;
    const intoList = diff.missingInList.filter((i) => toList.has(i.id));
    const intoTemplate = diff.missingInTemplate.filter((i) => toTemplate.has(i.id));
    if (intoList.length) await addItems(list.id, intoList.map((i) => ({ ...itemToNew(i), sources: [{ type: 'template' as const, label: template.name }] })));
    if (intoTemplate.length) await addItems(template.id, intoTemplate.map(itemToNew));
    for (const { t, l } of diff.different) {
      const choice = diffChoice.get(t.id);
      if (choice === 'toList') await updateItem(l.id, { amounts: t.amounts });
      if (choice === 'toTemplate') await updateItem(t.id, { amounts: l.amounts });
    }
    // Remember the template for next time.
    if (list.settings.templateId !== template.id) await sync.mutateList(list.id, { settings: { ...list.settings, templateId: template.id } });
    ref.current?.close();
  };

  const section = (title: string, rows: ItemRow[], set: Set<string>, setter: (s: Set<string>) => void, hint: string) =>
    rows.length > 0 && (
      <>
        <div className="row row--center">
          <h3 className="spacer">{title}</h3>
          <button type="button" className="link" onClick={() => setter(set.size === rows.length ? new Set() : new Set(rows.map((r) => r.id)))}>
            {set.size === rows.length ? 'keine' : 'alle'}
          </button>
        </div>
        <p className="muted">{hint}</p>
        <ul className="checklist">
          {rows.map((i) => (
            <li key={i.id}>
              <label>
                <input type="checkbox" checked={set.has(i.id)} onChange={() => toggle(set, setter, i.id)} />
                <ItemIcon name={i.name} categoryId={i.categoryId} catalogItemId={i.catalogItemId} size="sm" />
                <span className="spacer">
                  {i.name}
                  <small className="muted"> {describe(i)}</small>
                  {i.optional && <small className="muted"> · optional</small>}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </>
    );

  const nothing = template && listItems && templateItems && !diff.missingInList.length && !diff.missingInTemplate.length && !diff.different.length;

  return (
    <dialog ref={ref} className="sheet" onClose={onClose}>
      <form
        className="sheet__body"
        onSubmit={(e) => {
          e.preventDefault();
          void apply();
        }}
      >
        <header className="sheet__header row">
          <h2 className="spacer">Mit Vorlage abgleichen</h2>
          <button type="button" className="icon-btn" aria-label="Schließen" onClick={() => ref.current?.close()}>
            ✕
          </button>
        </header>

        {templates.length === 0 ? (
          <p className="muted">Es gibt noch keine Vorlage für diesen Listentyp. „+ Neu“ → „Als Vorlage anlegen“ oder „⋮ → Als Vorlage speichern“.</p>
        ) : (
          <label className="field">
            <span>Vorlage</span>
            <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  ◇ {t.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {nothing && <p className="success">Liste und Vorlage sind gleich.</p>}

        {section(
          `In die Liste übernehmen (${toList.size}/${diff.missingInList.length})`,
          diff.missingInList,
          toList,
          setToList,
          'Steht in der Vorlage, fehlt auf der Liste.',
        )}
        {section(
          `In die Vorlage übernehmen (${toTemplate.size}/${diff.missingInTemplate.length})`,
          diff.missingInTemplate,
          toTemplate,
          setToTemplate,
          'Steht auf der Liste, fehlt in der Vorlage.',
        )}

        {diff.different.length > 0 && (
          <>
            <h3>Andere Menge</h3>
            <ul className="checklist">
              {diff.different.map(({ t, l }) => (
                <li key={t.id}>
                  <label>
                    <ItemIcon name={t.name} categoryId={t.categoryId} catalogItemId={t.catalogItemId} size="sm" />
                    <span className="spacer">
                      {t.name}
                      <small className="muted">
                        {' '}
                        Liste: {formatAmounts(l.amounts) || '–'} · Vorlage: {formatAmounts(t.amounts) || '–'}
                      </small>
                    </span>
                    <select
                      value={diffChoice.get(t.id) ?? 'none'}
                      onChange={(e) => setDiffChoice((m) => new Map(m).set(t.id, e.target.value as Direction))}
                      aria-label={`${t.name}: welche Menge`}
                    >
                      <option value="none">lassen</option>
                      <option value="toList">Liste wie Vorlage</option>
                      <option value="toTemplate">Vorlage wie Liste</option>
                    </select>
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}

        <footer className="sheet__actions">
          <span className="spacer" />
          <button type="submit" className="btn btn--primary" disabled={!template || count === 0}>
            {count ? `${count} Änderungen übernehmen` : 'Nichts ausgewählt'}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
