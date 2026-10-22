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
| `source` | `seed` (Grundkatalog), `mealie`, `user` (in der App angelegt) |
| `mealie_food_id` | Verknüpfung |
| `list_type` | `shopping` (später `packing` für Packartikel) |

### `catalog_alias`
Synonyme, Schreibvarianten, Dialekt: *Erdapfel, Grumbeere, Kartoffel,
Kartoffeln* → Kartoffeln; *Paradeiser* → Tomaten; *Schlagsahne, Sahne*.

### `category`
Name, Farbe (für Kachelhintergrund), Reihenfolge, Icon.

**Kategorien wie bei Bring!** – das reicht für den Anfang:

| # | Kategorie | Beispiele |
|---|-----------|-----------|
| 1 | Obst & Gemüse | Äpfel, Tomaten, Kräuter |
| 2 | Brot & Gebäck | Brot, Brötchen, Toast |
| 3 | Milch & Käse | Milch, Joghurt, Butter, Eier, Käse |
| 4 | Fleisch & Fisch | Hack, Hähnchen, Lachs, Wurst |
| 5 | Zutaten & Gewürze | Mehl, Zucker, Öl, Salz, Brühe |
| 6 | Fertig- & Tiefkühlprodukte | TK-Erbsen, Pizza, Pesto |
| 7 | Getreideprodukte | Nudeln, Reis, Haferflocken, Müsli |
| 8 | Snacks & Süßwaren | Schokolade, Chips, Kekse |
| 9 | Getränke & Tabak | Wasser, Saft, Kaffee, Wein |
| 10 | Haushalt & Gesundheit | Spülmittel, Müllbeutel, Batterien |
| 11 | Pflege & Gesundheit | Zahnpasta, Duschgel, Pflaster |
| 12 | Tierbedarf | Katzenfutter |
| 13 | Baumarkt & Garten | Blumenerde, Glühbirnen |
| 14 | Eigene Artikel | Freitext ohne Katalogtreffer |

Die Reihenfolge ist in der App per Drag & Drop änderbar (eine Reihenfolge
für alle, kein Laden-Profil). Laden-spezifische Sortierung nur, falls das
später fehlt.

## Befüllung

1. **Basis aus deiner Mealie-Zutatenliste** (`/api/foods`): Name, Plural,
   Aliase, Label. Labels werden per Mapping-Dialog auf Kategorien gemappt.
2. **Bereinigung** (einmalig, halbautomatisch, Pflege-Ansicht in der App):
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
Shopping-eigene Änderungen (Kategorie, Icon) werden nicht überschrieben.

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
