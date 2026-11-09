import {
  asksForTemplates,
  canAutoReset,
  listDescription,
  listTemplateIds,
  listGroup,
  listReset,
  RESET_EVERY,
  RESET_LABEL,
  SUGGESTED_LIST_GROUPS,
  type ListRow,
  type Me,
  type ResetEvery,
  listStatuses,
  SUGGESTED_STATUSES,
  type ListStatus,
} from '@shopping/shared';
import { useEffect, useRef, useState } from 'react';
import { editList, newListIcon } from '../actions';
import { useLists } from '../hooks';
import { ListIcon } from './ListIcon';

interface Props {
  list: ListRow;
  me: Me;
  /** Kategorien already used by ToDo lists (suggestions). */
  groups: string[];
  onClose: () => void;
  /** Shopping and packing lists: opens "Kategorien sortieren" (this dialog closes). */
  onSortCategories: () => void;
}

/** Name, description, Kategorie (ToDo lists) and icon of a list, in one place. */
export function ListEditDialog({ list, me, groups, onClose, onSortCategories }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(list.name);
  const [description, setDescription] = useState(listDescription(list) ?? '');
  const [group, setGroup] = useState(listGroup(list) ?? '');
  const allLists = useLists();
  const templates = listTemplateIds(list)
    .map((id) => allLists.find((l) => l.id === id))
    .filter((t): t is ListRow => !!t && t.isTemplate);
  const [askTemplates, setAskTemplates] = useState(asksForTemplates(list));
  const [reset, setReset] = useState<ResetEvery | null>(listReset(list));
  const [icon, setIcon] = useState<'idle' | 'queued' | 'error'>('idle');
  const [statuses, setStatuses] = useState<ListStatus[]>(listStatuses(list));
  const todo = list.listType === 'todo';

  useEffect(() => ref.current?.showModal(), []);

  return (
    <dialog ref={ref} className="sheet" onClose={onClose}>
      <form
        className="sheet__body"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          await editList(list, {
            name,
            description,
            ...(todo ? { group, statuses } : {}),
            ...(canAutoReset(list) ? { reset } : {}),
            ...(templates.length ? { askTemplates } : {}),
          });
          ref.current?.close();
        }}
      >
        <header className="sheet__header row">
          <h2 className="spacer">Liste bearbeiten</h2>
          <button type="button" className="icon-btn" aria-label="Schließen" onClick={() => ref.current?.close()}>
            ✕
          </button>
        </header>

        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </label>

        <label className="field">
          <span>Beschreibung {list.listType === 'memo' ? '(hilft auch bei den Bildern)' : '(optional)'}</span>
          <textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={list.listType === 'memo' ? 'z. B. Filme und Serien, die wir sehen wollen' : 'Worum geht es in dieser Liste?'}
          />
        </label>

        {todo && (
          <label className="field">
            <span>Kategorie</span>
            <input value={group} onChange={(e) => setGroup(e.target.value)} list="edit-todo-groups" placeholder="Allgemein" />
            <datalist id="edit-todo-groups">
              {[...new Set([...groups, ...SUGGESTED_LIST_GROUPS])].map((g) => (
                <option key={g} value={g} />
              ))}
            </datalist>
          </label>
        )}

        {todo && <StatusEditor value={statuses} onChange={setStatuses} />}

        {templates.length > 0 && (
          <div className="field">
            <span>Erstellt aus {templates.length === 1 ? 'der Vorlage' : 'den Vorlagen'}</span>
            <div className="chips">
              {templates.map((t) => (
                <span key={t.id} className="chip">
                  ◇ {t.name}
                </span>
              ))}
            </div>
          </div>
        )}
        {templates.length > 0 && (
          <label className="check field">
            <input type="checkbox" checked={askTemplates} onChange={(e) => setAskTemplates(e.target.checked)} /> Bei neuen Einträgen fragen, ob sie auch in die
            Vorlage sollen
          </label>
        )}

        {(list.listType === 'shopping' || list.listType === 'packing') && (
          <div className="field">
            <span>Kategorien</span>
            <div className="row row--center">
              <button type="button" className="btn" onClick={onSortCategories}>
                ↕ Kategorien sortieren …
              </button>
            </div>
            <small className="muted">
              Reihenfolge wie dein Weg durch den Laden – gilt nur für dich, für alle {list.listType === 'packing' ? 'Packlisten' : 'Einkaufslisten'}.
            </small>
          </div>
        )}

        {canAutoReset(list) && <ResetSelect value={reset} onChange={setReset} />}

        <div className="field">
          <span>Icon</span>
          <div className="row row--center">
            <span className="list-icon-preview">
              <ListIcon list={list} size="md" fallback="–" />
            </span>
            {!me.isGuest && (
              <button
                type="button"
                className="btn"
                disabled={icon === 'queued'}
                onClick={async () => setIcon((await newListIcon(list.id)) ? 'queued' : 'error')}
              >
                🖼 Neues Icon erzeugen
              </button>
            )}
          </div>
          {icon === 'queued' && <small className="muted">Wird gezeichnet – es erscheint von selbst, sobald es fertig ist.</small>}
          {icon === 'error' && <small className="error">Dafür wird eine Verbindung und eine eingerichtete Bild-KI gebraucht.</small>}
          {icon === 'idle' && <small className="muted">Entsteht aus Name und Beschreibung; nach dem Umbenennen von selbst neu.</small>}
        </div>

        <footer className="sheet__actions">
          <span className="spacer" />
          <button type="submit" className="btn btn--primary">
            Speichern
          </button>
        </footer>
      </form>
    </dialog>
  );
}

