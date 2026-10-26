# 07 – API & Home Assistant

*Stand: Oktober 2026.*

Grundsatz: **Eine Geschäftslogik für alle.** REST-API, MCP und Home Assistant nutzen dieselbe
Dienstschicht; alle Schreibzugriffe laufen über die Sync-Engine und sind sofort in den Apps
sichtbar. Beschrieben in OpenAPI (`/api/v1/openapi.json`, lesbar unter `/api/docs`).

## Authentifizierung

| Client | Verfahren |
|--------|-----------|
| PWA | Session-Cookie (OIDC) |
| Home Assistant, n8n, Skripte | `Authorization: Bearer shp_…` – persönliches API-Token |
| MCP-Clients | OAuth 2.1 (siehe [08](08-mcp-server.md)) oder API-Token |

Tokens entstehen in der App unter *Einstellungen → API & Integrationen*, mit den Rechten `read`,
`write` und `mealie`. Ein Token sieht genau die Listen seines Nutzers – in dessen Reihenfolge.
Was über ein Token hinzukommt, trägt den Token-Namen („hinzugefügt von Anna über Home Assistant“).

## REST-Endpunkte

Listen dürfen überall per ID, per Name (`Einkauf`) oder als `default` (Hauptliste) angesprochen werden.

```
GET    /api/v1/me
GET    /api/v1/lists                          ?templates=exclude|include|only, type, archived
POST   /api/v1/lists                          {name, type?, description?, group?, private?, template?, isTemplate?}
GET    /api/v1/lists/{id}                     ?items=open|done|all
PATCH  /api/v1/lists/{id}                     {name?, description?, group?, archived?, visibility?}
DELETE /api/v1/lists/{id}

POST   /api/v1/lists/{id}/items               {text:"2 kg Kartoffeln, Milch"} und/oder
                                              {items:["Butter", {name, quantity, unit, properties, note, category,
                                                                 person, container, tipFrom, where, due, assignee, area}]}
POST   /api/v1/lists/{id}/clear-checked
POST   /api/v1/lists/{id}/apply-template      {template, includeOptional?}
POST   /api/v1/lists/{id}/import/mealie       {recipe, servings?, includePantry?} | {from, to, includePantry?}

GET    /api/v1/items/{id}
PATCH  /api/v1/items/{id}                     {name?, quantity?, unit?, properties?, note?, category?, checked?, …}
POST   /api/v1/items/{id}/check  |  /uncheck
DELETE /api/v1/items/{id}

GET    /api/v1/catalog/search?q=milch
POST   /api/v1/parse                          {text} → strukturierte Artikel (ohne Speichern)
GET    /api/v1/history                        zuletzt gekauft
GET    /api/v1/events                         Server-Sent Events
```

- Fehler im Format RFC 9457 (`application/problem+json`).
- `Idempotency-Key` für schreibende Aufrufe (24 h): Wiederholung liefert dieselbe Antwort,
  ein anderer Inhalt unter gleichem Schlüssel gibt `422`, eine laufende Anfrage `409`.

## Echtzeit für Integrationen

- **SSE** `GET /api/v1/events` – jede Änderung als `changes`-Ereignis, durch jeden Proxy.
- **Ausgehende Webhooks** (*Einstellungen*): eigener Änderungsstrom pro Webhook mit gespeicherter
  Position (Nachlieferung nach Ausfall), Signatur `X-Shopping-Signature: t=…,v1=HMAC-SHA256(t.body)`,
  3 Wiederholungen, nach 20 Fehlschlägen in Folge abgeschaltet. Die App selbst verschickt keine
  Benachrichtigungen.

## Home Assistant

Die Integration liegt im selben Repo (`custom_components/shopping`, `hacs.json`) und wird in der CI
in einem echten Home Assistant gegen einen echten Server getestet. HACS installiert sie aus
GitHub-Releases (`shopping.zip`).

- **Einrichten:** Adresse + API-Token. Danach **„Liste hinzufügen“** (Config-Subentry) für jede
  Liste, die in Home Assistant gebraucht wird – nichts wird automatisch angelegt. Einrichtungen
  aus der Zeit vor den Subentries behalten ihre bisherigen Listen mit denselben Entitäten.
- **Je Liste eine `todo`-Entität** plus Sensor „offene Artikel“.
  - `summary` = Name, `description` = „500 g · bio“ (Einkauf, Packliste) bzw. die Notiz
    (ToDo, Merkliste), `status` = abgehakt; ToDo-Listen mit Fälligkeitsdatum.
  - Neue Einträge laufen durch den Parser: „2 Liter Milch“ wird Milch · 2 l.
- **Push statt Polling:** ein SSE-Stream hält Home Assistant aktuell (`local_push`); Abfrage alle
  15 Minuten nur als Sicherheitsnetz.
- **Aktionen:** `shopping.add_items`, `shopping.apply_template`, `shopping.import_mealie_recipe`,
  `shopping.import_mealie_mealplan`, `shopping.clear_checked` (Liste per Name, leer = Hauptliste).
- **Sprache:** Assist versteht für To-do-Entitäten „Füge Milch zur Einkaufsliste hinzu“.
- **Icon:** liegt im Integrationsordner (`brand/`), angezeigt ab Home Assistant 2026.3.

### Beispiel-Automationen

```yaml
# Kaffeemaschine meldet "Bohnen leer" → auf die Hauptliste
trigger: { platform: state, entity_id: binary_sensor.kaffeemaschine_bohnen_leer, to: "on" }
action:
  service: shopping.add_items
  data: { items: ["1 kg Kaffeebohnen"] }
```

```yaml
# Dashboard-Taste "Grillen" → Vorlage in die Hauptliste übernehmen
action:
  service: shopping.apply_template
  data: { template: Grillabend }
```
