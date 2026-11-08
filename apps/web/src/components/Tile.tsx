import { useCustomCategories } from '../categories';
import { getCategory, itemSpecification, type ItemRow } from '@shopping/shared';
import { useRef, useState } from 'react';
import { iconUrl, useIconIndex } from '../icons';
import { Avatar } from './Avatar';
import { entryKeys } from '../keyboard';

interface ItemIconProps {
  name: string;
  categoryId: string | null;
  catalogItemId?: string | null;
  /** Merkliste entry with its own icon. */
  entry?: { id: string; icon?: string | null };
  size?: 'sm' | 'md';
}

/** Generated icon of the item, else of its category, else the first letter on the category colour. */
export function ItemIcon({ name, categoryId, catalogItemId, entry, size = 'md' }: ItemIconProps) {
  const cat = getCategory(categoryId, useCustomCategories());
  const url = iconUrl(useIconIndex(), catalogItemId, categoryId, entry);
  const [broken, setBroken] = useState<string | null>(null);
  if (url && broken !== url) {
    return (
      <img
        className={`item-icon item-icon--img item-icon--${size}`}
        src={url}
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
        onError={() => setBroken(url)}
      />
    );
  }
  return (
    <span className={`item-icon item-icon--${size}`} style={{ '--cat': cat.color } as React.CSSProperties} aria-hidden>
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

interface TileProps {
  item: Pick<ItemRow, 'name' | 'categoryId' | 'amounts' | 'properties' | 'note'> & { catalogItemId?: string | null; id?: string; icon?: string | null };
  /** packed: packing lists – crossed out, stays in place. */
  variant?: 'open' | 'done' | 'suggestion' | 'packed';
  badge?: string;
  /** Shown in front of the badge, e.g. who just checked the item. */
  badgeUser?: { displayName: string; avatarUrl: string | null };
  /** Checked by someone else: fades out before it moves away. */
  fading?: boolean;
  /** Extra line, e.g. person and Packstück on packing lists. */
  extra?: string;
  /** Multi-person items: who is ticked off already (initials). */
  people?: React.ReactNode;
  /** A web link: 🔗 in the corner, a tap on it opens the link (not the item). */
  url?: string | null;
  onTap: () => void;
  onLongPress?: () => void;
  /** Keyboard: Space ticks off (Enter opens via onLongPress). */
  onToggle?: () => void;
}

const isOffer = (p: string) => p.trim().toLowerCase() === 'angebot';

/** Tile: tap to check (or add), long press / right click for details. */
export function Tile({ item, variant = 'open', badge, badgeUser, fading = false, extra, people, url, onTap, onLongPress, onToggle }: TileProps) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const longPressed = useRef(false);
  // "Angebot" is not written out but shown as a % badge.
  const offer = item.properties.some(isOffer);
  const spec = itemSpecification(offer ? { ...item, properties: item.properties.filter((p) => !isOffer(p)) } : item);
  const cat = getCategory(item.categoryId, useCustomCategories());
  const icons = useIconIndex();
  // New icon drafts wait for review (shared free-text pictures count by their own entry only).
  const unreviewed = (item.catalogItemId && icons.pending.has(item.catalogItemId)) || (!!item.id && icons.pending.has(item.id));

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
      className={`tile tile--${variant}${fading ? ' tile--remote' : ''}`}
      data-item-id={item.id}
      {...entryKeys(onToggle, onLongPress)}
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
      aria-label={[item.name, offer ? 'im Angebot' : null, spec, extra, url ? 'mit Link' : null, unreviewed ? 'neues Icon zu prüfen' : null]
        .filter(Boolean)
        .join(', ')}
    >
      <ItemIcon
        name={item.name}
        categoryId={item.categoryId}
        catalogItemId={item.catalogItemId}
        entry={item.id && item.icon ? { id: item.id, icon: item.icon } : undefined}
      />
      <span className="tile__name">{item.name}</span>
      {spec && <span className="tile__spec">{spec}</span>}
      {extra && <span className="tile__spec tile__extra">{extra}</span>}
      {people && <span className="tile__spec tile__people">{people}</span>}
      {unreviewed && (
        <span className="tile__unreviewed" title="Neues Icon wartet auf Prüfung – lange drücken bzw. öffnen" aria-hidden>
          🖼
        </span>
      )}
      {url && <LinkBadge url={url} />}
      {offer && (
        <span className="tile__offer" title="Angebot" aria-hidden>
          %
        </span>
      )}
      {badge && (
        <span className="tile__badge">
          {badgeUser && <Avatar user={badgeUser} size="xs" />}
          {badge}
        </span>
      )}
    </button>
  );
}

/**
 * The 🔗 on a tile. The tile itself is a button, so this is no nested link: it opens the page itself and
 * keeps the tap from reaching the tile (no check, no long press). Keyboard users open it in the editor.
 */
export function LinkBadge({ url }: { url: string }) {
  const open = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    e.preventDefault();
    window.open(url, '_blank', 'noopener,noreferrer');
  };
  return (
    <span
      className="tile__link"
      title={url}
      aria-hidden
      onClick={open}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      🔗
    </span>
  );
}
