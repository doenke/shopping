# Haushalte, Teilen, Gäste

[← zurück zur README](../README.md)

## Haushalte

Listen gehören automatisch dem ganzen Haushalt, können aber **privat** 🔒 sein: „Privat – nur für mich“ beim
Anlegen oder unter *⋮ → Berechtigungen …*. ToDo-Listen sind standardmäßig privat.

Wer zu welchem Haushalt gehört, entscheidet die App bei jeder Anmeldung aus Pocket ID:

1. **Ausdrücklicher Haushalt** (nur für Sonderfälle): Ein **Custom Claim** `household` am Benutzer oder an einer
   Gruppe, z. B. `household = Müller WG`. Alle mit demselben Wert teilen sich einen Haushalt.
2. **Owner-Gruppe** (der Normalfall): Wer in der Gruppe `OIDC_OWNER_GROUP` ist (z. B. `familie`), ist im Haushalt
   des Betreibers. **Alle anderen** bekommen einen **eigenen Haushalt** und sehen nur ihre Listen und was man mit
   ihnen per Link teilt.
3. **Keine Owner-Gruppe eingestellt:** Alle Benutzer sind in einem gemeinsamen Haushalt.

Ein neuer Haushalt heißt nach dem **Nachnamen seines ersten Mitglieds** (bei einem Claim nach dessen Wert).
**Umbenennen** darf jedes Mitglied: *Einstellungen → Haushalt*, erste Zeile antippen. Wer den Haushalt
wechselt (andere Gruppe, anderer Claim), nimmt seine eigenen Listen mit – das passiert bei der nächsten Anmeldung.

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `OIDC_OWNER_GROUP` | leer | Gruppe für den Haushalt des Betreibers; leer = alle in einem Haushalt |
| `OIDC_HOUSEHOLD_CLAIM` | `household` | Name des Claims für einen ausdrücklichen Haushalt |
| `DEFAULT_HOUSEHOLD_NAME` | leer | Name des gemeinsamen Haushalts beim ersten Anlegen (sonst Nachname) |

Nur Pocket-ID-Benutzer gehören zu einem Haushalt, Gäste nie. Wer alles im eigenen Haushalt ist, zeigt
*Einstellungen → Haushalt → Wer ist in meinem Haushalt?* (ab zwei Mitgliedern); der Owner-Haushalt trägt dort und beim Teilen das Abzeichen „👑 Owner“.

## Mit anderen Haushalten oder Personen teilen

*⋮ → Berechtigungen … → + Haushalt oder Person …* zeigt alle anderen Haushalte mit ihren Leuten:

- **Ganzen Haushalt**: Alle aus diesem Haushalt sind dabei – auch wer später dazukommt; wer auszieht, verliert
  die Liste. Der Besitzer kann das Teilen wieder beenden (✕ am Haushalt).
- **Einladen**: eine einzelne Person, egal aus welchem Haushalt (bei privaten Listen auch aus dem eigenen).

Teilen darf jeder mit Konto, der die Liste hat – wie beim Link; entfernen darf nur der Besitzer. In der
Seitenleiste zeigt 🔗, dass eine Liste per Link geteilt ist, 👥, dass sie mit anderen Haushalten oder Personen
geteilt ist. Ob eine Liste privat ist (🔒), steht in der Liste selbst.

## Teilen per Link

*⋮ → Berechtigungen … → Link teilen* öffnet den Teilen-Dialog des Handys mit einem Link zur Liste. Wer den Link angemeldet öffnet,
ist dabei – auch aus einem anderen Haushalt. Der Besitzer kann den Link dort auch erneuern,
Mitglieder können die Liste verlassen.

## Gäste ohne Konto

Wer den Link ohne Konto öffnet, gibt einen Namen ein und sieht nur diese eine Liste. Ein erneuerter Link wirft
Gäste hinaus. „Wer ist dabei?“ zeigt alle Mitglieder mit ihrer Herkunft (Haushalt, Link, Besitzer); der
Besitzer kann Leute entfernen.
