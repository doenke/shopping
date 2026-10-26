import { categoriesFor, categoryInList, packingInfo, type CatalogIndex, type CatalogItem, type ItemRow, type ListRow, type UserInfo } from '@shopping/shared';
import { forwardRef, useEffect, useMemo, useState } from 'react';
import { clearChecked, setChecked } from '../actions';
import { shopModeKnown, shoppingActivity, startShopping, stopShopping, useShopping } from '../shopMode';
import type { RemoteCheck } from '../sync/engine';
import { AddBar } from './AddBar';
import { ItemEditor } from './ItemEditor';
import { MemoView } from './MemoView';
import { PackingView } from './PackingView';
import { TodoView } from './TodoView';
import { Tile } from './Tile';

interface Props {
  list: ListRow;
  items: ItemRow[];
  index: CatalogIndex;
  users: Map<string, UserInfo>;
  remoteChecks: Map<string, RemoteCheck>;
}

const RECENT_LIMIT = 40;

export const ListView = forwardRef<HTMLInputElement, Props>(function ListView(props, addRef) {
  // Packing lists work differently: packed items stay visible (templates are shown like any template).
  if (props.list.listType === 'packing' && !props.list.isTemplate) return <PackingView ref={addRef} {...props} />;
  if (props.list.listType === 'memo') return <MemoView ref={addRef} {...props} />;
  if (props.list.listType === 'todo') return <TodoView ref={addRef} {...props} />;
  return <ShoppingView ref={addRef} {...props} />;
});

const ShoppingView = forwardRef<HTMLInputElement, Props>(function ShoppingView({ list, items, index, users, remoteChecks }, addRef) {
  const [editing, setEditing] = useState<string | null>(null);
  const [undo, setUndo] = useState<ItemRow | null>(null);
  const [showRecent, setShowRecent] = useState(false);
  // At home a tap opens an item; only while shopping does it check it off. Templates are never checked.
  const shopping = useShopping() && !list.isTemplate;
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (shopping) setDone(false);
  }, [shopping]);

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
      const cat = categoryInList(i.categoryId, list.listType).id;
      byCat.set(cat, [...(byCat.get(cat) ?? []), i]);
    }
    return categoriesFor(list.listType).filter((c) => byCat.has(c.id)).map((c) => ({
      category: c,
      items: byCat.get(c.id)!.sort((a, b) => a.position.localeCompare(b.position)),
    }));
  }, [open, list.listType]);

  const boost = useMemo(() => {
    const used = new Map<string, number>();
    for (const i of items) if (i.catalogItemId) used.set(i.catalogItemId, (used.get(i.catalogItemId) ?? 0) + 1);
    return (c: CatalogItem) => (used.get(c.id) ?? 0) * 5;
  }, [items]);

  const editItem = items.find((i) => i.id === editing);

  return (
    <section className={`listview${shopping ? ' listview--shopping' : ''}`}>
      <AddBar
        ref={addRef}
        listId={list.id}
        index={index}
        boost={boost}
        placeholder={list.listType === 'packing' ? 'Was kommt mit? z. B. 3 T-Shirts @Anna #Koffer' : undefined}
      />

      {list.isTemplate && (
        <p className="template-hint">
          ◇ Vorlage – hier wird nichts abgehakt. Sie füllt neue Listen vor („+ Neu“) und lässt sich mit Listen abgleichen („⋮ → Mit Vorlage abgleichen“). Antippen
          bearbeitet einen Artikel.
        </p>
      )}

      {!shopping && !list.isTemplate && open.length > 0 && !shopModeKnown() && (
        <p className="mode-hint">
          🏠 Zuhause hakt Antippen nichts ab, sondern öffnet den Artikel. Im Laden auf{' '}
          <button type="button" className="link" onClick={startShopping}>
            🛒 Einkaufen
          </button>{' '}
          tippen – dann hakt Antippen ab.
        </p>
      )}

      {done && open.length === 0 && (
        <div className="empty">
          <p className="empty__title">Einkauf fertig 🎉</p>
          <p>Zurück im Zuhause-Modus.</p>
        </div>
      )}

      {!done && open.length === 0 && !list.isTemplate && (
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
                  fading={!!remote}
                  badge={remote ? `✓ ${users.get(remote.by)?.displayName ?? ''}`.trim() : list.isTemplate && item.optional ? 'optional' : undefined}
                  badgeUser={remote ? users.get(remote.by) : undefined}
                  extra={[packingInfo(item).person, packingInfo(item).container].filter(Boolean).join(' · ') || undefined}
                  onTap={() => {
                    if (!shopping) return setEditing(item.id);
                    if (remote) return;
                    void setChecked(item, true);
                    setUndo(item);
                    // The last item: shopping is over.
                    if (open.every((i) => i.id === item.id || remoteChecks.has(i.id))) {
                      stopShopping();
                      setDone(true);
                    } else {
                      shoppingActivity();
                    }
                  }}
                  onLongPress={() => setEditing(item.id)}
                />
              );
            })}
          </div>
        </div>
      ))}

      {recent.length > 0 && !list.isTemplate && (
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

      {editItem && <ItemEditor key={editItem.id} item={editItem} list={list} items={items} users={users} onClose={() => setEditing(null)} />}
    </section>
  );
});
