# 12 – UX & Oberfläche

*Stand: Oktober 2026.*

**Kachel-Raster**, ein Tipp hinzufügen oder abhaken, „Zuletzt verwendet“ als schnelle
Nachkauf-Quelle – ergänzt um echte Mengen und Einheiten, vier Listentypen und eine
Laptop-Ansicht.

## Handy

```
┌─────────────────────────────┐
│ ☰  🛍 Einkauf       🛒   ⋮● │   Listen-Icon, Einkaufen-Modus, Menü mit Sync-Punkt
├─────────────────────────────┤
│ Was brauchst du?            │   eine Zeile für alles (Parser)
├─────────────────────────────┤
│ OBST & GEMÜSE               │   Kategorien in eigener Reihenfolge
│ ┌────┐ ┌────┐ ┌────┐        │
│ │ 🥔 │ │ 🍅 │ │ 🧅 │        │   Kacheln mit Icon, Name, Menge · Eigenschaften
│ │2 kg│ │    │ │ 3  │        │
│ └────┘ └────┘ └────┘        │
│ ▸ Zuletzt verwendet (12)    │   eingeklappt; Tipp = wieder auf die Liste
└─────────────────────────────┘
```

- **Eingabe:** Tippen zeigt Katalogtreffer als Kacheln mit ihren Icons; Enter übernimmt den
  geparsten Text („2 kg Kartoffeln“), auch mehrere mit Komma.
- **Zuhause / Einkaufen:** Zu Hause öffnet ein Tipp den Artikel (Editor), damit nichts versehentlich
  abgehakt wird. Im Laden 🛒: grüner Kopf, ein Tipp hakt ab („Rückgängig“ in der Leiste unten),
  Bildschirm bleibt an. Zurück auf Zuhause, wenn alles gekauft ist oder eine Stunde nichts abgehakt
  wurde. Pro Gerät gemerkt.
- **Editor** (Tipp zu Hause, langer Druck im Laden; am Handy 🗑 ✕ ✓ Speichern oben): Menge mit Einheit, Eigenschaften als Chips
  („Angebot“ zeigt die Kachel als rotes %-Abzeichen statt als Text)
  (Vokabular je Listentyp), Notiz, Kategorie (auch „+ Neue Kategorie …“), Person/Packstück bzw. Tipp von/Wo bzw. Wer/Bereich,
  ToDo: „+ Fälligkeit“, Herkunft („für Lasagne“), „hinzugefügt von Anna über Claude“.
  Unten „🛒 Auf Einkaufsliste setzen …“ (Packliste) und „◇ Auf Vorlage setzen …“: Liste wählen, übernehmen.
- **Teilen-Ziel:** Text aus einer anderen App „teilen“ → landet auf der Hauptliste.
- **Installieren:** Knopf in der Titelzeile, solange die App im Browser läuft (iPhone: Anleitung).

## Ansichten je Listentyp

| Typ | Ansicht |
|-----|---------|
| Einkauf | Kacheln nach Kategorien, „Zuletzt verwendet“ |
| Packliste | Kacheln, eingepackt bleibt durchgestrichen stehen oder wird ausgeblendet (Schalter, pro Liste und Gerät); Fortschritt „12 von 30 eingepackt“; gruppiert nach Kategorie, Packstück oder Person; erledigte Packliste ins Archiv |
| Merkliste | Kacheln mit eigenem Icon je Eintrag, Tipp von und Wo darunter; gruppiert nach Ort oder Tippgeber; „Erledigt“ eingeklappt |
| ToDo | Checkliste; ohne Fälligkeiten schlicht, mit Fälligkeiten gruppiert nach Überfällig / Heute / Diese Woche / Später, wahlweise nach Bereich oder Person; „Erledigt“ eingeklappt |

## Laptop

