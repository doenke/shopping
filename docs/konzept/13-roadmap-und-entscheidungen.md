# 13 – Entscheidungen & Verlauf

*Stand: Oktober 2026.*

## Entscheidungen

| Thema | Entscheidung |
|-------|--------------|
| Name | **Shopping** |
| Hosting | Docker (App + PostgreSQL), nicht PHP-Webspace; **eine** Instanz |
| Sprache | TypeScript durchgehend, Monorepo (pnpm) |
| Client | PWA (React), Android-Fokus; native Hülle verworfen |
| Sync | Offline-first, eigene Outbox + Delta-Sync, Feld-LWW mit HLC, WebSocket; SSE für Integrationen |
| Login | **Pocket ID** (OIDC, PKCE); wer sich anmelden darf, steuern Gruppen in Pocket ID |
| Haushalte | aus einem OIDC-Claim (`household`); ohne Claim Standard-Haushalt; Gäste gehören zu keinem |
| Zugriff | Listen gehören dem Haushalt des Besitzers oder sind privat; der Link holt andere dazu (mit Konto dauerhaft, ohne als Gast); keine Rollen innerhalb einer Liste |
| Listentypen | `shopping`, `packing`, `memo`, `todo`, jeweils auch als Vorlage |
| Hauptliste | je Nutzer, immer eine Einkaufsliste; Standard für Home Assistant, MCP, API, Teilen, Start |
| Reihenfolgen | Kategorien, Listen und Abschnitte je Nutzer, auf allen Geräten; keine Ladenprofile |
| Mealie | **v2**; Mealie-Liste bleibt Eingangskorb (übernehmen + in Mealie abhaken, kein Rückkanal); dazu Rezept- und Wochenplan-Import |
| Icons | keine GPU → Cloudflare-Gratiskontingent mit Tageslimit; Claude (SVG, Vorprüfung) und OpenAI optional mit Monatsgrenze; automatische Freigabe |
| Daten anderer Listen-Apps | werden **nicht** übernommen |
| Benachrichtigungen | **keine** – kein Push, keine Mails, keine Chat-Meldungen |
| Home Assistant | eigene Integration im selben Repo, `todo`-Entitäten, Push via SSE, Listen einzeln hinzufügen, Releases über HACS |
| MCP | im Server eingebaut, Streamable HTTP, OAuth 2.1 mit Shopping als Authorization Server |
| Versionen | `x.yy.zzz` getrennt für App und Integration (Hauptversion, Tage mit Änderungen, CI-Lauf) |
| Lizenz | MIT |

## Verlauf

Alle Phasen sind umgesetzt.

| Phase | Inhalt |
|-------|--------|
| 1 – Fundament | Monorepo, Docker, CI; Login; Einkaufslisten mit Hauptliste, Mengen, Einheiten, Eigenschaften; Offline-Sync und Echtzeit; Katalog und Parser; Kacheln am Handy, drei Spalten am Laptop; Beitreten per Link |
| 2 – Alltagstauglich | Mealie-Eingangskorb, Rezept- und Wochenplan-Import, Vorlagen, Gäste ohne Konto, Mitglieder |
| 3 – Offen | REST-API mit Tokens, OpenAPI, SSE; Home-Assistant-Integration; MCP-Server mit OAuth |
| 4 – Icons | Pipeline mit Stil-Referenzen, Tagesbudget, automatischen Prüfungen und Freigabe; Claude als SVG-Zeichner und Vorprüfer |
| 5 – Ausbau | Packlisten; Kennzeichnung „über Claude/Home Assistant“; ausgehende Webhooks; `Idempotency-Key` |
| Danach | Merklisten mit Icons je Eintrag; Haushalte; ToDo-Listen mit Kategorien; ein Dialog „+ Neu“; Abgleich mit Vorlagen in beide Richtungen; Listen-Icons; Zuhause-/Einkaufen-Modus; eigene Reihenfolgen per Ziehen; Profilbilder; Listen einzeln in Home Assistant; Versionierung |

## Bewusst nicht gemacht

- Native Android-App (Trusted Web Activity, Capacitor, Homescreen-Widget) – die PWA reicht.
- Ladenprofile mit eigener Kategorie-Reihenfolge je Laden – die eigene Reihenfolge je Nutzer reicht.
- Benachrichtigungen jeder Art.
- Rückkanal nach Mealie.

## Offen

- Pflege-Ansicht für den Katalog (Dubletten zusammenführen, Artikel ausblenden) – bisher nur
  über die API und den Mealie-Abgleich.
- Automatische Oberflächen-Tests in der CI (bisher: Server-, Shared- und Home-Assistant-Tests).

## Ideen für später

Gerade ohne Bedarf, aber festgehalten:

- **CalDAV**: Listen als CalDAV-Aufgabenlisten (VTODO) anbieten, damit Kalender- und Aufgaben-Apps
  (z. B. Thunderbird, DAVx⁵ mit Tasks.org, Apple Erinnerungen) sie direkt lesen und abhaken können.
  Naheliegend vor allem für ToDo-Listen (Fälligkeit → `DUE`, Erledigt → `STATUS:COMPLETED`), denkbar
  auch für Einkaufslisten. Zu klären: Anmeldung (App-Passwort bzw. API-Token statt OIDC), ob nur lesen
  oder auch schreiben, und wie Mengen, Eigenschaften und Kategorien in VTODO abgebildet werden.
