import {
  DAY_MINUTES,
  daysToMinutes,
  dueOf,
  isoDate,
  itemPm,
  listAutomation,
  listCalendar,
  peopleOf,
  listProjectStart,
  minutesToDays,
  schedule,
  successorsOf,
  wouldCreateCycle,
  type DepType,
  type ItemRow,
  type ListRow,
  type PmChanges,
  type PmDep,
  type ScheduledItem,
} from '@shopping/shared';
import { useEffect, useMemo, useState } from 'react';
import { updateItem } from '../actions';

/**
 * Project planning of one task – the second level of the details (folded away; only in lists with project
 * planning switched on). Saves right away, every field on its own (see pm.ts).
 */

export const DEP_LABEL: Record<DepType, string> = {
  FS: 'nach Ende',
  SS: 'gleicher Start',
  FF: 'gleiches Ende',
  SF: 'Ende nach Start',
};

/** "Mi., 18.11." */
export function shortDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const now = new Date();
  return new Date(y, m - 1, d).toLocaleDateString('de-DE', {
    weekday: 'short',
    day: 'numeric',
    month: 'numeric',
    ...(y !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
}

const fmtDays = (min: number) => `${minutesToDays(min).toLocaleString('de-DE')} ${Math.abs(min) === DAY_MINUTES ? 'Tag' : 'Tage'}`;
const fmtHours = (min: number) => `${(Math.round((min / 60) * 10) / 10).toLocaleString('de-DE')} h`;

/** The plan of a list (all its entries). */
export function useSchedule(list: ListRow, items: ItemRow[]): Map<string, ScheduledItem> {
  return useMemo(
    () =>
      schedule(items, {
        calendar: listCalendar(list),
        projectStart: listProjectStart(list) ?? isoDate(new Date()),
        resourcesOf: peopleOf,
        ...listAutomation(list),
      }),
    [items, list],
  );
}

/** What is wrong with the plan of an entry, in words. */
export function conflictTexts(s: ScheduledItem, due: string | null): string[] {
  return s.conflicts.map((c) =>
    c === 'due'
      ? `Geplantes Ende (${shortDate(s.end)}) liegt nach der Fälligkeit${due ? ` (${shortDate(due)})` : ''}.`
      : c === 'start'
        ? 'Der vorgegebene Start ist früher, als die Vorgänger es erlauben.'
        : c === 'end'
          ? 'Das vorgegebene Ende ist früher, als die Vorgänger es erlauben.'
          : c === 'resource'
            ? `${s.resources.join(', ')} ${s.resources.length > 1 ? 'haben' : 'hat'} zur selben Zeit eine andere Aufgabe mit festem Termin.`
            : 'Die Vorgänger bilden einen Kreis – diese Verknüpfungen werden nicht berücksichtigt.',
  );
}

/** A number field that saves when it loses focus (or on Enter); empty = remove. */
function NumberField({
  value,
  placeholder,
  step,
  calc,
  onSave,
  label,
}: {
  value: number | null;
  placeholder?: string;
  step: number;
  calc?: boolean;
  onSave: (v: number | null) => void;
  label: string;
}) {
  const [text, setText] = useState(value === null ? '' : String(value));
  useEffect(() => setText(value === null ? '' : String(value)), [value]);
  const save = () => {
    const v = text.trim() === '' ? null : Number(text.replace(',', '.'));
    if (v !== null && (!Number.isFinite(v) || v < 0)) return setText(value === null ? '' : String(value));
    if (v !== value) onSave(v);
  };
  return (
    <input
      type="number"
      inputMode="decimal"
      min={0}
      step={step}
      aria-label={label}
      className={calc ? 'pm-calc' : undefined}
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          save();
        }
      }}
    />
  );
}

function ResetButton({ onClick, what }: { onClick: () => void; what: string }) {
  return (
    <button type="button" className="icon-btn pm-reset" title={`${what}: wieder berechnen`} aria-label={`${what} wieder berechnen`} onClick={onClick}>
      ↺
    </button>
  );
}

interface Props {
  item: ItemRow;
  list: ListRow;
  items: ItemRow[];
}