```
┌──────────────┬──────────────────────────────────┬──────────────────────┐
│ Shopping     │ 🛍 Wocheneinkauf      🛒 ⒷⒸⒶ ● ⋮ │ Obst & Gemüse ▾      │
│ + Neu        │ Was brauchst du?                 │ 🍍 🍎 🍑 🍆 🥑 🍌 …    │
│ ⭐ Einkauf 10 │ OBST & GEMÜSE                    │                      │
│ Baumarkt     │  🥔 Kartoffeln  🍎 Äpfel  🍌 …    │ Katalog zum          │
│ PACKLISTEN   │ MILCH & KÄSE                     │ Durchklicken         │
│ 🧳 Skiurlaub │  🥛 Milch  🥚 Eier  🧈 Butter     │                      │
│ TODO         │                                  │                      │
│  Arbeit      │                                  │                      │
│ ✅ Projekt X  │                                  │                      │
│ ↕ Listen sortieren                              │                      │
│ ⚙ Einstellungen                                 │                      │
└──────────────┴──────────────────────────────────┴──────────────────────┘
```

- Seitenleiste in Abschnitten (Einkauf, Packlisten, Merklisten, ToDo – dort nach Kategorien wie
  Arbeit oder Hobby –, Vorlagen, Archiv). Abschnitte und Listen in eigener Reihenfolge, per Ziehen
  sortierbar; das Listen-Icon ersetzt das Typ-Symbol.
- Rechts der Katalog des Listentyps zum Durchklicken.

## Listenmenü ⋮

| Eintrag | |
|---------|-|
| ✏️ Bearbeiten … | Name, Beschreibung, Kategorie (ToDo), Icon mit „Neues Icon erzeugen“ |
| 👥 Berechtigungen … | sichtbar für Haushalt oder nur mich, wer dabei ist (entfernen), Link teilen und erneuern |
| 📋 Als Text teilen … | offene Einträge als Text in den Teilen-Dialog bzw. die Zwischenablage |
| ↕ Kategorien sortieren … | Einkauf und Packliste |
| Aus Mealie hinzufügen … | Rezept oder Wochenplan |
| Mit Vorlage abgleichen … | in beide Richtungen; Richtung Vorlage anfangs nichts angehakt |
| Als Vorlage speichern, Archivieren, Als Hauptliste festlegen | je nach Typ |
| Liste verlassen / Liste löschen | Mitglied / Besitzer |

## Einstellungen

Eine kurze Übersicht wie in den Handy-Einstellungen: oben das Konto (Bild, Name, Haushalt, Abmelden),
darunter Gruppen mit je einer Zeile und dem aktuellen Stand – **Für mich** (Reihenfolge), **Haushalt**
(eigene Kategorien, Icons), **Verbindungen** (Mealie, API & Integrationen, Webhooks). Ein Tipp öffnet eine
eigene Seite (`#/settings/mealie` …) mit „‹ Einstellungen“ zurück.

## Neue Liste

Ein Knopf **„+ Neu“**: Typ (Einkauf, Packliste, Merkliste, ToDo), Name mit passendem Vorschlag,
Beschreibung, Kategorie (ToDo), aus Vorlage (Artikel einzeln wählbar, optionale vorab abgewählt),
„Als Vorlage anlegen“, privat (bei ToDo vorausgewählt).

## Mehrere Nutzer sichtbar machen

- Avatare aller mit Zugriff in der Titelzeile (am Handy im Listenmenü bei „Berechtigungen“, damit der
  Name Platz hat); ein Tipp öffnet „Berechtigungen“. Der Sync-Stand sitzt am Handy als Punkt am ⋮-Knopf
  und steht oben im Menü als Text.
- Fremd abgehakte Artikel: kurze Animation + „✓ von Anna“.

**Keine Benachrichtigungen:** kein Push, keine Mails, keine Badges auf dem App-Icon. Alles passiert
nur innerhalb der geöffneten App.

## Gestaltung

- Hell/Dunkel nach System, große Touch-Ziele (≥ 44 px), gut lesbar im grellen Supermarktlicht.
- Deutsch.
- Barrierefreiheit: Kacheln sind echte Buttons mit Beschriftung; Sortieren geht auch mit der
  Tastatur (Pfeiltasten am Griff).
