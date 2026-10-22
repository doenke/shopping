# 05 – Login & Teilen

## OIDC-Login

- Authorization Code Flow mit **PKCE**, beliebiger OIDC-Provider
  (Authentik, Keycloak, Pocket ID, Authelia, Zitadel …).
- Nutzer wird über `issuer + sub` identifiziert; Name/Mail/Avatar aus den Claims.
- Optional: Zugriff/Admin-Rechte über einen Gruppen-Claim
  (`OIDC_ALLOWED_GROUPS`, `OIDC_ADMIN_GROUPS`).
- Session: HttpOnly-, Secure-, SameSite=Lax-Cookie, langlebig (z. B. 90 Tage,
  gleitend) – im Supermarkt will sich niemand neu anmelden. Ein abgelaufenes
  Refresh-Token beim IdP darf die **Offline-Nutzung nie blockieren**: lokale
  Daten bleiben bedienbar, Sync pausiert bis zum Re-Login.
- Kein eigenes Passwort-System. Optionaler Notfall-Admin per Env-Variable
  für die Ersteinrichtung.

### Haushalte

- Erster Login → eigener Haushalt wird angelegt.
- Einladen per Mail-Adresse oder Einladungslink; Eingeladene melden sich per
  OIDC an und landen im Haushalt.

## Zugriff per Link (z. B. per Mail)

Für Personen ohne Account (Babysitter, Besuch, Nachbarin, die mitbringt):

| Aspekt | Lösung |
|--------|--------|
| Link | `https://…/s/<token>` – Token 256 Bit zufällig, nur als Hash gespeichert |
| Rolle | `view` (nur ansehen) oder `edit` (hinzufügen/abhaken) |
| Gültigkeit | unbegrenzt, bis Datum, oder „nach dem Einkauf“ (manuell widerrufen) |
| Mehrere Links pro Liste | ja, jeweils mit Label („Oma“, „Nachbar“) → einzeln widerrufbar |
| Versand | „Per Mail teilen“ in der App: Server verschickt Mail mit Link (SMTP); alternativ Link kopieren / Android-Teilen-Dialog (Messenger) |
| Gast-Erlebnis | gleiche PWA, nur diese eine Liste, voll offline-fähig und in Echtzeit synchron; beim ersten Öffnen optional Namen eingeben („✓ von Oma“) |
| Sicherheit | Gast-Session ist an Liste gebunden, Rate-Limit auf `/s/*`, `noindex`, kein Zugriff auf Katalog-Bearbeitung, Haushalt, andere Listen |

Zusätzlich praktisch: **Mail-Zusammenfassung** – „Liste an mich mailen“
verschickt die Liste als Text plus Link (z. B. für jemanden, der lieber
einen Zettel ausdruckt).

## Rollen & Rechte

| Rolle | Ansehen | Artikel bearbeiten / abhaken | Liste umbenennen, teilen, löschen |
|-------|---------|------------------------------|-----------------------------------|
| Haushalts-Owner/Member | ✅ | ✅ | ✅ |
| `list_share` edit | ✅ | ✅ | ❌ |
| `list_share` view / Link view | ✅ | ❌ | ❌ |
| Link edit | ✅ | ✅ | ❌ |
| API-Token | je nach Scopes | je nach Scopes | je nach Scopes |

## Maschinen-Zugriff

- **API-Tokens** (persönlich, mit Scopes, optional auf Listen beschränkt) für
  Home Assistant, n8n, Skripte – siehe [07](07-api-und-home-assistant.md).
- **OAuth für MCP** – siehe [08](08-mcp-server.md).
