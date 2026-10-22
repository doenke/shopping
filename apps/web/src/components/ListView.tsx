import { CATEGORIES, getCategory, type CatalogIndex, type CatalogItem, type ItemRow, type ListRow, type UserInfo } from '@shopping/shared';
import { forwardRef, useEffect, useMemo, useState } from 'react';
import { clearChecked, setChecked } from '../actions';
import type { RemoteCheck } from '../sync/engine';
import { AddBar } from './AddBar';
import { ItemEditor } from './ItemEditor';
import { Tile } from './Tile';

interface Props {
  list: ListRow;
  items: ItemRow[];
  index: CatalogIndex;
  users: Map<string, UserInfo>;
  remoteChecks: Map<string, RemoteCheck>;
}

const RECENT_LIMIT = 40;

export const ListView = forwardRef<HTMLInputElement, Props>(function ListView({ list, items, index, users, remoteChecks }, addRef) {
  const [editing, setEditing] = useState<string | null>(null);
  const [undo, setUndo] = useState<ItemRow | null>(null);
  const [showRecent, setShowRecent] = useState(false);

  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), 4000);
    return () => clearTimeout(t);
  }, [undo]);

  // Items checked by someone else stay visible for a moment, marked "✓ Anna".
  const open = items.filter((i) => !i.checked || remoteChecks.has(i.id));
  const recent = items
    .filter((i) => i.checked && !remoteChecks.has(i.id))
    .sort((a, b) => (b.checkedAt ?? '').localeCompare(a.checkedAt ?? ''))
    .slice(0, RECENT_LIMIT);

  const groups = useMemo(() => {
    const byCat = new Map<string, ItemRow[]>();
    for (const i of open) {
      const cat = getCategory(i.categoryId).id;
      byCat.set(cat, [...(byCat.get(cat) ?? []), i]);
    }
    return CATEGORIES.filter((c) => byCat.has(c.id)).map((c) => ({
      category: c,
      items: byCat.get(c.id)!.sort((a, b) => a.position.localeCompare(b.position)),
    }));
  }, [open]);

  const boost = useMemo(() => {
    const used = new Map<string, number>();
    for (const i of items) if (i.catalogItemId) used.set(i.catalogItemId, (used.get(i.catalogItemId) ?? 0) + 1);
    return (c: CatalogItem) => (used.get(c.id) ?? 0) * 5;
  }, [items]);

  const editItem = items.find((i) => i.id === editing);

  return (
    <section className="listview">
      <AddBar ref={addRef} listId={list.id} index={index} boost={boost} />

      {open.length === 0 && (
        <div className="empty">
          <p className="empty__title">Alles erledigt 🎉</p>
          <p>Tippe oben, was ihr braucht – oder hol etwas aus „Zuletzt verwendet“ zurück.</p>
        </div>
      )}

      {groups.map(({ category, items: catItems }) => (
        <div key={category.id} className="group">
          <h2 className="group__title">{category.name}</h2>
          <div className="tiles">
            {catItems.map((item) => {
              const remote = remoteChecks.get(item.id);
              return (
                <Tile
                  key={item.id}
                  item={item}
                  badge={remote ? `✓ ${users.get(remote.by)?.displayName ?? ''}`.trim() : undefined}
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

      {recent.length > 0 && (
        <div className="group group--recent">
          <div className="group__head">
            <button type="button" className="group__toggle" onClick={() => setShowRecent((s) => !s)} aria-expanded={showRecent}>
              {showRecent ? '▾' : '▸'} Zuletzt verwendet ({recent.length})
            </button>
            {showRecent && (
              <button type="button" className="link" onClick={() => void clearChecked(list.id)}>
                leeren
              </button>
            )}
          </div>
          {showRecent && (
            <div className="tiles">
              {recent.map((item) => (
                <Tile key={item.id} item={item} variant="done" onTap={() => void setChecked(item, false)} onLongPress={() => setEditing(item.id)} />
              ))}
            </div>
          )}
        </div>
      )}

      {undo && (
        <div className="snackbar" role="status">
          <span>{undo.name} gekauft</span>
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

      {editItem && <ItemEditor key={editItem.id} item={editItem} users={users} onClose={() => setEditing(null)} />}
    </section>
  );
});
