# 07 – API & Home Assistant

Grundsatz: **API-first.** Die PWA nutzt dieselbe API wie Home Assistant,
n8n und der MCP-Server. Alles ist in einer OpenAPI-Spezifikation
beschrieben (`/api/v1/openapi.json`, Doku unter `/api/docs`).

## Authentifizierung

| Client | Verfahren |
|--------|-----------|
| PWA | Session-Cookie (OIDC) |
| Home Assistant, n8n, Skripte | `Authorization: Bearer shopping_pat_…` – persönliches API-Token |
| MCP-Clients | OAuth 2.1 (siehe [08](08-mcp-server.md)) oder API-Token |

Tokens werden in der App unter *Einstellungen → API & Integrationen* erstellt,
mit den Berechtigungen `read`, `write` und `mealie`. Ein Token sieht genau die
Listen seines Nutzers. Tokens können keine weiteren Tokens erzeugen.

## REST-Endpunkte (umgesetzt)

Listen dürfen überall per ID, per Name (`Einkauf`) oder als `default` (Hauptliste)
angesprochen werden. Vollständig beschrieben unter `/api/v1/openapi.json`,
lesbar unter `/api/docs`.

```
GET    /api/v1/lists                          ?templates=exclude|include|only
POST   /api/v1/lists                          {name, template?, isTemplate?}
GET    /api/v1/lists/{id}                     ?items=open|done|all
PATCH  /api/v1/lists/{id}                     {name}
DELETE /api/v1/lists/{id}

GET    /api/v1/lists/{id}/items               ?items=open|done|all
POST   /api/v1/lists/{id}/items               {text:"2 kg Kartoffeln, Milch"} und/oder
                                              {items:["Butter", {name, quantity, unit, properties, note, category}]}
POST   /api/v1/lists/{id}/clear-checked
POST   /api/v1/lists/{id}/apply-template      {template, includeOptional?}
POST   /api/v1/lists/{id}/import/mealie       {recipe, servings?, includePantry?} | {from, to, includePantry?}

GET    /api/v1/items/{id}
PATCH  /api/v1/items/{id}                     {name?, quantity?, unit?, properties?, note?, category?, checked?}
POST   /api/v1/items/{id}/check               /uncheck
DELETE /api/v1/items/{id}

GET    /api/v1/catalog/search?q=milch
POST   /api/v1/parse                          {text} → strukturierte Artikel (ohne Speichern)
GET    /api/v1/history?list=&limit=           zuletzt gekauft
GET    /api/v1/events                         Server-Sent Events
```

Fehler im Format RFC 9457 (`application/problem+json`).

## Echtzeit für Integrationen

- **SSE** `GET /api/v1/events` – Ereignisse `list.changed`, `list.removed`,
  `item.changed`, `item.removed` (jeweils mit dem Objekt als JSON). Einfach zu
  konsumieren, funktioniert durch jeden Proxy.
- **Ausgehende Webhooks** (noch nicht umgesetzt; optional, HMAC-signiert) – für eigene
  Automationen, z. B. in n8n. Die App selbst verschickt keine
  Benachrichtigungen.

## Home Assistant

### Custom Integration „Shopping“ (HACS)

Home Assistant hat mit der **To-do-Plattform** (`todo`-Entitäten) genau das
richtige Gegenstück. Die Integration:

- **Config Flow:** URL + API-Token eingeben → die Listen des Token-Besitzers
  (eigene + über Link beigetretene) werden gefunden. Tipp: eigenes Token
  für HA anlegen und die gemeinsame Einkaufsliste per Link beitreten lassen.
- **Je Liste eine `todo`-Entität** (`todo.shopping_einkauf`); die
  Hauptliste des Token-Besitzers ist als Attribut `default: true` markiert und Standardziel der Aktionen mit Features
  Erstellen, Ändern, Löschen, Verschieben, Beschreibung.
  - `summary` = Name, `description` = „500 g · bio“, `status` = abgehakt.
  - Neu angelegte Artikel laufen durch den Parser: „2 Liter Milch“ wird korrekt strukturiert.
- **Push statt Polling:** hält einen SSE-Stream offen → Änderungen sind in HA
  sofort sichtbar (`iot_class: cloud_push` bzw. `local_push`).
- **Sensoren:** offene Artikel pro Liste (für Dashboards/Automationen).
- **Eigene Aktionen (Services):**
  - `shopping.add_item` (name, quantity, unit, properties, note, list)
  - `shopping.apply_template` (template, list)
  - `shopping.import_mealie_recipe` (recipe, servings)
  - `shopping.clear_checked`
- **Sprachsteuerung gratis:** HA Assist versteht für To-do-Entitäten bereits
  „Füge Milch zur Einkaufsliste hinzu“ und „Was steht auf der Einkaufsliste?“.

### Beispiel-Automationen

```yaml
# Kaffeemaschine meldet "Bohnen leer" → auf die Liste
trigger: { platform: state, entity_id: binary_sensor.kaffeemaschine_bohnen_leer, to: "on" }
action:
  service: shopping.add_item
  data: { name: Kaffeebohnen, quantity: 1, unit: kg }   # ohne list → Hauptliste
```

```yaml
# Dashboard-Taste "Grillen" → Vorlage in die Hauptliste übernehmen
action:
  service: shopping.apply_template
  data: { template: Grillabend }
```

### Ausbaustufe

Ohne Custom Integration geht es zunächst auch mit HA-Bordmitteln
(`rest_command` + `rest`-Sensor), die Custom Integration ist aber das Ziel.
Sie lebt in eigenem Repo (`shopping-homeassistant`), damit HACS sie einbinden kann.
