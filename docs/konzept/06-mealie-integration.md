# 06 – Mealie-Integration

## Ausgangslage: der heutige n8n-Flow „mealie2bring“

```
Mealie Notifier (Apprise jsons://)  ──►  n8n-Webhook
   bei Shopping-List-Events               │ Parse Event: document_data → shoppingListItemIds
                                          │   (nur konfigurierte Liste, keine deletes)
                                          │ Fetch Item: GET /api/households/shopping/items/{id}
                                          │ Build Payload: Name = food.pluralName|food.name|note
                                          │                Spezifikation = "Menge Einheit Notiz"
                                          │ Add to Bring (PUT bringlists/…)
                                          │ Mark Done in Mealie (PUT …/items, checked=true)
                                          └ Fehler → Matrix-Nachricht
```

Mealie-Einkaufsliste dient also als **Eingangskorb**: Was Mealie (Rezept →
„Zur Einkaufsliste hinzufügen“) dort ablegt, wird nach Bring geschoben und
in Mealie abgehakt. Dabei geht heute Struktur verloren: Menge und Einheit
landen als Text in der Bring-Spezifikation, das Lebensmittel als String.

> Nebenbefund: Im Flow steht das Bring-Passwort im Klartext in einem Node
> statt in einem n8n-Credential. Sollte man unabhängig von diesem Projekt
> ändern (Passwort rotieren, Credential nutzen).

## Ziel: dasselbe nativ – aber strukturiert

### Modus 1: Mealie-Liste als Eingangskorb (1:1-Ersatz für den Flow)

1. In Korb: *Einstellungen → Integrationen → Mealie* – URL + API-Token
   (Mealie: *Profil → API-Tokens*), Verbindung testen.
2. Mealie-Einkaufsliste wählen (Quelle) und Korb-Liste (Ziel).
3. Korb zeigt eine **Webhook-URL** `https://…/hooks/mealie/<secret>` und die
   fertige Apprise-URL zum Kopieren (`jsons://…`). Diese in Mealie unter
   *Haushalt → Benachrichtigungen* eintragen, Events „Einkaufsliste“ aktiv.
4. Ablauf bei einem Event:
   - Event parsen (`documentType = shopping_list_item`, `operation ≠ delete`,
     richtige `shoppingListId`) – wie im heutigen Flow;
   - Items per API holen, nur offene übernehmen;
   - **strukturiert** übernehmen: `food` → Katalogartikel (über
     `mealie_food_id`), `unit` → Einheit (über `mealie_unit_id`), `quantity`,
     `note` → Notiz/Eigenschaften, `recipeReferences` → Herkunft „für Lasagne“;
   - mit vorhandenen offenen Einträgen **zusammenführen** (Mengen addieren);
   - in Mealie abhaken (optional: löschen).
5. **Abgleich-Job als Sicherheitsnetz** (alle 15 min + Button „Jetzt
   abgleichen“): holt alle offenen Items der Quellliste. Fängt verlorene
   Webhooks ab (Server down, Netz weg). Idempotent über die Mealie-Item-ID.
6. Fehler → in der App sichtbar (Integrationsstatus) und optional an einen
   Webhook (z. B. weiter nach Matrix via n8n).

Damit entfällt der n8n-Flow.

### Modus 2: Rezept direkt übernehmen

- In Korb: „Aus Mealie hinzufügen“ → Rezeptsuche (Mealie-API) →
  Portionen anpassen → Zutaten-Checkliste („Salz hab ich“) → übernehmen.
- Zutaten kommen strukturiert (`recipeIngredient[].food/unit/quantity/note`);
  bei Rezepten ohne geparste Zutaten wird `originalText` durch den eigenen
  Parser geschickt (siehe [09](09-lebensmittel-datenbank.md)).
- Vorratsartikel (Salz, Pfeffer, Öl …) können im Katalog als „meist
  vorrätig“ markiert werden und sind im Dialog standardmäßig abgewählt.

### Modus 3: Wochenplan übernehmen

- „Wochenplan übernehmen“ → Zeitraum wählen → alle Rezepte aus dem
  Mealie-Mealplan → wie Modus 2, aber über alle Rezepte zusammengeführt.

### Optional: Rückmeldung an Mealie

Mealie kennt keinen „gekauft“-Status pro Rezept, daher standardmäßig
**kein** Rückkanal. Optional möglich: Beim Abhaken in Korb das ursprüngliche
Mealie-Item ebenfalls auf `checked` setzen, falls es (Modus „spiegeln“ statt
„verschieben“) noch existiert.

## Stammdaten aus Mealie

Einmaliger Import + regelmäßiger Abgleich:

| Mealie | Korb |
|--------|------|
| `GET /api/foods` (name, pluralName, aliases, label, description) | `catalog_item`, `catalog_alias` |
| `GET /api/units` (name, pluralName, abbreviation, aliases) | `unit`, `unit_alias` (gemappt auf eingebaute Einheiten) |
| Labels (`/api/groups/labels`) | `category` (Mapping-Dialog: Mealie-Label → Korb-Kategorie) |

Details zur Katalogpflege in [09](09-lebensmittel-datenbank.md).

## Technik

- Mealie-Client in `apps/server/integrations/mealie`, gegen Mealie v2
  (`/api/households/...`); Endpunkte beim Bau gegen die laufende
  Mealie-Version per OpenAPI (`/openapi.json`) verifizieren.
- Webhook-Endpunkt: kein Login, aber geheimer Pfad-Token + Rate-Limit;
  Payload wird nur als Hinweis genutzt – die Daten werden immer per
  authentifizierter API nachgeladen (Fälschung bringt nichts).
- Mealie-Token verschlüsselt in `integration.config`.
