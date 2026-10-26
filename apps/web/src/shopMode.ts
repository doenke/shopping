import { useEffect, useSyncExternalStore } from 'react';

/**
 * Zuhause / Einkaufen, per device (the tablet at home stays at home while someone is out shopping).
 * Only shopping lists care: at home a tap opens an item, in the shop it checks it off.
 * Shopping ends by itself after an hour without checking anything off, or when the list is done.
 */

const KEY = 'shop-mode';
const IDLE_MS = 60 * 60_000;

interface State {
  active: boolean;
  /** Last start or check-off (ms). */
  at: number;
}

const listeners = new Set<() => void>();
let state: State = load();

function load(): State {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as State | null;
    if (s?.active && Date.now() - s.at < IDLE_MS) return s;
  } catch {
    // Storage unavailable: at home.
  }
  return { active: false, at: 0 };
}

function set(next: State): void {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Not important: the mode then only lasts until the app is closed.
  }
  for (const fn of listeners) fn();
}

export function startShopping(): void {
  set({ active: true, at: Date.now() });
  try {
    localStorage.setItem('shop-mode-known', '1');
  } catch {
    // Not important.
  }
}

export function stopShopping(): void {
  if (state.active) set({ active: false, at: 0 });
}

/** Something was checked off: shopping goes on. */
export function shoppingActivity(): void {
  if (state.active) set({ active: true, at: Date.now() });
}

/** Has this device ever been in shopping mode (for the hint at home)? */
export function shopModeKnown(): boolean {
  try {
    return localStorage.getItem('shop-mode-known') === '1';
  } catch {
    return false;
  }
}

function expire(): void {
  if (state.active && Date.now() - state.at >= IDLE_MS) stopShopping();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** True while shopping. Checks the idle timeout every minute and when the app comes back. */
export function useShopping(): boolean {
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') expire();
    };
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(expire, 60_000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
    };
  }, []);
  return useSyncExternalStore(subscribe, () => state.active);
}

/** Keeps the screen on while shopping (where the browser supports it). */
export function useWakeLock(on: boolean): void {
  useEffect(() => {
    if (!on || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = async () => {
      try {
        const l = await navigator.wakeLock.request('screen');
        if (cancelled) void l.release();
        else lock = l;
      } catch {
        // Battery saver or not allowed: the screen goes off as usual.
      }
    };
    // The lock is dropped whenever the app goes to the background.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void acquire();
    };
    void acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release().catch(() => undefined);
    };
  }, [on]);
}
