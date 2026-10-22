# Shopping – Einkaufslisten-App

Selbst gehostete, offline-fähige Einkaufslisten-App im Stil von Bring!,
mit nativer Mealie-Anbindung, Login über Pocket ID, REST-API für Home Assistant und
eingebautem MCP-Server.

> Status: **Konzeptphase** – noch kein Code.

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
