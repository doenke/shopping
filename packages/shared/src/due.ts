/**
 * Due dates of ToDo items, kept as `attributes.due` (YYYY-MM-DD, local date).
 * Typed as "!heute", "!morgen", "!gestern", "!übermorgen", "!Fr", "!12.11.", "!12.11.2026" or "!2026-11-12".
 */

const WEEKDAYS = ['so', 'mo', 'di', 'mi', 'do', 'fr', 'sa'];

export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  r.setDate(r.getDate() + n);
  return r;
}

/** Parses one due token (without "!"); null if it is none. */
export function parseDue(token: string, now = new Date()): string | null {
  const t = token.toLowerCase().replace(/\.$/, '');
  if (t === 'heute') return isoDate(now);
  if (t === 'gestern') return isoDate(addDays(now, -1));
  if (t === 'morgen') return isoDate(addDays(now, 1));
  if (t === 'übermorgen' || t === 'uebermorgen') return isoDate(addDays(now, 2));
  const wd = WEEKDAYS.indexOf(t.slice(0, 2));
  if (wd >= 0 && /^(mo|di|mi|do|fr|sa|so)[a-z]*$/.test(t)) {
    // The next such day (today's weekday means next week).
    const diff = (wd - now.getDay() + 7) % 7 || 7;
    return isoDate(addDays(now, diff));
  }
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\.(\d{1,2})\.?(\d{2,4})?$/.exec(t);
  if (m) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    if (day < 1 || day > 31 || month < 1 || month > 12) return null;
    let year = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : now.getFullYear();
    // "12.1." in December means next January.
    if (!m[3] && new Date(year, month - 1, day) < addDays(now, -1)) year++;
    return isoDate(new Date(year, month - 1, day));
  }
  return null;
}

/** Pulls "!…" due tokens out of a typed line. */
export function extractDue(text: string, now = new Date()): { text: string; due: string | null } {
  let due: string | null = null;
  const rest = text.replace(/(^|\s)!([\p{L}\p{N}.\-]+)/gu, (all, pre: string, token: string) => {
    const d = parseDue(token, now);
    if (!d) return all;
    due ??= d;
    return pre;
  });
  return { text: rest.replace(/\s+/g, ' ').trim(), due };
}

export function dueOf(item: { attributes: Record<string, unknown> }): string | null {
  const d = item.attributes.due;
  return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

/** "Heute", "Morgen", "Fr., 14.11." – and whether it is overdue. */
export function formatDue(due: string, now = new Date()): { label: string; overdue: boolean; today: boolean } {
  const today = isoDate(now);
  const [y, mo, d] = due.split('-').map(Number) as [number, number, number];
  const date = new Date(y, mo - 1, d);
  const diff = Math.round((date.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86_400_000);
  const label =
    diff === 0
      ? 'Heute'
      : diff === 1
        ? 'Morgen'
        : diff === -1
          ? 'Gestern'
          : date.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric', ...(y !== now.getFullYear() ? { year: 'numeric' } : {}) });
  return { label, overdue: due < today, today: due === today };
}
