import { categoriesInOrder, groupLists, inUserOrder, listGroup, parseInput, type ListRow, type ListType, type Me, type SectionKey } from '@shopping/shared';
import { useEffect, useRef, useState } from 'react';
import { addItems, setCategoryOrder, setListOrder, setSectionOrder } from './actions';
import { CatalogPanel } from './components/CatalogPanel';
import { IconReview } from './components/IconReview';
import { startShopping, stopShopping, useShopping, useWakeLock } from './shopMode';
import { Help } from './components/Help';
import { ListIcon } from './components/ListIcon';
import { ListEditDialog } from './components/ListEditDialog';
import { InstallButton } from './components/InstallButton';
import { ListAvatars } from './components/ListAvatars';
import { MembersDialog } from './components/MembersDialog';
import { LIST_TYPE_LABEL, NewListDialog } from './components/NewListDialog';
import { SortDialog } from './components/SortDialog';
import { SyncTemplateDialog } from './components/SyncTemplateDialog';
import { RecipeUrlDialog, findUrl } from './components/RecipeUrlDialog';
import { ListView } from './components/ListView';
import { Login } from './components/Login';
import { SECTION_TITLE, Settings } from './components/Settings';
import { SyncBadge, SyncDot, useSyncInfo } from './components/SyncBadge';
import { CategoryContext } from './categories';
import { setMeta } from './db';
import { IconContext } from './icons';
import { navigate, useCatalog, useCategoryRows, useIcons, useItems, useLists, useMe, useMediaQuery, useRemoteChecks, useRoute, useUsers } from './hooks';
import { sync } from './sync/engine';

import { ListMenu } from './components/ListMenu';
import { ListBadges, OpenCount } from './components/ListBadges';

export function App() {
  const me = useMe();
  const [checking, setChecking] = useState(true);

  // A logged-in device starts from its local data right away (offline too).
  // Without local data we ask the server whether a session exists (e.g. right after the OIDC redirect).
  useEffect(() => {
    if (me === undefined) return;
    if (me) {
      void sync.start();
      setChecking(false);
      return;
    }
    fetch('/api/v1/me', { cache: 'no-store' })
      .then(async (res) => {
        if (res.ok) await setMeta('me', await res.json());
      })
      .catch(() => undefined)
      .finally(() => setChecking(false));
  }, [me]);

  if (me === undefined || (me === null && checking)) return <div className="splash" />;
  // "?next=" means the server sent us here to log in first (e.g. from a list link).
  if (!me || new URLSearchParams(location.search).has('next')) return <Login />;
  return <Shell me={me} />;
}

