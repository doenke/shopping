import { useEffect, useState } from 'react';
import { db } from '../db';

export function Login() {
  const [cfg, setCfg] = useState<{ oidc: boolean; devLogin: boolean; loginLabel?: string } | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const params = new URLSearchParams(location.search);
  const failed = params.get('login');
  // Set when someone opened a list link (or an AI assistant wants access) without being logged in.
  const rawNext = params.get('next') ?? '';
  const next = /^\/s\/[A-Za-z0-9_-]+$/.test(rawNext) || /^\/oauth\/authorize\?\S*$/.test(rawNext) ? rawNext : null;
  const isListLink = !!next?.startsWith('/s/');

  useEffect(() => {
    fetch('/auth/config')
      .then((r) => r.json())
      .then(setCfg)
      .catch(() => setError('Server nicht erreichbar. Für die erste Anmeldung wird Internet gebraucht.'));
  }, []);

  const [guestName, setGuestName] = useState('');

  /** Without account: guest of exactly this one list. */
  const guestLogin = async () => {
    const res = await fetch('/auth/guest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: next!.slice(3), name: guestName }),
    }).catch(() => null);
    if (!res?.ok) {
      setError(res?.status === 404 ? 'Dieser Link ist nicht mehr gültig.' : 'Das hat nicht geklappt. Ist das Handy online?');
      return;
    }
    const { listId } = (await res.json()) as { listId: string };
    // Start with an empty local store – nothing of a previous user may stay on this device.
    await db.delete();
    location.replace(`/#/list/${listId}`);
  };

  const devLogin = async () => {
    const res = await fetch('/auth/dev', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (res.ok) location.replace(next ?? '/');
    else setError('Anmeldung fehlgeschlagen');
  };

  return (
    <main className="login">
      <img src="/icon.svg" alt="" width={88} height={88} />
      <h1>Shopping</h1>
      <p className="muted">Eure Einkaufsliste – auch ohne Netz im Supermarkt.</p>
      {isListLink && <p>Jemand hat eine Einkaufsliste mit dir geteilt.</p>}
      {next && !isListLink && <p>Ein KI-Assistent möchte auf deine Listen zugreifen – bitte zuerst anmelden.</p>}
      {failed && <p className="error">Die Anmeldung hat nicht geklappt. Bitte noch einmal versuchen.</p>}
      {error && <p className="error">{error}</p>}
      {cfg?.oidc && (
        <a className="btn btn--primary btn--large" href={next ? `/auth/login?next=${encodeURIComponent(next)}` : '/auth/login'}>
          {cfg.loginLabel ?? 'Mit Pocket ID anmelden'}
        </a>
      )}
      {isListLink && (
        <form
          className="login__guest"
          onSubmit={(e) => {
            e.preventDefault();
            void guestLogin();
          }}
        >
          <p className="login__or">oder ohne Account, nur für diese Liste:</p>
          <input value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder="Dein Name, z. B. Oma" aria-label="Dein Name" required maxLength={40} />
          <button className="btn" type="submit">
            Als Gast weiter
          </button>
        </form>
      )}
      {cfg?.devLogin && (
        <form
          className="login__dev"
          onSubmit={(e) => {
            e.preventDefault();
            void devLogin();
          }}
        >
          <p className="muted">Entwicklungsmodus</p>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" aria-label="Name" required />
          <button className="btn" type="submit">
            Ohne Passwort anmelden
          </button>
        </form>
      )}
    </main>
  );
}
