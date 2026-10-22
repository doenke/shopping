# 05 – Login & Teilen

## Login mit Pocket ID

- OIDC Authorization Code Flow mit **PKCE** gegen **Pocket ID**
  (Passkey-Login – passt gut zum Handy).
- In Pocket ID wird ein OIDC-Client „Shopping“ angelegt:
  Callback `https://…/auth/callback`, PKCE an, Scopes `openid profile email groups`.
- **Zugriffssteuerung passiert in Pocket ID:** Über „Allowed User Groups“
  des Clients (z. B. eine Gruppe `shopping` oder einfach alle Haushaltsmitglieder).
  Wer dort durchkommt, darf in der App **alles** – es gibt keine Rollen.
- Die Gruppe `admins` wird aus dem `groups`-Claim gelesen und als
  `user.is_admin` gespeichert, hat aber vorerst keine Auswirkung. Reserve,
  falls später z. B. Icon-Freigabe oder Integrationseinstellungen
  eingeschränkt werden sollen.
- Nutzer wird über `sub` identifiziert; Name/Mail/Avatar aus den Claims.
- Session: HttpOnly-, Secure-, SameSite=Lax-Cookie, langlebig (90 Tage,
  gleitend) – im Supermarkt will sich niemand neu anmelden. Eine abgelaufene
  Session darf die **Offline-Nutzung nie blockieren**: lokale Daten bleiben
  bedienbar, Sync pausiert bis zum Re-Login.
- Kein eigenes Passwort-System, keine Einladungen, keine Haushaltsverwaltung:
  eine Instanz = ein Haushalt.

## Zugriff per Link (z. B. per Mail)

Für Personen ohne Pocket-ID-Account (Babysitter, Besuch, Nachbarin, die
etwas mitbringt):

| Aspekt | Lösung |
|--------|--------|
| Link | `https://…/s/<token>` – Token 256 Bit zufällig, nur als Hash gespeichert |
| Rolle | `view` (nur ansehen) oder `edit` (hinzufügen/abhaken) |
| Gültigkeit | unbegrenzt, bis Datum, oder bis zum manuellen Widerruf |
| Mehrere Links pro Liste | ja, jeweils mit Label („Oma“, „Nachbar“) → einzeln widerrufbar |
| Versand | „Per Mail teilen“: Server verschickt **eine** Mail mit dem Link (SMTP) – auf ausdrückliche Aktion hin, keine weiteren Mails danach. Alternativ Link kopieren / Android-Teilen-Dialog |
| Gast-Erlebnis | gleiche PWA, nur diese eine Liste, offline-fähig und in Echtzeit synchron; beim ersten Öffnen optional Namen eingeben („✓ von Oma“) |
| Sicherheit | Gast-Session ist an die Liste gebunden, Rate-Limit auf `/s/*`, `noindex`, kein Zugriff auf Katalog, Einstellungen, andere Listen |

## Rechte

| Wer | Darf |
|-----|------|
| Angemeldeter Nutzer (Pocket ID) | alles |
| Link `edit` | eine Liste ansehen, Artikel hinzufügen/ändern/abhaken |
| Link `view` | eine Liste ansehen |
| API-Token | je nach Scopes (siehe [07](07-api-und-home-assistant.md)) |

## Maschinen-Zugriff

- **API-Tokens** (persönlich, mit Scopes) für Home Assistant und Skripte –
  siehe [07](07-api-und-home-assistant.md).
- **OAuth für MCP** – siehe [08](08-mcp-server.md).