export function PlanningSection({ item, list, items }: Props) {
  const plan = useSchedule(list, items);
  const s = plan.get(item.id);
  const pm = itemPm(item);
  const due = dueOf(item);
  if (!s) return null;

  const save = (changes: PmChanges) => void updateItem(item.id, { pm: changes });
  const startSet = pm.start?.src === 'set';
  const endSet = pm.end?.src === 'set';
  const durSet = pm.dur?.src === 'set' && !(startSet && endSet);
  // At most two of start, end and duration are given; giving the third one drops one of the others.
  const setStart = (v: string) => save({ start: v ? { v, src: 'set' } : null, ...(v && endSet && durSet ? { dur: null } : {}) });
  const setEnd = (v: string) => save({ end: v ? { v, src: 'set' } : null, ...(v && startSet && durSet ? { dur: null } : {}) });
  const setDur = (days: number | null) =>
    save({ dur: days === null ? null : { v: daysToMinutes(days), src: 'set' }, ...(days !== null && startSet && endSet ? { end: null } : {}) });

  const byId = new Map(items.filter((i) => !i.deleted).map((i) => [i.id, i]));
  const preds = Object.entries(pm.deps)
    .filter(([id]) => byId.has(id))
    .map(([id, dep]) => ({ id, dep }));
  const succs = successorsOf(item.id, items);
  const linked = new Set([item.id, ...preds.map((p) => p.id), ...succs.map((x) => x.id)]);
  const others = items.filter((i) => !i.deleted && !linked.has(i.id));
  const canPred = others.filter((o) => !wouldCreateCycle(o.id, item.id, items));
  const canSucc = others.filter((o) => !wouldCreateCycle(item.id, o.id, items));

  const conflicts = conflictTexts(s, due);
  const summary = s.milestone ? `◆ ${shortDate(s.start)}` : `${fmtDays(s.duration)} · ${shortDate(s.start)} – ${shortDate(s.end)}`;

  return (
    <details className="pm" open={conflicts.length > 0 || undefined}>
      <summary>
        <span className="pm__title">Projektplanung</span>
        <span className="pm__summary">
          {summary}
          {s.critical && !item.checked ? ' · kritisch' : ''}
          {conflicts.length > 0 && <span className="pm__warn"> ⚠</span>}
        </span>
      </summary>

      {conflicts.map((c) => (
        <p key={c} className="pm__conflict" role="alert">
          ⚠ {c}
        </p>
      ))}

      <label className="check pm__row">
        <input type="checkbox" checked={s.milestone} onChange={(e) => save({ milestone: e.target.checked || null })} /> Meilenstein
      </label>

      <div className="pm__grid">
        <label>
          <span>{s.milestone ? 'Termin' : 'Start'}</span>
          <span className="pm__input">
            <input type="date" className={startSet ? undefined : 'pm-calc'} value={s.start} onChange={(e) => setStart(e.target.value)} />
            {startSet && <ResetButton what="Start" onClick={() => save({ start: null })} />}
          </span>
        </label>
        {!s.milestone && (
          <label>
            <span>Ende</span>
            <span className="pm__input">
              <input type="date" className={endSet ? undefined : 'pm-calc'} value={s.end} onChange={(e) => setEnd(e.target.value)} />
              {endSet && <ResetButton what="Ende" onClick={() => save({ end: null })} />}
            </span>
          </label>
        )}
        {!s.milestone && (
          <label>
            <span>Dauer (Tage)</span>
            <span className="pm__input">
              <NumberField label="Dauer in Tagen" step={0.5} calc={!durSet} value={minutesToDays(s.duration)} onSave={(v) => setDur(v)} />
              {durSet && <ResetButton what="Dauer" onClick={() => save({ dur: null })} />}
            </span>
          </label>
        )}
        <label>
          <span>Nicht vor</span>
          <input type="date" value={pm.notBefore ?? ''} onChange={(e) => save({ notBefore: e.target.value || null })} />
        </label>
        <label>
          <span>Aufwand geplant (h)</span>
          <NumberField
            label="Aufwand geplant in Stunden"
            step={0.5}
            value={pm.effort !== undefined ? pm.effort / 60 : null}
            onSave={(v) => save({ effort: v === null ? null : Math.round(v * 60) })}
          />
        </label>
        <label>
          <span>Aufwand geleistet (h)</span>
          <NumberField
            label="Aufwand geleistet in Stunden"
            step={0.5}
            value={pm.spent !== undefined ? pm.spent / 60 : null}
            onSave={(v) => save({ spent: v === null ? null : Math.round(v * 60) })}
          />
        </label>
      </div>
      {pm.effort !== undefined && pm.effort > 0 && (
        <p className="muted pm__note">
          {Math.round(((pm.spent ?? 0) / pm.effort) * 100)} % des Aufwands geleistet, noch {fmtHours(Math.max(0, pm.effort - (pm.spent ?? 0)))}
        </p>
      )}
      {s.waitsFor && byId.get(s.waitsFor.id) && (
        <p className="pm__note pm__waits">
          Nach hinten geschoben: {s.waitsFor.person} ist vorher mit „{byId.get(s.waitsFor.id)!.name}“ beschäftigt.
        </p>
      )}
      <p className="muted pm__note">
        Grau = berechnet{!durSet && !s.milestone && pm.effort && listAutomation(list).durationFromEffort ? ' (Dauer aus dem Aufwand)' : ''}. Was du einträgst,
        ist eine Vorgabe; ↺ rechnet wieder.
      </p>

      <DepList
        title="Vorgänger"
        rows={preds.map((p) => ({ ...p, name: byId.get(p.id)!.name }))}
        candidates={canPred}
        onAdd={(id) => save({ [`dep:${id}`]: { type: 'FS', lag: 0 } })}
        onChange={(id, dep) => save({ [`dep:${id}`]: dep })}
      />
      <DepList
        title="Nachfolger"
        rows={succs.map((x) => ({ ...x, name: byId.get(x.id)?.name ?? '?' }))}
        candidates={canSucc}
        // The link is stored on the successor.
        onAdd={(id) => void updateItem(id, { pm: { [`dep:${item.id}`]: { type: 'FS', lag: 0 } } })}
        onChange={(id, dep) => void updateItem(id, { pm: { [`dep:${item.id}`]: dep } })}
      />

      <dl className="pm__calc">
        <dt>Frühester Start</dt>
        <dd>{shortDate(s.earlyStart)}</dd>
        <dt>Spätester Start</dt>
        <dd>{shortDate(s.lateStart)}</dd>
        <dt>Frühestes Ende</dt>
        <dd>{shortDate(s.earlyEnd)}</dd>
        <dt>Spätestes Ende</dt>
        <dd>{shortDate(s.lateEnd)}</dd>
        <dt>Puffer</dt>
        <dd>
          {fmtDays(s.float)}
          {s.critical ? ' – kritischer Pfad' : ''}
        </dd>
      </dl>
    </details>
  );
}

