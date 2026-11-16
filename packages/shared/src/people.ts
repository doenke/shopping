import { applyAttachmentChanges, keepAttachments, mergeAttachments, type AttachmentChanges } from './attachments.js';
import { applyPatch, mergeRow } from './lww.js';
import type { ItemPatch, ItemRow } from './model.js';

/**
 * Things for several people ("Sonnenbrille" for Sönke and Ulli): one entry, ticked off per person.
 *
 * Kept in `attributes`:
 * - `persons`: the people (two or more; one person stays in `person` as before),
 * - `done`: who is ticked off already, `doneAt`: when the last one was ticked (for recurring lists),
 * - `forEach`: in templates – "für jeden"; becomes `persons` when a list is made from the template.
 *
 * Every person has an own clock (`hlc["done:<name>"]`), so Anna and Ben ticking at the same time
 * do not overwrite each other. `checked` follows: ticked off when everyone is.
 */

function names(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    const n = typeof x === 'string' ? x.trim() : '';
    if (n && !out.some((o) => o.toLowerCase() === n.toLowerCase())) out.push(n);
  }
  return out;
}

/** The people of a multi-person item (two or more), else []. */
export function itemPersons(item: Pick<ItemRow, 'attributes'>): string[] {
  const p = names(item.attributes.persons);
  return p.length >= 2 ? p : [];
}

/** Who of them is ticked off already. */
export function itemDone(item: Pick<ItemRow, 'attributes'>): string[] {
  const persons = itemPersons(item);
  const done = names(item.attributes.done);
  return persons.filter((p) => done.some((d) => d.toLowerCase() === p.toLowerCase()));
}

/** Template item for everyone ("für jeden"). */
export function isForEach(item: Pick<ItemRow, 'attributes'>): boolean {
  return item.attributes.forEach === true;
}

/** Everyone the item is for: the persons, the one person, or nobody. */
export function peopleOf(item: Pick<ItemRow, 'attributes'>): string[] {
  const persons = itemPersons(item);
  if (persons.length) return persons;
  const one = typeof item.attributes.person === 'string' ? item.attributes.person.trim() : '';
  return one ? [one] : [];
}

/** "Sönke + Ulli", "Anna", "für jeden" – for lines under the name. */
export function peopleLabel(item: Pick<ItemRow, 'attributes'>): string | null {
  if (isForEach(item)) return 'für jeden';
  const p = peopleOf(item);
  return p.length ? p.join(' + ') : null;
}

/**
 * Key for comparing a list with its template: "für jeden" in the template and Sönke + Ulli in the list
 * are the same thing ("*"), one person is that person, nobody is "".
 */
export function peopleKey(item: Pick<ItemRow, 'attributes'>): string {
  if (isForEach(item) || itemPersons(item).length) return '*';
  return (peopleOf(item)[0] ?? '').toLowerCase();
}

/** Same people (order and case do not matter); "für jeden" only equals "für jeden". */
export function samePeople(a: Pick<ItemRow, 'attributes'>, b: Pick<ItemRow, 'attributes'>): boolean {
  if (isForEach(a) !== isForEach(b)) return false;
  const x = peopleOf(a)
    .map((n) => n.toLowerCase())
    .sort();
  const y = peopleOf(b)
    .map((n) => n.toLowerCase())
    .sort();
  return x.length === y.length && x.every((n, i) => n === y[i]);
}

/**
 * Sets who the item is for: nobody, one person (`person`) or several (`persons`), or – in templates –
 * everyone (`forEach`). Who is ticked off already stays ticked off, as long as they are still on it.
 */
export function withPeople(attributes: Record<string, unknown>, people: string[], forEach = false): Record<string, unknown> {
  const next = { ...attributes };
  delete next.person;
  delete next.persons;
  delete next.forEach;
  const list = names(people);
  if (forEach) next.forEach = true;
  else if (list.length === 1) next.person = list[0];
  else if (list.length >= 2) next.persons = list;
  const done = names(attributes.done).filter((d) => list.length >= 2 && !forEach && list.some((p) => p.toLowerCase() === d.toLowerCase()));
  if (done.length) next.done = done;
  else {
    delete next.done;
    delete next.doneAt;
  }
  return next;
}

/** "@Sönke @Ulli" or "@alle" for the AddBar: everyone of a parsed item. */
export interface PeopleInput {
  person?: string | null;
  persons?: string[];
  forEach?: boolean;
}

/** The people of typed/added input, as attributes (person / persons / forEach). */
export function peopleAttributes(p: PeopleInput): Record<string, unknown> {
  if (p.forEach) return { forEach: true };
  const list = names(p.persons?.length ? p.persons : p.person ? [p.person] : []);
  if (list.length >= 2) return { persons: list };
  if (list.length === 1) return { person: list[0] };
  return {};
}

/**
 * "für jeden" turned into real people: in a list, everyone it is made for; in a template, multi-person
 * items become "für jeden" again. Items for one person are left alone.
 */
export function resolvePeople<T extends PeopleInput>(item: T, target: { isTemplate: boolean; persons: string[] }): T {
  if (target.isTemplate) {
    const many = names(item.persons).length >= 2;
    if (!many) return item;
    const { persons: _p, person: _q, ...rest } = item;
    return { ...rest, forEach: true } as T;
  }
  if (!item.forEach) return item;
  const { forEach: _f, ...rest } = item;
  const persons = names(target.persons);
  if (persons.length >= 2) return { ...rest, persons } as T;
  if (persons.length === 1) return { ...rest, person: persons[0] } as T;
  return rest as T;
}

