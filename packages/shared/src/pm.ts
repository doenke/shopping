import type { ItemRow } from './model.js';
import { dueOf } from './due.js';

/**
 * Project planning for ToDo lists (second level: the normal ToDo view stays as it is).
 *
 * Stored per item in `attributes.pm`:
 *   start / end   planned start / end date ("YYYY-MM-DD"; later also "YYYY-MM-DDTHH:mm")
 *   dur           planned duration in minutes of working time (a working day = `dayMinutes`, 480)
 *                 – each of the three as { v, src }: "set" = given by hand (a constraint for the
 *                   planning), "calc" = written by the planning automation (only a hint for others)
 *   milestone     true: duration 0, a point in time
 *   effort/spent  planned / spent effort in minutes (person time, not duration)
 *   notBefore     must not start before this date
 *   deps          predecessors: { <itemId>: { type, lag } } – only the successor stores the link;
 *                 the successors of an item are derived (see successorsOf), so both sides never disagree
 * The due date (`attributes.due`) stays as it is and is the deadline: a planned end after it is a conflict.
 *
 * Every field has an own clock (`hlc["pm:<field>"]`, a dependency `hlc["pm:dep:<id>"]`) and changes only
 * through the `pm` part of an item patch ({ field: value } or { field: null }, { "dep:<id>": dep | null }),
 * so two people editing different fields at the same time both keep theirs and an `attributes` patch never
 * drops planning data.
 *
 * Early/late dates, float and the critical path are not stored: `schedule` computes them on every device
 * from the same data.
 */

export type PmSource = 'set' | 'calc';
export interface PmValue<T> {
  v: T;
  src: PmSource;
}
/** FS: starts after the predecessor's end, SS: starts with its start, FF: ends with its end, SF: ends with its start. */
export type DepType = 'FS' | 'SS' | 'FF' | 'SF';
export const DEP_TYPES: readonly DepType[] = ['FS', 'SS', 'FF', 'SF'];
export interface PmDep {
  type: DepType;
  /** Minutes of working time; negative = overlap. */
  lag: number;
}
export interface ItemPm {
  start?: PmValue<string>;
  end?: PmValue<string>;
  dur?: PmValue<number>;
  milestone?: boolean;
  effort?: number;
  spent?: number;
  notBefore?: string;
  deps: Record<string, PmDep>;
}

/** The fields of `attributes.pm` that can be patched (dependencies as "dep:<id>"). */
export const PM_FIELDS = ['start', 'end', 'dur', 'milestone', 'effort', 'spent', 'notBefore'] as const;
export type PmField = (typeof PM_FIELDS)[number];
/** Changes as they travel in an item patch. */
export type PmChanges = Record<string, unknown>;

/** Minutes of a standard working day (durations are shown in days of this length). */
export const DAY_MINUTES = 480;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (v: unknown): v is string => typeof v === 'string' && DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const isMinutes = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 10_000_000;
const isSrc = (v: unknown): v is PmSource => v === 'set' || v === 'calc';

function toValue<T>(v: unknown, ok: (x: unknown) => x is T): PmValue<T> | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  return ok(o.v) && isSrc(o.src) ? { v: o.v, src: o.src } : undefined;
}

function toDep(v: unknown): PmDep | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const type = DEP_TYPES.includes(o.type as DepType) ? (o.type as DepType) : 'FS';
  const lag = typeof o.lag === 'number' && Number.isInteger(o.lag) && Math.abs(o.lag) <= 10_000_000 ? o.lag : 0;
  return { type, lag };
}

/** A valid value for a field (or for "dep:<id>"), else undefined. */
function cleanField(key: string, v: unknown): unknown {
  if (key.startsWith('dep:')) return toDep(v) ?? undefined;
  switch (key as PmField) {
    case 'start':
    case 'end':
      return toValue(v, isDate);
    case 'dur':
      return toValue(v, isMinutes);
    case 'milestone':
      return v === true ? true : undefined;
    case 'effort':
    case 'spent':
      return isMinutes(v) ? v : undefined;
    case 'notBefore':
      return isDate(v) ? v : undefined;
    default:
      return undefined;
  }
}

