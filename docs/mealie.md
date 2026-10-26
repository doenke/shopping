# Mealie

[← zurück zur README](../README.md)

## Eingangskorb

Was in Mealie auf der Einkaufsliste landet, kommt strukturiert (Menge, Einheit, Kategorie, „für Chili“) in
die Zielliste und wird in Mealie abgehakt – per Notifier sofort, sonst alle 15 Minuten. Das ersetzt einen
n8n-Flow für Mealie-Einkaufslisten.

1. *Einstellungen → Mealie*: Adresse und API-Token eintragen, speichern.
2. *Eingangskorb einschalten*, Mealie-Einkaufsliste und Zielliste wählen, speichern.
3. Die angezeigte Apprise-URL in Mealie unter *Haushalt → Benachrichtigungen* als Notifier eintragen,
   Ereignis *Einkaufsliste* aktivieren.
4. Einen bisherigen n8n-Flow für Mealie-Einkaufslisten abschalten.

## Rezepte und Wochenplan

*⋮ → Aus Mealie hinzufügen …*: ein Rezept oder den Wochenplan eines Zeitraums. Portionen lassen sich
anpassen, die Zutaten kommen als Checkliste; Vorrat (Salz, Öl …) ist vorab abgewählt, gleiche Zutaten werden
zusammengefasst.

## Katalog

Lebensmittel aus Mealie werden in den Katalog übernommen, ihre Labels werden zu Kategorien. Mit Anthropic-Key
beschreibt Claude neue Artikel für die Icons.