/** The people a list is made for (chosen when it was created from a template). */
export function listPersons(list: { settings: Record<string, unknown> }): string[] {
  return names(list.settings.persons);
}

/** Everyone who appears on the items of a list (for suggestions and "für jeden" on lists made by hand). */
export function peopleOnItems(items: Pick<ItemRow, 'attributes' | 'deleted'>[]): string[] {
  return names(items.filter((i) => !i.deleted).flatMap((i) => peopleOf(i)));
}

/** A patch as it is applied: the synced fields plus ticks for single persons. */
export type ItemChange = Partial<ItemRow> & { personChecks?: Record<string, boolean>; attachments?: AttachmentChanges };

function millisOf(ts: string): number {
  const m = Number(ts.slice(0, 13));
  return Number.isFinite(m) ? m : Date.now();
}

/**
 * Applies an item patch (field-wise last writer wins, see applyPatch) and keeps the per-person ticks right:
 * - an `attributes` patch never decides who is ticked off (that comes from the per-person clocks),
 * - `checked` on a multi-person item ticks (or unticks) everyone,
 * - `personChecks` ticks single persons,
 * - afterwards `checked` is true exactly when everyone is ticked off.
 * Returns the names of the applied fields ("checked" also when it changed as a consequence).
 * Used by the server and by the app's local copy alike.
 */
export function applyItemPatch(row: ItemRow, patch: ItemChange, ts: string): string[] {
  const { personChecks, attachments, ...rest } = patch;
  if (rest.attributes) {
    const keep = row.attributes;
    const attrs: Record<string, unknown> = keepAttachments(rest.attributes, keep);
    delete attrs.done;
    delete attrs.doneAt;
    if (keep.done !== undefined) attrs.done = keep.done;
    if (keep.doneAt !== undefined) attrs.doneAt = keep.doneAt;
    rest.attributes = attrs;
  }
  const wasChecked = row.checked;
  const applied: string[] = applyPatch(row, rest as Partial<Record<keyof ItemRow, unknown>>, ts);
  if (attachments && applyAttachmentChanges(row, attachments, ts) && !applied.includes('attributes')) applied.push('attributes');

  const persons = itemPersons(row);
  if (!persons.length) {
    // No longer for several people: forget the ticks.
    if (row.attributes.done !== undefined || row.attributes.doneAt !== undefined) {
      const { done: _d, doneAt: _a, ...attrs } = row.attributes;
      row.attributes = attrs;
    }
    return applied;
  }

  const checks: Record<string, boolean> = {};
  if (applied.includes('checked')) for (const p of persons) checks[p] = !!rest.checked;
  for (const [name, on] of Object.entries(personChecks ?? {})) {
    const p = persons.find((x) => x.toLowerCase() === name.trim().toLowerCase());
    if (p) checks[p] = on;
  }

  let done = itemDone(row);
  let ticked = false;
  for (const [p, on] of Object.entries(checks)) {
    const key = `done:${p.toLowerCase()}`;
    const current = row.hlc[key];
    if (current !== undefined && current >= ts) continue;
    row.hlc[key] = ts;
    const has = done.includes(p);
    if (on && !has) done = [...done, p];
    if (!on && has) done = done.filter((d) => d !== p);
    if (on) ticked = true;
  }
  const attrs = { ...row.attributes };
  if (done.length) attrs.done = persons.filter((p) => done.includes(p));
  else delete attrs.done;
  if (ticked) attrs.doneAt = new Date(millisOf(ts)).toISOString();
  if (!done.length) delete attrs.doneAt;
  if (JSON.stringify(attrs) !== JSON.stringify(row.attributes)) {
    row.attributes = attrs;
    if (!applied.includes('attributes')) applied.push('attributes');
  }

  const all = persons.every((p) => done.includes(p));
  if (all !== row.checked) {
    row.checked = all;
    if ((row.hlc.checked ?? '') < ts) row.hlc.checked = ts;
  }
  if (row.checked !== wasChecked && !applied.includes('checked')) applied.push('checked');
  return applied;
}

/**
 * Merges the server's copy of an item with the local one (see mergeRow); ticks of single persons that
 * are newer locally (not sent yet) are kept.
 */
export function mergeItem(local: ItemRow, incoming: ItemRow, fields: readonly string[]): ItemRow {
  const merged = mergeRow(local, incoming, fields);
  mergeAttachments(local, merged);
  const persons = itemPersons(merged);
  if (!persons.length) return merged;
  let done = itemDone(merged);
  const localDone = itemDone(local);
  let changed = false;
  for (const p of persons) {
    const key = `done:${p.toLowerCase()}`;
    const l = local.hlc[key];
    const r = merged.hlc[key];
    if (l === undefined || (r !== undefined && l <= r)) continue;
    merged.hlc[key] = l;
    const on = localDone.includes(p);
    if (on !== done.includes(p)) {
      done = on ? [...done, p] : done.filter((d) => d !== p);
      changed = true;
    }
  }
  if (changed) {
    const attrs = { ...merged.attributes };
    if (done.length) attrs.done = persons.filter((p) => done.includes(p));
    else delete attrs.done;
    merged.attributes = attrs;
    merged.checked = persons.every((p) => done.includes(p));
  }
  return merged;
}

/** Ticks of single persons as a patch (the app sends this; the server works out `checked`). */
export function personCheckPatch(checks: Record<string, boolean>): ItemPatch {
  return { personChecks: checks };
}
