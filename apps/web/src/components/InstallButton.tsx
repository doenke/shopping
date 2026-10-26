import { useState } from 'react';
import { createPortal } from 'react-dom';
import { install, useInstallOffer } from '../install';

/** Only in the browser: installs the app (or explains how on iPhone/iPad). */
export function InstallButton() {
  const offer = useInstallOffer();
  const [iosHint, setIosHint] = useState(false);
  if (!offer) return null;
  return (
    <>
      <button
        type="button"
        className="shop-toggle install-btn"
        title="Als App installieren – startet wie eine App, mit eigenem Symbol und offline"
        aria-label="Als App installieren"
        onClick={() => (offer === 'prompt' ? void install() : setIosHint(true))}
      >
        📲<span className="install-btn__label"> Installieren</span>
      </button>
      {/* Into the page itself: inside the blurred title bar "fixed" would stick to the bar. */}
      {iosHint &&
        createPortal(
          <div className="snackbar" role="status">
            <span>
              Im Safari unten auf <strong>Teilen</strong> ⬆︎ tippen, dann <strong>„Zum Home-Bildschirm“</strong>.
            </span>
            <button type="button" onClick={() => setIosHint(false)}>
              OK
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}
