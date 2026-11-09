import type { ItemRow } from './model.js';

/**
 * A status for open entries ("Neu", "In Arbeit", "Wartet auf Kunde"), chosen from the list's own
 * statuses (`settings.statuses`, in order). Done is not a status but the tick: in a Kanban board the
 * statuses are the columns, "Erledigt" the last one. Kept on every item (`attributes.status`, the
 * status id, so renaming does not lose anything); the app shows it for ToDo lists.
 */

export interface ListStatus {
  id: string;
  name: string;
}

export const SUGGESTED_STATUSES = ['Neu', 'In Arbeit', 'Wartet'];

/** The statuses of a list, in order (empty: the list does not use them). */
export function listStatuses(list: { settings: Record<string, unknown> }): ListStatus[] {
  const raw = Array.isArray(list.settings.statuses) ? list.settings.statuses : [];
  const out: ListStatus[] = [];
  for (const s of raw) {
    const id = s && typeof s === 'object' && typeof (s as ListStatus).id === 'string' ? (s as ListStatus).id : null;
    const name = s && typeof s === 'object' && typeof (s as ListStatus).name === 'string' ? (s as ListStatus).name.trim() : '';
    if (id && name && !out.some((o) => o.id === id)) out.push({ id, name });
  }
  return out;
}

/** An item's status: the one set on it, else the list's first (new entries start there); null without statuses. */
export function itemStatus(item: Pick<ItemRow, 'attributes'>, statuses: ListStatus[]): ListStatus | null {
  const id = item.attributes.status;
  return statuses.find((s) => s.id === id) ?? statuses[0] ?? null;
}

/** Sets the status (by id); the first one is the default and is not stored. */
export function withStatus(attributes: Record<string, unknown>, statusId: string | null, statuses: ListStatus[]): Record<string, unknown> {
  const next = { ...attributes };
  if (!statusId || statusId === statuses[0]?.id) delete next.status;
  else next.status = statusId;
  return next;
}

/** A status by name or id (API, MCP: "In Arbeit"). */
export function findStatus(statuses: ListStatus[], ref: string): ListStatus | null {
  const r = ref.trim().toLowerCase();
  return statuses.find((s) => s.id === ref || s.name.toLowerCase() === r) ?? null;
}
