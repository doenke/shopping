# 12 – UX & Oberfläche

Vorbild Bring!: **Kachel-Raster**, ein Tipp = hinzufügen/abhaken,
„Zuletzt verwendet“ als schnelle Nachkauf-Quelle. Ergänzt um echte
Mengen/Einheiten und eine Laptop-taugliche Ansicht.

## Handy (Fokus Android)

```
┌─────────────────────────────┐
│ ☰  Einkauf ▾        ☁✓  👤 │   Listenwahl, Sync-Status
├─────────────────────────────┤
│ 🔍 Was brauchst du?         │   Suche/Eingabe mit Parser
├─────────────────────────────┤
│ Obst & Gemüse               │
│ ┌────┐ ┌────┐ ┌────┐        │
│ │ 🥔 │ │ 🍅 │ │ 🧅 │        │   Kacheln, nach Kategorie gruppiert
│ │Kart│ │Toma│ │Zwie│        │
│ │2 kg│ │    │ │3 St│        │
│ └────┘ └────┘ └────┘        │
│ Milch & Käse                │
│ ┌────┐ ┌────┐               │
│ │ 🥛 │ │ 🧀 │               │
│ └────┘ └────┘               │
├─────────────────────────────┤
│ Zuletzt verwendet  ▸        │   eingeklappt; Tipp = wieder auf Liste
└─────────────────────────────┘
```

- **Tipp auf Kachel** = abhaken (Kachel animiert raus, „Rückgängig“-Snackbar).
- **Langer Druck** = Details: Menge (Stepper + Einheitenwahl), Eigenschaften
  (Chips), Notiz, Kategorie, Herkunft („für Lasagne“).
- **Eingabe:** Tippen zeigt Katalogtreffer als Kacheln; Enter übernimmt den
  geparsten Text („2 kg Kartoffeln“).
- **Einkaufsmodus** (optional, automatisch beim Abhaken): Bildschirm bleibt an
  (Wake Lock), große Kacheln, Bearbeiten-Funktionen ausgeblendet.
- Daumenfreundlich: wichtige Aktionen unten, Wischen zwischen Listen.
- Teilen-Ziel: Text aus anderer App „teilen“ → landet als Artikel(liste).

## Laptop

```
┌──────────────┬──────────────────────────────────┬──────────────────────┐
│ Listen       │ Einkauf                ☁✓        │ Katalog / Mealie     │
│ ● Einkauf  12│ 🔍 Hinzufügen… (Strg+K)           │ 🔍 Suche             │
│ ○ Drogerie  3│                                  │ Obst & Gemüse        │
│ ○ Getränke   │ Obst & Gemüse                    │ 🍎 🍌 🥕 🥦 🍋 …      │
│              │  🥔 Kartoffeln   2 kg  festk.  ⋯ │                      │
│ Vorlagen     │  🍅 Tomaten            klein  ⋯  │ Mealie ▸ Rezepte     │
│ ◇ Basis      │  🧅 Zwiebeln     3 Stk        ⋯  │        ▸ Wochenplan  │
│ ◇ Grillen    │ Milch & Käse                     │                      │
│              │  🥛 Milch        2 l  laktosefr. │ Zuletzt verwendet    │
│ Später:      │                                  │ 🧈 🥚 ☕ …            │
│ Packlisten   │                                  │                      │
└──────────────┴──────────────────────────────────┴──────────────────────┘
```

- Drei Spalten, Liste wahlweise als **Kacheln** oder **kompakte Tabelle**
  (Inline-Bearbeitung von Menge/Einheit).
- Tastatur: `Strg+K` Eingabe, `↑/↓` navigieren, `Leertaste` abhaken,
  `E` bearbeiten, `Entf` löschen, `Strg+Z` rückgängig.
- Drag & Drop von Katalog/„Zuletzt verwendet“ in die Liste und zwischen Listen.
- Mehrfachauswahl (z. B. 5 Artikel in die Drogerie-Liste verschieben).

## Vorlagen in der UI

- Eigene Rubrik in der Seitenleiste, Raute-Symbol ◇, keine Checkboxen.
- „Neue Liste“ → Dialog: leer oder aus Vorlage; Vorschau mit Haken zum
  Ab-/Anwählen einzelner Artikel (optionale Artikel vorab abgewählt).
- In jeder Liste: „Vorlage hinzufügen“.

## Mehrere Nutzer sichtbar machen

- Avatare der gerade aktiven Personen in der Liste („Anna ist im Laden“).
- Fremd abgehakte Artikel: kurze Animation + „✓ von Anna“.
- Neu von anderen hinzugefügt: dezenter Punkt an der Kachel bis zum Ansehen.

## Gestaltung

- Hell/Dunkel nach System, große Touch-Ziele (≥ 48 px), gut lesbar im
  grellen Supermarktlicht (hoher Kontrast).
- Sprache: Deutsch zuerst, i18n von Anfang an vorgesehen.
- Barrierefreiheit: Kacheln sind echte Buttons mit Beschriftung,
  Screenreader-Ansage „Kartoffeln, 2 Kilogramm, abgehakt“.
