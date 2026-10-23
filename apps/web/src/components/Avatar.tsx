import { useState } from 'react';

interface Props {
  user: { displayName: string; avatarUrl: string | null } | undefined;
  size?: 'xs' | 'sm' | 'md';
}

/** Profile picture from Pocket ID (local copy on the server), else the first letter. */
export function Avatar({ user, size = 'sm' }: Props) {
  const [broken, setBroken] = useState<string | null>(null);
  const name = user?.displayName ?? '?';
  const url = user?.avatarUrl;
  if (url && broken !== url) {
    return <img className={`avatar avatar--${size}`} src={url} alt="" draggable={false} onError={() => setBroken(url)} />;
  }
  return (
    <span className={`avatar avatar--${size}`} aria-hidden>
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}
