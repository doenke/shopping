import { useEffect, useState } from 'react';

export function Login() {
  const [cfg, setCfg] = useState<{ oidc: boolean; devLogin: boolean } | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const params = new URLSearchParams(location.search);
  const failed = params.get('login');
  // Set when someone opened a list link without being logged in.
  const next = /^\/s\/[A-Za-z0-9_-]+$/.test(params.get('next') ?? '') ? params.get('next')! : null;

  useEffect(() => {
    fetch('/auth/config')
      .then((r) => r.json())
      .then(setCfg)
      .catch(() => setError('Server nicht erreichbar. Für die erste Anmeldung wird Internet gebraucht.'));
  }, []);

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
      {next && <p>Melde dich an, um der geteilten Liste beizutreten.</p>}
      {failed && <p className="error">Die Anmeldung hat nicht geklappt. Bitte noch einmal versuchen.</p>}
      {error && <p className="error">{error}</p>}
      {cfg?.oidc && (
        <a className="btn btn--primary btn--large" href={next ? `/auth/login?next=${encodeURIComponent(next)}` : '/auth/login'}>
          Mit Pocket ID anmelden
        </a>
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
