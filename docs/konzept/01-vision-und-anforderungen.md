# 01 – Vision & Anforderungen

## Vision

Eine Einkaufslisten-App, die sich so schnell und angenehm anfühlt wie Bring!
(Kachel-Raster mit Icons, ein Tipp zum Hinzufügen, ein Tipp zum Abhaken),
aber **selbst gehostet**, **offen über API/MCP** und **nativ mit Mealie
verbunden** ist. Im Supermarkt mit schlechtem Netz muss sie trotzdem
zuverlässig funktionieren.

## Anforderungen

### Muss (MVP)

| ID | Anforderung | Details in |
|----|-------------|-----------|
| A1 | Bring!-ähnliche Bedienung: Kacheln mit Icons, Kategorien, „Zuletzt verwendet“ | [12](12-ux-und-oberflaeche.md) |
| A2 | Mengen, Einheiten und Eigenschaften pro Artikel (z. B. „500 g Hack, gemischt, bio“) | [03](03-datenmodell.md), [09](09-lebensmittel-datenbank.md) |
| A3 | Login per OIDC (Pocket ID) | [05](05-auth-und-teilen.md) |
| A4 | Liste per Link (z. B. per Mail verschickt) zugänglich, ohne Account | [05](05-auth-und-teilen.md) |
| A5 | Abhaken wird nahezu in Echtzeit bei allen anderen Nutzern sichtbar | [04](04-sync-und-offline.md) |
| A6 | Voll offline-fähig, robust bei schlechtem Netz | [04](04-sync-und-offline.md) |
| A7 | PWA, gut am Handy (Fokus Android) **und** am Laptop | [02](02-architektur-und-technologie.md), [12](12-ux-und-oberflaeche.md) |
| A8 | Native Mealie-Übernahme (ersetzt den heutigen n8n-Flow mealie2bring) | [06](06-mealie-integration.md) |
| A9 | Lebensmittel-Datenbank, initial aus Mealie-Zutaten befüllt | [09](09-lebensmittel-datenbank.md) |
| A10 | Eine Liste ist als **Hauptliste** markiert: Ziel für Mealie, Home Assistant, MCP und Start-Ansicht der App | [03](03-datenmodell.md) |
| A11 | Kategorien wie bei Bring! | [09](09-lebensmittel-datenbank.md) |

### Soll (kurz nach MVP)

| ID | Anforderung | Details in |
|----|-------------|-----------|
| B1 | Listenvorlagen (nicht abhakbar, dienen nur zum Vorbefüllen) | [03](03-datenmodell.md), [12](12-ux-und-oberflaeche.md) |
| B2 | REST-API, Bearbeitung der Listen aus Home Assistant | [07](07-api-und-home-assistant.md) |
| B3 | MCP-Server | [08](08-mcp-server.md) |
| B4 | Generierte Icons nach einheitlicher Designrichtlinie | [10](10-icons-plan.md), [11](11-icon-designrichtlinie.md) |

### Kann (später, aber jetzt schon im Modell vorgesehen)

| ID | Anforderung |
|----|-------------|
| C1 | Weitere Listentypen, z. B. Packlisten, To-dos |
| C2 | Laden-spezifische Sortierung der Kategorien – nur falls die Bring!-Kategorien nicht reichen |
| C3 | Native Android-Hülle (TWA/Capacitor) für Homescreen-Widget, Play Store |

## Nicht-Ziele

- Kein iOS-Fokus (die PWA läuft dort trotzdem, wird aber nicht gezielt optimiert).
- **Keine Benachrichtigungen** – weder Push noch Mail-Hinweise („Liste geändert“, „Ich gehe einkaufen“). Die App ist still.
- Keine Preise, Angebote, Prospekte, Werbung.
- Kein Rezept-Management – das bleibt Mealie.
- Kein Mehr-Haushalts-Betrieb: **eine Instanz = ein Haushalt**. Wer sich anmelden darf, darf alles.
- Keine Übernahme bestehender Bring!-Daten – Start bei null.

## Qualitätsziele

| Ziel | Messgröße |
|------|-----------|
| Schnell | Abhaken/Hinzufügen fühlt sich sofort an (lokal < 50 ms, nie auf Server warten) |
| Synchron | Abhaken bei anderen Online-Nutzern sichtbar in < 1 s |
| Robust | Keine verlorenen Änderungen, auch nach Stunden offline oder App-Kill |
| Leicht | Nach dem ersten Laden startet die App komplett aus dem Cache |
| Offen | Alles, was die UI kann, kann auch die API (und damit HA/MCP/n8n) |
