# 06 – Mealie-Integration

*Stand: Oktober 2026.*

## Ausgangslage

Vorher lief ein n8n-Flow: Mealie meldete per Notifier (Apprise `jsons://`)
Änderungen an seiner Einkaufsliste, der Flow holte die Artikel, schob sie als
Text in eine andere Listen-App und hakte sie in Mealie ab. Dabei ging Struktur
verloren – Menge und Einheit landeten als Text, das Lebensmittel als String.

Die Mealie-Einkaufsliste ist dabei nur ein **Eingangskorb**: Was Mealie
(Rezept → „Zur Einkaufsliste hinzufügen“) dort ablegt, soll in die eigentliche
Einkaufsliste wandern.

## Eingangskorb (ersetzt den n8n-Flow)

1. *Einstellungen → Mealie*: Adresse und API-Token (Mealie: *Profil → API-Tokens*).
2. Mealie-Einkaufsliste wählen (Quelle) und **eine** Zielliste – vorbelegt mit der Hauptliste.
   Die Integration gehört dem Nutzer, der sie einrichtet, und schreibt nur in Listen, auf die er
   Zugriff hat.
3. Shopping zeigt die fertige Apprise-URL (`jsons://…/hooks/mealie/<secret>`); sie kommt in Mealie
   unter *Haushalt → Benachrichtigungen*, Ereignis „Einkaufsliste“.
4. Bei jedem Ereignis liest Shopping die Mealie-Liste **komplett** neu (der Webhook ist nur ein
   Anstoß, gefälschte Payloads bringen nichts) und übernimmt offene Artikel **strukturiert**:
   `food` → Katalogartikel (über `mealie_food_id`), `unit` → Einheit, `quantity`, `note` → Notiz,
   `recipeReferences` → Herkunft „für Lasagne“. Gleiches wird zusammengeführt, danach wird in
   Mealie abgehakt.
5. **Abgleich alle 15 Minuten** als Sicherheitsnetz (verlorene Webhooks, Server war aus).
   Jeder Mealie-Artikel bekommt eine feste ID; auch doppelte Webhooks oder ein gescheitertes
   Abhaken in Mealie erzeugen kein Duplikat.
6. Fehler sind nur in der App sichtbar (Status in den Einstellungen) – keine Benachrichtigung.

## Rezept und Wochenplan

- *⋮ → Aus Mealie hinzufügen …* → Rezept suchen → Portionen anpassen → Zutaten-Checkliste
  („Salz hab ich“) → übernehmen.
- Zutaten kommen strukturiert; Rezepte ohne geparste Zutaten laufen durch den eigenen Parser.
- Vorratsartikel (Salz, Pfeffer, Öl … – im Katalog als `pantry` markiert) sind vorab abgewählt.
- Beim Skalieren werden Stück und Packungen aufgerundet (¾ Dose → 1 Dose).
- Wochenplan: Zeitraum wählen → alle Rezepte des Mealie-Mealplans, Zutaten über alle Rezepte
  zusammengeführt.
- Dasselbe geht über REST, MCP und Home Assistant (`import_mealie_recipe`, `import_mealie_mealplan`).

## Kein Rückkanal

Mealie bleibt reiner Eingangskorb: Übernommene Artikel werden in Mealie abgehakt, danach gibt es
keine Verbindung mehr. Abhaken in Shopping wirkt nicht zurück, Listen werden nicht gespiegelt.

## Stammdaten aus Mealie

Lebensmittel aus Mealie (`/api/foods`: Name, Plural, Aliase, Label) werden in den Katalog übernommen,
Labels auf Kategorien abgebildet. Shopping-eigene Änderungen (Kategorie, Icon) werden beim Abgleich
nicht überschrieben. Mit Anthropic-Key beschreibt Claude neue Artikel für die Icons.

## Technik

- Mealie **v2** (`/api/households/...`).
- Webhook-Endpunkt ohne Login, aber mit geheimem Pfad-Token; Daten werden immer per
  authentifizierter API nachgeladen.
- Mealie-Token verschlüsselt in `integrations.config`.
