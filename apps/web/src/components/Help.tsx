import type { Me } from '@shopping/shared';
import { useEffect, useState } from 'react';

interface HelpInfo {
  admins: string[];
  setup?: { ownerGroup: string | null; adminGroup: string; householdClaim: string };
}

type Tab = 'guest' | 'user' | 'admin';

/** "Anna", "Anna oder Ben", "Anna, Ben oder Carla" */
function either(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} oder ${names.at(-1)}`;
}

/** Short help for guests (via link), people with an account, and admins. */
export function Help({ me }: { me: Me }) {
  const [info, setInfo] = useState<HelpInfo | null>(null);
  useEffect(() => {
    void fetch('/api/v1/help')
      .then((r) => (r.ok ? (r.json() as Promise<HelpInfo>) : null))
      .then(setInfo)
      .catch(() => setInfo(null));
  }, []);
  const tabs: Tab[] = me.isGuest ? ['guest'] : me.isAdmin ? ['user', 'admin', 'guest'] : ['user', 'guest'];
  const [tab, setTab] = useState<Tab>(tabs[0]!);
  const label: Record<Tab, string> = { user: 'Für dich', admin: 'Für Admins', guest: 'Für Gäste' };

  return (
    <section className="help">
      {tabs.length > 1 && (
        <div className="segmented" role="tablist" aria-label="Hilfe für">
          {tabs.map((t) => (
            <button key={t} type="button" role="tab" className={t === tab ? 'active' : ''} aria-selected={t === tab} onClick={() => setTab(t)}>
              {label[t]}
            </button>
          ))}
        </div>
      )}
      {tab === 'guest' && <GuestHelp admins={info?.admins ?? []} isGuest={me.isGuest} />}
      {tab === 'user' && <UserHelp me={me} />}
      {tab === 'admin' && <AdminHelp setup={info?.setup} />}
    </section>
  );
}

function Example({ children, then }: { children: string; then: string }) {
  return (
    <li>
      <code>{children}</code> <span className="muted">→ {then}</span>
    </li>
  );
}

function GuestHelp({ admins, isGuest }: { admins: string[]; isGuest: boolean }) {
  return (
    <>
      <h2>{isGuest ? 'Willkommen, Gast! 👋' : 'So sieht es für Gäste aus'}</h2>
      <p>
        Jemand hat {isGuest ? 'dir' : 'einem Gast'} einen Link geschickt – und schon {isGuest ? 'bist du' : 'ist man'} auf genau dieser einen Liste dabei. Kein
        Konto, kein Passwort, kein Formular. Nur die Liste.
      </p>

      <h3>Was geht</h3>
      <ul className="help__examples">
        <Example then="landet direkt auf der Liste">2 kg Kartoffeln</Example>
        <Example then="drei Einträge auf einmal">Milch, Brot, 6 Eier</Example>
      </ul>
      <p>
        Antippen öffnet einen Eintrag zum Ändern. Im Laden auf <strong>🛒</strong> tippen – dann hakt Antippen ab, und alle anderen sehen live, was schon im
        Wagen liegt.
      </p>

      <h3>Was nicht geht</h3>
      <p>Eigene Listen anlegen, andere Listen sehen, Vorlagen, Packlisten fürs Wochenende. Gäste sind eben Gäste – nett, aber ohne Schlüssel.</p>
      <p className="muted">Erneuert der Besitzer den Link, ist der Gastzugang vorbei. Nicht persönlich nehmen.</p>

      <div className="help__callout">
        <strong>Dauerhaft dabei sein?</strong>
        <p>
          Mit einem eigenen Zugang bekommst du deinen eigenen Haushalt: eigene Listen, Vorlagen, Packlisten, ToDos – und Listen teilen kannst du dann auch.{' '}
          {admins.length ? (
            <>
              Frag einfach <strong>{either(admins)}</strong>.
            </>
          ) : (
            <>Frag einfach die Person, die diese App betreibt.</>
          )}
        </p>
      </div>
    </>
  );
}

function UserHelp({ me }: { me: Me }) {
  return (
    <>
      <h2>Die Kurzfassung</h2>
      <p>
        Listen gehören deinem Haushalt{me.household ? ` („${me.household}“)` : ''}. Wer drin ist, sieht sie – ohne dass du irgendwen einladen musst. Alles
        synchronisiert sofort und funktioniert auch im Funkloch hinterm Kühlregal.
      </p>

      <h3>Tippen wie du redest</h3>
      <ul className="help__examples">
        <Example then="Menge, Einheit und Eigenschaft erkannt">2 kg Kartoffeln festkochend</Example>
        <Example then="mehrere auf einmal">Milch, Butter, 6 Eier</Example>
        <Example then="Packliste: für Anna, in den Koffer">3 T-Shirts @Anna #Koffer</Example>
        <Example then="einmal auf der Liste, abgehakt wird pro Person">Sonnenbrille @Sönke @Ulli</Example>
        <Example then="in einer Vorlage: für jeden, der mitfährt">Badehose @alle</Example>
        <Example then="Merkliste: Tipp von Ben, gibt's bei Netflix">Dune @Ben #Netflix</Example>
        <Example then="mit 🔗 auf der Kachel – antippen öffnet die Seite">Dune https://www.imdb.com/…</Example>
        <Example then="ToDo: Freitag fällig, Ben macht's">Reifen wechseln !Fr @Ben #Auto</Example>
      </ul>
      <p className="muted">
        Steht „Milch“ schon drauf, wird zusammengelegt statt verdoppelt. Ganze Zutatenlisten oder Rezept-Links kannst du einfach einfügen – und aus anderen Apps
        per „Teilen → Shopping“ schicken.
      </p>

      <h3>Vier Sorten Listen</h3>
      <ul>
        <li>
          🛒 <strong>Einkauf</strong> – nach Gängen sortiert, Gekauftes rutscht nach unten.
        </li>
        <li>
          🧳 <strong>Packliste</strong> – nach Person oder Koffer, am Ende ins Archiv.
        </li>
        <li>
          📌 <strong>Merkliste</strong> – Filme, Bücher, Restaurants. Für „das wollten wir doch mal …“.
        </li>
        <li>
          ✅ <strong>ToDo</strong> – erst mal nur für dich, auf Wunsch auch wiederkehrend.
        </li>
      </ul>
      <p>
        <strong>Vorlagen</strong> ◇ sind Listen zum Wiederverwenden: „Wocheneinkauf Basis“ + „Grillen“ ergibt in zwei Tipps den Samstagseinkauf.
      </p>

      <h3>Wer sieht was?</h3>
      <ul>
        <li>🏠 normal: dein ganzer Haushalt</li>
        <li>🔒 privat: nur du</li>
        <li>👥 geteilt mit anderen Haushalten oder einzelnen Leuten</li>
        <li>🔗 per Link – auch für Leute ohne Konto (als Gast)</li>
      </ul>
      <p className="muted">Alles unter ⋮ → Berechtigungen. Den Namen deines Haushalts kann jeder darin ändern: Einstellungen → Haushalt.</p>

      <h3>Am Rechner</h3>
      <p>
        <kbd>N</kbd> neuer Eintrag, <kbd>↑</kbd>
        <kbd>↓</kbd> wechseln, <kbd>Leertaste</kbd> abhaken, <kbd>Entf</kbd> löschen (mit Rückgängig), <kbd>Strg</kbd>+<kbd>K</kbd> suchen, <kbd>?</kbd> alle
        Kürzel.
      </p>
      <p>
        <strong>💼 Arbeitsmodus</strong> (unten in der Seitenleiste oder <kbd>Strg</kbd>+<kbd>Shift</kbd>+<kbd>A</kbd>): nur die ToDo-Listen der Kategorie
        „Arbeit“, sachlich und kompakt – Listen, Aufgaben als Tabelle, Details rechts. Kein Einkaufszettel weit und breit.
      </p>
    </>
  );
}

function AdminHelp({ setup }: { setup?: HelpInfo['setup'] }) {
  const owner = setup?.ownerGroup;
  const claim = setup?.householdClaim ?? 'household';
  return (
    <>
      <h2>Haushalte in drei Regeln</h2>
      <p>Wer in welchem Haushalt landet, entscheidet die App bei jeder Anmeldung aus Pocket ID. Die erste passende Regel gewinnt:</p>
      <ol className="help__rules">
        <li>
          <strong>Claim gesetzt?</strong> Ein Custom Claim <code>{claim}</code> am Benutzer oder an einer Gruppe sticht alles.
          <br />
          <span className="muted">
            Beispiel: <code>{claim} = WG Bergstraße</code> an der Gruppe „wg“ → alle aus der WG teilen sich einen Haushalt.
          </span>
        </li>
        <li>
          <strong>In der Owner-Gruppe?</strong> Dann ab in den Owner-Haushalt 👑.
          <br />
          <span className="muted">
            {owner ? (
              <>
                Hier eingestellt: <code>{owner}</code>. Leg deine Familie in diese Gruppe – fertig.
              </>
            ) : (
              <>
                Hier ist keine Owner-Gruppe eingestellt (<code>OIDC_OWNER_GROUP</code>) – deshalb landen alle ohne Claim im selben Haushalt.
              </>
            )}
          </span>
        </li>
        <li>
          <strong>Sonst:</strong> {owner ? 'ein eigener Haushalt, ganz für sich allein.' : 'der gemeinsame Haushalt.'}
          <br />
          <span className="muted">{owner ? 'Beispiel: Kollege Tom bekommt einen Zugang → Haushalt „Schulz“, sieht nur seine eigenen Listen.' : ''}</span>
        </li>
      </ol>

      <h3>Gut zu wissen</h3>
      <ul>
        <li>Ein neuer Haushalt heißt wie der Nachname seines ersten Mitglieds; umbenennen darf jedes Mitglied.</li>
        <li>Umzüge (andere Gruppe, anderer Claim) wirken bei der nächsten Anmeldung – die eigenen Listen ziehen mit.</li>
        <li>
          Admin ist, wer in <code>{setup?.adminGroup ?? 'admins'}</code> ist. Du stellst die Bild-KI für alle ein (Einstellungen → Icons) und wirst Gästen als
          Ansprechpartner genannt, wenn sie einen eigenen Zugang möchten.
        </li>
        <li>Gast → richtiger Zugang: in Pocket ID anlegen, fertig. Die Regeln oben machen den Rest.</li>
      </ul>
    </>
  );
}
