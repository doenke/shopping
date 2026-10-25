import { listDescription, parseInput, type ListRow, type ListType, type Me } from '@shopping/shared';
import { useEffect, useRef, useState } from 'react';
import { addItems, archiveList, createList, deleteList, describeList, leaveList, renameList, saveAsTemplate, setMainList, shareList } from './actions';
import { CatalogPanel } from './components/CatalogPanel';
import { IconReview } from './components/IconReview';
import { ImportDialog } from './components/ImportDialog';
import { MembersDialog } from './components/MembersDialog';
import { TemplateDialog } from './components/TemplateDialog';
import { ListView } from './components/ListView';
import { Login } from './components/Login';
import { Settings } from './components/Settings';
import { SyncBadge } from './components/SyncBadge';
import { setMeta } from './db';
import { IconContext } from './icons';
import { navigate, useCatalog, useIcons, useItems, useLists, useMe, useMediaQuery, useRemoteChecks, useRoute, useUsers } from './hooks';
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
  const icons = useIcons(catalog.items);
  const users = useUsers();
  const remoteChecks = useRemoteChecks();
  const wide = useMediaQuery('(min-width: 900px)');
  const extraWide = useMediaQuery('(min-width: 1250px)');
  const [drawer, setDrawer] = useState(false);
  const [menu, setMenu] = useState(false);
  const [importing, setImporting] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const guest = me.isGuest;
  const [templateDialog, setTemplateDialog] = useState<{ mode: 'new' | 'apply'; type: ListType } | null>(null);
  const shoppingLists = lists.filter((l) => !l.isTemplate && !l.archivedAt && l.listType === 'shopping');
  const packingLists = lists.filter((l) => !l.isTemplate && !l.archivedAt && l.listType === 'packing');
  const memoLists = lists.filter((l) => !l.isTemplate && !l.archivedAt && l.listType === 'memo');
  const archived = lists.filter((l) => !l.isTemplate && l.archivedAt);
  const templates = lists.filter((l) => l.isTemplate);
  const mainList = shoppingLists.find((l) => l.id === me.defaultListId) ?? shoppingLists[0];
  const listId = route.page === 'list' ? (route.listId ?? (mainList ?? packingLists[0])?.id) : undefined;
  const addRef = useRef<HTMLInputElement>(null);


  const list = lists.find((l) => l.id === listId);
  const items = useItems(list?.id);

  // Shared text from another app ("Teilen → Shopping") lands on the main list.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const text = params.get('share_text') ?? params.get('share_title');
    const target = mainList?.id;
    if (!text || !target) return;
    history.replaceState(null, '', '/');
    void addItems(target, parseInput(text, catalog.index));
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

  const newList = (type: ListType = 'shopping') => {
    setTemplateDialog({ mode: 'new', type });
    setDrawer(false);
  };

  /** Merklisten: name and what they are about (the description also guides the icons). */
  const newMemo = async () => {
    const name = prompt('Name der Merkliste', 'Filme');
    if (!name?.trim()) return;
    const description = prompt('Worum geht es? (hilft auch bei den Bildern)', name.trim() === 'Filme' ? 'Filme und Serien, die wir sehen wollen' : '');
    const id = await createList(name.trim(), false, 'memo', description);
    navigate({ page: 'list', listId: id });
    setDrawer(false);
  };

  const newTemplate = async (type: ListType) => {
    const name = prompt(type === 'packing' ? 'Name der Packvorlage' : 'Name der Vorlage', type === 'packing' ? 'Wochenend-Trip' : 'Wocheneinkauf Basis');
    if (!name?.trim()) return;
    const id = await createList(name.trim(), true, type);
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
        {shoppingLists.map((l) => (
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
      {!guest && (
        <button type="button" className="btn btn--ghost" onClick={() => void newList()}>
          + Neue Liste
        </button>
      )}
      {(packingLists.length > 0 || !guest) && <h3 className="sidebar__section">Packlisten</h3>}
      <ul>
        {packingLists.map((l) => (
          <li key={l.id}>
            <a
              href={`#/list/${l.id}`}
              className={l.id === list?.id && route.page === 'list' ? 'active' : ''}
              onClick={() => setDrawer(false)}
            >
              <span>🧳 {l.name}</span>
              <OpenCount listId={l.id} />
            </a>
          </li>
        ))}
      </ul>
      {!guest && (
        <button type="button" className="btn btn--ghost" onClick={() => void newList('packing')}>
          + Neue Packliste
        </button>
      )}
      {(memoLists.length > 0 || !guest) && <h3 className="sidebar__section">Merklisten</h3>}
      <ul>
        {memoLists.map((l) => (
          <li key={l.id}>
            <a href={`#/list/${l.id}`} className={l.id === list?.id && route.page === 'list' ? 'active' : ''} onClick={() => setDrawer(false)}>
              <span>📌 {l.name}</span>
              <OpenCount listId={l.id} />
            </a>
          </li>
        ))}
      </ul>
      {!guest && (
        <button type="button" className="btn btn--ghost" onClick={() => void newMemo()}>
          + Neue Merkliste
        </button>
      )}
      {!guest && <h3 className="sidebar__section">Vorlagen</h3>}
      <ul>
        {templates.map((l) => (
          <li key={l.id}>
            <a
              href={`#/list/${l.id}`}
              className={l.id === list?.id && route.page === 'list' ? 'active' : ''}
              onClick={() => setDrawer(false)}
            >
              <span>
                ◇ {l.listType === 'packing' && '🧳 '}
                {l.name}
              </span>
            </a>
          </li>
        ))}
      </ul>
      {!guest && (
        <div className="row">
          <button type="button" className="btn btn--ghost" onClick={() => void newTemplate('shopping')}>
            + Einkaufsvorlage
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => void newTemplate('packing')}>
            + Packvorlage
          </button>
        </div>
      )}
      {archived.length > 0 && (
        <details className="sidebar__archive">
          <summary className="sidebar__section">Archiv ({archived.length})</summary>
          <ul>
            {archived.map((l) => (
              <li key={l.id}>
                <a href={`#/list/${l.id}`} className={l.id === list?.id && route.page === 'list' ? 'active' : ''} onClick={() => setDrawer(false)}>
                  <span>
                    {l.listType === 'packing' ? '🧳 ' : ''}
                    {l.name}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}
      <span className="spacer" />
      {!guest && (
        <a href="#/icons" className={route.page === 'icons' ? 'active' : ''} onClick={() => setDrawer(false)}>
          🖼 Icons
        </a>
      )}
      <a href="#/settings" className={route.page === 'settings' ? 'active' : ''} onClick={() => setDrawer(false)}>
        ⚙ Einstellungen
      </a>
    </nav>
  );

  return (
    <IconContext.Provider value={icons}>
    <div className={`shell${wide ? ' shell--wide' : ''}${extraWide && route.page === 'list' && list && list.listType !== 'memo' ? ' shell--catalog' : ''}`}>
      {wide ? sidebar : drawer && <div className="drawer" onClick={() => setDrawer(false)}>{sidebar}</div>}

      <div className="main">
        <header className="topbar">
          {!wide && (
            <button type="button" className="icon-btn" aria-label="Listen" onClick={() => setDrawer(true)}>
              ☰
            </button>
          )}
          <h1 className="topbar__title">{route.page === 'settings' ? 'Einstellungen' : route.page === 'icons' ? 'Icons' : (list?.name ?? 'Shopping')}</h1>
          <SyncBadge guest={me.isGuest} />
          {route.page === 'list' && list && (
            <div className="menu">
              <button type="button" className="icon-btn" aria-label="Listenmenü" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
                ⋮
              </button>
              {menu && (
                <ListMenu
                  list={list}
                  me={me}
                  hasTemplates={list.listType !== 'memo' && templates.some((t) => t.listType === list.listType)}
                  onClose={() => setMenu(false)}
                  onImport={() => setImporting(true)}
                  onApplyTemplate={() => setTemplateDialog({ mode: 'apply', type: list.listType })}
                  onMembers={() => setShowMembers(true)}
                />
              )}
            </div>
          )}
        </header>

        <main className="content">
          {route.page === 'settings' ? (
            <Settings me={me} />
          ) : route.page === 'icons' && !guest ? (
            <IconReview catalog={catalog.items} />
          ) : list && items ? (
            <ListView
              ref={addRef}
              key={list.id}
              list={list}
              items={items}
              index={list.listType === 'packing' ? catalog.packingIndex : list.listType === 'memo' ? catalog.emptyIndex : catalog.index}
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
              <div className="row row--center">
                <button type="button" className="btn btn--primary" onClick={() => void newList()}>
                  Erste Liste anlegen
                </button>
                <button type="button" className="btn" onClick={() => void newList('packing')}>
                  Packliste anlegen
                </button>
              </div>
            </div>
          ) : null}
        </main>
      </div>

      {templateDialog && (
        <TemplateDialog
          templates={templates}
          targetList={templateDialog.mode === 'apply' ? list : undefined}
          listType={templateDialog.type}
          onClose={() => setTemplateDialog(null)}
        />
      )}
      {showMembers && list && <MembersDialog list={list} me={me} onClose={() => setShowMembers(false)} />}
      {importing && list && <ImportDialog listId={list.id} onClose={() => setImporting(false)} />}
      {extraWide && route.page === 'list' && list && list.listType !== 'memo' && (
        <CatalogPanel key={list.listType} listId={list.id} listType={list.listType} catalog={catalog.items} items={items ?? []} />
      )}
    </div>
    </IconContext.Provider>
  );
}

function OpenCount({ listId }: { listId: string }) {
  const items = useItems(listId);
  const n = items?.filter((i) => !i.checked).length ?? 0;
  return n ? <span className="count">{n}</span> : null;
}

/** Kept outside the menu so the lock survives closing it. */
let wakeLock: WakeLockSentinel | null = null;

interface ListMenuProps {
  list: ListRow;
  me: Me;
  hasTemplates: boolean;
  onClose: () => void;
  onImport: () => void;
  onApplyTemplate: () => void;
  onMembers: () => void;
}

function ListMenu({ list, me, hasTemplates, onClose, onImport, onApplyTemplate, onMembers }: ListMenuProps) {
  const guest = me.isGuest;
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
          const d = prompt('Worum geht es in dieser Liste?', listDescription(list) ?? '');
          if (d !== null) void describeList(list, d);
          onClose();
        }}
      >
        Beschreibung …
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onMembers();
          onClose();
        }}
      >
        Wer ist dabei?
      </button>
      {!list.isTemplate && list.listType === 'shopping' && !guest && (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onImport();
            onClose();
          }}
        >
          Aus Mealie hinzufügen …
        </button>
      )}
      {!list.isTemplate && hasTemplates && !guest && (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onApplyTemplate();
            onClose();
          }}
        >
          Vorlage übernehmen …
        </button>
      )}
      {!list.isTemplate && list.listType !== 'memo' && !guest && (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            const name = prompt('Name der Vorlage', list.name);
            if (name?.trim()) void saveAsTemplate(list, name.trim()).then((id) => navigate({ page: 'list', listId: id }));
            onClose();
          }}
        >
          Als Vorlage speichern
        </button>
      )}
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
      {list.listType === 'packing' && !list.isTemplate && !guest && (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            void archiveList(list.id, !list.archivedAt);
            if (!list.archivedAt) navigate({ page: 'list' });
            onClose();
          }}
        >
          {list.archivedAt ? 'Aus dem Archiv holen' : 'Archivieren'}
        </button>
      )}
      {list.id !== me.defaultListId && list.listType === 'shopping' && !list.isTemplate && !list.archivedAt && !guest && (
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
      {!isOwner && !guest && (
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
