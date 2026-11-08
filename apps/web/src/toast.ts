import { useSyncExternalStore } from 'react';

/** One short note at the bottom, optionally with an action ("Rückgängig"). */
export interface Toast {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}

let current: Toast | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function showToast(text: string, action?: Toast['action'], ms = 5000): void {
  clearTimeout(timer);
  current = { id: Date.now(), text, action };
  emit();
  timer = setTimeout(hideToast, ms);
}

export function hideToast(): void {
  current = null;
  emit();
}

export function useToast(): Toast | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
