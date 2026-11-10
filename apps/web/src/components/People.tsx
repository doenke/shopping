import { itemDone, itemPersons, listPersons, peopleOnItems, type ItemRow, type ListRow } from '@shopping/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { setChecked, setPersonChecked } from '../actions';
import { useHouseholds } from '../households';
import { useMe } from '../hooks';

const firstName = (displayName: string) => displayName.trim().split(/\s+/)[0] ?? displayName;

/**
 * People to pick from: who has access to the list (first names), then who the list is for and who is on
 * its items. Without a list (new list) my household. Others can be typed in. Without a connection only the
 * names from the list remain.
 */
export function usePeopleSuggestions(
  list?: Pick<ListRow, 'id' | 'settings'> | Pick<ListRow, 'settings'>,
  items: Pick<ItemRow, 'attributes' | 'deleted'>[] = [],
): string[] {
  const listId = list && 'id' in list ? list.id : undefined;
  const household = useHouseholdNames(!listId);
  const members = useListMemberNames(listId);
  return useMemo(() => {
    const out: string[] = [];
    for (const n of [...((listId ? members : household) ?? []), ...(list ? listPersons(list) : []), ...peopleOnItems(items)]) {
      if (n && !out.some((o) => o.toLowerCase() === n.toLowerCase())) out.push(n);
    }
    return out;
  }, [household, members, listId, list, items]);
}

/** Last known members per list, so the suggestions stay while offline. */
const memberCache = new Map<string, string[]>();

/** First names of the people who have access to a list (null while loading or offline). */
export function useListMemberNames(listId: string | undefined): string[] | null {
  const [names, setNames] = useState<string[] | null>(listId ? (memberCache.get(listId) ?? null) : null);
  useEffect(() => {
    if (!listId) return setNames(null);
    setNames(memberCache.get(listId) ?? null);
    let live = true;
    void fetch(`/api/v1/lists/${listId}/members`)
      .then((r) => (r.ok ? (r.json() as Promise<{ displayName: string }[]>) : null))
      .then((rows) => {
        if (!rows) return;
        const n = rows.map((m) => firstName(m.displayName)).filter(Boolean);
        memberCache.set(listId, n);
        if (live) setNames(n);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [listId]);
  return names;
}

/** First names of my household's members (null while loading or offline). */
export function useHouseholdNames(enabled = true): string[] | null {
  const me = useMe();
  const [households] = useHouseholds([me?.isGuest], enabled);
  return useMemo(() => {
    if (me?.isGuest || !enabled) return [];
    const own = households?.find((h) => h.own);
    return own ? own.members.map((m) => firstName(m.displayName)) : null;
  }, [households, me?.isGuest, enabled]);
}

interface PickerProps {
  value: string[];
  onChange: (people: string[]) => void;
  suggestions: string[];
  /** Templates: "für jeden" instead of names. */
  forEach?: { on: boolean; onChange: (on: boolean) => void };
}

/** Chips for the household and known people, plus a field for anyone else. */
export function PeoplePicker({ value, onChange, suggestions, forEach }: PickerProps) {
  const [other, setOther] = useState('');
  const has = (n: string) => value.some((v) => v.toLowerCase() === n.toLowerCase());
  const toggle = (n: string) => onChange(has(n) ? value.filter((v) => v.toLowerCase() !== n.toLowerCase()) : [...value, n]);
  const names = [...suggestions, ...value.filter((v) => !suggestions.some((s) => s.toLowerCase() === v.toLowerCase()))];
  const add = () => {
    const n = other.trim();
    if (!n) return;
    const nice = n.charAt(0).toUpperCase() + n.slice(1);
    if (!has(nice)) onChange([...value, nice]);
    setOther('');
  };
  return (
    <div className="chips">
      {forEach && (
        <button
          type="button"
          className={`chip${forEach.on ? ' chip--on' : ''}`}
          aria-pressed={forEach.on}
          title="Beim Anlegen einer Liste aus der Vorlage wird daraus ein Eintrag für jede Person"
          onClick={() => forEach.onChange(!forEach.on)}
        >
          👥 für jeden
        </button>
      )}
      {!forEach?.on &&
        names.map((n) => (
          <button key={n} type="button" className={`chip${has(n) ? ' chip--on' : ''}`} aria-pressed={has(n)} onClick={() => toggle(n)}>
            {n}
          </button>
        ))}
      {!forEach?.on && (
        <input
          className="chip chip--input"
          value={other}
          onChange={(e) => setOther(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          onBlur={add}
          placeholder="+ jemand"
          aria-label="Weitere Person"
        />
      )}
    </div>
  );
}

/** Small initials under a multi-person item: filled = ticked off for that person. */
export function PeopleDots({ item }: { item: ItemRow }) {
  const persons = itemPersons(item);
  if (!persons.length) return null;
  const done = itemDone(item);
  return (
    <span className="people-dots" aria-label={`${done.length} von ${persons.length}: ${persons.map((p) => `${p}${done.includes(p) ? ' ✓' : ''}`).join(', ')}`}>
      {persons.map((p) => (
        <span key={p} className={`people-dot${done.includes(p) ? ' people-dot--done' : ''}`} title={p}>
          {initials(p)}
        </span>
      ))}
    </span>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]![0]}${parts.at(-1)![0]}`.toUpperCase() : name.slice(0, 2);
}

interface CheckProps {
  item: ItemRow;
  /** "eingepackt", "gekauft", "erledigt" */
  verb: string;
  /** After a change: the item is now done for everyone (or not). */
  onDone?: (allDone: boolean) => void;
  onClose: () => void;
}

/** "Für wen abhaken?": one button per person, ticks right away; "Alle" ticks everyone and closes. */
export function PersonCheckDialog({ item, verb, onDone, onClose }: CheckProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => ref.current?.showModal(), []);
  const persons = itemPersons(item);
  const done = itemDone(item);
  const close = () => ref.current?.close();

  const toggle = (p: string) => {
    const on = !done.includes(p);
    void setPersonChecked(item, { [p]: on });
    const all = persons.every((x) => (x === p ? on : done.includes(x)));
    onDone?.(all);
    if (all) close();
  };

  return (
    <dialog ref={ref} className="sheet" onClose={onClose}>
      <div className="sheet__body">
        <header className="sheet__header row">
          <h2 className="spacer">{item.name}</h2>
          <button type="button" className="icon-btn" aria-label="Schließen" onClick={close}>
            ✕
          </button>
        </header>
        <p className="muted">Für wen {verb}?</p>
        <div className="person-checks">
          {persons.map((p) => (
            <button
              key={p}
              type="button"
              className={`person-check${done.includes(p) ? ' person-check--done' : ''}`}
              aria-pressed={done.includes(p)}
              onClick={() => toggle(p)}
            >
              <span className="person-check__box" aria-hidden>
                {done.includes(p) ? '✓' : ''}
              </span>
              {p}
            </button>
          ))}
        </div>
        <footer className="sheet__actions">
          {done.length > 0 && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                void setChecked(item, false);
                onDone?.(false);
                close();
              }}
            >
              Keiner
            </button>
          )}
          <span className="spacer" />
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              void setChecked(item, true);
              onDone?.(true);
              close();
            }}
          >
            Alle
          </button>
        </footer>
      </div>
    </dialog>
  );
}
