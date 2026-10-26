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

/** Puts things in order with ↑ / ↓ (works the same with a finger, a mouse and a screen reader). */
export function SortDialog({ title, hint, groups: initial, onSave, onReset, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [groups, setGroups] = useState(initial);
  const [moved, setMoved] = useState<string | null>(null);

  useEffect(() => ref.current?.showModal(), []);

  const move = (g: number, i: number, by: -1 | 1) => {
    const j = i + by;
    setGroups((gs) =>
      gs.map((group, k) => {
        if (k !== g || j < 0 || j >= group.items.length) return group;
        const items = [...group.items];
        [items[i], items[j]] = [items[j]!, items[i]!];
        return { ...group, items };
      }),
    );
    setMoved(groups[g]!.items[i]!.id);
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
            <ol className="sortlist">
              {group.items.map((item, i) => (
                <li key={item.id} className={moved === item.id ? 'sortlist__moved' : undefined}>
                  <span className="spacer">{item.label}</span>
                  <button type="button" className="icon-btn" aria-label={`${item.label} nach oben`} disabled={i === 0} onClick={() => move(g, i, -1)}>
                    ↑
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`${item.label} nach unten`}
                    disabled={i === group.items.length - 1}
                    onClick={() => move(g, i, 1)}
                  >
                    ↓
                  </button>
                </li>
              ))}
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
