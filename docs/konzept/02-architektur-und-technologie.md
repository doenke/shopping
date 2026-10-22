# 02 – Architektur & Technologie

## Entscheidung: Docker statt PHP-Webspace

| Kriterium | Docker-Container | PHP + MySQL Webspace |
|-----------|------------------|----------------------|
| Echtzeit-Sync (WebSocket/SSE) | ✅ dauerhafte Verbindungen problemlos | ❌ meist nur Polling; SSE hält PHP-Worker belegt |
| Hintergrundjobs (Mealie-Abgleich, Icon-Generierung, Mails) | ✅ Worker im selben Prozess | ⚠️ nur per Cron, eingeschränkt |
| MCP-Server (Streamable HTTP) | ✅ | ⚠️ machbar, aber fragil |
| OIDC | ✅ | ✅ |
| Betrieb | Reverse Proxy + Compose (läuft bei dir schon für Mealie/n8n) | sehr einfach |

**Empfehlung: Docker.** Die Kernanforderung „Abhaken erscheint sofort bei
allen“ braucht dauerhafte Verbindungen, und das kann klassisches Shared
Hosting nicht sauber. Da Mealie und n8n bereits selbst gehostet laufen,
ist die Infrastruktur ohnehin da.

## Stack

Durchgehend **TypeScript**, damit Datenmodell, Validierung und
Sync-Logik zwischen Server, PWA, API und MCP geteilt werden.

| Schicht | Wahl | Warum |
|---------|------|-------|
| Server | Node.js 22 LTS + **Fastify** | schnell, gutes Plugin-Ökosystem (WebSocket, Rate-Limit, OpenAPI) |
| Validierung / Schemas | **Zod** (geteilt) | eine Quelle für API-Validierung, OpenAPI-Generierung, MCP-Tool-Schemas |
| Datenbank | **PostgreSQL 17** | `pg_trgm` für Fuzzy-Suche im Katalog, `LISTEN/NOTIFY`, JSONB |
| ORM / Migrationen | **Drizzle** | typsicher, SQL-nah, gute Migrationen |
| Echtzeit | WebSocket (`@fastify/websocket`), SSE als Fallback/für Integrationen | |
| Frontend | **React + Vite**, PWA via `vite-plugin-pwa` (Workbox) | großes Ökosystem (Drag & Drop, Virtualisierung) |
| Lokale Datenhaltung | **IndexedDB via Dexie** | vollständige lokale Replik der Listen |
| OIDC | `openid-client` gegen **Pocket ID** | zertifizierte Bibliothek, PKCE |
| MCP | offizielles `@modelcontextprotocol/sdk` | Streamable HTTP im selben Server |
| Mail | SMTP via `nodemailer` | Freigabe-Links verschicken |
| Bildverarbeitung | `sharp` | Icons skalieren/konvertieren |

Monorepo-Aufteilung (pnpm workspaces):

```
apps/
  server/      Fastify: REST, WebSocket, MCP, Jobs
  web/         React-PWA
packages/
  shared/      Zod-Schemas, Typen, Sync-Protokoll, Mengen-/Einheiten-Logik, Eingabe-Parser
  ha/          Home-Assistant-Custom-Integration (Python, eigenes Repo/HACS später)
```

## Komponenten

```
                    ┌────────────────────────────────────────────┐
  Browser / PWA ───►│  Fastify-Server (1 Container)              │
  (IndexedDB,       │   ├─ /            statische PWA            │
   Service Worker)  │   ├─ /auth/*      OIDC-Login               │
       ▲  ▲         │   ├─ /api/v1/*    REST (OpenAPI)           │
       │  └─ WS ───►│   ├─ /ws          Echtzeit-Sync            │
       │            │   ├─ /api/v1/events  SSE für HA & Co.      │
  Home Assistant ──►│   ├─ /mcp         MCP (Streamable HTTP)    │
  n8n, Skripte      │   ├─ /hooks/mealie/<secret>  Webhook-Ziel   │
  KI-Assistenten ──►│   └─ Jobs: Mealie-Abgleich, Icons, Mail    │
                    └──────────────┬─────────────────────────────┘
                                   │
                         PostgreSQL (Compose)        Mealie-API
                         Volume: /data/icons ◄─────  Pocket ID (OIDC)
                                                     SMTP, Bild-KI
```

Ein einziger App-Container plus Postgres. Keine weitere Infrastruktur
(kein Redis nötig: bei einer Instanz verteilt der Prozess Events selbst;
für mehrere Instanzen stünde Postgres `LISTEN/NOTIFY` bereit).

## Deployment

```yaml
# docker-compose.yml (Skizze)
services:
  app:
    image: ghcr.io/doenke/shopping:latest
    environment:
      DATABASE_URL: postgres://shopping:***@db/shopping
      PUBLIC_URL: https://einkauf.example.org
      OIDC_ISSUER: https://id.example.org          # Pocket ID
      OIDC_CLIENT_ID: ***
      OIDC_CLIENT_SECRET: ***
      SMTP_URL: smtp://...
      MEALIE_URL: https://mealie.example.org     # optional, auch per UI
    volumes: [ ./data:/data ]
    depends_on: [ db ]
  db:
    image: postgres:17
    volumes: [ ./pg:/var/lib/postgresql/data ]
```

- HTTPS über den vorhandenen Reverse Proxy (Pflicht für Service Worker / PWA).
- WebSocket-Upgrade im Proxy erlauben.
- Backups: `pg_dump` + `/data` (Icons).
- Konfiguration per Umgebungsvariablen; alles Nutzerspezifische (Mealie-Token, API-Tokens) in der DB, Secrets verschlüsselt.

## Android / native App

1. **PWA zuerst.** Chrome auf Android installiert PWAs als echte WebAPK:
   eigenes Icon, Vollbild, Share-Target („Teilen → Shopping“ für Text),
   Offline, Background Sync. Das deckt praktisch alles ab.
2. **Bei Bedarf: Trusted Web Activity** (Bubblewrap) – dieselbe PWA im
   Play Store, null Zusatzcode.
3. **Erst wenn nötig: Capacitor-Hülle** für Dinge, die das Web nicht kann:
   Homescreen-Widget mit Liste, Schnell-Kachel, Wear-OS. Das Sync-Protokoll
   ist so ausgelegt, dass ein nativer Client es ebenfalls sprechen kann.