/** The planning data of an item (empty when it has none). */
export function itemPm(item: Pick<ItemRow, 'attributes'>): ItemPm {
  const raw = item.attributes.pm;
  const out: ItemPm = { deps: {} };
  if (!raw || typeof raw !== 'object') return out;
  const o = raw as Record<string, unknown>;
  for (const f of PM_FIELDS) {
    const v = cleanField(f, o[f]);
    if (v !== undefined) (out as unknown as Record<string, unknown>)[f] = v;
  }
  if (o.deps && typeof o.deps === 'object') {
    for (const [id, d] of Object.entries(o.deps as Record<string, unknown>)) {
      const dep = toDep(d);
      if (dep && id) out.deps[id] = dep;
    }
  }
  return out;
}

/** Whether an item carries any planning data. */
export function hasPm(item: Pick<ItemRow, 'attributes'>): boolean {
  const pm = itemPm(item);
  return PM_FIELDS.some((f) => pm[f] !== undefined) || Object.keys(pm.deps).length > 0;
}

function storePm(attributes: Record<string, unknown>, pm: ItemPm): Record<string, unknown> {
  const { pm: _old, ...rest } = attributes;
  const out: Record<string, unknown> = {};
  for (const f of PM_FIELDS) if (pm[f] !== undefined) out[f] = pm[f];
  if (Object.keys(pm.deps).length) out.deps = pm.deps;
  return Object.keys(out).length ? { ...rest, pm: out } : rest;
}

/**
 * Applies planning changes to a row, each field and each dependency with its own clock.
 * Returns true when something changed.
 */
export function applyPmChanges(row: Pick<ItemRow, 'id' | 'attributes' | 'hlc'>, changes: PmChanges, ts: string): boolean {
  const pm = itemPm(row);
  let changed = false;
  for (const [key, value] of Object.entries(changes)) {
    const isDep = key.startsWith('dep:');
    if (!isDep && !(PM_FIELDS as readonly string[]).includes(key)) continue;
    if (isDep && (key.length <= 4 || key.slice(4) === row.id)) continue;
    const clock = `pm:${key}`;
    const current = row.hlc[clock];
    if (current !== undefined && current >= ts) continue;
    const v = value === null ? undefined : cleanField(key, value);
    if (value !== null && v === undefined) continue; // invalid: ignored, clock untouched
    row.hlc[clock] = ts;
    if (isDep) {
      const id = key.slice(4);
      if (v) pm.deps[id] = v as PmDep;
      else delete pm.deps[id];
    } else if (v === undefined) delete (pm as unknown as Record<string, unknown>)[key];
    else (pm as unknown as Record<string, unknown>)[key] = v;
    changed = true;
  }
  if (!changed) return false;
  const next = storePm(row.attributes, pm);
  if (JSON.stringify(next.pm) === JSON.stringify(row.attributes.pm)) return false;
  row.attributes = next;
  return true;
}

/** Keeps planning fields whose local clock is newer than the server's (not sent yet). */
export function mergePm(local: Pick<ItemRow, 'id' | 'attributes' | 'hlc'>, merged: Pick<ItemRow, 'id' | 'attributes' | 'hlc'>): void {
  const localPm = itemPm(local);
  for (const [clock, l] of Object.entries(local.hlc)) {
    if (!clock.startsWith('pm:')) continue;
    const r = merged.hlc[clock];
    if (r !== undefined && l <= r) continue;
    const key = clock.slice(3);
    const value = key.startsWith('dep:') ? (localPm.deps[key.slice(4)] ?? null) : ((localPm as unknown as Record<string, unknown>)[key] ?? null);
    applyPmChanges(merged, { [key]: value }, l);
  }
}

