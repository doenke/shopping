# 02 – Architektur & Technologie

*Stand: Oktober 2026.*

## Entscheidung: Docker statt PHP-Webspace

| Kriterium | Docker-Container | PHP + MySQL Webspace |
|-----------|------------------|----------------------|
| Echtzeit-Sync (WebSocket/SSE) | ✅ dauerhafte Verbindungen problemlos | ❌ meist nur Polling; SSE hält PHP-Worker belegt |
| Hintergrundjobs (Mealie-Abgleich, Icon-Generierung) | ✅ im selben Prozess | ⚠️ nur per Cron, eingeschränkt |
| MCP-Server (Streamable HTTP) | ✅ | ⚠️ machbar, aber fragil |
| OIDC | ✅ | ✅ |
| Betrieb | Reverse Proxy + Compose (läuft für Mealie/n8n ohnehin) | sehr einfach |

Die Kernanforderung „Abhaken erscheint sofort bei allen“ braucht dauerhafte
Verbindungen; das kann klassisches Shared Hosting nicht sauber. Die
Infrastruktur für Container ist ohnehin vorhanden.

## Stack

Durchgehend **TypeScript**, damit Datenmodell, Validierung, Eingabe-Parser und
Sync-Logik zwischen Server, PWA, API und MCP geteilt werden.

| Schicht | Wahl | Warum |
|---------|------|-------|
| Server | Node.js 22 + **Fastify** | schnell, Plugins für WebSocket, statische Dateien |
| Validierung | **Zod** (geteilt) | eine Quelle für API-Validierung, OpenAPI und MCP-Tool-Schemas |
| Datenbank | **PostgreSQL 17** | JSONB, robuste Transaktionen; auch Icons und Profilbilder liegen hier |
| ORM / Migrationen | **Drizzle** | typsicher, SQL-nah, Migrationen laufen beim Start |
| Echtzeit | WebSocket für die App, Server-Sent Events für Integrationen | |
| Frontend | **React + Vite**, PWA über `vite-plugin-pwa` (eigener Service Worker, Workbox) | |
| Lokale Daten | **IndexedDB über Dexie** | vollständige lokale Kopie aller Listen |
| OIDC | `openid-client` gegen **Pocket ID** | PKCE, Passkeys über Pocket ID |
| MCP | offizielles `@modelcontextprotocol/sdk` | Streamable HTTP im selben Server |
| Bilder | `sharp` (auch SVG-Rendering) | Icons freistellen, skalieren, WebP |
| Bild-KI | Cloudflare Workers AI, Anthropic, OpenAI (austauschbar) | siehe [10](10-icons-plan.md) |

Monorepo mit pnpm workspaces:

```
apps/
  server/      Fastify: REST, WebSocket, SSE, MCP, OAuth, Jobs (Mealie, Icons, Avatare, Webhooks)
  web/         React-PWA
packages/
  shared/      Datenmodell, Zod-Schemas, Sync (HLC, Feld-LWW), Einheiten, Kategorien, Parser, Grundkatalog
custom_components/
  shopping/    Home-Assistant-Integration (HACS), getestet in ha-tests/
```

## Komponenten

```
                    ┌──────────────────────────────────────────────┐
  Browser / PWA ───►│  Fastify-Server (1 Container)                │
  (IndexedDB,       │   ├─ /              statische PWA            │
   Service Worker)  │   ├─ /auth/*        OIDC-Login, Gäste        │
       ▲  ▲         │   ├─ /api/v1/*      REST (OpenAPI)           │
       │  └─ WS ───►│   ├─ /ws            Echtzeit-Sync            │
       │            │   ├─ /api/v1/events SSE für Integrationen    │
  Home Assistant ──►│   ├─ /mcp, /oauth/* MCP + OAuth 2.1          │
  n8n, Skripte      │   ├─ /hooks/mealie/<secret>  Webhook-Ziel     │
  KI-Assistenten ──►│   ├─ /icons/*, /avatars/*  Bilder (gecacht)  │
                    │   └─ Jobs: Mealie-Abgleich, Icons, Avatare,  │
                    │            ausgehende Webhooks               │
                    └──────────────┬───────────────────────────────┘
                                   │
                         PostgreSQL (Compose)       Mealie-API, Pocket ID,
                         auch Icons und Avatare      Bild-KI-Anbieter
```

Ein App-Container plus Postgres, keine weitere Infrastruktur. Schreibzugriffe
laufen im Prozess hintereinander (siehe [04](04-sync-und-offline.md)); das setzt
**eine** Instanz voraus – für einen Haushalt mehr als genug.

## Deployment

- Image `ghcr.io/doenke/shopping` (`latest` und Versionsnummer), gebaut von der CI für amd64 und arm64.
- Vorlage: `docker-compose.example.yml` (App auf `127.0.0.1:38417`, Postgres mit Healthcheck).
- HTTPS über den vorhandenen Reverse Proxy (Pflicht für Service Worker); WebSocket-Upgrade für `/ws`.
- Konfiguration per Umgebungsvariablen; Nutzerspezifisches (Mealie-Token, Bild-KI-Schlüssel, API-Tokens)
  in der Datenbank, Geheimnisse verschlüsselt mit `SECRET_KEY`.
- Backup: `pg_dump` – Icons und Profilbilder liegen in der Datenbank, es gibt kein Datenverzeichnis.
- Versionen `x.yy.zzz`, getrennt für App und Integration (siehe [docs/betrieb.md](../betrieb.md#versionen)).

## Android

Die PWA deckt alles ab: Chrome installiert sie als echte WebAPK (eigenes Icon,
Vollbild, Teilen-Ziel „Teilen → Shopping“, Offline, Background Sync). Ein
Knopf „Installieren“ in der Titelzeile bietet das an. Eine native Hülle
(Trusted Web Activity, Capacitor) ist verworfen.