function Shell({ me }: { me: Me }) {
  const route = useRoute();
  const lists = useLists();
  const catalog = useCatalog();
  const icons = useIcons(catalog.items);
  const customCategories = useCategoryRows();
  const users = useUsers();
  const remoteChecks = useRemoteChecks();
  const wide = useMediaQuery('(min-width: 900px)');
  const extraWide = useMediaQuery('(min-width: 1250px)');
  const [drawer, setDrawer] = useState(false);
  const syncState = useSyncInfo(me.isGuest).state;
  const [menu, setMenu] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  /** Bumped when the members dialog closes, so the avatars in the title bar reload. */
  const [membersSeen, setMembersSeen] = useState(0);
  const guest = me.isGuest;
  const [newDialog, setNewDialog] = useState(false);
  const [syncDialog, setSyncDialog] = useState(false);
  /** Lists in the user's own order (lists not in it keep their usual place behind). */
  const ordered = inUserOrder(lists, me.listOrder, (l) => l.id);
  const shoppingLists = ordered.filter((l) => !l.isTemplate && !l.archivedAt && l.listType === 'shopping');
  const packingLists = ordered.filter((l) => !l.isTemplate && !l.archivedAt && l.listType === 'packing');
  const memoLists = ordered.filter((l) => !l.isTemplate && !l.archivedAt && l.listType === 'memo');
  const todoLists = ordered.filter((l) => !l.isTemplate && !l.archivedAt && l.listType === 'todo');
  const archived = ordered.filter((l) => !l.isTemplate && l.archivedAt);
  const templates = ordered.filter((l) => l.isTemplate);
  const [editing, setEditing] = useState(false);
  /** Short note at the bottom ("Liste als Text kopiert"). */
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 2500);
    return () => clearTimeout(t);
  }, [notice]);
  const [sorting, setSorting] = useState<'lists' | ListType | null>(null);
  const TYPE_ICON: Record<ListType, string> = { shopping: '', packing: '🧳 ', memo: '📌 ', todo: '✅ ' };
  /** Sidebar: only sections that have lists. */
  /** Sidebar sections, in the user's own order (Merklisten at the bottom, for instance). */
  const sections: { key: SectionKey; title: string | null; lists: ListRow[]; prefix: (l: ListRow) => string; grouped?: boolean }[] = inUserOrder(
    [
      { key: 'shopping', title: null, lists: shoppingLists, prefix: () => '' },
      { key: 'packing', title: 'Packlisten', lists: packingLists, prefix: () => '🧳 ' },
      { key: 'memo', title: 'Merklisten', lists: memoLists, prefix: () => '📌 ' },
      { key: 'todo', title: 'ToDo', lists: todoLists, prefix: () => '✅ ', grouped: true },
      { key: 'templates', title: 'Vorlagen', lists: templates, prefix: (l: ListRow) => TYPE_ICON[l.listType] },
    ],
    me.sectionOrder,
    (s) => s.key,
  );
  const listLinks = (ls: ListRow[], prefix: (l: ListRow) => string) => (
    <ul>
      {ls.map((l) => (
        <li key={l.id}>
          <a href={`#/list/${l.id}`} className={l.id === list?.id && route.page === 'list' ? 'active' : ''} onClick={() => setDrawer(false)}>
            <span>
              {l.id === me.defaultListId && <span title="Hauptliste">⭐ </span>}
              {l.isTemplate && '◇ '}
              <ListIcon list={l} fallback={prefix(l)} />
              {l.name}
              <ListBadges list={l} />
            </span>
            {!l.isTemplate && <OpenCount listId={l.id} />}
          </a>
        </li>
      ))}
    </ul>
  );
  const mainList = shoppingLists.find((l) => l.id === me.defaultListId) ?? shoppingLists[0];
  const listId = route.page === 'list' ? (route.listId ?? (mainList ?? packingLists[0])?.id) : undefined;
  const addRef = useRef<HTMLInputElement>(null);

  const list = lists.find((l) => l.id === listId);
  const shopping = useShopping();
  /** The mode switch only exists on shopping lists; packing and ToDo lists are checked off at home. */
  const shopList = route.page === 'list' && !!list && list.listType === 'shopping' && !list.isTemplate;
  const shopMode = shopList && shopping;
  useWakeLock(shopMode);
  const items = useItems(list?.id);

  // Shared text from another app ("Teilen → Shopping") lands on the main list; a recipe link opens its ingredients.
  const [sharedRecipe, setSharedRecipe] = useState<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const text = [params.get('share_title'), params.get('share_text'), params.get('share_url')].filter(Boolean).join(' ');
    const target = mainList?.id;
    if (!text || !target) return;
    history.replaceState(null, '', '/');
    const link = findUrl(text);
    if (link) setSharedRecipe(link);
    else void addItems(target, parseInput(text, catalog.index));
  }, [mainList?.id, catalog.index]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('join') === 'invalid') {
      history.replaceState(null, '', '/');
      alert('Dieser Link ist nicht mehr gültig. Bitte lass dir einen neuen schicken.');
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        addRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const newList = () => {
    setNewDialog(true);
    setDrawer(false);
  };

  const sidebar = (
    <nav className="sidebar" aria-label="Listen">
      <a
        href={mainList ? `#/list/${mainList.id}` : '#/'}
        className="sidebar__head"
        title="Zur Hauptliste"
        onClick={(e) => {
          e.preventDefault();
          setDrawer(false);
          navigate(mainList ? { page: 'list', listId: mainList.id } : { page: 'list' });
        }}
      >
        <img src="/icon.svg" alt="" width={28} height={28} />
        <strong>Shopping</strong>
      </a>
      {!guest && (
        <button type="button" className="btn btn--primary sidebar__new" onClick={() => newList()}>
          + Neu
        </button>
      )}
      {sections.map(
        (sec) =>
          sec.lists.length > 0 && (
            <div key={sec.title}>
              {sec.title && <h3 className="sidebar__section">{sec.title}</h3>}
              {sec.grouped
                ? groupLists(sec.lists).map((g, _i, all) => (
                    <div key={g.group}>
                      {all.length > 1 && <h4 className="sidebar__subsection">{g.group}</h4>}
                      {listLinks(g.lists, sec.prefix)}
                    </div>
                  ))
                : listLinks(sec.lists, sec.prefix)}
            </div>
          ),
      )}
      {archived.length > 0 && (
        <details className="sidebar__archive">
          <summary className="sidebar__section">Archiv ({archived.length})</summary>
          <ul>
            {archived.map((l) => (
              <li key={l.id}>
                <a href={`#/list/${l.id}`} className={l.id === list?.id && route.page === 'list' ? 'active' : ''} onClick={() => setDrawer(false)}>
                  <span>
                    <ListIcon list={l} fallback={TYPE_ICON[l.listType]} />
                    {l.name}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}
      <span className="spacer" />
      <a href="#/help" className={route.page === 'help' ? 'active' : ''} onClick={() => setDrawer(false)}>
        ❓ Hilfe
      </a>
      <a href="#/settings" className={route.page === 'settings' || route.page === 'icons' ? 'active' : ''} onClick={() => setDrawer(false)}>
        ⚙ Einstellungen
      </a>
    </nav>
  );

  return (
    <IconContext.Provider value={icons}>
      <CategoryContext.Provider value={customCategories}>
        <div
          className={`shell${wide ? ' shell--wide' : ''}${extraWide && route.page === 'list' && list && list.listType !== 'memo' && list.listType !== 'todo' ? ' shell--catalog' : ''}`}
        >
          {wide
            ? sidebar
            : drawer && (
                <div
                  className="drawer"
                  onClick={(e) => {
                    // Closes on the backdrop or a link/button – not when a section like "Archiv" is unfolded.
                    const t = e.target as HTMLElement;
                    if (t === e.currentTarget || (t.closest('a, button') && !t.closest('summary'))) setDrawer(false);
                  }}
                >
                  {sidebar}
                </div>
              )}

          <div className="main">
            <header className={`topbar${shopMode ? ' topbar--shopping' : ''}`}>
              {!wide && (
                <button type="button" className="icon-btn" aria-label="Listen" onClick={() => setDrawer(true)}>
                  ☰
                </button>
              )}
              <h1 className="topbar__title">
                {route.page === 'list' && list && <ListIcon list={list} size="md" />}
                {route.page === 'settings'
                  ? route.section
                    ? SECTION_TITLE[route.section]
                    : 'Einstellungen'
                  : route.page === 'icons'
                    ? 'Icons'
                    : route.page === 'help'
                      ? 'Hilfe'
                      : (list?.name ?? 'Shopping')}
              </h1>
              {shopList &&
                (shopping ? (
                  <button type="button" className="shop-toggle shop-toggle--on" onClick={stopShopping} aria-label="Einkauf beenden, zurück zu Zuhause">
                    🛒<span className="shop-toggle__label"> Einkaufen</span> <span aria-hidden>✕</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="shop-toggle"
                    onClick={startShopping}
                    aria-label="Einkaufen starten"
                    title="Einkaufen starten – dann hakt Antippen ab"
                  >
                    🛒
                  </button>
                ))}
              {/* Phones: the people and the sync state move into the list menu, so the name keeps its room. */}
              {route.page === 'list' && list && wide && <ListAvatars listId={list.id} refresh={membersSeen} onClick={() => setShowMembers(true)} />}
              <InstallButton />
              {(wide || !list || route.page !== 'list' || syncState === 'unauthorized') && <SyncBadge guest={me.isGuest} />}
              {route.page === 'list' && list && (
                <div className="menu">
                  <button type="button" className="icon-btn menu__button" aria-label="Listenmenü" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
                    ⋮{!wide && <SyncDot guest={me.isGuest} />}
                  </button>
                  {menu && (
                    <ListMenu
                      list={list}
                      me={me}
                      compact={!wide}
                      membersSeen={membersSeen}
                      hasTemplates={templates.some((t) => t.listType === list.listType)}
                      onClose={() => setMenu(false)}
                      onApplyTemplate={() => setSyncDialog(true)}
                      onMembers={() => setShowMembers(true)}
                      onEdit={() => setEditing(true)}
                      onCopied={() => setNotice('Liste als Text kopiert')}
                      onNotice={setNotice}
                    />
                  )}
                </div>
              )}
            </header>

            <main className="content">
              {route.page === 'help' ? (
                <Help me={me} />
              ) : route.page === 'settings' ? (
                <Settings key={route.section ?? 'overview'} me={me} section={route.section} onSort={setSorting} />
              ) : route.page === 'icons' && !guest ? (
                <>
                  <a className="settings-back" href="#/settings">
                    ‹ Einstellungen
                  </a>
                  <IconReview catalog={catalog.items} admin={me.isAdmin} />
                </>
              ) : list && items ? (
                <ListView
                  ref={addRef}
                  key={list.id}
                  list={list}
                  items={items}
                  index={
                    list.listType === 'packing'
                      ? catalog.packingIndex
                      : list.listType === 'memo' || list.listType === 'todo'
                        ? catalog.emptyIndex
                        : catalog.index
                  }
                  users={users}
                  remoteChecks={remoteChecks}
                />
              ) : route.page === 'list' && route.listId && !list ? (
                <div className="empty">
                  <p>Liste wird geladen …</p>
                </div>
              ) : lists.length === 0 ? (
                <div className="empty">
                  <p className="empty__title">Noch keine Liste</p>
                  <button type="button" className="btn btn--primary" onClick={() => newList()}>
                    Erste Liste anlegen
                  </button>
                </div>
              ) : null}
            </main>
          </div>

          {newDialog && (
            <NewListDialog
              templates={templates}
              groups={[...new Set(todoLists.map(listGroup).filter((g): g is string => !!g))]}
              onClose={() => setNewDialog(false)}
            />
          )}
          {syncDialog && list && (
            <SyncTemplateDialog list={list} templates={templates.filter((t) => t.listType === list.listType)} onClose={() => setSyncDialog(false)} />
          )}
          {sharedRecipe && <RecipeUrlDialog url={sharedRecipe} listId={mainList?.id} onClose={() => setSharedRecipe(null)} />}
          {notice && (
            <div className="snackbar" role="status">
              <span>{notice}</span>
            </div>
          )}
          {editing && list && (
            <ListEditDialog
              list={list}
              me={me}
              groups={[...new Set(todoLists.map(listGroup).filter((g): g is string => !!g))]}
              onClose={() => setEditing(false)}
              onSortCategories={() => {
                setEditing(false);
                setSorting(list.listType);
              }}
            />
          )}
          {sorting === 'lists' && (
            <SortDialog
              title="Listen sortieren"
              hint="So stehen die Listen in der Seitenleiste – nur bei dir, auf allen deinen Geräten."
              groups={[
                // The sections themselves first, then the lists inside each.
                { title: 'Abschnitte', items: sections.map((s) => ({ id: `section:${s.key}`, label: s.title ?? 'Einkaufslisten' })) },
                ...sections
                  .filter((s) => s.lists.length)
                  .map((s) => ({ title: s.title ?? 'Einkaufslisten', items: s.lists.map((l) => ({ id: l.id, label: l.name })) })),
              ]}
              onSave={async (ids) => {
                await setSectionOrder(ids.filter((id) => id.startsWith('section:')).map((id) => id.slice('section:'.length) as SectionKey));
                await setListOrder([...ids.filter((id) => !id.startsWith('section:')), ...archived.map((l) => l.id)]);
              }}
              onReset={async () => {
                await setSectionOrder([]);
                await setListOrder([]);
              }}
              onClose={() => setSorting(null)}
            />
          )}
          {sorting && sorting !== 'lists' && (
            <SortDialog
              title={`Kategorien sortieren – ${LIST_TYPE_LABEL[sorting]}`}
              hint="Zum Beispiel in der Reihenfolge deines Weges durch den Laden. Gilt nur für dich, auf allen deinen Geräten."
              groups={[{ title: null, items: categoriesInOrder(sorting, me.categoryOrder, customCategories).map((c) => ({ id: c.id, label: c.name })) }]}
              onSave={(ids) => setCategoryOrder(sorting, ids, me.categoryOrder)}
              onReset={() => setCategoryOrder(sorting, [], me.categoryOrder)}
              onClose={() => setSorting(null)}
            />
          )}
          {showMembers && list && (
            <MembersDialog
              list={list}
              me={me}
              onClose={() => {
                setShowMembers(false);
                setMembersSeen((n) => n + 1);
              }}
            />
          )}
          {extraWide && route.page === 'list' && list && list.listType !== 'memo' && list.listType !== 'todo' && (
            <CatalogPanel key={list.listType} listId={list.id} listType={list.listType} catalog={catalog.items} items={items ?? []} />
          )}
        </div>
      </CategoryContext.Provider>
    </IconContext.Provider>
  );
}