/** The attributes without the stored planning data – an `attributes` patch never decides it. */
export function keepPm(next: Record<string, unknown>, current: Record<string, unknown>): Record<string, unknown> {
  const { pm: _drop, ...rest } = next;
  return current.pm !== undefined ? { ...rest, pm: current.pm } : rest;
}

/** The successors of an item, derived from the predecessors stored on the others. */
export function successorsOf(id: string, items: Pick<ItemRow, 'id' | 'attributes' | 'deleted'>[]): { id: string; dep: PmDep }[] {
  const out: { id: string; dep: PmDep }[] = [];
  for (const it of items) {
    if (it.deleted || it.id === id) continue;
    const dep = itemPm(it).deps[id];
    if (dep) out.push({ id: it.id, dep });
  }
  return out;
}

/**
 * Whether linking `pred` → `succ` would close a circle (or link an item to itself). Used before the app
 * offers or stores a dependency; `schedule` also copes with circles that came in through sync.
 */
export function wouldCreateCycle(pred: string, succ: string, items: Pick<ItemRow, 'id' | 'attributes' | 'deleted'>[]): boolean {
  if (pred === succ) return true;
  const byId = new Map(items.filter((i) => !i.deleted).map((i) => [i.id, itemPm(i).deps]));
  // Is `succ` already a (transitive) predecessor of `pred`?
  const seen = new Set<string>();
  const stack = [pred];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === succ) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const p of Object.keys(byId.get(id) ?? {})) stack.push(p);
  }
  return false;
}

/**
 * The planning data of an entry as changes for a copy of it (moving to another list creates a copy with a
 * new id; an `attributes` patch does not carry planning data). Links to entries moved along are carried
 * over (`idMap` old → new id), links to entries that stay behind are dropped (dependencies stay within one
 * list).
 */
export function pmChangesForCopy(item: Pick<ItemRow, 'attributes'>, idMap: Map<string, string>): PmChanges | undefined {
  const pm = itemPm(item);
  const out: PmChanges = {};
  for (const f of PM_FIELDS) if (pm[f] !== undefined) out[f] = pm[f];
  for (const [id, dep] of Object.entries(pm.deps)) {
    const to = idMap.get(id);
    if (to) out[`dep:${to}`] = dep;
  }
  return Object.keys(out).length ? out : undefined;
}

// ---------------------------------------------------------------------------------------------------------
// Working calendar

/**
 * Which days of the week are working days, and how long they are. List setting `workDays` (0 = Sunday …
 * 6 = Saturday; default Monday to Friday). Later per day `workHours: { "1": { from: "08:00", to: "16:00" } }`
 * – then a day has the minutes between, else `DAY_MINUTES`.
 */
export interface WorkCalendar {
  /** Minutes of working time per weekday (0 = Sunday); 0 = free day. */
  minutes: number[];
}

export const DEFAULT_WORK_DAYS = [1, 2, 3, 4, 5];

function clock(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(v);
  if (!m) return null;
  const min = Number(m[1]) * 60 + Number(m[2]);
  return min <= 24 * 60 ? min : null;
}

