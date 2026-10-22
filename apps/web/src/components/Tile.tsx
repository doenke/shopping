import { getCategory, itemSpecification, type ItemRow } from '@shopping/shared';
import { useRef } from 'react';

export function ItemIcon({ name, categoryId, size = 'md' }: { name: string; categoryId: string | null; size?: 'sm' | 'md' }) {
  const cat = getCategory(categoryId);
  // Until generated icons exist: first letter on the category colour (see docs/konzept/10-icons-plan.md).
  return (
    <span className={`item-icon item-icon--${size}`} style={{ '--cat': cat.color } as React.CSSProperties} aria-hidden>
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

interface TileProps {
  item: Pick<ItemRow, 'name' | 'categoryId' | 'amounts' | 'properties' | 'note'>;
  variant?: 'open' | 'done' | 'suggestion';
  badge?: string;
  onTap: () => void;
  onLongPress?: () => void;
}

/** Bring!-style tile: tap to check (or add), long press / right click for details. */
export function Tile({ item, variant = 'open', badge, onTap, onLongPress }: TileProps) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const longPressed = useRef(false);
  const spec = itemSpecification(item);
  const cat = getCategory(item.categoryId);

  const start = () => {
    longPressed.current = false;
    if (!onLongPress) return;
    timer.current = setTimeout(() => {
      longPressed.current = true;
      navigator.vibrate?.(15);
      onLongPress();
    }, 500);
  };
  const cancel = () => clearTimeout(timer.current);

  return (
    <button
      type="button"
      className={`tile tile--${variant}${badge ? ' tile--remote' : ''}`}
      style={{ '--cat': cat.color } as React.CSSProperties}
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onClick={() => {
        if (!longPressed.current) onTap();
      }}
      onContextMenu={(e) => {
        if (!onLongPress) return;
        e.preventDefault();
        cancel();
        onLongPress();
      }}
      aria-label={[item.name, spec].filter(Boolean).join(', ')}
    >
      <ItemIcon name={item.name} categoryId={item.categoryId} />
      <span className="tile__name">{item.name}</span>
      {spec && <span className="tile__spec">{spec}</span>}
      {badge && <span className="tile__badge">{badge}</span>}
    </button>
  );
}
