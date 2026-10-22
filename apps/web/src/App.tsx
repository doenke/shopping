import { parseInput, type ListRow, type Me } from '@shopping/shared';
import { useEffect, useRef, useState } from 'react';
import { addItems, createList, deleteList, leaveList, renameList, setMainList, shareList } from './actions';
import { CatalogPanel } from './components/CatalogPanel';
import { ListView } from './components/ListView';
import { Login } from './components/Login';
import { Settings } from './components/Settings';
import { SyncBadge } from './components/SyncBadge';
import { setMeta } from './db';
import { navigate, useCatalog, useItems, useLists, useMe, useMediaQuery, useRemoteChecks, useRoute, useUsers } from './hooks';
import { sync } from './sync/engine';

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
  const users = useUsers();
  const remoteChecks = useRemoteChecks();
  const wide = useMediaQuery('(min-width: 900px)');
  const extraWide = useMediaQuery('(min-width: 1250px)');
  const [drawer, setDrawer] = useState(false);
  const [menu, setMenu] = useState(false);
  const addRef = useRef<HTMLInputElement>(null);

  const listId = route.page === 'list' ? (route.listId ?? me.defaultListId ?? lists[0]?.id) : undefined;
  const list = lists.find((l) => l.id === listId);
  const items = useItems(list?.id);

  // Shared text from another app ("Teilen → Shopping") lands on the main list.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const text = params.get('share_text') ?? params.get('share_title');
    const target = me.defaultListId ?? lists[0]?.id;
    if (!text || !target) return;
    history.replaceState(null, '', '/');
    void addItems(target, parseInput(text, catalog.index));
  }, [me.defaultListId, lists, catalog.index]);

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

  const newList = async () => {
    const name = prompt('Name der neuen Liste', 'Einkauf');
    if (!name?.trim()) return;
    const id = await createList(name.trim());
    navigate({ page: 'list', listId: id });
    setDrawer(false);
  };

  const sidebar = (
    <nav className="sidebar" aria-label="Listen">
      <div className="sidebar__head">
        <img src="/icon.svg" alt="" width={28} height={28} />
        <strong>Shopping</strong>
      </div>
      <ul>
        {lists.map((l) => (
          <li key={l.id}>
            <a
              href={`#/list/${l.id}`}
              className={l.id === list?.id && route.page === 'list' ? 'active' : ''}
              onClick={() => setDrawer(false)}
            >
              <span>
                {l.id === me.defaultListId && <span title="Hauptliste">⭐ </span>}
                {l.name}
              </span>
              <OpenCount listId={l.id} />
            </a>
          </li>
        ))}
      </ul>
      <button type="button" className="btn btn--ghost" onClick={() => void newList()}>
        + Neue Liste
      </button>
      <span className="spacer" />
      <a href="#/settings" className={route.page === 'settings' ? 'active' : ''} onClick={() => setDrawer(false)}>
        ⚙ Einstellungen
      </a>
    </nav>
  );

  return (
    <div className={`shell${wide ? ' shell--wide' : ''}${extraWide && route.page === 'list' && list ? ' shell--catalog' : ''}`}>
      {wide ? sidebar : drawer && <div className="drawer" onClick={() => setDrawer(false)}>{sidebar}</div>}

      <div className="main">
        <header className="topbar">
          {!wide && (
            <button type="button" className="icon-btn" aria-label="Listen" onClick={() => setDrawer(true)}>
              ☰
            </button>
          )}
          <h1 className="topbar__title">{route.page === 'settings' ? 'Einstellungen' : (list?.name ?? 'Shopping')}</h1>
          <SyncBadge />
          {route.page === 'list' && list && (
            <div className="menu">
              <button type="button" className="icon-btn" aria-label="Listenmenü" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
                ⋮
              </button>
              {menu && <ListMenu list={list} me={me} onClose={() => setMenu(false)} />}
            </div>
          )}
        </header>

        <main className="content">
          {route.page === 'settings' ? (
            <Settings me={me} />
          ) : list && items ? (
            <ListView ref={addRef} key={list.id} list={list} items={items} index={catalog.index} users={users} remoteChecks={remoteChecks} />
          ) : route.page === 'list' && route.listId && !list ? (
            <div className="empty">
              <p>Liste wird geladen …</p>
            </div>
          ) : lists.length === 0 ? (
            <div className="empty">
              <p className="empty__title">Noch keine Liste</p>
              <button type="button" className="btn btn--primary" onClick={() => void newList()}>
                Erste Liste anlegen
              </button>
            </div>
          ) : null}
        </main>
      </div>

      {extraWide && route.page === 'list' && list && <CatalogPanel listId={list.id} catalog={catalog.items} items={items ?? []} />}
    </div>
  );
}

function OpenCount({ listId }: { listId: string }) {
  const items = useItems(listId);
  const n = items?.filter((i) => !i.checked).length ?? 0;
  return n ? <span className="count">{n}</span> : null;
}

/** Kept outside the menu so the lock survives closing it. */
let wakeLock: WakeLockSentinel | null = null;

function ListMenu({ list, me, onClose }: { list: ListRow; me: Me; onClose: () => void }) {
  const isOwner = list.ownerId === me.id;

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.menu')) onClose();
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [onClose]);

  return (
    <div className="menu__panel" role="menu">
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          const name = prompt('Neuer Name', list.name);
          if (name?.trim()) void renameList(list.id, name.trim());
          onClose();
        }}
      >
        Umbenennen
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          void shareList(list);
          onClose();
        }}
      >
        Teilen …
      </button>
      {list.id !== me.defaultListId && (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            void setMainList(list.id);
            onClose();
          }}
        >
          ⭐ Als Hauptliste festlegen
        </button>
      )}
      {'wakeLock' in navigator && (
        <button
          type="button"
          role="menuitem"
          onClick={async () => {
            if (wakeLock) {
              await wakeLock.release();
              wakeLock = null;
            } else {
              wakeLock = await navigator.wakeLock.request('screen').catch(() => null);
            }
            onClose();
          }}
        >
          {wakeLock ? 'Bildschirm darf ausgehen' : 'Einkaufsmodus: Bildschirm anlassen'}
        </button>
      )}
      {isOwner && (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            if (confirm('Neuen Link erzeugen? Der alte funktioniert dann nicht mehr. Wer schon drin ist, bleibt drin.')) {
              void shareList(list, true);
            }
            onClose();
          }}
        >
          Link erneuern
        </button>
      )}
      {!isOwner && (
        <button
          type="button"
          role="menuitem"
          className="danger"
          onClick={() => {
            if (confirm(`„${list.name}“ verlassen? Du brauchst dann wieder den Link.`)) {
              void leaveList(list.id).then(() => navigate({ page: 'list' }));
            }
            onClose();
          }}
        >
          Liste verlassen
        </button>
      )}
      {isOwner && (
        <button
          type="button"
          role="menuitem"
          className="danger"
          onClick={() => {
            if (confirm(`„${list.name}“ wirklich löschen?`)) {
              void deleteList(list.id);
              navigate({ page: 'list' });
            }
            onClose();
          }}
        >
          Liste löschen
        </button>
      )}
    </div>
  );
}