/** The working days of a list (0 = Sunday), in order. */
export function listWorkDays(list: { settings: Record<string, unknown> }): number[] {
  const raw = list.settings.workDays;
  if (!Array.isArray(raw)) return DEFAULT_WORK_DAYS;
  const days = [...new Set(raw.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  return days.length ? days : DEFAULT_WORK_DAYS;
}

export function listCalendar(list: { settings: Record<string, unknown> }): WorkCalendar {
  const days = listWorkDays(list);
  const hours = list.settings.workHours && typeof list.settings.workHours === 'object' ? (list.settings.workHours as Record<string, unknown>) : {};
  const minutes = [0, 1, 2, 3, 4, 5, 6].map((d) => {
    if (!days.includes(d)) return 0;
    const h = hours[String(d)] as { from?: unknown; to?: unknown } | undefined;
    const from = clock(h?.from);
    const to = clock(h?.to);
    return from !== null && to !== null && to > from ? to - from : DAY_MINUTES;
  });
  return { minutes };
}

/** Project planning is switched on for the list (list setting `planning`). */
export function listPlans(list: { settings: Record<string, unknown> }): boolean {
  return list.settings.planning === true;
}

/** The project's start (list setting `projectStart`), if set. */
export function listProjectStart(list: { settings: Record<string, unknown> }): string | null {
  return isDate(list.settings.projectStart) ? list.settings.projectStart : null;
}

const DAY_MS = 86_400_000;
/** Days since 1970-01-01 (a Thursday) of a "YYYY-MM-DD" date. */
const dayNumber = (date: string) => Math.round(Date.parse(`${date.slice(0, 10)}T00:00:00Z`) / DAY_MS);
const dateOfDay = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);
/** Weekday (0 = Sunday) of a day number. */
const weekday = (n: number) => (((n + 4) % 7) + 7) % 7;

/**
 * Working time as one axis: minutes of working time since the Monday 1970-01-05 (free days take no room).
 * The end of one working day and the start of the next one are the same point; dates show a point as the
 * day it starts (for starts) or ends (for ends) in.
 */
class Axis {
  readonly week: number;
  /** Working minutes before each weekday, in a week starting on Monday. */
  private readonly before: number[];
  constructor(private readonly cal: WorkCalendar) {
    const m = cal.minutes.some((x) => x > 0) ? cal.minutes : [0, ...DEFAULT_WORK_DAYS.map(() => DAY_MINUTES), 0];
    this.cal = { minutes: m };
    this.week = m.reduce((a, b) => a + b, 0);
    this.before = [];
    let sum = 0;
    for (const d of [1, 2, 3, 4, 5, 6, 0]) {
      this.before[d] = sum;
      sum += m[d]!;
    }
  }
  /** Where a day starts on the axis (a free day: where the next working day starts). */
  dayStart(day: number): number {
    const fromMonday = day - 4; // day 4 = 1970-01-05, a Monday
    const weeks = Math.floor(fromMonday / 7);
    return weeks * this.week + this.before[weekday(day)]!;
  }
  dayEnd(day: number): number {
    return this.dayStart(day) + this.cal.minutes[weekday(day)]!;
  }
  /** The working day a point starts in (a point at a day's end belongs to the next working day). */
  startDay(t: number): number {
    let day = 4 + Math.floor(t / this.week) * 7;
    while (this.dayEnd(day) <= t || this.cal.minutes[weekday(day)] === 0) day++;
    return day;
  }
  /** The working day a point ends in (a point at a day's start belongs to the previous working day). */
  endDay(t: number): number {
    let day = 4 + Math.floor(t / this.week) * 7 + 7;
    while (this.dayStart(day) >= t || this.cal.minutes[weekday(day)] === 0) day--;
    return day;
  }
}

/** Whether a date is a working day of the calendar. */
export function isWorkDay(date: string, cal: WorkCalendar): boolean {
  return (cal.minutes[weekday(dayNumber(date))] ?? 0) > 0;
}

/** A date plus some calendar days. */
export function addCalendarDays(date: string, days: number): string {
  return dateOfDay(dayNumber(date) + days);
}

/** Calendar days from one date to another (negative when `to` lies before `from`). */
export function calendarDaysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

/** Working time from the start of one day to the end of another (0 if the end lies before the start). */
export function workBetween(start: string, end: string, cal: WorkCalendar): number {
  const axis = new Axis(cal);
  return Math.max(0, axis.dayEnd(dayNumber(end)) - axis.dayStart(dayNumber(start)));
}

/** Duration (minutes of working time) shown in working days. */
export function minutesToDays(min: number): number {
  return Math.round((min / DAY_MINUTES) * 100) / 100;
}
export function daysToMinutes(days: number): number {
  return Math.round(days * DAY_MINUTES);
}

// ---------------------------------------------------------------------------------------------------------
// Scheduling (critical path method)

export type PmConflict =
  /** The given start lies before what the predecessors (or "not before") allow. */
  | 'start'
  /** The given end lies before what the predecessors allow. */
  | 'end'
  /** The planned end lies after the due date. */
  | 'due'
  /** Part of a circle of dependencies (those links are ignored). */
  | 'cycle';

export interface ScheduledItem {
  id: string;
  milestone: boolean;
  /** Duration in minutes of working time. */
  duration: number;
  /** Where duration, start and end come from. */
  durationSrc: PmSource;
  startSrc: PmSource;
  endSrc: PmSource;
  /** Planned start / end (dates): given ones, else the early dates. */
  start: string;
  end: string;
  earlyStart: string;
  earlyEnd: string;
  lateStart: string;
  lateEnd: string;
  /** Total float in minutes of working time (negative: the plan does not work out). */
  float: number;
  critical: boolean;
  conflicts: PmConflict[];
}

export interface ScheduleOptions {
  calendar: WorkCalendar;
  /** Where the plan starts (list setting `projectStart`, else today). */
  projectStart: string;
}

interface Node {
  id: string;
  dur: number;
  durSrc: PmSource;
  milestone: boolean;
  fixedStart: number | null;
  fixedEnd: number | null;
  notBefore: number | null;
  deadline: number | null;
  preds: { id: string; dep: PmDep }[];
  succs: { id: string; dep: PmDep }[];
  es: number;
  ef: number;
  ls: number;
  lf: number;
  /** The start was decided by a predecessor or a given date (a milestone then shows the day it ends). */
  bound: boolean;
  conflicts: Set<PmConflict>;
}

/**
 * Computes early and late dates, float and the critical path of a list's entries (deleted ones are left
 * out; dependencies on entries that are not there are ignored). Given start/end/duration ("set") are
 * fixed; a given start and end together decide the duration. Without a duration an entry takes one day,
 * a milestone none.
 */
export function schedule(items: Pick<ItemRow, 'id' | 'attributes' | 'deleted'>[], opts: ScheduleOptions): Map<string, ScheduledItem> {
  const axis = new Axis(opts.calendar);
  const live = items.filter((i) => !i.deleted);
  const nodes = new Map<string, Node>();
  for (const it of live) {
    const pm = itemPm(it);
    const milestone = pm.milestone === true;
    const fixedStart = pm.start?.src === 'set' ? axis.dayStart(dayNumber(pm.start.v)) : null;
    const fixedEnd = pm.end?.src === 'set' ? axis.dayEnd(dayNumber(pm.end.v)) : null;
    let dur = milestone ? 0 : pm.dur ? pm.dur.v : DAY_MINUTES;
    let durSrc: PmSource = milestone || pm.dur?.src === 'set' ? 'set' : 'calc';
    if (!milestone && fixedStart !== null && fixedEnd !== null) {
      dur = Math.max(0, fixedEnd - fixedStart);
      durSrc = 'calc';
    }
    const due = dueOf(it);
    nodes.set(it.id, {
      id: it.id,
      dur,
      durSrc,
      milestone,
      fixedStart: milestone && fixedStart !== null ? axis.dayEnd(dayNumber(pm.start!.v)) : fixedStart,
      fixedEnd,
      notBefore: pm.notBefore ? axis.dayStart(dayNumber(pm.notBefore)) : null,
      deadline: due ? axis.dayEnd(dayNumber(due)) : null,
      preds: [],
      succs: [],
      es: 0,
      ef: 0,
      ls: 0,
      lf: 0,
      bound: false,
      conflicts: new Set(),
    });
  }
  for (const it of live) {
    for (const [pred, dep] of Object.entries(itemPm(it).deps)) {
      if (pred === it.id || !nodes.has(pred)) continue;
      nodes.get(it.id)!.preds.push({ id: pred, dep });
      nodes.get(pred)!.succs.push({ id: it.id, dep });
    }
  }

  // Topological order (Kahn); what is left over sits in (or behind) a circle.
  const order: Node[] = [];
  const indeg = new Map([...nodes.values()].map((n) => [n.id, n.preds.length]));
  const queue = [...nodes.values()].filter((n) => n.preds.length === 0);
  while (queue.length) {
    const n = queue.shift()!;
    order.push(n);
    for (const s of n.succs) {
      const d = indeg.get(s.id)! - 1;
      indeg.set(s.id, d);
      if (d === 0) queue.push(nodes.get(s.id)!);
    }
  }
  if (order.length < nodes.size) {
    const done = new Set(order.map((n) => n.id));
    const rest = [...nodes.values()].filter((n) => !done.has(n.id));
    const restIds = new Set(rest.map((n) => n.id));
    for (const n of rest) {
      n.conflicts.add('cycle');
      // Links inside the circle are ignored; the rest is scheduled in a stable order.
      n.preds = n.preds.filter((p) => !restIds.has(p.id));
      n.succs = n.succs.filter((s) => !restIds.has(s.id));
    }
    for (const n of order) n.succs = n.succs.filter((s) => !restIds.has(s.id));
    order.push(...rest);
  }

  // Forward pass.
  const projectStart = axis.dayStart(dayNumber(opts.projectStart));
  for (const n of order) {
    let es = Math.max(projectStart, n.notBefore ?? -Infinity);
    for (const { id, dep } of n.preds) {
      const p = nodes.get(id)!;
      const t = dep.type === 'FS' ? p.ef + dep.lag : dep.type === 'SS' ? p.es + dep.lag : dep.type === 'FF' ? p.ef + dep.lag - n.dur : p.es + dep.lag - n.dur;
      if (t >= es) n.bound = true;
      es = Math.max(es, t);
    }
    if (n.fixedStart !== null || n.fixedEnd !== null) n.bound = true;
    if (n.fixedStart !== null) {
      if (n.fixedStart < es) n.conflicts.add('start');
      es = n.fixedStart;
    } else if (n.fixedEnd !== null) {
      if (n.fixedEnd - n.dur < es) n.conflicts.add('end');
      es = n.fixedEnd - n.dur;
    }
    n.es = es;
    n.ef = es + n.dur;
  }

  // Backward pass.
  const projectEnd = Math.max(projectStart, ...order.map((n) => n.ef));
  for (const n of [...order].reverse()) {
    let lf = Math.min(projectEnd, n.deadline ?? Infinity);
    for (const { id, dep } of n.succs) {
      const s = nodes.get(id)!;
      const t = dep.type === 'FS' ? s.ls - dep.lag : dep.type === 'SS' ? s.ls - dep.lag + n.dur : dep.type === 'FF' ? s.lf - dep.lag : s.lf - dep.lag + n.dur;
      lf = Math.min(lf, t);
    }
    n.lf = lf;
    n.ls = lf - n.dur;
    if (n.deadline !== null && n.ef > n.deadline) n.conflicts.add('due');
  }

  const out = new Map<string, ScheduledItem>();
  for (const n of nodes.values()) {
    // A point in time (milestone) right after a predecessor is shown on the day that one ends, else (at the
    // project start, "not before") on the day it starts.
    const point = n.dur === 0;
    const startDate = (t: number) => dateOfDay(point && n.bound ? axis.endDay(t) : axis.startDay(t));
    const endDate = (t: number) => (point ? startDate(t) : dateOfDay(axis.endDay(t)));
    const float = n.ls - n.es;
    out.set(n.id, {
      id: n.id,
      milestone: n.milestone,
      duration: n.dur,
      durationSrc: n.durSrc,
      startSrc: n.fixedStart !== null ? 'set' : 'calc',
      endSrc: n.fixedEnd !== null ? 'set' : 'calc',
      start: startDate(n.es),
      end: endDate(n.ef),
      earlyStart: startDate(n.es),
      earlyEnd: endDate(n.ef),
      lateStart: startDate(n.ls),
      lateEnd: endDate(n.lf),
      float,
      critical: float <= 0,
      conflicts: [...n.conflicts],
    });
  }
  return out;
}
