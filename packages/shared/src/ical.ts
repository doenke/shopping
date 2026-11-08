import { formatAmounts } from './amounts.js';
import { dueOf } from './due.js';
import { itemUrl, withUrl } from './links.js';
import type { ItemPatch, ItemRow, ListRow, ListType } from './model.js';
import { packingInfo } from './packing.js';
import { peopleLabel } from './people.js';
import type { ParsedItem } from './parser.js';

/**
 * Entries as tasks for other apps – iCalendar VTODO (CalDAV: Apple Erinnerungen, Thunderbird, DAVx⁵ + Tasks.org)
 * and the same fields for JMAP. The summary carries what a task app can show: "Milch – 2 l · bio".
 * Editing it there comes back as new name (and amount, if the text reads like "2 l Hafermilch").
 */

/** "Milch – 2 l · bio · Sönke + Ulli" */
export function taskTitle(item: Pick<ItemRow, 'name' | 'amounts' | 'properties' | 'attributes'>, listType: ListType): string {
  const spec = taskSpec(item, listType);
  return spec ? `${item.name} – ${spec}` : item.name;
}

function taskSpec(item: Pick<ItemRow, 'amounts' | 'properties' | 'attributes'>, listType: ListType): string {
  const who = listType === 'memo' ? null : peopleLabel(item);
  return [formatAmounts(item.amounts), ...item.properties, who].filter(Boolean).join(' · ');
}

/** When the item was last changed (from its field clocks), for LAST-MODIFIED and ETags. */
export function lastModified(item: Pick<ItemRow, 'hlc' | 'createdAt'>): Date {
  const millis = Object.values(item.hlc).reduce((max, ts) => Math.max(max, Number(ts.slice(0, 13)) || 0), 0);
  return millis ? new Date(millis) : new Date(item.createdAt);
}

/** The UID other apps know the item by (their own one if they created it). */
export function taskUid(item: Pick<ItemRow, 'id' | 'attributes'>): string {
  return typeof item.attributes.icalUid === 'string' && item.attributes.icalUid ? item.attributes.icalUid : item.id;
}

// ---- iCalendar text ---------------------------------------------------------

function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

function unescapeText(s: string): string {
  return s.replace(/\\([\\;,nN])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c));
}

/** Lines longer than 75 octets are folded (counted in characters, multibyte text stays well below). */
function fold(line: string): string {
  const parts: string[] = [];
  let rest = line;
  while (rest.length > 60) {
    parts.push(rest.slice(0, 60));
    rest = rest.slice(60);
  }
  parts.push(rest);
  return parts.join('\r\n ');
}

const stamp = (d: Date) =>
  d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');

