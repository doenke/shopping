# 05 – Login & Teilen

## Login mit Pocket ID

- OIDC Authorization Code Flow mit **PKCE** gegen **Pocket ID**
  (Passkey-Login – passt gut zum Handy).
- In Pocket ID wird ein OIDC-Client „Shopping“ angelegt:
  Callback `https://…/auth/callback`, PKCE an, Scopes `openid profile email groups`.
- **Wer sich anmelden darf, steuert Pocket ID** über „Allowed User Groups“
  des Clients (z. B. eine Gruppe `shopping`).
- Die Gruppe `admins` wird aus dem `groups`-Claim gelesen und als
  `user.is_admin` gespeichert, hat aber vorerst keine Auswirkung.
- Nutzer wird über `sub` identifiziert; Name/Mail/Avatar aus den Claims.
- Session: HttpOnly-, Secure-, SameSite=Lax-Cookie, langlebig (90 Tage,
  gleitend) – im Supermarkt will sich niemand neu anmelden. Eine abgelaufene
  Session darf die **Offline-Nutzung nie blockieren**: lokale Daten bleiben
  bedienbar, Sync pausiert bis zum Re-Login.
- Kein eigenes Passwort-System, keine Einladungen, keine Haushaltsverwaltung.

## Zugriffsmodell: Listen gehören dem, der sie anlegt – der Link öffnet sie

| Regel | |
|-------|-|
| Listen anlegen | **jeder** angemeldete Nutzer |
| Eine Liste sehen & bearbeiten | ihr **Besitzer** und **jeder, der ihren Link geöffnet hat** |
| Ohne Link | eine fremde Liste ist unsichtbar – auch für angemeldete Nutzer |
| Abstufungen | keine: Wer drin ist, darf hinzufügen, ändern, abhaken (ein „nur ansehen“ ergibt bei Einkaufslisten keinen Sinn) |

Gleiches gilt für Vorlagen (und später Packlisten).
Gemeinsam für alle angemeldeten Nutzer sind nur Katalog, Kategorien,
Einheiten und Icons.

## Der Link

| Aspekt | Lösung |
|--------|--------|
| Form | `https://…/s/<token>` – Token 256 Bit zufällig, nur als Hash gespeichert |
| Anzahl | **ein** aktiver Link pro Liste |
| Teilen | „Teilen“ in der Liste öffnet den **Teilen-Dialog des Handys** (Web Share API) mit Link und kurzem Text → Messenger, Mail-App, SMS … Am Laptop wird der Link in die Zwischenablage kopiert. Der Server verschickt nichts. Jeder, der in der Liste ist, darf den Link weitergeben |
| Öffnen als **angemeldeter Nutzer** | Nutzer wird **Mitglied** (`list_member`): Die Liste erscheint dauerhaft in seiner App, synchron, offline-fähig, auch in HA/MCP über seine Tokens |
| Öffnen **ohne Account** | Gast-Zugang nur zu dieser Liste (Gast-Session per Cookie, optional Name eingeben → „✓ von Oma“). Hinweis „Mit Pocket ID anmelden“ für Haushaltsmitglieder, die gerade nicht eingeloggt sind |
| Link erneuern | Besitzer kann den Link neu erzeugen: der alte wird ungültig, **bestehende Mitglieder bleiben drin**, Gast-Sessions des alten Links enden |
| Mitglieder entfernen | Besitzer sieht die Mitglieder (Avatare) und kann einzelne entfernen |
| Liste verlassen | jedes Mitglied kann eine Liste für sich ausblenden/verlassen |
| Sicherheit | Rate-Limit auf `/s/*`, `noindex`, Gäste haben keinen Zugriff auf Katalog-Pflege, Einstellungen oder andere Listen |

## Rechte im Überblick

| | Besitzer | Mitglied (Pocket ID, über Link) | Gast (ohne Account, über Link) |
|-|----------|----------------------------------|--------------------------------|
| Artikel hinzufügen, ändern, abhaken | ✅ | ✅ | ✅ |
| Link teilen | ✅ | ✅ | ✅ |
| Liste umbenennen, Vorlage anwenden | ✅ | ✅ | ✅ |
| Link erneuern, Mitglieder entfernen | ✅ | ❌ | ❌ |
| Liste löschen | ✅ | ❌ (nur verlassen) | ❌ |
| Liste in HA/MCP/API sichtbar | ✅ | ✅ | – |

## Maschinen-Zugriff

- **API-Tokens** gehören einem Nutzer und sehen genau dessen Listen
  (eigene + beigetretene) – siehe [07](07-api-und-home-assistant.md).
- **OAuth für MCP** – ebenfalls im Namen des Nutzers, siehe [08](08-mcp-server.md).
