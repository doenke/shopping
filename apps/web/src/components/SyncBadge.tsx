import { useSyncStatus } from '../hooks';

/** Sync state as text and colour class. */
export function useSyncInfo(guest = false): { state: string; label: string; cls: string } {
  const { state, pending } = useSyncStatus();
  let label: string;
  let cls: string;
  if (state === 'unauthorized') {
    label = guest ? 'Zugang beendet – bitte neuen Link geben lassen' : 'Bitte neu anmelden';
    cls = 'warn';
  } else if (state === 'offline' || (state === 'connecting' && pending > 0)) {
    label = pending ? `Offline · ${pending} ausstehend` : 'Offline';
    cls = 'offline';
  } else if (state === 'connecting') {
    label = 'Verbinde …';
    cls = 'pending';
  } else if (pending > 0) {
    label = `${pending} ausstehend`;
    cls = 'pending';
  } else {
    label = 'Synchron';
    cls = 'ok';
  }
  return { state, label, cls };
}

/** Phones: just the coloured dot, on the corner of the menu button. */
export function SyncDot({ guest = false }: { guest?: boolean }) {
  const { label, cls } = useSyncInfo(guest);
  return (
    <span className={`sync sync--${cls} sync--corner`} title={label} aria-label={label}>
      <span className="sync__dot" aria-hidden />
    </span>
  );
}

/** Small, unobtrusive sync state: ✓ synced · ↻ pending · offline. */
export function SyncBadge({ guest = false, always = false }: { guest?: boolean; always?: boolean }) {
  const { state, label, cls } = useSyncInfo(guest);
  const content = (
    <span className={`sync sync--${cls}${always ? ' sync--always' : ''}`} role="status" title={label}>
      <span className="sync__dot" aria-hidden />
      <span className="sync__label">{label}</span>
    </span>
  );
  return state === 'unauthorized' && !guest ? <a href="/auth/login">{content}</a> : content;
}
