import { itemSpecification } from './amounts.js';
import { categoriesInOrder, categoryInList } from './categories.js';
import { dueOf, formatDue } from './due.js';
import type { ItemRow, ListRow } from './model.js';
import { listDescription, packingInfo } from './packing.js';

/**
 * A list as plain text, for a messenger or the clipboard ("Liste als Text teilen"): the open items
 * (templates: all), grouped by category in the user's order. ToDo lists sorted by due date.
 */
export function listAsText(
  list: Pick<ListRow, 'name' | 'listType' | 'isTemplate' | 'settings'>,
  items: ItemRow[],
  categoryOrder?: readonly string[],
  now = new Date(),
): string {
  const open = items.filter((i) => !i.deleted && (list.isTemplate || !i.checked));
  const head = [list.name, listDescription(list)].filter(Boolean).join('\n');
  if (open.length === 0) return `${head}\n\nAlles erledigt.`;

  const line = (i: ItemRow) => {
    const p = packingInfo(i);
    const spec = itemSpecification(i);
    const due = list.listType === 'todo' ? dueOf(i) : null;
    const extra =
      list.listType === 'memo'
        ? [p.person ? `Tipp von ${p.person}` : null, p.container]
        : [p.person, p.container];
    const parts = [due ? formatDue(due, now).label : null, spec || null].filter(Boolean).join(' · ');
    const tail = extra.filter(Boolean).join(', ');
    return `• ${i.name}${parts ? ` – ${parts}` : ''}${tail ? ` (${tail})` : ''}${list.isTemplate && i.optional ? ' (optional)' : ''}`;
  };

  // Merk- and ToDo lists have a single category: no headings.
  if (list.listType === 'memo' || list.listType === 'todo') {
    const sorted = [...open].sort((a, b) =>
      list.listType === 'todo'
        ? (dueOf(a) ?? '9999').localeCompare(dueOf(b) ?? '9999') || a.position.localeCompare(b.position)
        : a.position.localeCompare(b.position),
    );
    return `${head}\n\n${sorted.map(line).join('\n')}`;
  }

  const byCat = new Map<string, ItemRow[]>();
  for (const i of open) {
    const id = categoryInList(i.categoryId, list.listType).id;
    byCat.set(id, [...(byCat.get(id) ?? []), i]);
  }
  const groups = categoriesInOrder(list.listType, categoryOrder)
    .filter((c) => byCat.has(c.id))
    .map((c) => `${c.name}\n${byCat.get(c.id)!.sort((a, b) => a.position.localeCompare(b.position)).map(line).join('\n')}`);
  return `${head}\n\n${groups.join('\n\n')}`;
}
