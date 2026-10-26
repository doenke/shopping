# REST-API, KI-Assistenten (MCP), Webhooks

[← zurück zur README](../README.md)

## REST-API

- API-Tokens in *Einstellungen → API & Integrationen*, mit Rechten „Lesen“, „Ändern“ und „Mealie-Import“.
  Mitschicken als `Authorization: Bearer shp_…`.
- OpenAPI-Dokumentation unter `/api/docs`.
- Echtzeit-Ereignisse per Server-Sent Events.
- `Idempotency-Key` als Header macht Wiederholungen sicher (gleicher Schlüssel, gleiche Antwort).
- Listen und Artikel kommen in der Reihenfolge des Token-Besitzers.

## KI-Assistenten (MCP)

MCP-Server-Adresse: `https://<deine-adresse>/mcp`. In Claude als *Custom Connector* eintragen; beim Verbinden
meldest du dich über Pocket ID an und erlaubst den Zugriff. Verbundene Assistenten stehen in den Einstellungen
und lassen sich dort trennen. Für einfache Clients geht statt OAuth auch ein API-Token.

Was ein Assistent hinzufügt, ist in der App gekennzeichnet („hinzugefügt von Anna über Claude“).

## Webhooks

Für eigene Automationen (z. B. n8n): In den Einstellungen eine Adresse eintragen, Shopping schickt jede
Änderung dorthin – HMAC-signiert im Header `X-Shopping-Signature` (`t=…,v1=HMAC-SHA256(t.body)`) und mit
Nachlieferung, falls das Ziel kurz nicht erreichbar ist. Nach vielen Fehlschlägen in Folge schaltet sich ein
Webhook ab.
