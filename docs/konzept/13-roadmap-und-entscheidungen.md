# 13 – Roadmap & Entscheidungen

## Entscheidungen

| Thema | Entscheidung |
|-------|--------------|
| Name | **Shopping** |
| Hosting | Docker (App + PostgreSQL), nicht PHP-Webspace |
| Sprache | TypeScript durchgehend, Monorepo |
| Client | PWA (React), Android-Fokus; native Hülle erst bei Bedarf |
| Sync | Offline-first, eigene Outbox + Delta-Sync, Feld-LWW mit HLC, WebSocket |
| Login | **Pocket ID** (OIDC); wer sich anmelden darf, steuern Gruppen in Pocket ID; Gruppe `admins` wird gelesen, aber vorerst nicht genutzt |
| Zugriff | Jeder angemeldete Nutzer darf Listen anlegen. Andere sehen und bearbeiten eine Liste **nur, wenn sie ihren Link geöffnet haben** – angemeldet werden sie dauerhaft Mitglied, ohne Account Gast. Keine Rollen, kein „nur ansehen“, keine Haushaltsverwaltung |
| Link | ein Link pro Liste, verschickt über den Teilen-Dialog des Handys; Besitzer kann ihn erneuern und Mitglieder entfernen; der Server versendet keine Mails |
| Listentypen | generisch über `list_type` + `is_template`, Start nur mit `shopping` |
| Hauptliste | jeder Nutzer hat seine Hauptliste; Standard für HA, MCP, API und Startansicht, Vorschlag als Mealie-Ziel |
| Mealie | **v2**; Mealie-Liste bleibt **Eingangskorb wie heute** (übernehmen + in Mealie abhaken, kein Rückkanal); alles landet in einer Zielliste; plus Rezept-/Wochenplan-Import |
| Kategorien | die 14 Kategorien wie bei Bring!, Reihenfolge änderbar; keine Laden-Profile |
| Icons | keine GPU → Gratis-Kontingente (bevorzugt Gemini mit Referenzbildern), über Wochen gestreckt; bezahlter Dienst nur als Fallback mit Kostendeckel |
| Bring-Daten | werden **nicht** übernommen |
| Benachrichtigungen | **keine** – kein Push, keine Hinweis-Mails, keine Matrix-Meldungen |
| HA | eigene Custom Integration mit `todo`-Entitäten, Push via SSE |
| MCP | im Server eingebaut, Streamable HTTP, OAuth über Pocket ID |

## Phasen

### Phase 1 – Fundament (MVP)
- Monorepo, Docker-Compose, CI
- Login mit Pocket ID, Listen mit Besitzer
- Einkaufslisten mit Hauptliste: Artikel mit Menge/Einheit/Eigenschaften/Notiz
- Offline-Sync + WebSocket-Echtzeit, PWA installierbar
- Katalog-Import aus Mealie, Grundkatalog, Bring!-Kategorien, Eingabe-Parser
- Kachel-UI (Handy) + Drei-Spalten-UI (Laptop), Buchstaben-Fallback statt Icons
- **Meilenstein:** Wocheneinkauf damit erledigen, zu zweit, im echten Supermarkt.

### Phase 2 – Bring ablösen
- Mealie-Eingangskorb (Webhook + Abgleich) → n8n-Flow „mealie2bring“ abschalten
- Rezept- und Wochenplan-Import
- Vorlagen
- Teilen per Link (Teilen-Dialog des Handys), Mitglieder, Gäste

### Phase 3 – Offen machen
- REST-API mit Tokens, OpenAPI, SSE
- Home-Assistant-Integration (HACS)
- MCP-Server

### Phase 4 – Icons (kann parallel ab Phase 1 laufen)
- Stil finden (Anker-Set) – geht ohne Code, direkt in der Weboberfläche
- Kategorie-Icons, Review-Ansicht, Generierung mit Tagesbudget

### Phase 5 – Ausbau (bei Bedarf)
- Packlisten (zweiter Listentyp)
- ggf. TWA/Capacitor für Homescreen-Widget und Play Store

## Noch offen

Nichts Blockierendes. Beim Bau zu klären:

- Ob Pocket ID die MCP-OAuth-Anforderungen direkt erfüllt (sonst übernimmt Shopping die Rolle, siehe [08](08-mcp-server.md)).
- Aktuelle Gratis-Limits der Bild-Dienste.
