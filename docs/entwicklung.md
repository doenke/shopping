# Entwickeln

[← zurück zur README](../README.md)

## Loslegen

Voraussetzungen: Node 22, pnpm, eine PostgreSQL-Datenbank.

```bash
pnpm install
cp .env.example .env    # DATABASE_URL, PUBLIC_URL=http://localhost:5173, SECRET_KEY, DEV_LOGIN=true
pnpm --filter @shopping/server dev   # API auf :3000
pnpm --filter @shopping/web dev      # PWA auf :5173 (leitet /api, /auth, /ws an :3000 weiter)
```

Mit `DEV_LOGIN=true` kann man sich lokal nur mit einem Namen anmelden – **niemals in Produktion**.

## Prüfen

```bash
pnpm typecheck
pnpm test     # Server-Tests brauchen TEST_DATABASE_URL (Standard: postgres://postgres@127.0.0.1:54329/postgres)
pnpm build
```

Die Home-Assistant-Integration wird gegen einen echten Server getestet:

```bash
pnpm --filter @shopping/server build
pip install -r ha-tests/requirements.txt
cd ha-tests && python -m pytest -q
```

## Aufbau

| Pfad | Inhalt |
| --- | --- |
| `packages/shared` | Datenmodell, Eingabe-Parser, Einheiten, Kategorien, Sync-Logik (HLC, Feld-LWW), Grundkatalog |
| `apps/server` | Fastify: OIDC, Sync (WebSocket + HTTP), REST-API, MCP, Mealie, Icons, Postgres via Drizzle |
| `apps/web` | React-PWA: Dexie (IndexedDB), Sync-Engine, Service Worker |
| `custom_components/shopping` | Home-Assistant-Integration (HACS) |
| `ha-tests` | Tests der Integration gegen einen echten Server |
| `scripts/version.mjs` | berechnet die Versionen (siehe [betrieb.md](betrieb.md#versionen)) |
| `.github/workflows/ci.yml` | Tests, Image, Releases der Integration |

## Veröffentlichen

Jeder Push auf `main` testet, baut das Image `ghcr.io/doenke/shopping` (`latest` und Versionsnummer) und
erstellt ein Release der Home-Assistant-Integration, wenn sich `custom_components/` oder `hacs.json` geändert
haben. Von Hand ist nichts zu tun.

## Konzept

| # | Dokument | Inhalt |
| --- | --- | --- |
| 01 | [Vision & Anforderungen](konzept/01-vision-und-anforderungen.md) | Ziele, Anforderungen, Abgrenzung (u. a. keine Benachrichtigungen) |
| 02 | [Architektur & Technologie](konzept/02-architektur-und-technologie.md) | Docker vs. PHP-Webspace, Stack, Deployment |
| 03 | [Datenmodell](konzept/03-datenmodell.md) | Tabellen, Listentypen, Vorlagen, Mengen/Einheiten |
| 04 | [Sync & Offline](konzept/04-sync-und-offline.md) | Offline-first, Echtzeit-Abhaken, schlechtes Netz im Supermarkt |
| 05 | [Login & Teilen](konzept/05-auth-und-teilen.md) | Pocket ID, Zugriffsmodell, Teilen per Link |
| 06 | [Mealie-Integration](konzept/06-mealie-integration.md) | Ersatz für den n8n-Flow, Rezepte, Wochenplan |
| 07 | [API & Home Assistant](konzept/07-api-und-home-assistant.md) | REST, Echtzeit-Events, HA-Integration |
| 08 | [MCP-Server](konzept/08-mcp-server.md) | Tools, Ressourcen, Auth |
| 09 | [Lebensmittel-Datenbank](konzept/09-lebensmittel-datenbank.md) | Katalog, Aliase, Eingabe-Parser |
| 10 | [Icons – Plan](konzept/10-icons-plan.md) | Generierungs-Pipeline, Review, Rollout |
| 11 | [Icons – Designrichtlinie](konzept/11-icon-designrichtlinie.md) | Stil, Raster, Farben, Prompt-Vorlage |
| 12 | [UX & Oberfläche](konzept/12-ux-und-oberflaeche.md) | Handy, Laptop, Einkaufsmodus |
| 13 | [Roadmap & Entscheidungen](konzept/13-roadmap-und-entscheidungen.md) | Phasen, getroffene Entscheidungen |
