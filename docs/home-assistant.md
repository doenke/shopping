# Home Assistant

[← zurück zur README](../README.md)

## Installieren

1. In der App: *Einstellungen → API & Integrationen* ein Token mit „Lesen“ und „Ändern“ erzeugen (für
   Mealie-Aktionen zusätzlich „Mealie-Import“).
2. HACS → ⋮ → *Benutzerdefinierte Repositories* → diese URL eintragen, Typ **Integration**:

   ```
   https://github.com/doenke/shopping
   ```

   Dann „Shopping“ in HACS suchen, installieren und Home Assistant neu starten.
3. *Einstellungen → Geräte & Dienste → Integration hinzufügen → Shopping*: Adresse und Token.
4. Bei der Integration **„Liste hinzufügen“** – für jede Liste, die du in Home Assistant brauchst. Es wird
   nichts automatisch angelegt; entfernen geht über ⋮ bei der Liste.

Voraussetzung ist Home Assistant 2025.6; das Integrations-Icon zeigt Home Assistant ab 2026.3.

## Was du bekommst

Jede hinzugefügte Liste wird eine **To-do-Liste** (`todo.einkauf`) plus **Sensor** mit der Zahl offener
Artikel. Änderungen kommen per Push sofort an. Über Assist geht „Füge Milch zur Einkaufsliste hinzu“; freier
Text läuft durch denselben Parser wie in der App („2 Liter Milch“ wird Milch · 2 l). ToDo-Listen haben
Fälligkeitsdaten, bei ToDo- und Merklisten ist die Notiz die Beschreibung.

Wer die Integration schon vor „Liste hinzufügen“ eingerichtet hatte, behält seine bisherigen Listen mit
denselben Entitäten; neue kommen nur noch von Hand dazu.

Die Home-Assistant-Instanz sieht dieselben Listen wie der Benutzer, dem das Token gehört – in dessen
Reihenfolge.

## Aktionen

| Aktion | Was sie tut |
| --- | --- |
| `shopping.add_items` | Artikel als freien Text hinzufügen („2 l Milch“) |
| `shopping.apply_template` | Eine Vorlage auf eine Liste übernehmen |
| `shopping.import_mealie_recipe` | Zutaten eines Mealie-Rezepts auf die Liste |
| `shopping.import_mealie_mealplan` | Zutaten aller Rezepte eines Zeitraums |
| `shopping.clear_checked` | „Zuletzt verwendet“ leeren |

Die Liste wird per Name oder ID angegeben, leer heißt Hauptliste.

## Updates

Die Integration erscheint in HACS als Release `v…` mit eigener Versionsnummer; ein neues Release gibt es nur,
wenn sich die Integration geändert hat.
