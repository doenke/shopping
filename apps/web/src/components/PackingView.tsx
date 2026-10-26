import { categoriesFor, categoryInList, packingInfo, type CatalogIndex, type CatalogItem, type ItemRow, type ListRow, type UserInfo } from '@shopping/shared';
import { forwardRef, useEffect, useMemo, useState } from 'react';
import { archiveList, setChecked } from '../actions';
import { navigate } from '../hooks';
import type { RemoteCheck } from '../sync/engine';
import { AddBar } from './AddBar';
import { ItemEditor } from './ItemEditor';
import { Tile } from './Tile';

type GroupBy = 'category' | 'container' | 'person';

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

/**
 * Packing list: ticking means "packed" – the item stays where it is, crossed out,
 * so you can see what is still missing in each Packstück or for each person.
 */
export const PackingView = forwardRef<HTMLInputElement, Props>(function PackingView({ list, items, index, users, remoteChecks }, addRef) {
  const [editing, setEditing] = useState<string | null>(null);
  const [undo, setUndo] = useState<ItemRow | null>(null);
  const [groupBy, setGroupBy] = useState<GroupBy>(() => loadGroupBy(list.id));

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

  const packed = items.filter((i) => i.checked).length;
  const allPacked = items.length > 0 && packed === items.length;

  const groups = useMemo(() => {
    const keyOf = (i: ItemRow): string => {
      const p = packingInfo(i);
      if (groupBy === 'person') return p.person ?? '';
      if (groupBy === 'container') return p.container ?? '';
      return categoryInList(i.categoryId, 'packing').id;
    };
    const byKey = new Map<string, ItemRow[]>();
    for (const i of items) byKey.set(keyOf(i), [...(byKey.get(keyOf(i)) ?? []), i]);
    const sortItems = (rows: ItemRow[]) => rows.sort((a, b) => a.position.localeCompare(b.position));
    if (groupBy === 'category') {
      return categoriesFor('packing')
        .filter((c) => byKey.has(c.id))
        .map((c) => ({ key: c.id, title: c.name, items: sortItems(byKey.get(c.id)!) }));
    }
    const empty = groupBy === 'person' ? 'Alle / ohne Person' : 'Ohne Packstück';
    return [...byKey.keys()]
      .sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, 'de')))
      .map((k) => ({ key: k || '-', title: k || empty, items: sortItems(byKey.get(k)!) }));
  }, [items, groupBy]);

  const boost = useMemo(() => {
    const used = new Set(items.map((i) => i.catalogItemId));
    return (c: CatalogItem) => (used.has(c.id) ? -5 : 0);
  }, [items]);

  /** What the tile shows besides the grouping (no need to repeat the group). */
  const extraOf = (i: ItemRow) => {
    const p = packingInfo(i);
    return [groupBy !== 'person' ? p.person : null, groupBy !== 'container' ? p.container : null].filter(Boolean).join(' · ') || undefined;
  };

  const editItem = items.find((i) => i.id === editing);

  return (
    <section className="listview">
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
            <progress max={items.length} value={packed} />
            <span>
              {packed} von {items.length} eingepackt
            </span>
          </div>
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
          <p>
            Tippe oben, was mit soll. Mit „@Anna“ gehört es Anna, mit „#Koffer“ kommt es in den Koffer – zum Beispiel „Zahnbürste @Ben
            #Kulturbeutel“.
          </p>
        </div>
      )}

      {groups.map((g) => {
        const done = g.items.filter((i) => i.checked).length;
        return (
          <div key={g.key} className="group">
            <h2 className="group__title">
              {g.title} <span className="group__count">{done === g.items.length ? '✓' : `${done}/${g.items.length}`}</span>
            </h2>
            <div className="tiles">
              {g.items.map((item) => {
                const remote = remoteChecks.get(item.id);
                return (
                  <Tile
                    key={item.id}
                    item={item}
                    variant={item.checked ? 'packed' : 'open'}
                    extra={extraOf(item)}
                    badge={remote ? `✓ ${users.get(remote.by)?.displayName ?? ''}`.trim() : undefined}
                    badgeUser={remote ? users.get(remote.by) : undefined}
                    onTap={() => {
                      void setChecked(item, !item.checked);
                      if (!item.checked) setUndo(item);
                    }}
                    onLongPress={() => setEditing(item.id)}
                  />
                );
              })}
            </div>
          </div>
        );
      })}

      {undo && (
        <div className="snackbar" role="status">
          <span>{undo.name} eingepackt</span>
          <button
            type="button"
            onClick={() => {
              void setChecked(undo, false);
              setUndo(null);
            }}
          >
            Rückgängig
          </button>
        </div>
      )}

      {editItem && <ItemEditor key={editItem.id} item={editItem} list={list} items={items} users={users} onClose={() => setEditing(null)} />}
    </section>
  );
});
