import type { ListRow } from '@shopping/shared';
import { useState } from 'react';

/** The list's generated icon, else the type's emoji (packing 🧳, Merkliste 📌, ToDo ✅). */
export function ListIcon({ list, fallback = '', size = 'sm' }: { list: Pick<ListRow, 'id' | 'icon'>; fallback?: string; size?: 'sm' | 'md' }) {
  const url = list.icon ? `/icons/list/${list.id}.webp?v=${list.icon}` : null;
  const [broken, setBroken] = useState<string | null>(null);
  if (url && broken !== url) {
    return <img className={`list-icon list-icon--${size}`} src={url} alt="" draggable={false} onError={() => setBroken(url)} />;
  }
  return fallback ? <>{fallback}</> : null;
}
