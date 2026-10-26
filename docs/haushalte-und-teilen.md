# Haushalte, Teilen, Gäste

[← zurück zur README](../README.md)

## Haushalte

Listen gehören automatisch dem ganzen Haushalt, können aber **privat** 🔒 sein: „Privat – nur für mich“ beim
Anlegen oder unter *⋮ → Berechtigungen …*. ToDo-Listen sind standardmäßig privat.

Wer zu welchem Haushalt gehört, steht in Pocket ID: Leg einen **Custom Claim** `household` an – am Benutzer
oder an einer Gruppe (dann gilt er für alle Mitglieder), z. B. `household = Müller`. Alle mit demselben Tag
sehen gegenseitig ihre Listen; wer keinen Tag hat, ist im Standard-Haushalt. Der Tag wird bei jeder Anmeldung
gelesen, ein Umzug in einen anderen Haushalt nimmt die eigenen Listen mit.

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `OIDC_HOUSEHOLD_CLAIM` | `household` | Name des Claims mit dem Haushalts-Tag |
| `DEFAULT_HOUSEHOLD_NAME` | `Haushalt` | Name des Haushalts für alle ohne Tag |

Nur Pocket-ID-Benutzer gehören zu einem Haushalt, Gäste nie.

## Teilen per Link

*⋮ → Berechtigungen … → Link teilen* öffnet den Teilen-Dialog des Handys mit einem Link zur Liste. Wer den Link angemeldet öffnet,
ist dabei – auch aus einem anderen Haushalt. Der Besitzer kann den Link dort auch erneuern,
Mitglieder können die Liste verlassen.

## Gäste ohne Konto

Wer den Link ohne Konto öffnet, gibt einen Namen ein und sieht nur diese eine Liste. Ein erneuerter Link wirft
Gäste hinaus. „Wer ist dabei?“ zeigt alle Mitglieder mit ihrer Herkunft (Haushalt, Link, Besitzer); der
Besitzer kann Leute entfernen.
