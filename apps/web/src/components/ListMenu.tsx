import { canReset, type ListRow, type Me } from '@shopping/shared';
import { useEffect } from 'react';
import { checkAll, resetList, archiveList, deleteList, leaveList, saveAsTemplate, setMainList, shareListAsText } from '../actions';
import { ListAvatars } from './ListAvatars';
import { SyncBadge } from './SyncBadge';
import { db } from '../db';
import { navigate } from '../hooks';

interface ListMenuProps {
  list: ListRow;
  me: Me;
  /** Phones: sync state and the people with access are shown in the menu. */
  compact: boolean;
  membersSeen: number;
  hasTemplates: boolean;
  onClose: () => void;
  onApplyTemplate: () => void;
  onMembers: () => void;
  onEdit: () => void;
  onCopied: () => void;
  onNotice: (text: string) => void;
}

export function ListMenu({ list, me, compact, membersSeen, hasTemplates, onClose, onApplyTemplate, onMembers, onEdit, onCopied, onNotice }: ListMenuProps) {
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
      {compact && (
        <div className="menu__status">
          <SyncBadge guest={guest} always />
        </div>
      )}
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onEdit();
          onClose();
        }}
      >
        ✏️ Bearbeiten …
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onMembers();
          onClose();
        }}
      >
        <span>👥 Berechtigungen …</span>
        {compact && <ListAvatars listId={list.id} refresh={membersSeen} inline />}
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onClose();
          void shareListAsText(list, me.categoryOrder).then((r) => r === 'copied' && onCopied());
        }}
      >
        📋 Als Text teilen …
      </button>
      {!list.isTemplate && hasTemplates && !guest && (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onApplyTemplate();
            onClose();
          }}
        >
          Mit Vorlage abgleichen …
        </button>
      )}
      {!list.isTemplate && !guest && (
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
      {list.id !== me.defaultListId && !list.isTemplate && !list.archivedAt && !guest && (
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
      {!list.isTemplate && (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onClose();
            void db.items
              .where('listId')
              .equals(list.id)
              .filter((i) => !i.checked && !i.deleted)
              .count()
              .then((n) => {
                if (n === 0) return onNotice('Es ist schon alles erledigt.');
                if (confirm(`Alle ${n} offenen Einträge als erledigt markieren?`))
                  void checkAll(list.id).then((c) => onNotice(c === 1 ? '1 Eintrag als erledigt markiert.' : `${c} Einträge als erledigt markiert.`));
              });
          }}
        >
          ✓ Alle als erledigt markieren
        </button>
      )}
      {canReset(list) && (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onClose();
            void db.items
              .where('listId')
              .equals(list.id)
              .filter((i) => i.checked && !i.deleted)
              .count()
              .then((n) => {
                if (n === 0) return onNotice('Es ist noch nichts abgehakt.');
                if (confirm(n === 1 ? 'Den abgehakten Eintrag wieder öffnen?' : `Alle ${n} abgehakten Einträge wieder öffnen?`))
                  void resetList(list.id).then((c) => onNotice(c === 1 ? '1 Eintrag wieder offen.' : `${c} Einträge wieder offen.`));
              });
          }}
        >
          ↺ Alles zurücksetzen
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
