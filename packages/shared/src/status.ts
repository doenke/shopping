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

/** Kanban: "Erledigt" as the last column (list setting, off by default). */
export function kanbanShowsDone(list: { settings: Record<string, unknown> }): boolean {
  return list.settings.kanbanDone === true;
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

/** The list's default status (`settings.defaultStatus`) – what new entries get; else the first one. */
export function listDefaultStatus(list: { settings: Record<string, unknown> }, statuses = listStatuses(list)): ListStatus | null {
  return statuses.find((s) => s.id === list.settings.defaultStatus) ?? statuses[0] ?? null;
}

/**
 * An item's status: the one set on it, else the default (entries without one are "new" – they got the
 * default; when the default changes, the app writes the old one onto them first). Null without statuses.
 */
export function itemStatus(item: Pick<ItemRow, 'attributes'>, statuses: ListStatus[], fallback: ListStatus | null = statuses[0] ?? null): ListStatus | null {
  const id = item.attributes.status;
  return statuses.find((s) => s.id === id) ?? fallback;
}

/** Sets the status (by id); the default one is not stored. */
export function withStatus(
  attributes: Record<string, unknown>,
  statusId: string | null,
  statuses: ListStatus[],
  fallback: ListStatus | null = statuses[0] ?? null,
): Record<string, unknown> {
  const next = { ...attributes };
  if (!statusId || statusId === fallback?.id) delete next.status;
  else next.status = statusId;
  return next;
}

/** A status by name or id (API, MCP: "In Arbeit"). */
export function findStatus(statuses: ListStatus[], ref: string): ListStatus | null {
  const r = ref.trim().toLowerCase();
  return statuses.find((s) => s.id === ref || s.name.toLowerCase() === r) ?? null;
}
