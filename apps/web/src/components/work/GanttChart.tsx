import {
  addCalendarDays,
  calendarDaysBetween,
  comparePositions,
  dueOf,
  isoDate,
  isWorkDay,
  itemPm,
  listCalendar,
  peopleLabel,
  pmCalcChanges,
  workBetween,
  type CatalogIndex,
  type DepType,
  type ItemRow,
  type ListRow,
  type ScheduledItem,
} from '@shopping/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { updateItem, writePlannedDates } from '../../actions';
import { showToast } from '../../toast';
import { conflictTexts, delayText, DEP_LABEL, shortDate, useSchedule } from '../Planning';
import { TaskAdd, TaskHeader } from './TaskTable';

interface Props {
  list: ListRow;
  items: ItemRow[];
  index: CatalogIndex;
  selected: string | null;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  viewSwitch?: React.ReactNode;
}

type Zoom = 'day' | 'week';
const DAY_WIDTH: Record<Zoom, number> = { day: 28, week: 10 };
const ROW = 34;
const NAME_WIDTH = 240;
/** Calendar days shown before the first and after the last bar. */
const PAD_BEFORE = 3;
const PAD_AFTER = 10;

function loadZoom(listId: string): Zoom {
  try {
    return localStorage.getItem(`gantt-zoom:${listId}`) === 'week' ? 'week' : 'day';
  } catch {
    return 'day';
  }
}

