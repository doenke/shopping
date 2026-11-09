import {
  dueOf,
  itemStatus,
  listStatuses,
  listDefaultStatus,
  withStatus,
  isForEach,
  itemPersons,
  itemUrl,
  packingInfo,
  peopleOf,
  withPacking,
  withPeople,
  withUrl,
  type ItemRow,
  type ListRow,
  type UserInfo,
} from '@shopping/shared';
import { useEffect, useRef, useState } from 'react';
import { deleteItem, restoreItem, setChecked, updateItem } from '../../actions';
import { showToast } from '../../toast';
import { PeoplePicker, PersonCheckDialog, usePeopleSuggestions } from '../People';

interface Props {
  item: ItemRow;
  list: ListRow;
  items: ItemRow[];
  users: Map<string, UserInfo>;
  /** Focus the title (Enter on a row). */
  focusTitle: number;
  /** Kanban: the details can be closed (the board gets the width back). */
  onClose?: () => void;
}

/**
 * The right column of the Arbeitsmodus: one task, edited in place. Text fields save when they lose
 * focus (or on Enter), everything else right away.
 */
export function TaskDetail({ item, list, items, users, focusTitle, onClose }: Props) {
  const [name, setName] = useState(item.name);
  const [note, setNote] = useState(item.note ?? '');
  const [area, setArea] = useState(packingInfo(item).container ?? '');
  const [link, setLink] = useState(typeof item.attributes.url === 'string' ? item.attributes.url : '');
  const [checking, setChecking] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const suggestions = usePeopleSuggestions(list, items);
  const people = peopleOf(item);
  const statuses = listStatuses(list);
  const defaultStatus = listDefaultStatus(list, statuses);

  // Someone else changed it meanwhile: show that (unless the field is being edited right now).
  useEffect(() => {
    if (document.activeElement !== titleRef.current) setName(item.name);
  }, [item.name]);
  useEffect(() => {
    if (focusTitle) {
      titleRef.current?.focus();
      titleRef.current?.select();
    }
  }, [focusTitle]);

  const saveAttributes = (attributes: Record<string, unknown>) => {
    if (JSON.stringify(attributes) !== JSON.stringify(item.attributes)) void updateItem(item.id, { attributes });
  };
  const saveName = () => {
    if (name.trim() && name.trim() !== item.name) void updateItem(item.id, { name: name.trim() });
    else setName(item.name);
  };
  const saveNote = () => {
    if ((note.trim() || null) !== item.note) void updateItem(item.id, { note: note.trim() || null });
  };
  const toggle = () => {
    if (itemPersons(item).length && !item.checked) return setChecking(true);
    void setChecked(item, !item.checked);
  };
  const remove = () => {
    void deleteItem(item.id);
    showToast(`„${item.name}“ gelöscht`, { label: 'Rückgängig', run: () => void restoreItem(item) });
  };
  const enterSaves = (save: () => void) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      save();
      e.currentTarget.blur();
    } else if (e.key === 'Escape') e.currentTarget.blur();
  };

  const createdBy = item.createdBy ? users.get(item.createdBy) : undefined;
  const checkedBy = item.checkedBy ? users.get(item.checkedBy) : undefined;
  const url = itemUrl(item);
  const due = dueOf(item);

  return (
    <aside className="work-detail" aria-label="Details">
      <div className="work-detail__head">
        <button
          type="button"
          className={`work-check${item.checked ? ' work-check--on' : ''}`}
          aria-pressed={item.checked}
          aria-label="Erledigt"
          onClick={toggle}
        >
          {item.checked ? '✓' : ''}
        </button>
        <input
          ref={titleRef}
          className="work-detail__title"
          value={name}
          aria-label="Titel"
          onChange={(e) => setName(e.target.value)}
          onBlur={saveName}
          onKeyDown={enterSaves(saveName)}
        />
        {onClose && (
          <button type="button" className="icon-btn" aria-label="Details schließen" onClick={onClose}>
            ✕
          </button>
        )}
      </div>

      {statuses.length > 0 && !item.checked && (
        <label className="work-field">
          <span>Status</span>
          <select
            aria-label="Status"
            value={itemStatus(item, statuses, defaultStatus)?.id ?? ''}
            onChange={(e) => saveAttributes(withStatus(item.attributes, e.target.value, statuses, defaultStatus))}
          >
            {statuses.map((st) => (
              <option key={st.id} value={st.id}>
                {st.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="work-field">
        <span>Fällig</span>
        <input
          type="date"
          value={due ?? ''}
          onChange={(e) => {
            const next = { ...item.attributes };
            if (e.target.value) next.due = e.target.value;
            else delete next.due;
            saveAttributes(next);
          }}
        />
      </label>

      <div className="work-field">
        <span>Wer{people.length >= 2 ? ' – wird pro Person abgehakt' : ''}</span>
        <PeoplePicker value={people} onChange={(p) => saveAttributes(withPeople(item.attributes, p, isForEach(item)))} suggestions={suggestions} />
      </div>

      <label className="work-field">
        <span>Bereich</span>
        <input
          value={area}
          list="work-areas"
          placeholder="z. B. Kunde, Projekt"
          onChange={(e) => setArea(e.target.value)}
          onBlur={() => saveAttributes(withPacking(item.attributes, { container: area }))}
          onKeyDown={enterSaves(() => saveAttributes(withPacking(item.attributes, { container: area })))}
        />
        <datalist id="work-areas">
          {[...new Set(items.map((i) => packingInfo(i).container).filter(Boolean))].map((c) => (
            <option key={c} value={c!} />
          ))}
        </datalist>
      </label>

      <label className="work-field">
        <span>Notiz</span>
        <textarea rows={5} value={note} onChange={(e) => setNote(e.target.value)} onBlur={saveNote} />
      </label>

      <div className="work-field">
        <span>Link</span>
        <div className="field__link">
          <input
            type="url"
            value={link}
            aria-label="Link"
            placeholder="https://…"
            onChange={(e) => setLink(e.target.value)}
            onBlur={() => saveAttributes(withUrl(item.attributes, link))}
            onKeyDown={enterSaves(() => saveAttributes(withUrl(item.attributes, link)))}
          />
          {url && (
            <a className="btn" href={url} target="_blank" rel="noopener noreferrer">
              Öffnen
            </a>
          )}
        </div>
      </div>

      <dl className="work-detail__meta">
        {createdBy && (
          <>
            <dt>Angelegt</dt>
            <dd>
              {createdBy.displayName}, {new Date(item.createdAt).toLocaleDateString('de-DE')}
              {typeof item.attributes.via === 'string' ? ` · über ${item.attributes.via}` : ''}
            </dd>
          </>
        )}
        {item.checked && item.checkedAt && (
          <>
            <dt>Erledigt</dt>
            <dd>
              {checkedBy ? `${checkedBy.displayName}, ` : ''}
              {new Date(item.checkedAt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}
            </dd>
          </>
        )}
      </dl>

      <div className="work-detail__actions">
        <button type="button" className="btn btn--danger-quiet" onClick={remove}>
          Löschen
        </button>
      </div>

      {checking && <PersonCheckDialog item={item} verb="erledigt" onClose={() => setChecking(false)} />}
    </aside>
  );
}