/** Recurring checklist: when everything is open again (Berlin time, done by the server). */
export function ResetSelect({ value, onChange }: { value: ResetEvery | null; onChange: (v: ResetEvery | null) => void }) {
  return (
    <label className="field">
      <span>↺ Automatisch zurücksetzen</span>
      <select value={value ?? ''} onChange={(e) => onChange((e.target.value || null) as ResetEvery | null)}>
        <option value="">nie – nur per Menü „Alles zurücksetzen“</option>
        {RESET_EVERY.map((r) => (
          <option key={r} value={r}>
            {RESET_LABEL[r]}
          </option>
        ))}
      </select>
      <small className="muted">Für wiederkehrende Checklisten, z. B. „Haus verlassen“ oder „Wochenputz“: Abgehaktes ist dann wieder offen.</small>
    </label>
  );
}

const newStatusId = () => crypto.randomUUID().slice(0, 8);

/**
 * The statuses of a ToDo list, in order: new tasks start in the first one; "Erledigt" is the tick,
 * not a status. Ids stay when renaming, so tasks keep their status.
 */
function StatusEditor({ value, onChange }: { value: ListStatus[]; onChange: (v: ListStatus[]) => void }) {
  const move = (i: number, by: number) => {
    const next = [...value];
    const [s] = next.splice(i, 1);
    next.splice(i + by, 0, s!);
    onChange(next);
  };
  return (
    <div className="field">
      <span>Status</span>
      {value.length === 0 ? (
        <div className="row row--center">
          <button type="button" className="btn" onClick={() => onChange(SUGGESTED_STATUSES.map((name) => ({ id: newStatusId(), name })))}>
            {SUGGESTED_STATUSES.join(' · ')} übernehmen
          </button>
          <button type="button" className="link" onClick={() => onChange([{ id: newStatusId(), name: '' }])}>
            eigene anlegen
          </button>
        </div>
      ) : (
        <ol className="status-editor">
          {value.map((st, i) => (
            <li key={st.id}>
              <input
                value={st.name}
                aria-label={`Status ${i + 1}`}
                placeholder="z. B. In Arbeit"
                onChange={(e) => onChange(value.map((x) => (x.id === st.id ? { ...x, name: e.target.value } : x)))}
              />
              <button type="button" className="icon-btn" aria-label="Nach oben" disabled={i === 0} onClick={() => move(i, -1)}>
                ↑
              </button>
              <button type="button" className="icon-btn" aria-label="Nach unten" disabled={i === value.length - 1} onClick={() => move(i, 1)}>
                ↓
              </button>
              <button type="button" className="icon-btn" aria-label="Entfernen" onClick={() => onChange(value.filter((x) => x.id !== st.id))}>
                ✕
              </button>
            </li>
          ))}
          <li>
            <button type="button" className="link" onClick={() => onChange([...value, { id: newStatusId(), name: '' }])}>
              + Status
            </button>
          </li>
        </ol>
      )}
      <small className="muted">Für offene Aufgaben – neue starten im ersten. „Erledigt“ ist der Haken. Später die Spalten eines Kanban-Boards.</small>
    </div>
  );
}
