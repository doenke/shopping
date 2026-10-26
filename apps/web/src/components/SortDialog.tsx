import { useEffect, useRef, useState } from 'react';

export interface SortGroup {
  title: string | null;
  items: { id: string; label: string }[];
}

interface Props {
  title: string;
  hint?: string;
  groups: SortGroup[];
  /** The new order of every id, groups one after the other. */
  onSave: (ids: string[]) => Promise<void> | void;
  /** Back to the built-in order. */
  onReset?: () => Promise<void> | void;
  onClose: () => void;
}

interface Drag {
  g: number;
  id: string;
  /** Where the row was grabbed, measured from its top. */
  grabY: number;
}

/**
 * Puts things in order by dragging the handle ⠿ (finger or mouse). The handle is also a button:
 * with the keyboard, ↑ / ↓ move the row.
 */
export function SortDialog({ title, hint, groups: initial, onSave, onReset, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const lists = useRef<(HTMLOListElement | null)[]>([]);
  const drag = useRef<Drag | null>(null);
  const [groups, setGroups] = useState(initial);
  const [dragging, setDragging] = useState<{ id: string; dy: number } | null>(null);

  useEffect(() => ref.current?.showModal(), []);

  const move = (g: number, from: number, to: number) =>
    setGroups((gs) =>
      gs.map((group, k) => {
        if (k !== g || to < 0 || to >= group.items.length) return group;
        const items = [...group.items];
        const [item] = items.splice(from, 1);
        items.splice(to, 0, item!);
        return { ...group, items };
      }),
    );

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>, g: number, id: string) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const row = e.currentTarget.closest('li')!.getBoundingClientRect();
    drag.current = { g, id, grabY: e.clientY - row.top };
    setDragging({ id, dy: 0 });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const ol = d && lists.current[d.g];
    if (!d || !ol) return;
    const rows = [...ol.children] as HTMLElement[];
    const i = groups[d.g]!.items.findIndex((x) => x.id === d.id);
    const el = rows[i];
    if (!el) return;
    // Where the row's top would be if it followed the finger.
    const y = e.clientY - ol.getBoundingClientRect().top - d.grabY;
    let top = el.offsetTop;
    const next = rows[i + 1];
    const prev = rows[i - 1];
    if (next && y + el.offsetHeight / 2 > next.offsetTop + next.offsetHeight / 2) {
      move(d.g, i, i + 1);
      top += next.offsetHeight + (next.offsetTop - el.offsetTop - el.offsetHeight);
    } else if (prev && y + el.offsetHeight / 2 < prev.offsetTop + prev.offsetHeight / 2) {
      move(d.g, i, i - 1);
      top -= prev.offsetHeight + (el.offsetTop - prev.offsetTop - prev.offsetHeight);
    }
    setDragging({ id: d.id, dy: y - top });
    // Long lists: scroll along near the edges of the dialog.
    const body = ol.closest('.sheet__body');
    if (body) {
      const r = body.getBoundingClientRect();
      if (e.clientY < r.top + 48) body.scrollBy(0, -10);
      else if (e.clientY > r.bottom - 48) body.scrollBy(0, 10);
    }
  };

  const onPointerUp = () => {
    drag.current = null;
    setDragging(null);
  };

  return (
    <dialog ref={ref} className="sheet" onClose={onClose}>
      <form
        className="sheet__body"
        onSubmit={async (e) => {
          e.preventDefault();
          await onSave(groups.flatMap((g) => g.items.map((i) => i.id)));
          ref.current?.close();
        }}
      >
        <header className="sheet__header row">
          <h2 className="spacer">{title}</h2>
          <button type="button" className="icon-btn" aria-label="Schließen" onClick={() => ref.current?.close()}>
            ✕
          </button>
        </header>
        {hint && <p className="muted">{hint}</p>}

        {groups.map((group, g) => (
          <div key={group.title ?? g}>
            {group.title && <h3>{group.title}</h3>}
            <ol
              className="sortlist"
              ref={(el) => {
                lists.current[g] = el;
              }}
            >
              {group.items.map((item, i) => {
                const active = dragging?.id === item.id;
                return (
                  <li key={item.id} className={active ? 'sortlist__dragging' : undefined} style={active ? { transform: `translateY(${dragging.dy}px)` } : undefined}>
                    <button
                      type="button"
                      className="sortlist__handle"
                      aria-label={`${item.label} verschieben (Pfeiltasten)`}
                      onPointerDown={(e) => onPointerDown(e, g, item.id)}
                      onPointerMove={onPointerMove}
                      onPointerUp={onPointerUp}
                      onPointerCancel={onPointerUp}
                      onKeyDown={(e) => {
                        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                          e.preventDefault();
                          move(g, i, e.key === 'ArrowUp' ? i - 1 : i + 1);
                          // Keep the focus on the moved row's handle.
                          requestAnimationFrame(() => (lists.current[g]?.querySelector(`[data-id="${CSS.escape(item.id)}"]`) as HTMLElement | null)?.focus());
                        }
                      }}
                      data-id={item.id}
                    >
                      ⠿
                    </button>
                    <span className="spacer">{item.label}</span>
                  </li>
                );
              })}
            </ol>
          </div>
        ))}

        <footer className="sheet__actions">
          {onReset && (
            <button
              type="button"
              className="link"
              onClick={async () => {
                await onReset();
                ref.current?.close();
              }}
            >
              Standard-Reihenfolge
            </button>
          )}
          <span className="spacer" />
          <button type="submit" className="btn btn--primary">
            Speichern
          </button>
        </footer>
      </form>
    </dialog>
  );
}
