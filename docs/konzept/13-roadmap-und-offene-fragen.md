# 13 – Roadmap & offene Fragen

## Getroffene Entscheidungen (Vorschlag)

| Thema | Entscheidung |
|-------|--------------|
| Hosting | Docker (App + PostgreSQL), nicht PHP-Webspace |
| Sprache | TypeScript durchgehend, Monorepo |
| Client | PWA (React), Android-Fokus; native Hülle erst bei Bedarf |
| Sync | Offline-first, eigene Outbox + Delta-Sync, Feld-LWW mit HLC, WebSocket |
| Login | OIDC, Gäste per Link |
| Listentypen | generisch über `list_type` + `is_template`, Start nur mit `shopping` |
| Mealie | Webhook + Abgleich-Job als Ersatz für n8n, plus Rezept-/Wochenplan-Import |
| HA | eigene Custom Integration mit `todo`-Entitäten, Push via SSE |
| MCP | im Server eingebaut, Streamable HTTP, OAuth |

## Phasen

### Phase 1 – Fundament (MVP)
- Monorepo, Docker-Compose, CI
- OIDC-Login, Haushalte
- Einkaufslisten: Artikel mit Menge/Einheit/Eigenschaften/Notiz
- Offline-Sync + WebSocket-Echtzeit, PWA installierbar
- Katalog-Import aus Mealie, Grundkatalog, Eingabe-Parser
- Kachel-UI (Handy) + Drei-Spalten-UI (Laptop), Kategorie-Fallback-Icons
- **Meilenstein:** Wocheneinkauf damit erledigen, zu zweit, im echten Supermarkt.

### Phase 2 – Bring ablösen
- Mealie-Eingangskorb (Webhook + Abgleich) → n8n-Flow abschalten
- Rezept- und Wochenplan-Import
- Vorlagen
- Teilen per Link/Mail

### Phase 3 – Offen machen
- REST-API mit Tokens, OpenAPI, SSE, Webhooks
- Home-Assistant-Integration (HACS)
- MCP-Server

### Phase 4 – Icons
- Anker-Set, Kategorie-Icons, Review-UI, Massengenerierung

### Phase 5 – Ausbau
- Packlisten (zweiter Listentyp)
- Laden-spezifische Sortierung
- Web Push, ggf. TWA/Capacitor für Widget und Play Store

## Offene Fragen an dich

1. **Name:** „Korb“ ist nur Arbeitstitel – Ideen/Wünsche?
2. **OIDC-Provider:** Welcher läuft bei dir (Authentik, Keycloak, Pocket ID, Authelia …)? Gibt es Gruppen, die Zugriff steuern sollen?
3. **Nutzerkreis:** Nur euer Haushalt, oder sollen auch andere Haushalte (Familie, Freunde) eigene Haushalte auf deiner Instanz bekommen?
4. **Mealie-Verhalten:** Soll die Mealie-Liste weiterhin als Eingangskorb geleert/abgehakt werden (wie heute), oder sollen beide Listen gespiegelt bleiben?
5. **Mealie-Version:** Läuft v2 (Haushalte)? Dann passen die Endpunkte aus dem heutigen Flow.
6. **Ziel-Listen:** Landet alles aus Mealie in einer Liste, oder soll nach Kategorie verteilt werden (z. B. Drogerie separat)?
7. **Icons:** Budget/Präferenz für Cloud-Modell vs. lokale Generierung? Steht eine GPU zur Verfügung?
8. **Läden:** Kauft ihr meist in denselben 1–2 Läden ein? Dann lohnt sich die Gangreihenfolge früher.
9. **Bring-Daten:** Sollen bestehende Bring-Listen/Verlauf einmalig übernommen werden?
10. **Benachrichtigungen:** Reicht Home Assistant/Matrix (über Webhooks), oder willst du Push direkt aus der App?