/** One item as a complete iCalendar object with one VTODO. */
export function itemToIcal(item: ItemRow, list: Pick<ListRow, 'name' | 'listType'>, now = new Date()): string {
  const p = packingInfo(item);
  const due = dueOf(item);
  const url = itemUrl(item);
  const categories = [p.container].filter((c): c is string => !!c);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Shopping//Listen//DE',
    'CALSCALE:GREGORIAN',
    'BEGIN:VTODO',
    `UID:${escapeText(taskUid(item))}`,
    `DTSTAMP:${stamp(now)}`,
    `CREATED:${stamp(new Date(item.createdAt))}`,
    `LAST-MODIFIED:${stamp(lastModified(item))}`,
    `SUMMARY:${escapeText(taskTitle(item, list.listType))}`,
    ...(item.note ? [`DESCRIPTION:${escapeText(item.note)}`] : []),
    ...(due ? [`DUE;VALUE=DATE:${due.replace(/-/g, '')}`] : []),
    ...(url ? [`URL:${url}`] : []),
    ...(categories.length ? [`CATEGORIES:${categories.map(escapeText).join(',')}`] : []),
    `STATUS:${item.checked ? 'COMPLETED' : 'NEEDS-ACTION'}`,
    ...(item.checked ? [`COMPLETED:${stamp(new Date(item.checkedAt ?? lastModified(item)))}`, 'PERCENT-COMPLETE:100'] : []),
    `X-SHOPPING-LIST:${escapeText(list.name)}`,
    'END:VTODO',
    'END:VCALENDAR',
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

/** What a task app sent (the fields Shopping takes over). */
export interface IncomingTask {
  uid: string | null;
  summary: string;
  description: string | null;
  completed: boolean;
  /** YYYY-MM-DD */
  due: string | null;
  url: string | null;
}

/** Reads the first VTODO of an iCalendar text (null: there is none). */
export function parseIcalTodo(text: string): IncomingTask | null {
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim().toUpperCase() === 'BEGIN:VTODO');
  if (start < 0) return null;
  const props = new Map<string, { params: string; value: string }>();
  let depth = 0;
  for (const line of lines.slice(start + 1)) {
    const upper = line.trim().toUpperCase();
    if (upper === 'END:VTODO' && depth === 0) break;
    // Alarms and the like have properties of their own.
    if (upper.startsWith('BEGIN:')) depth++;
    if (upper.startsWith('END:')) depth--;
    if (depth > 0 || upper.startsWith('END:')) continue;
    const m = /^([A-Za-z0-9-]+)((?:;[^:]*)?):(.*)$/.exec(line);
    if (m && !props.has(m[1]!.toUpperCase())) props.set(m[1]!.toUpperCase(), { params: m[2] ?? '', value: m[3] ?? '' });
  }
  const text_ = (k: string) => {
    const v = props.get(k)?.value;
    return v === undefined ? null : unescapeText(v).trim() || null;
  };
  const status = props.get('STATUS')?.value.trim().toUpperCase();
  const dueRaw = props.get('DUE')?.value ?? '';
  const due = /^(\d{4})(\d{2})(\d{2})/.exec(dueRaw);
  return {
    uid: text_('UID'),
    summary: text_('SUMMARY') ?? '',
    description: text_('DESCRIPTION'),
    completed: status ? status === 'COMPLETED' : props.has('COMPLETED'),
    due: due ? `${due[1]}-${due[2]}-${due[3]}` : null,
    url: text_('URL'),
  };
}

/**
 * What changed, as a patch for the item. A new title is read like typed input ("2 l Hafermilch"),
 * unless only the name in front of " – " changed.
 */
export function taskPatch(
  item: ItemRow,
  listType: ListType,
  task: Pick<IncomingTask, 'summary' | 'description' | 'completed' | 'due' | 'url'>,
  parse: (text: string) => ParsedItem | null,
): ItemPatch {
  const patch: ItemPatch = {};
  const summary = task.summary.trim();
  if (summary && summary !== taskTitle(item, listType)) {
    const spec = taskSpec(item, listType);
    if (spec && summary.endsWith(` – ${spec}`)) {
      patch.name = summary.slice(0, -` – ${spec}`.length).trim() || item.name;
    } else {
      const parsed = parse(summary.split(' – ')[0]!);
      if (parsed) {
        patch.name = parsed.name;
        if (parsed.catalogItemId !== item.catalogItemId) patch.catalogItemId = parsed.catalogItemId;
        if (parsed.categoryId && parsed.categoryId !== item.categoryId) patch.categoryId = parsed.categoryId;
        if (parsed.amounts.length) patch.amounts = parsed.amounts;
        if (parsed.properties.length) patch.properties = parsed.properties;
      }
    }
    if (patch.name === item.name) delete patch.name;
  }
  if ((task.description ?? null) !== (item.note ?? null)) patch.note = task.description;
  if (task.completed !== item.checked) patch.checked = task.completed;
  let attributes = item.attributes;
  if (listType === 'todo' && (task.due ?? null) !== (dueOf(item) ?? null)) {
    attributes = { ...attributes };
    if (task.due) attributes.due = task.due;
    else delete attributes.due;
  }
  if ((task.url ?? null) !== itemUrl(item)) attributes = withUrl(attributes, task.url);
  if (attributes !== item.attributes) patch.attributes = attributes;
  return patch;
}
