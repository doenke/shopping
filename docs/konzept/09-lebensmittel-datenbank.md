# 09 – Lebensmittel-Datenbank

Der Katalog ist das Herz der Bring!-artigen Bedienung: Er liefert Icon,
Kategorie, Standard-Einheit und macht aus „kartofeln“ den Artikel
**Kartoffeln** 🥔.

## Aufbau

### `catalog_item`

| Feld | Beispiel |
|------|----------|
| `name`, `plural` | Kartoffel / Kartoffeln |
| `display_name_mode` | `plural` (Kacheln zeigen „Kartoffeln“) |
| `category_id` | Obst & Gemüse |
| `default_unit_id`, `default_quantity` | kg, – |
| `allowed_units` | kg, g, Netz, Stk |
| `typical_properties` | festkochend, mehligkochend, bio |
| `pantry` | false (Salz, Öl = true → beim Rezeptimport abgewählt) |
| `icon_id` | aktuelles Icon |
| `household_id` | `null` = globaler Katalog, sonst haushaltseigene Ergänzung |
| `mealie_food_id` | Verknüpfung |
| `list_type` | `shopping` (später `packing` für Packartikel) |

### `catalog_alias`
Synonyme, Schreibvarianten, Dialekt: *Erdapfel, Grumbeere, Kartoffel,
Kartoffeln* → Kartoffeln; *Paradeiser* → Tomaten; *Schlagsahne, Sahne*.

### `category`
Name, Farbe (für Kachelhintergrund), Standard-Reihenfolge, Icon.
Grundstock: Obst & Gemüse · Brot & Backwaren · Milch & Käse · Fleisch &
Fisch · Kühlregal · Tiefkühl · Nudeln, Reis & Getreide · Konserven ·
Gewürze & Öle · Backen · Frühstück & Süßes · Snacks · Getränke ·
Haushalt · Drogerie · Tier · Sonstiges.

Später: `store` + `store_category_order` für die Gangreihenfolge pro Laden.

## Befüllung

1. **Basis aus deiner Mealie-Zutatenliste** (`/api/foods`): Name, Plural,
   Aliase, Label. Labels werden per Mapping-Dialog auf Kategorien gemappt.
2. **Bereinigung** (einmalig, halbautomatisch, Admin-Ansicht):
   - Dubletten zusammenführen („Zwiebel“, „Zwiebeln“, „rote Zwiebel“ → Zwiebeln + Eigenschaft „rot“ ?)
   - Rezept-only-Zutaten markieren, die man nicht einkauft („Wasser“ → ausblenden)
   - Fehlende Kategorien zuordnen – Vorschläge per LLM (Batch, ein Durchlauf, vom Menschen bestätigt)
3. **Kuratierter Grundkatalog** (~400 gängige Artikel inkl. Drogerie/Haushalt,
   die in Mealie naturgemäß fehlen: Klopapier, Spülmittel, Batterien …),
   mitgeliefert als Seed-Datei im Repo.
4. **Lernen im Betrieb:** Freitext, der oft vorkommt, wird als Vorschlag
   „In Katalog aufnehmen?“ angeboten. Neue Katalogartikel können optional
   zurück nach Mealie als Food angelegt werden.

Der Abgleich mit Mealie läuft regelmäßig; neue Foods erscheinen automatisch,
Korb-eigene Änderungen (Kategorie, Icon) werden nicht überschrieben.

## Eingabe-Parser

Schnelle Eingabe ist am Laptop wie am Handy entscheidend. Ein Feld,
in das man tippt:

| Eingabe | Ergebnis |
|---------|----------|
| `Milch` | Milch |
| `2 l Milch` | Milch · 2 l |
| `Milch 2l laktosefrei` | Milch · 2 l · laktosefrei |
| `500g Hack gemischt bio` | Hackfleisch · 500 g · gemischt · bio |
| `3 Zwiebeln` | Zwiebeln · 3 Stk |
| `1/2 Bund Petersilie` | Petersilie · ½ Bund |
| `Tomaten (die kleinen)` | Tomaten · Notiz „die kleinen“ |
| `Kaffee, Butter, 6 Eier` | drei Artikel |

Vorgehen (deterministisch, läuft offline im Client, Code in `packages/shared`):

1. Aufteilen an Komma/Zeilenumbruch.
2. Menge erkennen (Zahlen, Dezimalkomma, Brüche, „ein/eine/zwei“).
3. Einheit erkennen über `unit` + `unit_alias`.
4. Bekannte Eigenschaften (`property`) und Klammerinhalte abtrennen.
5. Rest gegen Katalog matchen: exakt → Alias → Normalisiert (Kleinschreibung,
   Umlaute, Singular/Plural) → Fuzzy (Trigramm, Tippfehler) → sonst Freitext.
6. Unsicherer Treffer → Autocomplete zeigt Vorschläge statt still falsch zu raten.

Serverseitig steht derselbe Parser hinter `POST /api/v1/parse` (HA, MCP, API).
Optional kann für Rezeptzeilen der Mealie-Parser genutzt werden.

## Suche

- Client: lokaler Index über Name + Aliase (offline, sofort), Ranking nach
  eigener Nutzungshäufigkeit (`item_history`).
- Server: Postgres `pg_trgm` für API/MCP.
