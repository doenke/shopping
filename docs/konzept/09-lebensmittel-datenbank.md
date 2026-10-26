# 09 – Katalog & Eingabe-Parser

*Stand: Oktober 2026.*

Der Katalog ist das Herz der schnellen Bedienung: Er liefert Icon, Kategorie
und Standard-Einheit und macht aus „kartofeln“ den Artikel **Kartoffeln**.

## Aufbau (`catalog_items`)

| Feld | Beispiel |
|------|----------|
| `name`, `plural` | Kartoffel / Kartoffeln |
| `category_id` | `obst-gemuese` |
| `default_unit` | kg |
| `aliases` | Erdapfel, Grumbeere; Paradeiser → Tomaten |
| `pantry` | Salz, Öl = `true` → beim Rezeptimport vorab abgewählt |
| `kind` | `shopping` (Lebensmittel, Drogerie, Haushalt) oder `packing` (Dinge zum Einpacken) |
| `source` | `seed` (Grundkatalog), `mealie` |
| `mealie_food_id` | Verknüpfung zu Mealie |
| `hidden` | ausgeblendet (z. B. „Wasser“ aus Rezepten) |
| `category_locked` | Kategorie von Hand gesetzt, wird beim Mealie-Abgleich nicht überschrieben |
| `icon`, `icon_subject` | Versions-Token des Icons; englische Bildbeschreibung dafür |

Merk- und ToDo-Listen haben keinen Katalog – dort sind Einträge freier Text.

## Kategorien

Fest im Code (`packages/shared/src/categories.ts`), über alle Listentypen eindeutig:

| Listentyp | Kategorien |
|-----------|------------|
| Einkauf | Obst & Gemüse · Brot & Gebäck · Milch & Käse · Fleisch & Fisch · Zutaten & Gewürze · Fertig- & Tiefkühlprodukte · Getreideprodukte · Snacks & Süßwaren · Getränke & Tabak · Haushalt & Gesundheit · Pflege & Gesundheit · Tierbedarf · Baumarkt & Garten · Eigene Artikel |
| Packliste | Dokumente & Geld · Kleidung · Schuhe · Körperpflege · Reiseapotheke · Technik · Unterwegs & Proviant · Freizeit & Sport · Kinder · Ausrüstung · Sonstiges |
| Merkliste | Merkliste |
| ToDo | Aufgaben |

Jede Kategorie hat eine Farbe (Kachelhintergrund) und ein generiertes Icon. Die **Reihenfolge**
stellt sich jeder Nutzer selbst ein (z. B. nach dem Weg durch den Laden); sie gilt auf allen seinen
Geräten und auch in API und Home Assistant. Ladenprofile gibt es bewusst nicht.

## Befüllung

1. **Grundkatalog** im Repo (`seed-catalog.ts`): rund 290 gängige Einkaufsartikel inkl. Drogerie und
   Haushalt, rund 130 Packartikel – mit englischen Bildbeschreibungen für die Icons.
2. **Mealie**: Lebensmittel aus `/api/foods` (Name, Plural, Aliase, Label); Labels werden auf
   Kategorien abgebildet. Der Abgleich läuft regelmäßig, Shopping-eigene Änderungen bleiben.
3. **Im Betrieb**: Frei getippte Artikel ohne Katalogtreffer bleiben freier Text; sie bekommen trotzdem
   ein eigenes Icon (eins pro Name, siehe [10](10-icons-plan.md)). Die Kategorie lässt sich im Editor
   ändern, auf Wunsch „für alle“ (dann am Katalogartikel).

## Eingabe-Parser

Ein Feld für alles, am Laptop wie am Handy:

| Eingabe | Ergebnis |
|---------|----------|
| `Milch` | Milch |
| `2 l Milch` | Milch · 2 l |
| `Milch 2l laktosefrei` | Milch · 2 l · laktosefrei |
| `500g Hack gemischt bio` | Hackfleisch · 500 g · gemischt · bio |
| `3 Zwiebeln` | Zwiebeln · 3 |
| `1/2 Bund Petersilie` | Petersilie · ½ Bund |
| `Tomaten (die kleinen)` | Tomaten · Notiz „die kleinen“ |
| `Kaffee, Butter, 6 Eier` | drei Artikel |
| `3 T-Shirts @Anna #Koffer` (Packliste) | T-Shirts · 3 · für Anna · im Koffer |
| `Dune @Ben #Netflix` (Merkliste) | Dune · Tipp von Ben · bei Netflix |
| `Reifen wechseln !Fr @Ben #Auto` (ToDo) | fällig Freitag · Ben · Auto |

Vorgehen (deterministisch, offline im Client, Code in `packages/shared`):

1. Aufteilen an Komma und Zeilenumbruch.
2. `@…`, `#…` und (ToDo) `!…` als Person/Ort/Fälligkeit herausziehen.
3. Menge erkennen (Zahlen, Dezimalkomma, Brüche, „ein/eine/zwei“), dann die Einheit.
4. Bekannte Eigenschaften und Klammerinhalte abtrennen – das Vokabular hängt am Listentyp
   (Einkauf „bio“, Packliste „Handgepäck“, ToDo „dringend“; Merklisten erkennen keine, damit Titel
   wie „Der kleine Prinz“ ganz bleiben).
5. Rest gegen den Katalog des Listentyps: exakt → Alias → normalisiert (Kleinschreibung, Umlaute,
   Singular/Plural) → fuzzy (Trigramme, Tippfehler) → sonst freier Text.
6. Unsichere Treffer: die Vorschläge beim Tippen zeigen Kacheln zur Auswahl, statt still falsch zu raten.

Serverseitig steht derselbe Parser hinter `POST /api/v1/parse`, `add_items` (MCP) und den
Home-Assistant-Aktionen.

## Suche

Ein Index über Name und Aliase (`CatalogIndex`), offline im Client, gerankt nach eigener Nutzung;
derselbe Index läuft im Server für API und MCP.
