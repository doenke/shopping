# Funktionen im Detail

[← zurück zur README](../README.md)

| Listentyp | Wofür | Abgehakt heißt |
| --- | --- | --- |
| 🛒 Einkauf | Wocheneinkauf, Baumarkt, Drogerie | gekauft |
| 🧳 Packliste | Urlaub, Wochenende, Sport | eingepackt |
| 📌 Merkliste | Filme, Bücher, Restaurants | gesehen, gelesen, besucht |
| ✅ ToDo | Aufgaben, privat oder für die Arbeit | erledigt |

## Eingeben

- **Eine Eingabezeile für alles**: „2 kg Kartoffeln“, „500g Hack gemischt bio“, „Milch, Butter, 6 Eier“.
  Menge, Einheit und Eigenschaften werden erkannt, mehrere Einträge trennt ein Komma. Wird etwas nur über
  ein Synonym gefunden („Stirnlampe“ → Taschenlampe), gibt es zusätzlich eine Kachel mit genau dem Getippten.
- **Zeichen mit Bedeutung**:

  | Eingabe | Einkauf / Packliste | Merkliste | ToDo |
  | --- | --- | --- | --- |
  | `@Anna` | für Anna | Tipp von Anna | Anna kümmert sich |
  | `@Sönke @Ulli` | ein Eintrag für beide, pro Person abgehakt | – | wie links |
  | `@alle` | in Vorlagen: für jeden (siehe unten) | – | wie links |
  | `#Koffer` | Packstück | Wo („#Netflix“) | Bereich („#Garten“) |
  | `!Fr`, `!morgen`, `!12.11.` | – | – | fällig am |
  | `https://…` | Link am Eintrag | Link am Eintrag | Link am Eintrag |

- **Liste einfügen**: eine kopierte Zutaten- oder Einkaufsliste (mehrere Zeilen) einfügen – jede Zeile wird
  ein Eintrag mit Menge, Einheit und Notiz; vorher lässt sie sich noch bearbeiten.
- **Rezept aus dem Web** (Chefkoch, Lecker, EAT SMARTER, BBC Good Food …): den Link des Rezepts in die
  Eingabezeile einer Einkaufsliste einfügen oder *Teilen → Shopping* wählen. Shopping liest die Zutaten aus
  den Rezeptdaten der Seite und zeigt sie als Checkliste: Portionen anpassen, Vorrat wie Salz und Öl ist
  vorab abgewählt. Ohne Rezept auf der Seite gibt es „Als Eintrag mit Link hinzufügen“.
- **Spracheingabe**: 🎤 in der Eingabezeile, „zwei Liter Milch und Butter“ – auf Einkaufs- und Packlisten
  wird „und“ zum Trenner (Chrome/Android, Safari; braucht Netz).
- **Doppelte Einträge** werden zusammengeführt (1 l + 2 l Milch = 3 l); zuletzt gekaufte kommen zurück statt
  doppelt.
- **Eigenschaften je Listentyp**: Einkauf „bio“, „TK“, „festkochend“; Packliste „Handgepäck“, „aufladen“,
  „leihen“; ToDo „wichtig“, „dringend“; Merkliste „Highlight“, „Kino“. Merklisten erkennen keine Eigenschaften
  im Text – „Der kleine Prinz“ bleibt der Titel.

## Einkaufslisten

- **Kategorien** nach Supermarkt-Bereichen, in der eigenen Reihenfolge (z. B. dem Weg durch den Laden):
  *⋮ → Bearbeiten … → Kategorien sortieren …* oder *Einstellungen → Reihenfolge*; gilt auf allen eigenen
  Geräten, in der API und in Home Assistant.
- **Eigene Kategorien** (auch für Packlisten, z. B. „Angeln“, „Asia-Laden“): im Editor über
  *Kategorie → + Neue Kategorie …* oder unter *Einstellungen → Eigene Kategorien*; gelten für den Haushalt.
- **Automatisch einsortiert**: Neues, das nicht im Katalog steht, landet nach wenigen Sekunden in der
  passenden Kategorie (wie beim letzten Mal, sonst gewählt von Claude Haiku; abschaltbar).
- **Lernender Katalog** mit Grundkatalog und Import aus Mealie: Was du von Hand einträgst, wird beim nächsten
  Tippen vorgeschlagen. Am Laptop steht rechts der Katalog zum Durchklicken.
- **🏠 Zuhause / 🛒 Einkaufen** (pro Gerät): Zu Hause öffnet Antippen den Eintrag; im Einkaufen-Modus
  (🛒 in der Titelzeile) hakt Antippen ab und der Bildschirm bleibt an. Zurück geht es von selbst, wenn
  alles gekauft ist oder eine Stunde nichts passiert.
- **Hauptliste** ⭐: die Liste, die ohne weitere Angabe gemeint ist (Teilen aus anderen Apps, Home Assistant,
  KI-Assistenten).
- **Zuletzt verwendet**: Gekauftes wandert nach unten und lässt sich mit einem Tipp zurückholen. Pro Liste
  bleiben die letzten 100 erledigten Einträge (auch in Merk- und ToDo-Listen).
- **Kacheln oder Liste** (runder Knopf neben dem Eingabefeld): am Handy startet die Liste, am Laptop die
  Kacheln; die Wahl merkt sich jedes Gerät.

## Packlisten

- Eigener Katalog (Kleidung, Dokumente, Technik …). Abgehakt bleibt durchgestrichen stehen („Eingepackte
  ausblenden“ pro Liste), Fortschritt „12 von 30 eingepackt“, gruppiert nach Kategorie, **Packstück** oder
  **Person**. Neue Packlisten entstehen aus Packvorlagen, fertige kommen ins Archiv.
- **Auf die Einkaufsliste** (oder eine Vorlage): im Editor *🛒 Auf Einkaufsliste setzen …* – mit passender
  Lebensmittel-Kategorie und dem Vermerk, für welche Packliste.

## Merklisten

- Für Filme, Bücher, Restaurants: **Tipp von** und **Wo** („Dune @Ben #Netflix“), gruppierbar nach Ort oder
  Tippgeber; Erledigtes bleibt unter „Erledigt“. Die Beschreibung der Liste („Filme und Serien, die wir sehen
  wollen“) hilft beim Icon jedes Eintrags.

## ToDo-Listen

- Standardmäßig **privat**. Aufgaben mit **Fälligkeit**, **Wer** und **Bereich**, gruppiert nach Fälligkeit
  (Überfällig, Heute, Nächste 7 Tage, Später), Bereich, Person oder Status.
- **Kategorien** für die Listen selbst (Arbeit, Hobby, Urlaub …), beim Anlegen oder unter *⋮ → Bearbeiten …*;
  die Seitenleiste gruppiert danach.
- **Wiederkehrend** ↺ (z. B. „Haus verlassen“): *⋮ → ↺ Alles zurücksetzen* öffnet alles wieder (auch in
  Packlisten); bei ToDo-Listen optional automatisch – täglich, wöchentlich (montags) oder monatlich (am 1.),
  um Mitternacht deutscher Zeit. Zurückgesetzte Aufgaben stehen wieder im Standard-Status, auch teilweise
  abgehakte für mehrere Personen.
- **Status** (*⋮ → Bearbeiten …*): eigene Status anlegen und sortieren (Vorschlag: Neu · In Arbeit · Wartet)
  und einen **Standard** wählen, den jeder neue Eintrag bekommt; wechselt der Standard, behalten bestehende
  Aufgaben ihren. „Erledigt“ ist der Haken, kein Status. Ein Klick auf die Status-Pille in der Liste zeigt alle
  Status untereinander zur Auswahl. Umbenennen verliert nichts (gespeichert wird pro Eintrag; REST/MCP:
  `status`; in Aufgaben-Apps „in Bearbeitung“, siehe [api-und-ki.md](api-und-ki.md)).

### Tabelle und Kanban

Jede ToDo-Liste erscheint als **Tabelle** (Status, Fällig, Wer, Bereich, Link – nur die Spalten, die eine
Aufgabe nutzt). Am Rechner steht die gewählte Aufgabe rechts zum direkten Bearbeiten, auf dem Handy sind die
Zeilen kompakt (Angaben in einer zweiten Zeile) und ein Tipp öffnet die Aufgabe als eigene Seite.

**Design:** Alle Listen teilen ein ruhiges, neutrales Grundgerüst (hell/dunkel nach System). Jeder Listentyp
hat eine eigene Akzentfarbe – Einkauf grün, Packliste blau, Merkliste ocker, ToDo blaugrau –, die Kacheln
sind in der Farbe ihrer Kategorie getönt.

Listen mit Status bekommen oben rechts den Umschalter *Tabelle | Kanban* (pro Liste gemerkt; ohne Status
gibt es nur die Tabelle). Im **Kanban** ist jeder Status eine Spalte:

- Karten zeigen Fälligkeit, Bereich, Personen und Link.
- **Ziehen** (Maus oder Stift) in eine andere Spalte setzt den Status; innerhalb einer Spalte ändert es die
  Reihenfolge – eine Linie zeigt, wo die Karte landet. Die Reihenfolge gilt für alle.
- **Tastatur**: `Alt+←/→` in die Nachbarspalte, `Alt+↑/↓` einen Platz hoch/runter, Leertaste hakt ab.
- Ein Klick wählt eine Karte nur aus; Doppelklick oder Enter öffnet rechts die Details (✕ oder Esc schließt).
- **„Erledigt“ als Spalte** (die 30 neuesten) nur mit dem Haken *Erledigte als Spalte im Kanban-Board
  anzeigen* in den Listeneinstellungen; sonst verlassen erledigte Karten das Board. Aus „Erledigt“
  zurückgezogen ist eine Aufgabe wieder offen.

### Arbeitsmodus

💼 unten in der Seitenleiste (angeboten, solange eine ToDo-Liste offen ist) oder `Strg+Shift+A` (pro Gerät
gemerkt) blendet Listen aus: Seitenleiste, Suche
und Start zeigen nur noch die ToDo-Listen der Kategorie „Arbeit“ (umstellbar auf alle ToDo-Listen). Neue
Listen sind dann ToDo-Listen in „Arbeit“, oben links steht „To-Do“. Die installierte App bietet per
Rechtsklick aufs Taskleisten-Icon „Arbeitsmodus“ und „Einkaufslisten“ als Sprungziele.

## Für alle Listen

- **„+ Neu“** für alles: Name, Typ, eine oder **mehrere Vorlagen** (z. B. „Basis“ + „Ski“ + „Kinder“; was in
  mehreren steht, kommt einmal), „Als Vorlage anlegen“, privat, Beschreibung, bei ToDo-Listen die Kategorie.
- **Vorlagen** (◇): nicht abhakbar, füllen neue Listen vor, optionale Einträge. *Mit Vorlage abgleichen* in
  beide Richtungen (was fehlt, abweichende Mengen – einzeln auswählbar). In einer Liste aus Vorlagen fragt die
  Eingabezeile nach dem Hinzufügen, ob das Neue auch in eine Vorlage soll („Nicht mehr fragen“ möglich).
- **Ein Eintrag für mehrere Personen** 👥 (Einkauf, Packliste, ToDo): „Sonnenbrille @Sönke @Ulli“ ist *ein*
  Eintrag mit den Initialen beider; ein Tipp fragt „Für wen?“, „Alle“ hakt alle ab. Gruppiert nach Person
  steht er bei jeder Person einzeln. Kommt jemand dazu, wird der Eintrag erweitert. In Vorlagen heißt es
  „für jeden“ („@alle“): Beim Anlegen aus der Vorlage fragt „+ Neu“, für wen die Liste ist (vorausgewählt:
  der eigene Haushalt). Gleichzeitiges Abhaken von zwei Handys überschreibt sich nicht.
- **Links** 🔗: im Text („Dune https://…“) oder im Editor (*Link*, mit „Öffnen“). Die Kachel zeigt ein 🔗,
  ein Tipp darauf öffnet die Seite, ohne abzuhaken. Nur ein Link eingetippt: Der Eintrag heißt wie die Seite.
  Am Laptop lassen sich Links und Browser-Tabs **auf die Liste ziehen** – auf einen Eintrag (bekommt den Link)
  oder auf freie Fläche (neuer Eintrag).
- **Mehrere markieren und verschieben** (am Rechner): `Shift` + Pfeiltasten oder Shift-/Strg-Klick markiert
  mehrere Einträge. Markierte (oder ein einzelner) lassen sich **auf eine Liste in der Seitenleiste ziehen**
  oder mit `V` („Verschieben nach …“) in eine andere Liste verschieben, im Kanban mit `Alt` + Pfeiltasten in
  die Nachbarspalte; `Entf` löscht alle, `Esc` hebt die Markierung auf. Verschieben und Löschen lassen sich
  rückgängig machen. Der Status bleibt dabei in der alten Liste (in der neuen gilt deren Standard).
- **⋮ → Bearbeiten …**: Name, Beschreibung, Kategorie, Status, Kanban-Einstellung, Icon.
- **⋮ → Berechtigungen …**: für den Haushalt oder nur für dich, **mit anderen Haushalten oder Personen
  teilen**, Link teilen und erneuern. In der Seitenleiste: 🔒 privat, 🔗 per Link, 👥 mit anderen geteilt.
- **⋮ → Als Text teilen …**: die offenen Einträge als Text, auf dem Handy in den Teilen-Dialog, am Laptop in
  die Zwischenablage; geht auch offline.
- **Reihenfolge der Listen und Abschnitte** in der Seitenleiste: *Einstellungen → Reihenfolge*, je Benutzer.

## Am Rechner bedienen

- **Maus**: Doppelklick öffnet einen Eintrag (wie langes Drücken auf dem Handy), Rechtsklick ebenso.
- **Tastatur** (überall; `H` oder `?` zeigt die Übersicht, am Laptop steht unten rechts ein dezenter Hinweis):

  | Taste | Wirkung |
  | --- | --- |
  | `N` | neuer Eintrag |
  | Pfeiltasten | zwischen Einträgen wechseln (auch im Kachelraster) |
  | Leertaste | abhaken bzw. wieder öffnen |
  | Enter | öffnen / bearbeiten |
  | Entf | löschen, mit „Rückgängig“ |
  | `Shift` + Pfeiltasten | mehrere markieren (auch Shift-/Strg-Klick) |
  | `V` | Markierte in eine andere Liste verschieben |
  | `Alt` + Pfeiltasten | Kanban: Karte verschieben |
  | `Strg+K` | Listen und Einträge suchen |
  | `Strg+Shift+A` | Arbeitsmodus an/aus |

## Zusammenarbeiten

- **Echtzeit**: Abhaken erscheint bei anderen in etwa 0,1 s, mit „✓ von Anna“.
- **Offline-first**: lokale Datenbank im Browser, Änderungen werden gepuffert und nachgeliefert.
- **Haushalte, Teilen, Gäste**: siehe [haushalte-und-teilen.md](haushalte-und-teilen.md).
- **❓ Hilfe** (Seitenleiste): kurz und mit Beispielen – für Gäste, für alle mit Konto und für Admins.
- Was über ein Token oder einen KI-Assistenten hinzukommt, ist gekennzeichnet („hinzugefügt von Anna über
  Claude“).

## App

- **PWA**: installierbar, läuft offline; neue Versionen kommen von selbst an.
- **Teilen → Shopping** (installierte App auf Android): Geteiltes aus Browser, Netflix & Co. öffnet
  „Hinzufügen“ – Name und Liste wählen (mit Link ist eine Merkliste vorausgewählt; die letzte Wahl wird
  gemerkt). Auf Einkaufslisten gibt es zusätzlich „Zutaten aus dem Rezept“.
- **Profilbilder** aus Pocket ID; **Icons** im einheitlichen Stil, offline verfügbar – siehe [icons.md](icons.md).

## Anbindungen

- **Mealie**: Eingangskorb und Katalog – siehe [mealie.md](mealie.md).
- **Home Assistant**: To-do-Listen, Sensoren, Aktionen – siehe [home-assistant.md](home-assistant.md).
- **Aufgaben-Apps** (CalDAV, JMAP): alle Listen in Apple Erinnerungen, Thunderbird oder DAVx⁵ + jtx Board,
  in beide Richtungen – siehe [api-und-ki.md](api-und-ki.md#aufgaben-apps-caldav-und-jmap).
- **REST-API, MCP-Server, Webhooks**: siehe [api-und-ki.md](api-und-ki.md).
