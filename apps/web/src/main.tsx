import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { listenForInstall } from './install';
import './styles.css';

// The browser looks for a new version only now and then; an installed app stays open for days.
// So look whenever the app comes back to the foreground, and every hour. A new version takes over
// at once and the page reloads (nothing is lost: everything lives in IndexedDB and the outbox).
listenForInstall();

registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    if (!registration) return;
    const check = () => {
      if (navigator.onLine) void registration.update().catch(() => undefined);
    };
    setInterval(check, 60 * 60_000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check();
    });
  },
});

// Ask the browser not to evict the offline data when space gets low.
void navigator.storage?.persist?.();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
