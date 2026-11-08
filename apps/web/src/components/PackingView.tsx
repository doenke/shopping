import { useCustomCategories } from '../categories';
import {
  categoriesInOrder,
  categoryInList,
  itemDone,
  itemPersons,
  itemUrl,
  packingInfo,
  peopleLabel,
  type CatalogIndex,
  type CatalogItem,
  type ItemRow,
  type ListRow,
  type UserInfo,
} from '@shopping/shared';
import { forwardRef, useEffect, useMemo, useState } from 'react';
import { archiveList, setChecked, setPersonChecked } from '../actions';
import { navigate, useMe, useTileView } from '../hooks';
import type { RemoteCheck } from '../sync/engine';
import { AddBar } from './AddBar';
import { useLinkDrop } from '../linkDrop';
import { ItemEditor } from './ItemEditor';
import { Tile } from './Tile';
import { PeopleDots, PersonCheckDialog } from './People';

type GroupBy = 'category' | 'container' | 'person';

/** A tile: an item, or – grouped by person – one person's share of a multi-person item. */
interface Entry {
  item: ItemRow;
  person?: string;
}

const entryPacked = (e: Entry) => (e.person ? itemDone(e.item).includes(e.person) : e.item.checked);

const GROUP_LABEL: Record<GroupBy, string> = { category: 'Kategorie', container: 'Packstück', person: 'Person' };

interface Props {
  list: ListRow;
  items: ItemRow[];
  index: CatalogIndex;
  users: Map<string, UserInfo>;
  remoteChecks: Map<string, RemoteCheck>;
}

function loadGroupBy(listId: string): GroupBy {
  try {
    const v = localStorage.getItem(`packing-group:${listId}`);
    if (v === 'container' || v === 'person' || v === 'category') return v;
  } catch {
    // Storage unavailable (private mode): default grouping.
  }
  return 'category';
}

function loadFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function saveFlag(key: string, on: boolean): void {
  try {
    if (on) localStorage.setItem(key, '1');
    else localStorage.removeItem(key);
  } catch {
    // Not important enough to complain about.
  }
}

/**
 * Packing list: ticking means "packed" – the item stays where it is, crossed out,
 * so you can see what is still missing in each Packstück or for each person.
 */