/** ISO week number of a date. */
function weekNumber(date: string): number {
  const d = new Date(`${date}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round((d.getTime() - firstThursday.getTime()) / 86_400_000 / 7 - ((firstThursday.getUTCDay() + 6) % 7) / 7 + 3 / 7);
}

const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const WEEKDAY_LETTERS = ['S', 'M', 'D', 'M', 'D', 'F', 'S'];

interface Drag {
  id: string;
  mode: 'move' | 'end';
  x: number;
  /** Calendar days moved so far. */
  days: number;
}

/**
 * The plan of a ToDo list as a Gantt chart (lists with project planning): one row per task, bars from the
 * planned start to the planned end, milestones as diamonds, the links as arrows. Dragging a bar sets its
 * start (a given value), dragging its right edge its duration; a click selects, a double click opens.
 */
export function GanttChart({ list, items, index, selected, onSelect, onOpen, viewSwitch }: Props) {
  const plan = useSchedule(list, items);
  const calendar = useMemo(() => listCalendar(list), [list]);
  const [zoom, setZoom] = useState<Zoom>(() => loadZoom(list.id));
  useEffect(() => setZoom(loadZoom(list.id)), [list.id]);
  const chooseZoom = (z: Zoom) => {
    setZoom(z);
    try {
      localStorage.setItem(`gantt-zoom:${list.id}`, z);
    } catch {
      // Only a convenience.
    }
  };
  const dw = DAY_WIDTH[zoom];
  const today = isoDate(new Date());

  const rows = useMemo(
    () =>
      items
        .filter((i) => !i.deleted && plan.has(i.id))
        .sort((a, b) => Number(a.checked) - Number(b.checked) || comparePositions(a.position, b.position))
        .map((item) => ({ item, s: plan.get(item.id)! })),
    [items, plan],
  );
  const done = rows.filter((r) => r.item.checked).length;
  // Planning automation: how many open tasks would get new calculated dates.
  const pending = useMemo(() => pmCalcChanges(items, plan).size, [items, plan]);
  const fixDates = async () => {
    const n = await writePlannedDates(items, plan);
    showToast(n === 1 ? 'Termine für 1 Aufgabe festgeschrieben' : `Termine für ${n} Aufgaben festgeschrieben`);
  };

  // The time range: all bars (and today, when it is near), with some room on both sides.
  const range = useMemo(() => {
    const dates = rows.flatMap(({ s }) => [s.start, s.end, s.lateEnd]);
    let from = dates.reduce((m, d) => (d < m ? d : m), dates[0] ?? today);
    let to = dates.reduce((m, d) => (d > m ? d : m), dates[0] ?? today);
    if (today < from && calendarDaysBetween(today, from) < 60) from = today;
    if (today > to && calendarDaysBetween(to, today) < 60) to = today;
    from = addCalendarDays(from, -PAD_BEFORE);
    // Weeks start on Monday.
    if (zoom === 'week') from = addCalendarDays(from, -((new Date(`${from}T00:00:00Z`).getUTCDay() + 6) % 7));
    to = addCalendarDays(to, PAD_AFTER);
    return { from, days: calendarDaysBetween(from, to) + 1 };
  }, [rows, today, zoom]);

  const x = (date: string) => calendarDaysBetween(range.from, date) * dw;
  const days = useMemo(() => Array.from({ length: range.days }, (_, i) => addCalendarDays(range.from, i)), [range]);

  // Dragging a bar: the bar follows the mouse in whole days; on release it is saved.
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;
  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (d) setDrag({ ...d, days: Math.round((e.clientX - d.x) / dw) });
    };
    const onUp = () => {
      const d = dragRef.current;
      setDrag(null);
      if (!d || d.days === 0) return;
      const row = rows.find((r) => r.item.id === d.id);
      if (!row) return;
      const { s, item } = row;
      const pm = itemPm(item);
      if (d.mode === 'move') {
        const start = addCalendarDays(s.start, d.days);
        // A given end moves along; the duration stays.
        const changes: Record<string, unknown> = { start: { v: start, src: 'set' } };
        if (pm.end?.src === 'set') changes.end = { v: addCalendarDays(pm.end.v, d.days), src: 'set' };
        void updateItem(item.id, { pm: changes });
      } else {
        const end = addCalendarDays(s.end, d.days);
        if (end < s.start) return;
        if (pm.start?.src === 'set' && pm.end?.src === 'set') void updateItem(item.id, { pm: { end: { v: end, src: 'set' } } });
        else void updateItem(item.id, { pm: { dur: { v: Math.max(0, workBetween(s.start, end, calendar)), src: 'set' }, end: null } });
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    // Only when a drag starts or ends.
  }, [drag === null]);

  /** Where a bar is drawn (with the drag applied). */
  const geometry = (id: string, s: ScheduledItem) => {
    const shift = drag?.id === id && drag.mode === 'move' ? drag.days : 0;
    const grow = drag?.id === id && drag.mode === 'end' ? drag.days : 0;
    const left = x(s.start) + shift * dw;
    if (s.milestone) return { left: x(s.start) + (shift + 1) * dw, width: 0 };
    return { left, width: Math.max(dw, (calendarDaysBetween(s.start, s.end) + 1 + grow) * dw) };
  };

  // Arrows: from the predecessor's end (or start) to the successor's start (or end).
  const rowOf = new Map(rows.map((r, i) => [r.item.id, i]));
  const arrows: { key: string; d: string; critical: boolean }[] = [];
  for (const [i, { item, s }] of rows.entries()) {
    for (const [pred, dep] of Object.entries(itemPm(item).deps)) {
      const j = rowOf.get(pred);
      if (j === undefined) continue;
      const p = rows[j]!;
      const pg = geometry(p.item.id, p.s);
      const sg = geometry(item.id, s);
      const type: DepType = dep.type;
      const ax = type[0] === 'F' ? pg.left + pg.width : pg.left;
      const bx = type[1] === 'S' ? sg.left : sg.left + sg.width;
      const ay = j * ROW + ROW / 2;
      const by = i * ROW + ROW / 2;
      const out = type[0] === 'F' ? 1 : -1;
      const into = type[1] === 'S' ? -1 : 1;
      const x1 = ax + out * 8;
      const x2 = bx + into * 8;
      const fits = into === -1 ? x1 <= x2 : x1 >= x2;
      const mid = (j < i ? i : i + 1) * ROW;
      const d = fits ? `M${ax},${ay} H${x2} V${by} H${bx}` : `M${ax},${ay} H${x1} V${mid} H${x2} V${by} H${bx}`;
      arrows.push({ key: `${pred}>${item.id}`, d, critical: p.s.critical && s.critical && !item.checked });
    }
  }

  const width = range.days * dw;
  const months: { label: string; left: number; width: number }[] = [];
  for (const [i, d] of days.entries()) {
    const last = months.at(-1);
    const label = `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
    if (last?.label === label) last.width += dw;
    else months.push({ label, left: i * dw, width: dw });
  }

  return (
    <section className="work-tasks work-tasks--gantt" aria-label={list.name}>
      <TaskHeader
        list={list}
        open={rows.length - done}
        done={done}
        viewSwitch={
          <div className="work-tasks__tools">
            <button
              type="button"
              className="btn gantt__fix"
              disabled={pending === 0}
              title={
                pending
                  ? 'Berechnete Start- und Endtermine in die Aufgaben schreiben – dann sehen sie auch Kalender-Apps (CalDAV), die API und andere Geräte. Vorgaben bleiben.'
                  : 'Alle berechneten Termine sind festgeschrieben.'
              }
              onClick={() => void fixDates()}
            >
              📌 Termine festschreiben{pending ? ` (${pending})` : ''}
            </button>
            <div className="segmented" role="group" aria-label="Zeitachse">
              {(['day', 'week'] as const).map((z) => (
                <button key={z} type="button" className={z === zoom ? 'active' : ''} aria-pressed={z === zoom} onClick={() => chooseZoom(z)}>
                  {z === 'day' ? 'Tage' : 'Wochen'}
                </button>
              ))}
            </div>
            {viewSwitch}
          </div>
        }
      />
      <TaskAdd list={list} index={index} />
      <div className="gantt" style={{ '--gantt-row': `${ROW}px`, '--gantt-name': `${NAME_WIDTH}px` } as React.CSSProperties}>
        <div className="gantt__inner" style={{ width: NAME_WIDTH + width }}>
          <div className="gantt__head">
            <div className="gantt__corner">Aufgabe</div>
            <div className="gantt__scale" style={{ width }}>
              <div className="gantt__months">
                {months.map((m) => (
                  <span key={m.label} style={{ left: m.left, width: m.width }}>
                    {m.width >= 40 ? m.label : ''}
                  </span>
                ))}
              </div>
              <div className="gantt__days">
                {days.map((d, i) =>
                  zoom === 'day' ? (
                    <span
                      key={d}
                      style={{ left: i * dw, width: dw }}
                      className={`${isWorkDay(d, calendar) ? '' : 'gantt__free'}${d === today ? ' gantt__today-label' : ''}`}
                    >
                      <small>{WEEKDAY_LETTERS[new Date(`${d}T00:00:00Z`).getUTCDay()]}</small>
                      {Number(d.slice(8))}
                    </span>
                  ) : new Date(`${d}T00:00:00Z`).getUTCDay() === 1 ? (
                    <span key={d} style={{ left: i * dw, width: 7 * dw }}>
                      KW {weekNumber(d)}
                    </span>
                  ) : null,
                )}
              </div>
            </div>
          </div>

          <div className="gantt__body" style={{ height: rows.length * ROW }}>
            <div className="gantt__grid" style={{ left: NAME_WIDTH, width }} aria-hidden>
              {days.map((d, i) => (!isWorkDay(d, calendar) ? <span key={d} className="gantt__free" style={{ left: i * dw, width: dw }} /> : null))}
              {calendarDaysBetween(range.from, today) >= 0 && calendarDaysBetween(range.from, today) < range.days && (
                <span className="gantt__today" style={{ left: x(today) + dw / 2 }} title="Heute" />
              )}
            </div>
            <svg className="gantt__arrows" style={{ left: NAME_WIDTH }} width={width} height={rows.length * ROW} aria-hidden>
              <defs>
                <marker id="gantt-arrow" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M0,0 L6,3 L0,6 z" fill="context-stroke" />
                </marker>
              </defs>
              {arrows.map((a) => (
                <path key={a.key} d={a.d} className={a.critical ? 'gantt__arrow gantt__arrow--critical' : 'gantt__arrow'} markerEnd="url(#gantt-arrow)" />
              ))}
            </svg>

            {rows.map(({ item, s }, i) => {
              const g = geometry(item.id, s);
              const conflicts = conflictTexts(s, dueOf(item));
              const due = dueOf(item);
              const preds = Object.entries(itemPm(item).deps)
                .map(([id, dep]) => {
                  const p = rows.find((r) => r.item.id === id);
                  return p ? `${p.item.name} (${DEP_LABEL[dep.type]})` : null;
                })
                .filter(Boolean);
              const label = s.milestone ? `${item.name}: Meilenstein ${shortDate(s.start)}` : `${item.name}: ${shortDate(s.start)} bis ${shortDate(s.end)}`;
              const people = peopleLabel(item);
              const title = [
                label,
                people,
                s.critical && !item.checked ? 'kritischer Pfad' : null,
                preds.length ? `nach ${preds.join(', ')}` : null,
                delayText(s, people),
                ...conflicts,
              ]
                .filter(Boolean)
                .join('\n');
              const cls = [
                'gantt__bar',
                s.milestone ? 'gantt__bar--milestone' : '',
                s.critical && !item.checked ? 'gantt__bar--critical' : '',
                item.checked ? 'gantt__bar--done' : '',
                conflicts.length ? 'gantt__bar--conflict' : '',
                s.delay > 0 && !item.checked ? 'gantt__bar--delayed' : '',
                drag?.id === item.id ? 'gantt__bar--dragging' : '',
              ]
                .filter(Boolean)
                .join(' ');
              return (
                <div
                  key={item.id}
                  className={`gantt__row${item.id === selected ? ' gantt__row--selected' : ''}`}
                  style={{ top: i * ROW }}
                  data-item-id={item.id}
                  onClick={() => onSelect(item.id)}
                  onDoubleClick={() => onOpen(item.id)}
                >
                  <button
                    type="button"
                    className="gantt__name"
                    aria-pressed={item.id === selected}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        onOpen(item.id);
                      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                        e.preventDefault();
                        const next = rows[i + (e.key === 'ArrowDown' ? 1 : -1)];
                        if (next) {
                          onSelect(next.item.id);
                          (document.querySelector(`.gantt__row[data-item-id="${next.item.id}"] .gantt__name`) as HTMLElement | null)?.focus();
                        }
                      }
                    }}
                  >
                    {item.checked ? '✓ ' : ''}
                    {item.name}
                    {conflicts.length > 0 && (
                      <span className="gantt__warn" title={conflicts.join('\n')}>
                        {' '}
                        ⚠
                      </span>
                    )}
                  </button>
                  <div className="gantt__lane" style={{ width }}>
                    {due && <span className="gantt__due" style={{ left: x(due) + dw }} title={`Fällig ${shortDate(due)}`} />}
                    <div
                      className={cls}
                      style={{ left: g.left, width: g.width }}
                      role="img"
                      aria-label={label}
                      title={title}
                      onPointerDown={(e) => {
                        if (e.button !== 0 || item.checked) return;
                        e.preventDefault();
                        onSelect(item.id);
                        const end = (e.target as HTMLElement).classList.contains('gantt__handle');
                        setDrag({ id: item.id, mode: end ? 'end' : 'move', x: e.clientX, days: 0 });
                      }}
                    >
                      {!s.milestone && !item.checked && <span className="gantt__handle" aria-hidden />}
                      {!s.milestone && g.width >= 60 && <span className="gantt__bar-label">{item.name}</span>}
                    </div>
                    {s.milestone && (
                      <span className="gantt__milestone-label" style={{ left: g.left + 10 }}>
                        {shortDate(s.start)}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {rows.length === 0 && <p className="work-empty">Noch keine Aufgaben.</p>}
      <p className="gantt__legend muted">
        Balken ziehen verschiebt den Start, der rechte Rand die Dauer. <span className="gantt__key gantt__key--critical" /> kritischer Pfad ·{' '}
        <span className="gantt__key gantt__key--due" /> fällig · Doppelklick öffnet die Details.
      </p>
    </section>
  );
}
