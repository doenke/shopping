import { categoriesInOrder, groupLists, parseInput, inUserOrder, listGroup, type ListRow, type ListType, type Me, type SectionKey } from '@shopping/shared';
import { useEffect, useRef, useState } from 'react';
import { addItems, setCategoryOrder, setListOrder, setSectionOrder } from './actions';
import { showToast } from './toast';
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
import { RecipeUrlDialog } from './components/RecipeUrlDialog';
import { ShareDialog, readShared, type Shared } from './components/ShareDialog';
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
import { CommandPalette } from './components/CommandPalette';
import { MoveDialog } from './components/MoveDialog';
import { ShortcutHelp } from './components/ShortcutHelp';
import { Toast } from './components/Toast';
import { useShortcuts } from './keyboard';
import { useItemDrag } from './itemDrag';
import { useSidebarCollapse } from './sidebarCollapse';
import { moveInOrder, useListDrag } from './listDrag';
import { applyModeFromUrl, isWorkList, isWorkMode, setWorkMode, useWorkModeSetting } from './workMode';
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
      void import('./files').then((f) => f.startUploads());
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
  useState(applyModeFromUrl);
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
  // Arbeitsmodus: only shows and hides lists – just the work lists in the sidebar, the search and as start.
  const workMode = useWorkModeSetting();
  const workLists = todoLists.filter(isWorkList);
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
      { key: 'shopping', title: null, lists: workMode ? [] : shoppingLists, prefix: () => '' },
      { key: 'packing', title: 'Packlisten', lists: workMode ? [] : packingLists, prefix: () => '🧳 ' },
      { key: 'memo', title: 'Merklisten', lists: workMode ? [] : memoLists, prefix: () => '📌 ' },
      { key: 'todo', title: 'ToDo', lists: workMode ? workLists : todoLists, prefix: () => '✅ ', grouped: true },
      { key: 'templates', title: 'Vorlagen', lists: workMode ? [] : templates, prefix: (l: ListRow) => TYPE_ICON[l.listType] },
    ],
    me.sectionOrder,
    (s) => s.key,
  );
  const { isCollapsed, toggle: toggleGroup } = useSidebarCollapse();
  // On the phone everything is open – fewer small targets. Only Vorlagen and the Archiv still fold (they start folded).
  const foldable = (key: string) => wide || key === 'sec:templates' || key === 'sec:archive';
  const folded = (key: string) => foldable(key) && isCollapsed(key);
  const groupHeading = (className: string, label: string, foldKey: string) =>
    foldable(foldKey) ? (
      <GroupToggle className={className} label={label} open={!isCollapsed(foldKey)} onToggle={() => toggleGroup(foldKey)} />
    ) : (
      <div className={className}>{label}</div>
    );
  const listLinks = (ls: ListRow[], prefix: (l: ListRow) => string) => (
    <ul>
      {ls.map((l) => (
        <li key={l.id} data-sort-id={guest ? undefined : l.id}>
          <a
            href={`#/list/${l.id}`}
            className={l.id === list?.id && route.page === 'list' ? 'active' : ''}
            onClick={() => setDrawer(false)}
            // Entries can be dragged onto a list (not onto templates).
            {...(l.isTemplate ? {} : { 'data-list-id': l.id, 'data-list-name': l.name })}
          >
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
  // Any list can be the main list (shopping, packing, Merk- or ToDo list); without one, the first shopping list.
  const mainList = ordered.find((l) => l.id === me.defaultListId && !l.isTemplate && !l.archivedAt) ?? shoppingLists[0];
  const workStart = mainList && isWorkList(mainList) ? mainList : workLists[0];
  const listId = route.page === 'list' ? (route.listId ?? (workMode ? workStart : (mainList ?? packingLists[0]))?.id) : undefined;
  const addRef = useRef<HTMLInputElement>(null);

  const list = lists.find((l) => l.id === listId);
  const shopping = useShopping();
  /** The mode switch only exists on shopping lists; packing and ToDo lists are checked off at home. */
  const shopList = route.page === 'list' && !!list && list.listType === 'shopping' && !list.isTemplate;
  const shopMode = shopList && shopping;
  useWakeLock(shopMode);
  const items = useItems(list?.id);

  // Shared from another app ("Teilen → Shopping"): which list, and a link becomes an entry with 🔗.
  const [sharedRecipe, setSharedRecipe] = useState<{ url: string; listId?: string } | null>(null);
  const [shared, setShared] = useState<Shared | null>(null);
  useEffect(() => {
    const got = readShared(location.search);
    if (!got) return;
    history.replaceState(null, '', '/');
    setShared(got);
  }, []);

  // "Standort merken" (long press on the app icon): the current location as a new entry in the main list,
  // like a lone "*" typed there. Waits until the lists are loaded.
  const [hereAction, setHereAction] = useState(() => takeHereAction());
  useEffect(() => {
    if (!hereAction || !mainList || guest) return;
    setHereAction(false);
    navigate({ page: 'list', listId: mainList.id });
    void addItems(mainList.id, parseInput('*', undefined, mainList.listType));
    showToast(`Standort wird in „${mainList.name}“ gemerkt …`);
  }, [hereAction, mainList?.id]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('join') === 'invalid') {
      history.replaceState(null, '', '/');
      alert('Dieser Link ist nicht mehr gültig. Bitte lass dir einen neuen schicken.');
    }
  }, []);

  useEffect(() => {
    document.title = workMode ? 'To-Do' : 'Shopping';
  }, [workMode]);
  // Arbeitsmodus on while a hidden list is open: go to the first work list.
  useEffect(() => {
    if (workMode && route.page === 'list' && list && !isWorkList(list)) navigate(workLists[0] ? { page: 'list', listId: workLists[0].id } : { page: 'list' });
  }, [workMode, list?.id]);

  // A ToDo list on the desktop: tasks as a table with details.
  const board = wide && route.page === 'list' && list?.listType === 'todo' && !list.isTemplate;
  // One design for all lists; the open list's type sets the accent colour.
  useEffect(() => {
    if (route.page === 'list' && list) document.documentElement.dataset.accent = list.listType;
    else delete document.documentElement.dataset.accent;
  }, [route.page, list?.listType]);
  // The keyboard, in every mode.
  const [palette, setPalette] = useState(false);
  const [shortcutHelp, setShortcutHelp] = useState(false);
  /** Entries to move into another list (V, "Verschieben nach …"). */
  const [moving, setMoving] = useState<string[] | null>(null);
  useShortcuts({
    onSearch: () => setPalette(true),
    onHelp: () => setShortcutHelp(true),
    onToggleWork: () => setWorkMode(!isWorkMode()),
    onMove: (ids) => setMoving(ids),
  });
  useItemDrag(list?.id);
  // Sorting the lists right in the sidebar: drag a list within its group.
  useListDrag(
    (id, beforeId, afterId) =>
      void setListOrder(
        moveInOrder(
          ordered.map((l) => l.id),
          id,
          beforeId,
          afterId,
        ),
      ),
  );

  const newList = () => {
    setNewDialog(true);
    setDrawer(false);
  };

  const sidebar = (
    <nav className="sidebar" aria-label="Listen">
      <div className="sidebar__top">
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
          <strong>{workMode ? 'To-Do' : 'Shopping'}</strong>
        </a>
        {!guest && (
          <button
            type="button"
            className={`sidebar__work${workMode ? ' sidebar__work--on' : ''}`}
            onClick={() => setWorkMode(!workMode)}
            aria-pressed={workMode}
            aria-label="Arbeitsmodus"
            title={workMode ? 'Arbeitsmodus aus: alle Listen zeigen – Strg+Shift+A' : 'Arbeitsmodus: nur die Arbeitslisten zeigen – Strg+Shift+A'}
          >
            🏢
          </button>
        )}
      </div>
      {!guest && (
        <button type="button" className="btn btn--primary sidebar__new" onClick={() => newList()}>
          + Neu
        </button>
      )}
      {sections.map((sec) => {
        if (sec.lists.length === 0) return null;
        // A collapsed group still shows the open list, so you always see where you are.
        const shown = (key: string, ls: ListRow[]) => (folded(key) ? ls.filter((l) => l.id === list?.id && route.page === 'list') : ls);
        const secKey = `sec:${sec.key}`;
        const secLists = sec.title ? shown(secKey, sec.lists) : sec.lists;
        const title = sec.key === 'templates' ? `${sec.title} (${sec.lists.length})` : sec.title;
        return (
          <div key={sec.key}>
            {title && groupHeading('sidebar__section', title, secKey)}
            {sec.grouped && !(sec.title && folded(secKey))
              ? groupLists(sec.lists).map((g, _i, all) => {
                  const grpKey = `grp:${sec.key}:${g.group}`;
                  return (
                    <div key={g.group}>
                      {all.length > 1 && groupHeading('sidebar__subsection', g.group, grpKey)}
                      {listLinks(all.length > 1 ? shown(grpKey, g.lists) : g.lists, sec.prefix)}
                    </div>
                  );
                })
              : listLinks(secLists, sec.prefix)}
          </div>
        );
      })}
      {!workMode && archived.length > 0 && (
        <div className="sidebar__archive">
          {groupHeading('sidebar__section', `Archiv (${archived.length})`, 'sec:archive')}
          <ul>
            {(folded('sec:archive') ? archived.filter((l) => l.id === list?.id && route.page === 'list') : archived).map((l) => (
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
        </div>
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

  const overlays = (
    <>
      {palette && <CommandPalette lists={workMode ? workLists : ordered} onClose={() => setPalette(false)} />}
      {shortcutHelp && <ShortcutHelp onClose={() => setShortcutHelp(false)} />}
      {moving && <MoveDialog ids={moving} fromListId={list?.id} onClose={() => setMoving(null)} />}
      {wide && (
        <button type="button" className="kbd-hint" onClick={() => setShortcutHelp(true)} title="Tastenkürzel anzeigen">
          <kbd>H</kbd> Tastenkürzel <span className="kbd-hint-version">· {__APP_VERSION__}</span>
        </button>
      )}
      <Toast />
    </>
  );

  return (
    <IconContext.Provider value={icons}>
      <CategoryContext.Provider value={customCategories}>
        <div
          className={`shell${wide ? ' shell--wide' : ''}${board ? ' shell--board' : ''}${extraWide && route.page === 'list' && list && list.listType !== 'memo' && list.listType !== 'todo' ? ' shell--catalog' : ''}`}
        >
          {wide
            ? sidebar
            : drawer && (
                <div
                  className="drawer"
                  onClick={(e) => {
                    // Closes on the backdrop or a link/button – not when a group like "Vorlagen" or "Archiv" is unfolded.
                    const t = e.target as HTMLElement;
                    if (t === e.currentTarget || (t.closest('a, button') && !t.closest('.sidebar__toggle'))) setDrawer(false);
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
                  desktop={wide}
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
              {...(workMode ? { initialType: 'todo' as const, initialGroup: 'Arbeit' } : {})}
              groups={[...new Set(todoLists.map(listGroup).filter((g): g is string => !!g))]}
              onClose={() => setNewDialog(false)}
            />
          )}
          {syncDialog && list && (
            <SyncTemplateDialog list={list} templates={templates.filter((t) => t.listType === list.listType)} onClose={() => setSyncDialog(false)} />
          )}
          {shared && (
            <ShareDialog shared={shared} index={catalog.index} onRecipe={(url, listId) => setSharedRecipe({ url, listId })} onClose={() => setShared(null)} />
          )}
          {sharedRecipe && <RecipeUrlDialog url={sharedRecipe.url} listId={sharedRecipe.listId ?? mainList?.id} onClose={() => setSharedRecipe(null)} />}
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
          {overlays}
        </div>
      </CategoryContext.Provider>
    </IconContext.Provider>
  );
}

/** Heading of a sidebar group that folds it away (click again to open). */
function GroupToggle({ className, label, open, onToggle }: { className: string; label: string; open: boolean; onToggle: () => void }) {
  return (
    <button type="button" className={`${className} sidebar__toggle`} aria-expanded={open} onClick={onToggle} title={open ? 'Zuklappen' : 'Aufklappen'}>
      <span className="sidebar__chevron" aria-hidden="true">
        ▾
      </span>
      {label}
    </button>
  );
}

/** "/?action=here" (app shortcut „Standort merken“): taken once, and gone from the address. */
function takeHereAction(): boolean {
  const url = new URL(location.href);
  if (url.searchParams.get('action') !== 'here') return false;
  url.searchParams.delete('action');
  history.replaceState(null, '', url.pathname + url.search + url.hash);
  return true;
}
