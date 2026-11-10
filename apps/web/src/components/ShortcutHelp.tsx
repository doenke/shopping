import { useEffect, useRef } from 'react';

const KEYS: [string, string][] = [
  ['N', 'Neuer Eintrag (Eingabezeile)'],
  ['↑ ↓ ← →', 'Zwischen Einträgen wechseln'],
  ['Leertaste', 'Abhaken (bzw. wieder öffnen)'],
  ['Enter', 'Eintrag öffnen / bearbeiten'],
  ['Entf', 'Eintrag löschen (mit Rückgängig)'],
  ['Shift + ↑ ↓ ← →', 'Mehrere Einträge markieren (auch Shift-/Strg-Klick)'],
  ['V', 'Markierte in eine andere Liste verschieben (oder auf eine Liste in der Seitenleiste ziehen)'],
  ['Alt + ← →', 'Kanban: Karte in die Nachbarspalte'],
  ['Alt + ↑ ↓', 'Kanban: Karte einen Platz hoch/runter'],
  ['Strg + K', 'Liste oder Eintrag suchen'],
  ['Strg + Shift + A', 'Arbeitsmodus: nur die Arbeitslisten zeigen (an/aus)'],
  ['H', 'Diese Übersicht (auch ?)'],
  ['Esc', 'Dialog schließen'],
];

/** "?": the keyboard shortcuts. */
export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => ref.current?.showModal(), []);
  return (
    <dialog ref={ref} className="sheet" onClose={onClose} aria-label="Tastenkürzel">
      <div className="sheet__body">
        <header className="sheet__header row">
          <h2 className="spacer">Tastenkürzel</h2>
          <button type="button" className="icon-btn" aria-label="Schließen" onClick={() => ref.current?.close()}>
            ✕
          </button>
        </header>
        <table className="shortcuts">
          <tbody>
            {KEYS.map(([k, what]) => (
              <tr key={k}>
                <td>
                  {k.split(' + ').map((part, i) => (
                    <span key={part}>
                      {i > 0 && ' + '}
                      <kbd>{part}</kbd>
                    </span>
                  ))}
                </td>
                <td>{what}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </dialog>
  );
}
