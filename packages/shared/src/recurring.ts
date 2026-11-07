import type { ListRow } from './model.js';

/** Recurring checklists (ToDo and packing lists): everything is unchecked again at the start of each period. */
export type ResetEvery = 'daily' | 'weekly' | 'monthly';
export const RESET_EVERY: ResetEvery[] = ['daily', 'weekly', 'monthly'];
export const RESET_LABEL: Record<ResetEvery, string> = { daily: 'täglich', weekly: 'wöchentlich (montags)', monthly: 'monatlich (am 1.)' };
const TZ = 'Europe/Berlin';

/** Lists that can be reset: where a checked entry stays (done, packed) instead of being bought. */
export function canReset(list: Pick<ListRow, 'listType' | 'isTemplate'>): boolean {
  return !list.isTemplate && (list.listType === 'todo' || list.listType === 'packing');
}

export function listReset(list: Pick<ListRow, 'settings' | 'listType' | 'isTemplate'>): ResetEvery | null {
  const v = list.settings.reset;
  return canReset(list) && RESET_EVERY.includes(v as ResetEvery) ? (v as ResetEvery) : null;
}

/** Date parts of an instant on the Berlin wall clock. */
function berlin(at: Date): { y: number; m: number; d: number; h: number; min: number; weekday: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23', weekday: 'short' })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.weekday!);
  return { y: +parts.year!, m: +parts.month!, d: +parts.day!, h: +parts.hour!, min: +parts.minute!, weekday };
}

/** The instant of midnight (Berlin) on that calendar day. */
function berlinMidnight(y: number, m: number, d: number): Date {
  const guess = Date.UTC(y, m - 1, d);
  // Berlin is ahead of UTC: look at what the wall clock says at the UTC midnight and step back by that.
  const w = berlin(new Date(guess));
  const ahead = (Date.UTC(w.y, w.m - 1, w.d, w.h, w.min) - guess) / 60_000;
  return new Date(guess - ahead * 60_000);
}

/** Start of the current period: entries checked before it are unchecked again. */
export function resetPeriodStart(every: ResetEvery, now = new Date()): Date {
  const b = berlin(now);
  if (every === 'monthly') return berlinMidnight(b.y, b.m, 1);
  const day = new Date(Date.UTC(b.y, b.m - 1, b.d - (every === 'weekly' ? b.weekday : 0)));
  return berlinMidnight(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate());
}
