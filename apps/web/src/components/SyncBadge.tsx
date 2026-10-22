import { useSyncStatus } from '../hooks';

/** Small, unobtrusive sync state: ✓ synced · ↻ pending · offline. */
export function SyncBadge() {
  const { state, pending } = useSyncStatus();
  let label: string;
  let cls: string;
  if (state === 'unauthorized') {
    label = 'Bitte neu anmelden';
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
  const content = (
    <span className={`sync sync--${cls}`} role="status" title={label}>
      <span className="sync__dot" aria-hidden />
      <span className="sync__label">{label}</span>
    </span>
  );
  return state === 'unauthorized' ? <a href="/auth/login">{content}</a> : content;
}
