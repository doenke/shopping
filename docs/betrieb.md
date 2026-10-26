# Betrieb

[← zurück zur README](../README.md)

## Einrichten

1. In Pocket ID einen OIDC-Client anlegen:
   - Callback-URL: `https://<deine-adresse>/auth/callback`
   - „Public Client“ / PKCE aktiv (dann kein Client-Secret nötig)
   - Zugriff über „Allowed User Groups“ steuern
2. `.env.example` nach `.env` und `docker-compose.example.yml` nach `docker-compose.yml` kopieren, `.env`
   ausfüllen.
3. `docker compose up -d` – die App ist auf `127.0.0.1:38417` erreichbar, dorthin zeigt der Reverse Proxy.
   `docker compose ps` zeigt beide Dienste als `healthy`, sobald App und Datenbank laufen (`/healthz` prüft
   auch die Datenbank).
4. Reverse Proxy mit HTTPS davor, WebSocket-Upgrade für `/ws` erlauben.

Datenbank-Migrationen und der Grundkatalog laufen beim Start automatisch.

## Alle Einstellungen

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `PUBLIC_URL` | – | Pflicht. Öffentliche Adresse, wie sie im Browser steht. |
| `SECRET_KEY` | – | Pflicht, mindestens 16 Zeichen (z. B. `openssl rand -base64 48`). Verschlüsselt gespeicherte Zugangsdaten; nach dem Start nicht mehr ändern. |
| `POSTGRES_PASSWORD` | – | Pflicht in der Compose-Vorlage, Passwort der Datenbank. |
| `DATABASE_URL` | – | Setzt die Compose-Vorlage selbst; nur für eigene Datenbanken oder die Entwicklung angeben. |
| `OIDC_ISSUER` | – | Adresse des Identity Providers, z. B. Pocket ID. |
| `OIDC_CLIENT_ID` | – | Client-ID aus dem Identity Provider. |
| `OIDC_CLIENT_SECRET` | leer | Leer lassen bei einem öffentlichen Client (PKCE). |
| `OIDC_ADMIN_GROUP` | `admins` | Mitglieder dieser Gruppe sind Admins. |
| `OIDC_LOGIN_LABEL` | `Mit Pocket ID anmelden` | Beschriftung des Anmeldeknopfs. |
| `OIDC_HOUSEHOLD_CLAIM` | `household` | Claim mit dem Haushalts-Tag, siehe [haushalte-und-teilen.md](haushalte-und-teilen.md). |
| `DEFAULT_HOUSEHOLD_NAME` | `Haushalt` | Name des Haushalts für alle ohne Tag. |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Wo die App im Container lauscht. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error`. |
| `SHOPPING_IMAGE` | `ghcr.io/doenke/shopping:latest` | In der Compose-Vorlage: feste Version statt `latest`, z. B. `ghcr.io/doenke/shopping:1.5.36`. |
| `DEV_LOGIN` | aus | Anmeldung nur mit Namen – **nur für die Entwicklung**. |

Zugangsdaten für Mealie und die Bild-KI werden nicht über Umgebungsvariablen gesetzt, sondern in der App
(*Einstellungen*) und verschlüsselt in der Datenbank gespeichert.

## Updates

Neues Image ziehen und den Container neu starten (in Portainer: Stack neu deployen mit „Image neu ziehen“).
Die installierte App im Browser sucht beim Zurückkehren in den Vordergrund und stündlich nach einer neuen
Version, übernimmt sie sofort und lädt sich einmal neu – offene Änderungen gehen dabei nicht verloren.

## Versionen

App und Home-Assistant-Integration haben getrennte Versionen im Format `x.yy.zzz`:

- `x` – Hauptversion, von Hand in [versions.json](../versions.json)
- `yy` – Zahl der Tage, an denen sich die jeweilige Komponente geändert hat
- `zzz` – Nummer des CI-Laufs

Das Image gibt es als `ghcr.io/doenke/shopping:latest` und mit Versionsnummer. Die App zeigt ihre Version
unten in den Einstellungen und in `/healthz`. Die Integration erscheint in HACS als Release `v…`.

## Sichern

Alles liegt in der PostgreSQL-Datenbank, auch die generierten Icons und Profilbilder:

```bash
docker compose exec db pg_dump -U shopping shopping > shopping.sql
```
