import { canReset, listDescription, listGroup, listReset, RESET_EVERY, RESET_LABEL, SUGGESTED_LIST_GROUPS, type ListRow, type Me, type ResetEvery } from '@shopping/shared';
import { useEffect, useRef, useState } from 'react';
import { editList, newListIcon } from '../actions';
import { ListIcon } from './ListIcon';

interface Props {
  list: ListRow;
  me: Me;
  /** Kategorien already used by ToDo lists (suggestions). */
  groups: string[];
  onClose: () => void;
}

/** Name, description, Kategorie (ToDo lists) and icon of a list, in one place. */
export function ListEditDialog({ list, me, groups, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(list.name);
  const [description, setDescription] = useState(listDescription(list) ?? '');
  const [group, setGroup] = useState(listGroup(list) ?? '');
  const [reset, setReset] = useState<ResetEvery | null>(listReset(list));
  const [icon, setIcon] = useState<'idle' | 'queued' | 'error'>('idle');
  const todo = list.listType === 'todo';

  useEffect(() => ref.current?.showModal(), []);

  return (
    <dialog ref={ref} className="sheet" onClose={onClose}>
      <form
        className="sheet__body"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          await editList(list, { name, description, ...(todo ? { group } : {}), ...(canReset(list) ? { reset } : {}) });
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

        {canReset(list) && <ResetSelect value={reset} onChange={setReset} />}

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
