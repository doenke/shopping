# 05 – Login, Haushalte & Teilen

*Stand: Oktober 2026.*

## Login mit Pocket ID

- OIDC Authorization Code Flow mit **PKCE** gegen **Pocket ID** (Passkey-Login – passt gut zum Handy).
- In Pocket ID wird ein Client „Shopping“ angelegt: Callback `${PUBLIC_URL}/auth/callback`, öffentlicher
  Client mit PKCE.
- **Wer sich anmelden darf, steuert Pocket ID** über „Allowed User Groups“ des Clients.
- Die Gruppe aus `OIDC_ADMIN_GROUP` (Standard `admins`) wird gelesen und als `is_admin` gespeichert.
- Nutzer werden über `sub` identifiziert; Name, Mail und Profilbild kommen aus den Claims. Das Profilbild
  wird als 128-px-Kopie gespeichert (offline, auch für Gäste sichtbar) und täglich aufgefrischt.
- Session: HttpOnly-, Secure-, SameSite=Lax-Cookie, 90 Tage gleitend – im Supermarkt will sich niemand
  neu anmelden. Eine abgelaufene Session blockiert nie die Offline-Nutzung; Sync pausiert bis zum Login.
- Kein eigenes Passwort-System, keine Einladungsmails.

## Haushalte

- Der Haushalt steht in Pocket ID als **Custom Claim** (Name per `OIDC_HOUSEHOLD_CLAIM`, Standard
  `household`), am Benutzer oder an einer Gruppe. Ohne Claim gilt der Standard-Haushalt
  (Name per `DEFAULT_HOUSEHOLD_NAME`).
- Der Claim wird bei jeder Anmeldung gelesen; ein Umzug nimmt die eigenen Listen mit.
- Nur Pocket-ID-Nutzer gehören zu einem Haushalt, Gäste nie.

## Wer sieht eine Liste?

| Regel | |
|-------|-|
| Listen anlegen | jeder angemeldete Nutzer (Gäste nicht) |
| Neue Liste | sichtbar für den **ganzen Haushalt** des Besitzers; ToDo-Listen sind standardmäßig **privat** |
| Privat | nur der Besitzer und wer über den Link dazukommt |
| Link | wer ihn öffnet, ist dabei – auch aus einem anderen Haushalt, ohne Konto als Gast |
| Abstufungen | keine: Wer drin ist, darf hinzufügen, ändern, abhaken |

Technisch sind das Mitgliedschaften mit Herkunft (`owner`, `household`, `link`, siehe
[03](03-datenmodell.md#zugriff)). Gemeinsam für alle sind nur Katalog, Kategorien, Einheiten und Icons.

## Der Link

| Aspekt | Lösung |
|--------|--------|
| Form | `${PUBLIC_URL}/s/<token>`, Token zufällig, nur als Hash gespeichert |
| Anzahl | **ein** aktiver Link pro Liste |
| Teilen | *⋮ → Berechtigungen … → Link teilen* öffnet den Teilen-Dialog des Handys (Web Share API); am Laptop wird der Link kopiert. Der Server verschickt nichts |
| Öffnen angemeldet | der Nutzer wird Mitglied (`via = link`), die Liste erscheint dauerhaft in seiner App, in Home Assistant und MCP |
| Öffnen ohne Konto | Gast nur für diese Liste (eigener Nutzer mit `is_guest`, Name eingeben → „✓ von Oma“) |
| Link erneuern | nur der Besitzer: der alte wird ungültig, Mitglieder mit Konto bleiben, Gäste fliegen raus |
| Mitglieder entfernen | nur der Besitzer, im Dialog „Berechtigungen“ |
| Liste verlassen | jedes Mitglied; wer verlässt, bleibt draußen, bis die Liste neu geteilt wird |
| Sicherheit | `noindex`; Gäste haben keinen Zugriff auf Katalogpflege, Einstellungen, Integrationen oder andere Listen |

## Rechte im Überblick

| | Besitzer | Mitglied (Haushalt oder Link) | Gast |
|-|----------|-------------------------------|------|
| Artikel hinzufügen, ändern, abhaken | ✅ | ✅ | ✅ |
| Liste bearbeiten (Name, Beschreibung), Vorlage anwenden | ✅ | ✅ | ✅ |
| Link teilen | ✅ | ✅ | ✅ |
| Privat / Haushalt umschalten, Link erneuern, Mitglieder entfernen | ✅ | ❌ | ❌ |
| Liste löschen | ✅ | ❌ (nur verlassen) | ❌ |
| Liste in API, Home Assistant, MCP | ✅ | ✅ | – |

## Maschinen-Zugriff

- **API-Tokens** gehören einem Nutzer und sehen genau dessen Listen – siehe [07](07-api-und-home-assistant.md).
- **OAuth für MCP** – ebenfalls im Namen des Nutzers, siehe [08](08-mcp-server.md).
