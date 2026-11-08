import type { CatalogIndex, ListRow, Me, UserInfo } from '@shopping/shared';
import { useEffect, useState } from 'react';
import type { Route } from '../../hooks';
import { navigate, useItems } from '../../hooks';
import { isWorkList, setWorkMode, setWorkScope, useWorkScope } from '../../workMode';
import { OpenCount } from '../ListBadges';
import { Help } from '../Help';
import { Settings } from '../Settings';
import { SyncBadge } from '../SyncBadge';
import { TaskDetail } from './TaskDetail';
import { TaskTable } from './TaskTable';

interface Props {
  me: Me;
  route: Route;
  /** All lists in the user's order. */
  lists: ListRow[];
  users: Map<string, UserInfo>;
  index: CatalogIndex;
  onNewList: () => void;
  onSearch: () => void;
  onShortcuts: () => void;
  onEditList: (list: ListRow) => void;
}

/**
 * Arbeitsmodus: three columns – the ToDo lists, the tasks as a table, the selected task.
 * Calm, compact, keyboard first; nothing of the shopping side shows here.
 */
export function WorkShell({ me, route, lists, users, index, onNewList, onSearch, onShortcuts, onEditList }: Props) {
  const scope = useWorkScope();
  const workLists = lists.filter((l) => isWorkList(l, scope));
  const routed = route.page === 'list' ? workLists.find((l) => l.id === route.listId) : undefined;
  const list = routed ?? (route.page === 'list' ? workLists[0] : undefined);
  const items = useItems(list?.id);
  const [selected, setSelectedId] = useState<string | null>(null);
  /** Enter/double click: edit this task's title (a plain selection leaves the focus in the table). */
  const [opened, setOpened] = useState<{ id: string; n: number } | null>(null);
  const item = items?.find((i) => i.id === selected) ?? null;

  useEffect(() => setSelectedId(null), [list?.id]);

  const select = (id: string) => {
    setSelectedId(id);
    setOpened((o) => (o?.id === id ? o : null));
  };
  const open = (id: string) => {
    setSelectedId(id);
    setOpened((o) => ({ id, n: (o?.n ?? 0) + 1 }));
  };

  return (
    <div className="work-shell">
      <nav className="work-nav" aria-label="Listen">
        <div className="work-nav__head">
          <span className="work-nav__brand">Aufgaben</span>
          <SyncBadge guest={me.isGuest} />
        </div>
        <button type="button" className="work-search" onClick={onSearch}>
          <span>Suchen</span>
          <kbd>Strg K</kbd>
        </button>
        <ul className="work-nav__lists">
          {workLists.map((l) => (
            <li key={l.id}>
              <a
                href={`#/list/${l.id}`}
                className={l.id === list?.id && route.page === 'list' ? 'active' : ''}
                onDoubleClick={(e) => {
                  e.preventDefault();
                  onEditList(l);
                }}
                title="Doppelklick: Liste bearbeiten"
              >
                <span className="work-nav__name">{l.name}</span>
                <OpenCount listId={l.id} />
              </a>
            </li>
          ))}
        </ul>
        {workLists.length === 0 && (
          <p className="work-nav__empty">
            {scope === 'arbeit' ? (
              <>
                Noch keine ToDo-Liste in der Kategorie „Arbeit“.{' '}
                <button type="button" className="link" onClick={() => setWorkScope('all')}>
                  Alle ToDo-Listen zeigen
                </button>
              </>
            ) : (
              'Noch keine ToDo-Liste.'
            )}
          </p>
        )}
        {!me.isGuest && (
          <button type="button" className="work-nav__new" onClick={onNewList}>
            + Neue Liste
          </button>
        )}

        <span className="spacer" />
        <label className="work-nav__scope">
          <span>Zeigen</span>
          <select value={scope} onChange={(e) => setWorkScope(e.target.value === 'all' ? 'all' : 'arbeit')}>
            <option value="arbeit">Kategorie „Arbeit“</option>
            <option value="all">Alle ToDo-Listen</option>
          </select>
        </label>
        <div className="work-nav__links">
          <a href="#/settings" className={route.page === 'settings' ? 'active' : ''}>
            Einstellungen
          </a>
          <a href="#/help" className={route.page === 'help' ? 'active' : ''}>
            Hilfe
          </a>
          <button type="button" className="link" onClick={onShortcuts}>
            Tastenkürzel
          </button>
        </div>
        <button
          type="button"
          className="work-nav__leave"
          onClick={() => {
            setWorkMode(false);
            navigate({ page: 'list' });
          }}
          title="Strg+Shift+A"
        >
          Arbeitsmodus beenden
        </button>
      </nav>

      <main className="work-main">
        {route.page === 'settings' ? (
          <div className="work-page">
            <Settings key={route.section ?? 'overview'} me={me} section={route.section} onSort={() => undefined} />
          </div>
        ) : route.page === 'help' ? (
          <div className="work-page">
            <Help me={me} />
          </div>
        ) : list && items ? (
          <TaskTable list={list} items={items} index={index} selected={selected} onSelect={select} onOpen={open} />
        ) : (
          <p className="work-empty">Links eine Liste wählen{me.isGuest ? '' : ' oder eine neue anlegen'}.</p>
        )}
      </main>

      {route.page === 'list' && list && (
        <div className="work-side">
          {item && items ? (
            <TaskDetail key={item.id} item={item} list={list} items={items} users={users} focusTitle={opened?.id === item.id ? opened.n : 0} />
          ) : (
            <p className="work-empty">Eine Aufgabe auswählen – mit der Maus oder ↑ ↓.</p>
          )}
        </div>
      )}
    </div>
  );
}
