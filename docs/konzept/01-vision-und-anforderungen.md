# 01 – Vision & Anforderungen

*Stand: Oktober 2026 – beschreibt, was gebaut ist und warum.*

## Vision

Eine Listen-App für den ganzen Haushalt, die sich so schnell anfühlt wie ein
Zettel: Kachel-Raster mit Icons, ein Tipp zum Hinzufügen, ein Tipp zum
Abhaken. Dazu **selbst gehostet**, **offen über API und MCP** und **direkt mit
Mealie verbunden**. Im Supermarkt mit schlechtem Netz muss sie trotzdem
zuverlässig funktionieren.

Begonnen als Einkaufsliste, gewachsen zu vier Listentypen mit gemeinsamem
Unterbau: Einkauf, Packliste, Merkliste, ToDo.

## Anforderungen

| ID | Anforderung | Umgesetzt in |
|----|-------------|--------------|
| A1 | Kacheln mit Icons, nach Kategorien gruppiert, „Zuletzt verwendet“ | [12](12-ux-und-oberflaeche.md) |
| A2 | Mengen, Einheiten und Eigenschaften pro Artikel („500 g Hack, gemischt, bio“) | [03](03-datenmodell.md), [09](09-lebensmittel-datenbank.md) |
| A3 | Login per OIDC (Pocket ID) | [05](05-auth-und-teilen.md) |
| A4 | Listen gehören dem Haushalt (oder sind privat); andere kommen über den Link dazu, ohne Konto als Gast | [05](05-auth-und-teilen.md) |
| A5 | Abhaken ist nahezu sofort bei allen anderen sichtbar | [04](04-sync-und-offline.md) |
| A6 | Voll offline-fähig, robust bei schlechtem Netz | [04](04-sync-und-offline.md) |
| A7 | PWA, gut am Handy **und** am Laptop | [02](02-architektur-und-technologie.md), [12](12-ux-und-oberflaeche.md) |
| A8 | Mealie-Anbindung: Eingangskorb, Rezepte, Wochenplan (ersetzt einen n8n-Flow) | [06](06-mealie-integration.md) |
| A9 | Lebensmittel-Katalog: Grundkatalog plus Zutaten aus Mealie | [09](09-lebensmittel-datenbank.md) |
| A10 | Jeder Nutzer hat eine **Hauptliste** – Standard für Mealie, Home Assistant, MCP und den Start der App | [03](03-datenmodell.md) |
| A11 | Vorlagen (nicht abhakbar, füllen Listen vor, Abgleich in beide Richtungen) | [03](03-datenmodell.md), [12](12-ux-und-oberflaeche.md) |
| A12 | REST-API und Home-Assistant-Integration | [07](07-api-und-home-assistant.md) |
| A13 | MCP-Server für KI-Assistenten | [08](08-mcp-server.md) |
| A14 | Generierte Icons nach einheitlicher Richtlinie | [10](10-icons-plan.md), [11](11-icon-designrichtlinie.md) |
| A15 | Weitere Listentypen: Packliste, Merkliste, ToDo | [03](03-datenmodell.md) |
| A16 | Eigene Reihenfolge von Kategorien, Listen und Abschnitten je Nutzer | [03](03-datenmodell.md), [12](12-ux-und-oberflaeche.md) |

## Nicht-Ziele

- **Keine Benachrichtigungen** – weder Push noch Mails („Liste geändert“, „Ich gehe einkaufen“).
  Die App ist still; was passiert, sieht man in der geöffneten App.
- Keine native App: Die PWA reicht (installierbar, offline, Teilen-Ziel). Eine Hülle für den
  Play Store oder ein Homescreen-Widget ist bewusst verworfen.
- Kein iOS-Fokus – die PWA läuft dort, wird aber nicht gezielt optimiert.
- Keine Preise, Angebote, Prospekte, Werbung.
- Kein Rezept-Management – das bleibt Mealie.
- Keine Übernahme von Daten aus anderen Listen-Apps – Start bei null.
- Keine Rollen innerhalb einer Liste: Wer drin ist, darf alles außer Löschen und Rechte ändern.

## Qualitätsziele

| Ziel | Messgröße |
|------|-----------|
| Schnell | Abhaken/Hinzufügen fühlt sich sofort an (lokal, nie auf den Server warten) |
| Synchron | Abhaken bei anderen Online-Nutzern sichtbar in < 1 s (gemessen ~0,1 s) |
| Robust | Keine verlorenen Änderungen, auch nach Stunden offline oder App-Kill |
| Leicht | Nach dem ersten Laden startet die App komplett aus dem Cache |
| Offen | Was die App kann, kann auch die API (und damit Home Assistant, MCP, n8n) |
