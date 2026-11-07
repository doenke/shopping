# Mealie

[← zurück zur README](../README.md)

Die Mealie-Anbindung gehört zum **Haushalt**: Wer sie einrichtet, richtet sie für alle darin ein, und jeder im
Haushalt kann sie ändern. Andere Haushalte verbinden ihr eigenes Mealie (oder keins). Gäste haben keins.

## Eingangskorb

Was in Mealie auf einer Einkaufsliste landet (von Hand, aus einem Rezept, aus dem Wochenplan), kommt
strukturiert in eine Shopping-Liste – mit Menge, Einheit, Kategorie und „für Chili“ – und wird in Mealie
abgehakt. Mit einer Mealie-Benachrichtigung passiert das sofort, ohne alle 15 Minuten.

Das ersetzt einen n8n-Flow, der auf Mealie-Benachrichtigungen (Apprise) reagiert: Shopping nimmt dieselben
Benachrichtigungen direkt entgegen.

### Einrichten

**In Shopping** (*Einstellungen → Mealie*):

1. **Adresse** von Mealie (z. B. `https://mealie.example.org`) und einen **API-Token** eintragen
   (in Mealie: *Profil → API-Tokens → Token erstellen*), **Speichern**, „Verbindung testen“.
2. **Eingangskorb einschalten**, die **Mealie-Liste** wählen, die geleert werden soll, und darunter, in
   welcher Shopping-Liste die Artikel **landen** (z. B. die Hauptliste). **Speichern**.
3. Darunter erscheint die **Apprise-URL**, z. B.
   `jsons://shopping.example.org/hooks/mealie/AbC…xyz` – mit **Kopieren** übernehmen.
   Sie enthält ein Geheimnis: nicht weitergeben. (`jsons://` bei https, `json://` bei http.)

**In Mealie** (*Einstellungen → Haushalt → Benachrichtigungen*, englisch *Notifiers*):

4. **Benachrichtigung erstellen**: Name z. B. „Shopping“, als **Apprise-URL** die kopierte URL einfügen,
   speichern. Mit „Test“ kommt in Shopping ein Abgleich an (leere Liste: „Eingangskorb leer“).
5. In der neuen Benachrichtigung bei **Einkaufslisten-Ereignissen** **Erstellt** und **Aktualisiert**
   einschalten (die übrigen Ereignisse aus), speichern. Neue Artikel auf einer Liste zählen in Mealie als
   „Einkaufsliste aktualisiert“.
6. Den **n8n-Flow abschalten** (bzw. seine Benachrichtigung in Mealie löschen) – sonst nehmen sich beide
   die Artikel.

### Gut zu wissen

- **Mealie muss Shopping erreichen.** Die URL zeigt auf `PUBLIC_URL`. Laufen beide im selben Docker-Netz,
  geht auch die interne Adresse, z. B. `json://shopping:3000/hooks/mealie/…` (`json://`, weil intern http).
- **Der Inhalt der Benachrichtigung ist egal**: Shopping liest bei jedem Anstoß die gewählte Mealie-Liste
  neu. Mehrere Benachrichtigungen kurz hintereinander (ein Rezept mit 15 Zutaten) ergeben einen Abgleich.
- **Das Abhaken in Mealie** löst selbst wieder „aktualisiert“ aus; der folgende Abgleich findet nichts
  Neues und tut nichts.
- **Nichts doppelt**: Jeder Mealie-Artikel wird genau einmal übernommen, auch wenn das Abhaken in Mealie
  einmal scheitert.
- **Ohne Benachrichtigung** (oder wenn eine verloren geht) gleicht Shopping alle 15 Minuten ab;
  „Jetzt abgleichen“ in den Einstellungen sofort. Der letzte Stand steht unter dem Formular.
- **Kein Rückweg**: Was in Shopping abgehakt wird, geht nicht an Mealie zurück.
- Die Apprise-URL bleibt dieselbe, auch wenn der Eingangskorb zwischendurch ausgeschaltet ist (dann nimmt
  Shopping Benachrichtigungen nur nicht an).

## Rezepte und Wochenplan

*⋮ → Aus Mealie hinzufügen …*: ein Rezept oder den Wochenplan eines Zeitraums. Portionen lassen sich
anpassen, die Zutaten kommen als Checkliste; Vorrat (Salz, Öl …) ist vorab abgewählt, gleiche Zutaten werden
zusammengefasst.

## Katalog

Lebensmittel aus Mealie werden in den Katalog übernommen, ihre Labels werden zu Kategorien. Mit Anthropic-Key
beschreibt Claude neue Artikel für die Icons.
