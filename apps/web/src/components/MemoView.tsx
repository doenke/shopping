import { useTileView } from '../hooks';
import { listDescription, packingInfo, type CatalogIndex, type ItemRow, type ListRow, type UserInfo } from '@shopping/shared';
import { forwardRef, useEffect, useMemo, useState } from 'react';
import { setChecked } from '../actions';
import type { RemoteCheck } from '../sync/engine';
import { AddBar } from './AddBar';
import { ItemEditor } from './ItemEditor';
import { Tile } from './Tile';

type GroupBy = 'none' | 'where' | 'from';

const GROUP_LABEL: Record<GroupBy, string> = { none: 'Alle', where: 'Wo', from: 'Tipp von' };

interface Props {
  list: ListRow;
  items: ItemRow[];
  index: CatalogIndex;
  users: Map<string, UserInfo>;
  remoteChecks: Map<string, RemoteCheck>;
}

function loadGroupBy(listId: string): GroupBy {
  try {
    const v = localStorage.getItem(`memo-group:${listId}`);
    if (v === 'none' || v === 'where' || v === 'from') return v;
  } catch {
    // Storage unavailable: default grouping.
  }
  return 'none';
}

const noBoost = () => 0;

/**
 * Merkliste (films, books, restaurants …): who recommended it and where to find it.
 * Ticked off means done (seen, read, visited) – it moves to "Erledigt", nothing is lost.
 */
export const MemoView = forwardRef<HTMLInputElement, Props>(function MemoView({ list, items, index, users, remoteChecks }, addRef) {
  const [tileView] = useTileView();
  const [editing, setEditing] = useState<string | null>(null);
  const [undo, setUndo] = useState<ItemRow | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [groupBy, setGroupBy] = useState<GroupBy>(() => loadGroupBy(list.id));
  const description = listDescription(list);

  useEffect(() => {
    try {
      localStorage.setItem(`memo-group:${list.id}`, groupBy);
    } catch {
      // Not important.
    }
  }, [groupBy, list.id]);

  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), 4000);
    return () => clearTimeout(t);
  }, [undo]);

  const open = items.filter((i) => !i.checked || remoteChecks.has(i.id));
  const done = items.filter((i) => i.checked && !remoteChecks.has(i.id)).sort((a, b) => (b.checkedAt ?? '').localeCompare(a.checkedAt ?? ''));

  const groups = useMemo(() => {
    const sorted = [...open].sort((a, b) => a.position.localeCompare(b.position));
    if (groupBy === 'none') return [{ key: 'all', title: null as string | null, items: sorted }];
    const keyOf = (i: ItemRow) => (groupBy === 'where' ? packingInfo(i).container : packingInfo(i).person) ?? '';
    const byKey = new Map<string, ItemRow[]>();
    for (const i of sorted) byKey.set(keyOf(i), [...(byKey.get(keyOf(i)) ?? []), i]);
    return [...byKey.keys()]
      .sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, 'de')))
      .map((k) => ({ key: k || '-', title: k || (groupBy === 'where' ? 'Ohne Ort' : 'Ohne Tippgeber'), items: byKey.get(k)! }));
  }, [open, groupBy]);

  /** Tip and place under the name (minus what the grouping already says). */
  const extraOf = (i: ItemRow) => {
    const p = packingInfo(i);
    return [groupBy !== 'where' ? p.container : null, groupBy !== 'from' && p.person ? `Tipp von ${p.person}` : null].filter(Boolean).join(' · ') || undefined;
  };

  const editItem = items.find((i) => i.id === editing);

  return (
    <section className={`listview${tileView === 'rows' ? ' listview--rows' : ''}`}>
      <AddBar ref={addRef} listId={list.id} listType={list.listType} index={index} boost={noBoost} placeholder="Was wollt ihr euch merken? z. B. Dune @Ben #Netflix" />

      {description && <p className="list-description">{description}</p>}

      {items.length > 0 && (
        <div className="packing-head">
          <span className="muted">
            {open.length} offen{done.length ? ` · ${done.length} erledigt` : ''}
          </span>
          <div className="segmented" role="group" aria-label="Gruppieren nach">
            {(Object.keys(GROUP_LABEL) as GroupBy[]).map((g) => (
              <button key={g} type="button" className={g === groupBy ? 'active' : ''} aria-pressed={g === groupBy} onClick={() => setGroupBy(g)}>
                {GROUP_LABEL[g]}
              </button>
            ))}
          </div>
        </div>
      )}

      {items.length === 0 && (
        <div className="empty">
          <p className="empty__title">Noch nichts gemerkt</p>
          <p>
            Tippe oben, was ihr euch merken wollt. Mit „@Ben“ merkst du, von wem der Tipp kommt, mit „#Netflix“, wo es das gibt – zum Beispiel
            „Dune @Ben #Netflix“.
          </p>
        </div>
      )}

      {groups.map((g) => (
        <div key={g.key} className="group">
          {g.title && <h2 className="group__title">{g.title}</h2>}
          <div className="tiles">
            {g.items.map((item) => {
              const remote = remoteChecks.get(item.id);
              return (
                <Tile
                  key={item.id}
                  item={item}
                  extra={extraOf(item)}
                  fading={!!remote}
                  badge={remote ? `✓ ${users.get(remote.by)?.displayName ?? ''}`.trim() : undefined}
                  badgeUser={remote ? users.get(remote.by) : undefined}
                  onTap={() => {
                    if (remote) return;
                    void setChecked(item, true);
                    setUndo(item);
                  }}
                  onLongPress={() => setEditing(item.id)}
                />
              );
            })}
          </div>
        </div>
      ))}

      {done.length > 0 && (
        <div className="group group--recent">
          <div className="group__head">
            <button type="button" className="group__toggle" onClick={() => setShowDone((s) => !s)} aria-expanded={showDone}>
              {showDone ? '▾' : '▸'} Erledigt ({done.length})
            </button>
          </div>
          {showDone && (
            <div className="tiles">
              {done.map((item) => (
                <Tile key={item.id} item={item} variant="done" extra={extraOf(item)} onTap={() => void setChecked(item, false)} onLongPress={() => setEditing(item.id)} />
              ))}
            </div>
          )}
        </div>
      )}

      {undo && (
        <div className="snackbar" role="status">
          <span>{undo.name} erledigt</span>
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
