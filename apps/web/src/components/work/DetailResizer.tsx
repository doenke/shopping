import { useState, type CSSProperties } from 'react';

/** Width of the task details on the desktop, changed with the mouse at their left edge. Per device. */
const KEY = 'task-detail-width';
const DEFAULT = 380;
const MIN = 280;
/** The table keeps at least this much room. */
const MIN_MAIN = 420;

function load(): number {
  try {
    const n = Number(localStorage.getItem(KEY));
    return Number.isFinite(n) && n >= MIN ? n : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

function save(width: number): void {
  try {
    if (width === DEFAULT) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, String(Math.round(width)));
  } catch {
    // Not important enough to complain about.
  }
}

export function useDetailWidth(): { style: CSSProperties; handle: React.ReactNode } {
  const [width, setWidth] = useState(load);
  const clamp = (w: number, board: HTMLElement | null) => {
    const max = Math.max(MIN, (board?.getBoundingClientRect().width ?? window.innerWidth) - MIN_MAIN);
    return Math.round(Math.min(max, Math.max(MIN, w)));
  };
  const set = (w: number) => {
    setWidth(w);
    save(w);
  };

  const handle = (
    <div
      className="task-board__resize"
      role="separator"
      aria-orientation="vertical"
      aria-label="Breite der Details"
      aria-valuenow={width}
      aria-valuemin={MIN}
      tabIndex={0}
      title="Ziehen ändert die Breite – Doppelklick: Standard"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const board = (e.currentTarget as HTMLElement).closest<HTMLElement>('.task-board');
        const right = board?.getBoundingClientRect().right ?? window.innerWidth;
        const el = e.currentTarget;
        el.setPointerCapture(e.pointerId);
        document.body.classList.add('resizing-details');
        const move = (m: PointerEvent) => setWidth(clamp(right - m.clientX, board));
        const up = (u: PointerEvent) => {
          el.removeEventListener('pointermove', move);
          el.removeEventListener('pointerup', up);
          el.removeEventListener('pointercancel', up);
          document.body.classList.remove('resizing-details');
          save(clamp(right - u.clientX, board));
        };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', up);
      }}
      onDoubleClick={() => set(DEFAULT)}
      onKeyDown={(e) => {
        const board = (e.currentTarget as HTMLElement).closest<HTMLElement>('.task-board');
        if (e.key === 'ArrowLeft') set(clamp(width + 20, board));
        else if (e.key === 'ArrowRight') set(clamp(width - 20, board));
        else return;
        e.preventDefault();
        e.stopPropagation();
      }}
    />
  );
  return { style: { '--detail-width': `${width}px` } as CSSProperties, handle };
}
