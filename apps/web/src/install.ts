import { useSyncExternalStore } from 'react';

/**
 * "Als App installieren": Chrome, Edge and Android offer it through `beforeinstallprompt`;
 * iPhone/iPad only by hand (Teilen → Zum Home-Bildschirm). Nothing is offered once the app runs installed.
 */

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type InstallOffer = 'prompt' | 'ios' | null;

const listeners = new Set<() => void>();
let deferred: InstallPromptEvent | null = null;
let installed = false;

const standalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

const ios = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function notify(): void {
  for (const fn of listeners) fn();
}

/** Called once at start-up, before React, so the browser's offer is not missed. */
export function listenForInstall(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    // Keep the browser's own mini-infobar away; the button in the title bar offers it.
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installed = true;
    notify();
  });
}

function current(): InstallOffer {
  if (installed || standalone()) return null;
  if (deferred) return 'prompt';
  return ios() ? 'ios' : null;
}

export function useInstallOffer(): InstallOffer {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    current,
  );
}

/** Shows the browser's install dialog. */
export async function install(): Promise<void> {
  const e = deferred;
  if (!e) return;
  await e.prompt();
  const { outcome } = await e.userChoice;
  // The event can only be used once; Chrome sends a new one if it may ask again.
  deferred = null;
  if (outcome === 'accepted') installed = true;
  notify();
}
