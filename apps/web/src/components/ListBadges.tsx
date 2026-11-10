import { type ListRow } from '@shopping/shared';
import { useItems } from '../hooks';

export function OpenCount({ listId }: { listId: string }) {
  const items = useItems(listId);
  const n = items?.filter((i) => !i.checked).length ?? 0;
  return n ? <span className="count">{n}</span> : null;
}

/** Sidebar badges: 🔗 shared via the link, 👥 shared with other households or people (private shows in the list itself). */
export function ListBadges({ list }: { list: ListRow }) {
  return (
    <>
      {(list.sharing === 'link' || list.sharing === 'both') && <span title="Per Link geteilt"> 🔗</span>}
      {(list.sharing === 'people' || list.sharing === 'both') && <span title="Mit anderen Haushalten oder Personen geteilt"> 👥</span>}
    </>
  );
}