export const PackingView = forwardRef<HTMLInputElement, Props>(function PackingView({ list, items, index, users, remoteChecks }, addRef) {
  const [editing, setEditing] = useState<string | null>(null);
  // Drag a link onto an entry (adds it there) or onto free space (new entry).
  const linkDrop = useLinkDrop(list.id, items);
  /** Multi-person item being ticked off ("Für wen?"). */
  const [checking, setChecking] = useState<string | null>(null);
  const [undo, setUndo] = useState<Entry | null>(null);
  const [groupBy, setGroupBy] = useState<GroupBy>(() => loadGroupBy(list.id));
  const [hidePacked, setHidePacked] = useState(() => loadFlag(`packing-hide:${list.id}`));

  useEffect(() => saveFlag(`packing-hide:${list.id}`, hidePacked), [hidePacked, list.id]);

  useEffect(() => {
    try {
      localStorage.setItem(`packing-group:${list.id}`, groupBy);
    } catch {
      // Not important enough to complain about.
    }
  }, [groupBy, list.id]);

  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), 4000);
    return () => clearTimeout(t);
  }, [undo]);

  // Sonnenbrille for Sönke and Ulli counts twice: two of them go into the bag.
  const total = items.reduce((n, i) => n + Math.max(1, itemPersons(i).length), 0);
  const packed = items.reduce((n, i) => n + (itemPersons(i).length ? itemDone(i).length : i.checked ? 1 : 0), 0);
  const allPacked = items.length > 0 && packed === total;

  const me = useMe();
  const custom = useCustomCategories();
  const [tileView] = useTileView();
  const groups = useMemo(() => {
    // Grouped by person, a multi-person item shows up with each of them – ticked off there just for them.
    const entries: Entry[] =
      groupBy === 'person'
        ? items.flatMap((i) => (itemPersons(i).length ? itemPersons(i).map((person) => ({ item: i, person })) : [{ item: i }]))
        : items.map((i) => ({ item: i }));
    const keyOf = (e: Entry): string => {
      const p = packingInfo(e.item);
      if (groupBy === 'person') return e.person ?? p.person ?? '';
      if (groupBy === 'container') return p.container ?? '';
      return categoryInList(e.item.categoryId, 'packing', custom).id;
    };
    const byKey = new Map<string, Entry[]>();
    for (const e of entries) byKey.set(keyOf(e), [...(byKey.get(keyOf(e)) ?? []), e]);
    const sortEntries = (rows: Entry[]) => rows.sort((a, b) => a.item.position.localeCompare(b.item.position));
    if (groupBy === 'category') {
      return categoriesInOrder('packing', me?.categoryOrder, custom)
        .filter((c) => byKey.has(c.id))
        .map((c) => ({ key: c.id, title: c.name, entries: sortEntries(byKey.get(c.id)!) }));
    }
    const empty = groupBy === 'person' ? 'Alle / ohne Person' : 'Ohne Packstück';
    return [...byKey.keys()]
      .sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, 'de')))
      .map((k) => ({ key: k || '-', title: k || empty, entries: sortEntries(byKey.get(k)!) }));
  }, [items, groupBy, me?.categoryOrder, custom]);

  const boost = useMemo(() => {
    const used = new Set(items.map((i) => i.catalogItemId));
    return (c: CatalogItem) => (used.has(c.id) ? -5 : 0);
  }, [items]);

  /** What the tile shows besides the grouping (no need to repeat the group). */
  const extraOf = (e: Entry) => {
    const p = packingInfo(e.item);
    const who = groupBy !== 'person' && !itemPersons(e.item).length ? peopleLabel(e.item) : null;
    return [who, groupBy !== 'container' ? p.container : null].filter(Boolean).join(' · ') || undefined;
  };

  const tap = (e: Entry) => {
    const persons = itemPersons(e.item);
    if (e.person) {
      const on = !itemDone(e.item).includes(e.person);
      void setPersonChecked(e.item, { [e.person]: on });
      if (on) setUndo(e);
      return;
    }
    if (persons.length) return setChecking(e.item.id);
    void setChecked(e.item, !e.item.checked);
    if (!e.item.checked) setUndo(e);
  };

  const editItem = items.find((i) => i.id === editing);
  const checkItem = items.find((i) => i.id === checking);

  return (
    <section className={`listview${tileView === 'rows' ? ' listview--rows' : ''}`} {...linkDrop}>
      <AddBar ref={addRef} listId={list.id} listType={list.listType} index={index} boost={boost} placeholder="Was kommt mit? z. B. 3 T-Shirts @Anna #Koffer" />

      {list.archivedAt && (
        <p className="template-hint">
          Archiviert – nur noch zum Nachschauen.{' '}
          <button type="button" className="link" onClick={() => void archiveList(list.id, false)}>
            Wieder aktivieren
          </button>
        </p>
      )}

      {items.length > 0 && (
        <div className="packing-head">
          <div className="packing-progress">
            <progress max={total} value={packed} />
            <span>
              {packed} von {total} eingepackt
            </span>
          </div>
          {packed > 0 && (
            <button type="button" className={`chip${hidePacked ? ' chip--on' : ''}`} aria-pressed={hidePacked} onClick={() => setHidePacked(!hidePacked)}>
              {hidePacked ? 'Eingepackte ausgeblendet' : 'Eingepackte ausblenden'}
            </button>
          )}
          <div className="segmented" role="group" aria-label="Gruppieren nach">
            {(Object.keys(GROUP_LABEL) as GroupBy[]).map((g) => (
              <button key={g} type="button" className={g === groupBy ? 'active' : ''} aria-pressed={g === groupBy} onClick={() => setGroupBy(g)}>
                {GROUP_LABEL[g]}
              </button>
            ))}
          </div>
        </div>
      )}

      {allPacked && !list.archivedAt && (
        <div className="empty empty--inline">
          <p className="empty__title">Alles eingepackt 🧳</p>
          <button
            type="button"
            className="btn"
            onClick={() => {
              void archiveList(list.id, true);
              navigate({ page: 'list' });
            }}
          >
            Nach der Reise archivieren
          </button>
        </div>
      )}

      {items.length === 0 && (
        <div className="empty">
          <p className="empty__title">Noch nichts auf der Packliste</p>
          <p>Tippe oben, was mit soll. Mit „@Anna“ gehört es Anna, mit „#Koffer“ kommt es in den Koffer – zum Beispiel „Zahnbürste @Ben #Kulturbeutel“.</p>
        </div>
      )}

      {groups.map((g) => {
        const done = g.entries.filter(entryPacked).length;
        // Hidden: packed ones go (someone else's tick shows for a moment first); fully packed groups too.
        const shown = hidePacked ? g.entries.filter((e) => !entryPacked(e) || remoteChecks.has(e.item.id)) : g.entries;
        if (shown.length === 0) return null;
        return (
          <div key={g.key} className="group">
            <h2 className="group__title">
              {g.title} <span className="group__count">{done === g.entries.length ? '✓' : `${done}/${g.entries.length}`}</span>
            </h2>
            <div className="tiles">
              {shown.map((e) => {
                const remote = remoteChecks.get(e.item.id);
                return (
                  <Tile
                    key={`${e.item.id}:${e.person ?? ''}`}
                    item={e.item}
                    url={itemUrl(e.item)}
                    variant={entryPacked(e) ? 'packed' : 'open'}
                    extra={extraOf(e)}
                    people={!e.person && itemPersons(e.item).length ? <PeopleDots item={e.item} /> : undefined}
                    badge={remote ? `✓ ${users.get(remote.by)?.displayName ?? ''}`.trim() : undefined}
                    badgeUser={remote ? users.get(remote.by) : undefined}
                    onTap={() => tap(e)}
                    onLongPress={() => setEditing(e.item.id)}
                    onToggle={() => tap(e)}
                  />
                );
              })}
            </div>
          </div>
        );
      })}

      {undo && (
        <div className="snackbar" role="status">
          <span>
            {undo.item.name} eingepackt{undo.person ? ` (${undo.person})` : ''}
          </span>
          <button
            type="button"
            onClick={() => {
              void (undo.person ? setPersonChecked(undo.item, { [undo.person]: false }) : setChecked(undo.item, false));
              setUndo(null);
            }}
          >
            Rückgängig
          </button>
        </div>
      )}

      {editItem && <ItemEditor key={editItem.id} item={editItem} list={list} items={items} users={users} onClose={() => setEditing(null)} />}
      {checkItem && <PersonCheckDialog key={checkItem.id} item={checkItem} verb="eingepackt" onClose={() => setChecking(null)} />}
    </section>
  );
});
