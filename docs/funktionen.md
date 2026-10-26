# Funktionen im Detail

[← zurück zur README](../README.md)

## Eingeben

- **Eine Eingabezeile für alles**: „2 kg Kartoffeln“, „500g Hack gemischt bio“, „Milch, Butter, 6 Eier“.
  Menge, Einheit und Eigenschaften werden erkannt, mehrere Artikel mit Komma.
- **Doppelte Artikel** werden zusammengeführt (1 l + 2 l Milch = 3 l); zuletzt gekaufte kommen zurück
  auf die Liste statt doppelt.
- **Eigenschaften je Listentyp**: Einkauf „bio“, „TK“, „festkochend“ …; Packliste „Handgepäck“,
  „aufladen“, „kaufen“, „leihen“ …; ToDo „wichtig“, „dringend“, „Hilfe nötig“ …; Merkliste „Highlight“,
  „zu zweit“, „Kino“ …. Merklisten erkennen keine Eigenschaften im Text – „Der kleine Prinz“ bleibt der Titel.
- **Lebensmittel-Katalog** mit Grundkatalog und Import aus Mealie (Labels werden zu Kategorien). Am Laptop
  steht rechts der Katalog zum Durchklicken.

## Einkaufen

- **Kategorien** nach Supermarkt-Bereichen; die Reihenfolge stellt sich jeder selbst ein (z. B. nach dem
  Weg durch den Laden): *⋮ → Kategorien sortieren …* oder *Einstellungen → Reihenfolge*. Sie gilt auf allen
  eigenen Geräten und auch in API und Home Assistant.
- **🏠 Zuhause / 🛒 Einkaufen** (pro Gerät): Zu Hause öffnet Antippen den Artikel, statt ihn abzuhaken.
  Im Einkaufen-Modus (Knopf 🛒 in der Titelzeile, grüner Kopf) hakt Antippen ab und der Bildschirm bleibt an.
  Zurück auf Zuhause geht es von selbst, wenn alles gekauft ist oder eine Stunde nichts abgehakt wurde.
- **Hauptliste** ⭐: die Liste, die ohne weitere Angabe gemeint ist (Teilen aus anderen Apps, Home
  Assistant, KI-Assistenten).
- **Zuletzt verwendet**: Gekauftes wandert nach unten und lässt sich mit einem Tipp zurückholen.

## Listen

- **Eine Schaltfläche „+ Neu“** für alles: Name, Typ (Einkauf, Packliste, Merkliste, ToDo), Vorlage,
  „Als Vorlage anlegen“, privat, Beschreibung, bei ToDo-Listen die Kategorie.
- **Vorlagen** (◇) für jeden Listentyp: nicht abhakbar, füllen neue Listen vor, „Als Vorlage speichern“,
  optionale Artikel. **Mit Vorlage abgleichen** in beide Richtungen: was der Liste fehlt, was der Vorlage
  fehlt und abweichende Mengen – einzeln auswählbar; die Liste merkt sich ihre Vorlage.
- **Packlisten** 🧳 mit eigenem Katalog (Kleidung, Dokumente, Technik …): Abgehakt heißt „eingepackt“ und
  bleibt durchgestrichen stehen, Fortschritt „12 von 30 eingepackt“, gruppiert nach Kategorie, **Packstück**
  oder **Person**. Beim Tippen ordnen „@Anna“ und „#Koffer“ zu („3 T-Shirts @Anna #Koffer“). Neue Packlisten
  entstehen aus Packvorlagen, erledigte kommen ins Archiv.
- **Merklisten** 📌 für Filme, Bücher, Restaurants …: mit **Tipp von** und **Wo** („Dune @Ben #Netflix“),
  gruppierbar nach Ort oder Tippgeber; Erledigtes (gesehen, gelesen, besucht) bleibt unter „Erledigt“. Die
  Beschreibung der Liste („Filme und Serien, die wir sehen wollen“) hilft beim Icon jedes Eintrags.
- **ToDo-Listen** ✅ (standardmäßig **privat**): Aufgaben mit **Fälligkeit** („!morgen“, „!Fr“, „!12.11.“),
  **Wer** („@Ben“) und **Bereich** („#Garten“), gruppiert nach Fälligkeit (Überfällig, Heute, Diese Woche …),
  Bereich oder Person. Die Listen selbst lassen sich in **Kategorien** ordnen (Arbeit, Hobby, Urlaub …; beim
  Anlegen oder *⋮ → Kategorie …*) und stehen in der Seitenleiste darunter gruppiert.
- **Reihenfolge der Listen** in der Seitenleiste: *↕ Listen sortieren*, je Benutzer.
- **Wer ist dabei?** zeigt in der Titelzeile die Avatare aller mit Zugriff; ein Tipp öffnet die Liste der
  Mitglieder.

## Zusammenarbeiten

- **Echtzeit**: Abhaken erscheint bei anderen in etwa 0,1 s, mit „✓ von Anna“.
- **Offline-first**: lokale Datenbank im Browser, Änderungen werden gepuffert und nachgeliefert (auch per
  Background Sync, wenn die App schon zu ist).
- **Haushalte, Teilen, Gäste**: siehe [haushalte-und-teilen.md](haushalte-und-teilen.md).
- Was über ein Token oder einen KI-Assistenten hinzukommt, ist gekennzeichnet („hinzugefügt von Anna über
  Claude“).

## App

- **PWA**: installierbar (Knopf „Installieren“ in der Titelzeile, auf dem iPhone mit Anleitung), läuft
  offline. Neue Versionen kommen von selbst an, sobald die App wieder in den Vordergrund kommt.
- **Profilbilder** aus Pocket ID bei Mitgliedern, „✓ von …“ und „Hinzugefügt von“ (lokale Kopie, auch offline).
- **Icons**: generierte Icons im einheitlichen Stil für Artikel, Kategorien, Einträge und Listen, offline
  verfügbar – siehe [icons.md](icons.md).
- **Am Laptop** drei Spalten: Listen, Liste, Katalog.

## Anbindungen

- **Mealie**: Eingangskorb, Rezepte, Wochenplan – siehe [mealie.md](mealie.md).
- **Home Assistant**: To-do-Listen, Sensoren, Aktionen – siehe [home-assistant.md](home-assistant.md).
- **REST-API, MCP-Server, Webhooks**: siehe [api-und-ki.md](api-und-ki.md).