function DepList({
  title,
  rows,
  candidates,
  onAdd,
  onChange,
}: {
  title: string;
  rows: { id: string; name: string; dep: PmDep }[];
  candidates: ItemRow[];
  onAdd: (id: string) => void;
  onChange: (id: string, dep: PmDep | null) => void;
}) {
  return (
    <div className="pm__deps">
      <span className="pm__label">{title}</span>
      {rows.map(({ id, name, dep }) => (
        <div key={id} className="pm__dep">
          <span className="pm__dep-name">{name}</span>
          <select aria-label={`Art der Verknüpfung mit ${name}`} value={dep.type} onChange={(e) => onChange(id, { ...dep, type: e.target.value as DepType })}>
            {(Object.keys(DEP_LABEL) as DepType[]).map((t) => (
              <option key={t} value={t}>
                {DEP_LABEL[t]}
              </option>
            ))}
          </select>
          <NumberLag value={dep.lag} name={name} onSave={(lag) => onChange(id, { ...dep, lag })} />
          <button type="button" className="icon-btn" aria-label={`${title} ${name} entfernen`} onClick={() => onChange(id, null)}>
            ✕
          </button>
        </div>
      ))}
      {candidates.length > 0 && (
        <select
          aria-label={`${title} hinzufügen`}
          value=""
          onChange={(e) => {
            if (e.target.value) onAdd(e.target.value);
          }}
        >
          <option value="">+ {title} hinzufügen …</option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.checked ? '✓ ' : ''}
              {c.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

/** Lag in days (may be negative: overlap). */
function NumberLag({ value, name, onSave }: { value: number; name: string; onSave: (lag: number) => void }) {
  const days = minutesToDays(value);
  const [text, setText] = useState(String(days));
  useEffect(() => setText(String(days)), [days]);
  const save = () => {
    const v = Number(text.replace(',', '.'));
    if (!Number.isFinite(v)) return setText(String(days));
    if (v !== days) onSave(daysToMinutes(v));
  };
  return (
    <label className="pm__lag" title="Abstand in Tagen (negativ = Überlappung)">
      <span>+</span>
      <input
        type="number"
        step={0.5}
        aria-label={`Abstand zu ${name} in Tagen`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            save();
          }
        }}
      />
      <span>T</span>
    </label>
  );
}
