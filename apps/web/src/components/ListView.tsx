import { useCustomCategories } from '../categories';
import {
  categoriesInOrder,
  categoryInList,
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
import { clearChecked, setChecked } from '../actions';
import { shopModeKnown, shoppingActivity, startShopping, stopShopping, useShopping } from '../shopMode';
import { useMe, useTileView } from '../hooks';
import type { RemoteCheck } from '../sync/engine';
import { AddBar } from './AddBar';
import { useLinkDrop } from '../linkDrop';
import { ItemEditor } from './ItemEditor';
import { MemoView } from './MemoView';
import { PackingView } from './PackingView';
import { TodoView } from './TodoView';
import { TaskBoard } from './work/TaskBoard';
import { Tile } from './Tile';
import { PeopleDots, PersonCheckDialog } from './People';

interface Props {
  list: ListRow;
  items: ItemRow[];
  index: CatalogIndex;
  users: Map<string, UserInfo>;
  remoteChecks: Map<string, RemoteCheck>;
  /** Wide screen: ToDo lists as a table with details. */
  desktop?: boolean;
  /** Opens the list settings (Kanban: "Status festlegen"). */
  onEditList?: () => void;
}

const RECENT_LIMIT = 40;

export const ListView = forwardRef<HTMLInputElement, Props>(function ListView(props, addRef) {
  // Packing lists work differently: packed items stay visible (templates are shown like any template).
  if (props.list.listType === 'packing' && !props.list.isTemplate) return <PackingView ref={addRef} {...props} />;
  if (props.list.listType === 'memo') return <MemoView ref={addRef} {...props} />;
  // ToDo lists on the desktop: table + details (every ToDo list, work or not).
  if (props.list.listType === 'todo' && props.desktop && !props.list.isTemplate)
    return <TaskBoard list={props.list} items={props.items} index={props.index} users={props.users} onEditList={props.onEditList} />;
  if (props.list.listType === 'todo') return <TodoView ref={addRef} {...props} />;
  return <ShoppingView ref={addRef} {...props} />;
});

const ShoppingView = forwardRef<HTMLInputElement, Props>(function ShoppingView({ list, items, index, users, remoteChecks }, addRef) {
  const [editing, setEditing] = useState<string | null>(null);
  // Drag a link onto an entry (adds it there) or onto free space (new entry).
  const linkDrop = useLinkDrop(list.id, items);
  /** Multi-person item being ticked off ("Für wen?"). */
  const [checking, setChecking] = useState<string | null>(null);
  const [undo, setUndo] = useState<ItemRow | null>(null);
  const [showRecent, setShowRecent] = useState(false);
  const me = useMe();
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

  const custom = useCustomCategories();
  const [tileView] = useTileView();
  const groups = useMemo(() => {
    const byCat = new Map<string, ItemRow[]>();
    for (const i of open) {
      const cat = categoryInList(i.categoryId, list.listType, custom).id;
      byCat.set(cat, [...(byCat.get(cat) ?? []), i]);
    }
    return categoriesInOrder(list.listType, me?.categoryOrder, custom)
      .filter((c) => byCat.has(c.id))
      .map((c) => ({
        category: c,
        items: byCat.get(c.id)!.sort((a, b) => a.position.localeCompare(b.position)),
      }));
  }, [open, list.listType, me?.categoryOrder, custom]);

  const boost = useMemo(() => {
    const used = new Map<string, number>();
    for (const i of items) if (i.catalogItemId) used.set(i.catalogItemId, (used.get(i.catalogItemId) ?? 0) + 1);
    return (c: CatalogItem) => (used.get(c.id) ?? 0) * 5;
  }, [items]);

  /** Tick off (tap while shopping, Space everywhere); for several people: ask for whom. */
  const check = (item: ItemRow, remote: boolean) => {
    if (remote || list.isTemplate) return;
    if (itemPersons(item).length) return setChecking(item.id);
    void setChecked(item, true);
    setUndo(item);
    afterCheck(item.id, true);
  };

  /** The last item: shopping is over. */
  const afterCheck = (id: string, allDone: boolean) => {
    if (allDone && open.every((i) => i.id === id || remoteChecks.has(i.id))) {
      stopShopping();
      setDone(true);
    } else {
      shoppingActivity();
    }
  };

  const editItem = items.find((i) => i.id === editing);
  const checkItem = items.find((i) => i.id === checking);

  return (
    <section className={`listview${shopping ? ' listview--shopping' : ''}${tileView === 'rows' ? ' listview--rows' : ''}`} {...linkDrop}>
      <AddBar
        ref={addRef}
        listId={list.id}
        listType={list.listType}
        index={index}
        boost={boost}
        placeholder={list.listType === 'packing' ? 'Was kommt mit? z. B. 3 T-Shirts @Anna #Koffer' : undefined}
      />

      {list.isTemplate && (
        <p className="template-hint">
          ◇ Vorlage – hier wird nichts abgehakt. Sie füllt neue Listen vor („+ Neu“) und lässt sich mit Listen abgleichen („⋮ → Mit Vorlage abgleichen“).
          Antippen bearbeitet einen Artikel.
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
                  url={itemUrl(item)}
                  fading={!!remote}
                  badge={remote ? `✓ ${users.get(remote.by)?.displayName ?? ''}`.trim() : list.isTemplate && item.optional ? 'optional' : undefined}
                  badgeUser={remote ? users.get(remote.by) : undefined}
                  extra={[itemPersons(item).length ? null : peopleLabel(item), packingInfo(item).container].filter(Boolean).join(' · ') || undefined}
                  people={itemPersons(item).length ? <PeopleDots item={item} /> : undefined}
                  onTap={() => (shopping ? check(item, !!remote) : setEditing(item.id))}
                  onLongPress={() => setEditing(item.id)}
                  onToggle={() => check(item, !!remote)}
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
                <Tile
                  key={item.id}
                  item={item}
                  url={itemUrl(item)}
                  variant="done"
                  onTap={() => void setChecked(item, false)}
                  onLongPress={() => setEditing(item.id)}
                />
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
      {checkItem && (
        <PersonCheckDialog
          key={checkItem.id}
          item={checkItem}
          verb="gekauft"
          onDone={(all) => afterCheck(checkItem.id, all)}
          onClose={() => setChecking(null)}
        />
      )}
    </section>
  );
});
