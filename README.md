# Shopping – Einkaufslisten-App

Selbst gehostete, offline-fähige Einkaufslisten-App im Stil von Bring!,
mit nativer Mealie-Anbindung, Login über Pocket ID, REST-API für Home Assistant und
eingebautem MCP-Server.

> Status: **Phase 1 und 2** umgesetzt – siehe [Roadmap](docs/konzept/13-roadmap-und-entscheidungen.md).

## Was die App kann

- Login über **Pocket ID** (OIDC mit PKCE), langlebige Sessions
- Einkaufslisten mit **Hauptliste** ⭐, Artikel mit **Menge, Einheit, Eigenschaften, Notiz**
- **Eine Eingabezeile für alles**: „2 kg Kartoffeln“, „500g Hack gemischt bio“, „Milch, Butter, 6 Eier“
- Doppelte Artikel werden zusammengeführt (1 l + 2 l Milch = 3 l)
- **Offline-first**: lokale Datenbank im Browser, Änderungen werden gepuffert und
  nachgeliefert (auch per Background Sync, wenn die App schon zu ist)
- **Echtzeit**: Abhaken erscheint bei anderen in ~0,1 s, mit „✓ von Anna“
- PWA zum Installieren auf Android; am Laptop drei Spalten mit Katalog zum Durchklicken
- Lebensmittel-Katalog (Grundkatalog + **Import aus Mealie**, Labels → Kategorien)
- Kategorien wie bei Bring!, Kacheln mit Buchstaben-Platzhalter bis zu den generierten Icons
- **Teilen per Link** über den Teilen-Dialog des Handys: Wer den Link angemeldet öffnet,
  ist dabei (Besitzer kann den Link erneuern, Mitglieder können die Liste verlassen)

- **Gäste ohne Account**: Link öffnen, Namen eingeben, nur diese Liste; Link erneuern wirft Gäste raus.
  „Wer ist dabei?“ zeigt Mitglieder, der Besitzer kann Leute entfernen.
- **Mealie-Eingangskorb** (ersetzt den n8n-Flow „mealie2bring“): Was in Mealie auf der
  Einkaufsliste landet, kommt strukturiert (Menge, Einheit, Kategorie, „für Chili“) in die
  Zielliste und wird in Mealie abgehakt – per Notifier sofort, sonst alle 15 Minuten
- **Rezept und Wochenplan aus Mealie**: Portionen anpassen, Zutaten-Checkliste,
  Vorrat (Salz, Öl …) vorab abgewählt, gleiche Zutaten zusammengefasst
- **Vorlagen** (◇): nicht abhakbar, „Neue Liste“ aus Vorlage, „Vorlage übernehmen“ mit
  Auswahl, „Als Vorlage speichern“, optionale Artikel

Noch nicht dabei (folgende Phasen): REST-API-Tokens, Home Assistant, MCP, Icons.

### Mealie-Eingangskorb einrichten

1. *Einstellungen → Mealie*: Adresse und API-Token eintragen, speichern.
2. *Eingangskorb einschalten*, Mealie-Einkaufsliste und Zielliste wählen, speichern.
3. Die angezeigte Apprise-URL in Mealie unter *Haushalt → Benachrichtigungen* als
   Notifier eintragen, Ereignis *Einkaufsliste* aktivieren.
4. Den n8n-Flow „mealie2bring“ abschalten.

## Betrieb

1. In Pocket ID einen OIDC-Client anlegen:
   - Callback-URL: `https://<deine-adresse>/auth/callback`
   - „Public Client“ / PKCE aktiv (dann kein Client-Secret nötig)
   - Zugriff über „Allowed User Groups“ steuern
2. `.env.example` nach `.env` und `docker-compose.example.yml` nach `docker-compose.yml` kopieren, `.env` ausfüllen.
3. `docker compose up -d` – die App ist auf `127.0.0.1:38417` erreichbar (dorthin zeigt der Reverse Proxy). `docker compose ps` zeigt beide
   Dienste als `healthy`, sobald App und Datenbank laufen (`/healthz` prüft auch die Datenbank).
4. Reverse Proxy mit HTTPS davor (WebSocket-Upgrade für `/ws` erlauben).

Datenbank-Migrationen laufen beim Start automatisch. Backup: `pg_dump` der Datenbank.

## Entwicklung

Voraussetzungen: Node 22, pnpm, eine PostgreSQL-Datenbank.

```bash
pnpm install
cp .env.example .env    # DATABASE_URL, PUBLIC_URL=http://localhost:5173, SECRET_KEY, DEV_LOGIN=true
pnpm --filter @shopping/server dev   # API auf :3000
pnpm --filter @shopping/web dev      # PWA auf :5173 (leitet /api, /auth, /ws an :3000 weiter)
```

Mit `DEV_LOGIN=true` kann man sich lokal nur mit einem Namen anmelden – **niemals in Produktion**.

```bash
pnpm typecheck
pnpm test     # Server-Tests brauchen TEST_DATABASE_URL (Standard: postgres://postgres@127.0.0.1:54329/postgres)
pnpm build
```

Struktur:

| Pfad | Inhalt |
|------|--------|
| `packages/shared` | Datenmodell, Eingabe-Parser, Einheiten, Kategorien, Sync-Logik (HLC, Feld-LWW), Grundkatalog |
| `apps/server` | Fastify: OIDC, Sync (WebSocket + HTTP), Katalog, Mealie, Postgres via Drizzle |
| `apps/web` | React-PWA: Dexie (IndexedDB), Sync-Engine, Service Worker |

## Konzept

| # | Dokument | Inhalt |
|---|----------|--------|
| 01 | [Vision & Anforderungen](docs/konzept/01-vision-und-anforderungen.md) | Ziele, Anforderungen, Abgrenzung (u. a. keine Benachrichtigungen) |
| 02 | [Architektur & Technologie](docs/konzept/02-architektur-und-technologie.md) | Docker vs. PHP-Webspace, Stack, Deployment |
| 03 | [Datenmodell](docs/konzept/03-datenmodell.md) | Tabellen, Listentypen, Vorlagen, Mengen/Einheiten |
| 04 | [Sync & Offline](docs/konzept/04-sync-und-offline.md) | Offline-first, Echtzeit-Abhaken, schlechtes Netz im Supermarkt |
| 05 | [Login & Teilen](docs/konzept/05-auth-und-teilen.md) | Pocket ID, Zugriffsmodell, Teilen per Link |
| 06 | [Mealie-Integration](docs/konzept/06-mealie-integration.md) | Ersatz für den n8n-Flow, Rezepte, Wochenplan |
| 07 | [API & Home Assistant](docs/konzept/07-api-und-home-assistant.md) | REST, Echtzeit-Events, HA-Integration |
| 08 | [MCP-Server](docs/konzept/08-mcp-server.md) | Tools, Ressourcen, Auth |
| 09 | [Lebensmittel-Datenbank](docs/konzept/09-lebensmittel-datenbank.md) | Katalog, Aliase, Eingabe-Parser |
| 10 | [Icons – Plan](docs/konzept/10-icons-plan.md) | Generierungs-Pipeline, Review, Rollout |
| 11 | [Icons – Designrichtlinie](docs/konzept/11-icon-designrichtlinie.md) | Stil, Raster, Farben, Prompt-Vorlage |
| 12 | [UX & Oberfläche](docs/konzept/12-ux-und-oberflaeche.md) | Handy, Laptop, Einkaufsmodus |
| 13 | [Roadmap & Entscheidungen](docs/konzept/13-roadmap-und-entscheidungen.md) | Phasen, getroffene Entscheidungen |
