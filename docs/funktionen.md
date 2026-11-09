# Funktionen im Detail

[← zurück zur README](../README.md)

## Eingeben

- **Eine Eingabezeile für alles**: „2 kg Kartoffeln“, „500g Hack gemischt bio“, „Milch, Butter, 6 Eier“.
  Menge, Einheit und Eigenschaften werden erkannt, mehrere Artikel mit Komma.
  Wird etwas nur über ein Synonym gefunden („Stirnlampe“ → Taschenlampe), gibt es neben dem Vorschlag eine
  Kachel mit genau dem Getippten.
- **Liste einfügen**: Eine kopierte Zutaten- oder Einkaufsliste (mehrere Zeilen, z. B. von einer Rezeptseite)
  in die Eingabezeile einfügen – jede Zeile wird ein Artikel mit Menge, Einheit und Notiz („1 Zehe(n) Knoblauch“,
  „30 g Petersilie (glatt)“, „200 g Bergkäse, gerieben“). Vorher lässt sich die Liste noch bearbeiten.
- **Rezept aus dem Web** (Chefkoch, Lecker, EAT SMARTER, BBC Good Food …): den Link des Rezepts in die
  Eingabezeile einer Einkaufsliste einfügen oder in der Rezept-App/im Browser *Teilen → Shopping* wählen
  (dort eine Einkaufsliste wählen und „Zutaten aus dem Rezept“).
  Shopping liest die Zutaten aus den Rezeptdaten der Seite (wie Bring es tut) und zeigt sie als Checkliste:
  Portionen anpassen, Vorrat wie Salz und Öl ist vorab abgewählt, Einkaufsliste wählen.
- **Spracheingabe**: 🎤 in der Eingabezeile, „zwei Liter Milch und Butter“ – auf Einkaufs- und Packlisten
  wird „und“ zum Trenner, das Gesagte steht zur Kontrolle im Feld (Chrome/Android, Safari; braucht Netz).
- **Doppelte Artikel** werden zusammengeführt (1 l + 2 l Milch = 3 l); zuletzt gekaufte kommen zurück
  auf die Liste statt doppelt.
- **Eigenschaften je Listentyp**: Einkauf „bio“, „TK“, „festkochend“ …; Packliste „Handgepäck“,
  „aufladen“, „kaufen“, „leihen“ …; ToDo „wichtig“, „dringend“, „Hilfe nötig“ …; Merkliste „Highlight“,
  „zu zweit“, „Kino“ …. Merklisten erkennen keine Eigenschaften im Text – „Der kleine Prinz“ bleibt der Titel.
- **Lebensmittel-Katalog** mit Grundkatalog und Import aus Mealie (Labels werden zu Kategorien). Am Laptop
  steht rechts der Katalog zum Durchklicken.

## Einkaufen

- **Kategorien** nach Supermarkt-Bereichen; die Reihenfolge stellt sich jeder selbst ein (z. B. nach dem
  Weg durch den Laden, per Ziehen): *⋮ → Bearbeiten … → Kategorien sortieren …* oder *Einstellungen → Reihenfolge*. Sie gilt auf allen
  eigenen Geräten und auch in API und Home Assistant.
- **Eigene Kategorien** für Einkaufs- und Packlisten (z. B. „Angeln“, „Camping“, „Asia-Laden“): direkt im
  Editor über *Kategorie → + Neue Kategorie …* oder unter *Einstellungen → Eigene Kategorien* (umbenennen,
  Farbe, löschen). Sie gelten für den ganzen Haushalt, stehen vor „Sonstiges“ und bekommen ein eigenes Icon.
  Gelöschte Kategorien: ihre Einträge landen unter „Sonstiges“.
- **Automatisch einsortiert**: Neue Einträge, die nicht im Katalog stehen, landen nach wenigen Sekunden in
  der passenden Kategorie – wie beim letzten Mal bei gleichem Namen, sonst gewählt von Claude Haiku
  (mit Anthropic-Key; abschaltbar unter *Icons → Einrichtung*).
- **Lernender Katalog**: Was du von Hand einträgst, landet danach im Katalog – mit Kategorie und Icon – und
  wird beim nächsten Tippen vorgeschlagen. Die Kategorie lässt sich im Editor „für alle“ ändern.
- **Kacheln oder Liste** (runder Knopf rechts neben dem Eingabefeld): Liste = Bild links, Text daneben. Am Handy
  startet die App mit der Liste, am Laptop mit Kacheln; umgeschaltet wird pro Gerät gemerkt. Am Handy sind die Kacheln kleiner (vier nebeneinander), die Schrift bleibt gleich groß.
- **🏠 Zuhause / 🛒 Einkaufen** (pro Gerät): Zu Hause öffnet Antippen den Artikel, statt ihn abzuhaken.
  Im Einkaufen-Modus (Knopf 🛒 in der Titelzeile, grüner Kopf) hakt Antippen ab und der Bildschirm bleibt an.
  Zurück auf Zuhause geht es von selbst, wenn alles gekauft ist oder eine Stunde nichts abgehakt wurde.
- **Hauptliste** ⭐: die Liste, die ohne weitere Angabe gemeint ist (Teilen aus anderen Apps, Home
  Assistant, KI-Assistenten).
- **Zuletzt verwendet**: Gekauftes wandert nach unten und lässt sich mit einem Tipp zurückholen. Pro Liste
  bleiben die letzten 100 erledigten Einträge; ältere räumt der Server einmal täglich still auf (auch in Merk-
  und ToDo-Listen, nicht in Packlisten und Vorlagen). Katalog und gelernte Kategorien bleiben erhalten.

## Listen

- **Eine Schaltfläche „+ Neu“** für alles: Name, Typ (Einkauf, Packliste, Merkliste, ToDo), eine oder
  **mehrere Vorlagen** (z. B. „Basis“ + „Ski“ + „Kinder“; was in mehreren steht, kommt einmal),
  „Als Vorlage anlegen“, privat, Beschreibung, bei ToDo-Listen die Kategorie.
- **Vorlagen** (◇) für jeden Listentyp: nicht abhakbar, füllen neue Listen vor, „Als Vorlage speichern“,
  optionale Artikel. **Mit Vorlage abgleichen** in beide Richtungen: was der Liste fehlt, was der Vorlage
  fehlt und abweichende Mengen – einzeln auswählbar (Richtung Vorlage ist anfangs nichts angehakt); die Liste
  merkt sich ihre Vorlage.
- **Neues auch in die Vorlage?** In einer Liste, die aus Vorlagen entstand, fragt die Eingabezeile nach dem
  Hinzufügen, ob das Ding auch in eine der Vorlagen soll (nur Vorlagen, denen es noch fehlt; schnell
  hintereinander Eingegebenes kommt in eine Frage). „Nicht mehr fragen“ schaltet das für die Liste ab;
  *⋮ → Bearbeiten …* zeigt die Vorlagen der Liste und den Haken zum Wiedereinschalten.
- **Packlisten** 🧳 mit eigenem Katalog (Kleidung, Dokumente, Technik …): Abgehakt heißt „eingepackt“ und
  bleibt durchgestrichen stehen (Schalter „Eingepackte ausblenden“, pro Liste gemerkt), Fortschritt „12 von 30 eingepackt“, gruppiert nach Kategorie, **Packstück**
  oder **Person**. Beim Tippen ordnen „@Anna“ und „#Koffer“ zu („3 T-Shirts @Anna #Koffer“). Neue Packlisten
  entstehen aus Packvorlagen, erledigte kommen ins Archiv.
- **Ein Ding für mehrere Personen** 👥 (Packliste, Einkauf, ToDo): „Sonnenbrille @Sönke @Ulli“ ist *ein*
  Eintrag mit den Initialen beider; abgehakt wird pro Person. Ein Tipp darauf fragt „Für wen eingepackt?“
  (bzw. gekauft/erledigt), „Alle“ hakt alle auf einmal ab. Erledigt ist der Eintrag, wenn alle abgehakt sind;
  auf Packlisten zählt er im Fortschritt pro Person. Gruppiert nach **Person** steht er bei jeder Person
  einzeln und wird dort direkt für sie abgehakt. Kommt jemand dazu („Sonnenbrille @Anna“), wird der Eintrag
  erweitert statt verdoppelt. Im Editor wählt man die Personen aus dem eigenen Haushalt (Vornamen) oder
  trägt andere ein. In **Vorlagen** steht stattdessen „für jeden“ („Sonnenbrille @alle“): Beim Anlegen einer
  Liste aus der Vorlage fragt „+ Neu“, für wen die Liste ist (vorausgewählt: der eigene Haushalt), und macht
  daraus die Einträge für diese Personen; „@alle“ in der Liste selbst meint dieselben Leute. Gleichzeitiges
  Abhaken von zwei Handys überschreibt sich nicht. Wiederkehrende ToDo-Listen öffnen auch teilweise
  abgehakte Einträge wieder.
- **Links an Einträgen** 🔗 (alle Listentypen, besonders Merklisten): ein Link im eingetippten Text
  („Dune https://… @Ben“) oder im Editor (Feld *Link*, mit „Öffnen“). Die Kachel zeigt oben links ein 🔗 –
  ein Tipp darauf öffnet die Seite, ohne abzuhaken; in ToDo-Zeilen steht das 🔗 rechts. Nur ein Link
  eingetippt: Der Eintrag heißt wie die Seite (Titel, sonst der Name der Website). Auf Einkaufslisten öffnet
  ein bloßer Link wie bisher die Rezept-Zutaten; findet sich kein Rezept, gibt es „Als Eintrag mit Link
  hinzufügen“.
- **Links hineinziehen** (Laptop): einen Link oder Browser-Tab auf die Liste ziehen. Auf einen Eintrag
  gezogen, bekommt er den Link (hat er schon einen, fragt die App vor dem Ersetzen); auf freie Fläche
  gezogen, entsteht ein neuer Eintrag – benannt nach dem Linktext bzw. dem Titel der Seite. In die
  Eingabezeile gezogen landet der Link wie gewohnt als Text.
- **Status für Aufgaben** (ToDo-Listen): unter *⋮ → Bearbeiten …* eigene Status festlegen und sortieren
  (Vorschlag: Neu · In Arbeit · Wartet) und einen **Standard** wählen, den jeder neue Eintrag bekommt (bestehende
  behalten ihren, wenn der Standard wechselt); „Erledigt“ ist der Haken, kein Status.
  Am Rechner eine eigene Spalte in der Tabelle (Klick auf den Status zeigt alle als Pillen untereinander zur
  Auswahl, ebenso in der Handy-Liste) und eine Auswahl in den Details, auf dem Handy im Editor und als
  Gruppierung „Status“. Gespeichert wird der Status pro Eintrag (auch REST/MCP: `status`), umbenennen
  verliert nichts.
- **Kanban** (ToDo-Listen am Rechner, Umschalter *Tabelle | Kanban* oben rechts, pro Liste gemerkt): eine
  Spalte pro Status; „Erledigt“ als letzte (die 30 neuesten) nur mit dem Haken *Erledigte als Spalte im
  Kanban-Board anzeigen* in den Listeneinstellungen, sonst verlassen erledigte Karten das Board. Karten mit Fälligkeit, Bereich, Personen und
  Link; mit Maus oder Stift in eine andere Spalte ziehen setzt den Status bzw. hakt ab, innerhalb einer
  Spalte ändert Ziehen die Reihenfolge (eine Linie zeigt, wo die Karte landet; gilt für alle) – zurück aus „Erledigt“ öffnet
  wieder. Klick wählt eine Karte nur aus; Doppelklick/Enter öffnet rechts die Details (✕ oder Esc schließt sie),
  Leertaste hakt ab, Pfeiltasten wandern über die Karten. Ohne eigene Status gibt es eine Spalte „Offen“.
- **Arbeitsmodus** 💼 (*Arbeitsmodus* unten in der Seitenleiste oder Strg+Shift+A, pro Gerät gemerkt): blendet
  Listen aus – Seitenleiste, Suche und Start zeigen nur noch die ToDo-Listen der Kategorie „Arbeit“
  (umstellbar auf alle ToDo-Listen). Neue Listen sind dann ToDo-Listen in „Arbeit“; oben links steht „To-Do“
  statt „Shopping“. Die installierte App
  bietet per Rechtsklick aufs Taskleisten-Icon „Arbeitsmodus“ und „Einkaufslisten“ als Sprungziele.
- **ToDo-Listen am Rechner** (breites Fenster, jede ToDo-Liste, ob Arbeit oder nicht): Aufgaben als Tabelle
  (Fällig, Wer, Bereich, Link) und rechts die gewählte Aufgabe zum direkten Bearbeiten, in einem sachlichen
  Design (Grau mit gedecktem Blau, Segoe UI, hell/dunkel nach System). Andere Listen behalten ihr Aussehen.
- **Maus:** Doppelklick öffnet einen Eintrag (wie langes Drücken auf dem Handy), Rechtsklick ebenso.
- **Tastatur** (in jedem Modus): N neuer Eintrag, Pfeiltasten zwischen Einträgen (auch im Kachelraster),
  Leertaste abhaken, Enter öffnen, Entf löschen mit „Rückgängig“, Strg+K Listen und Einträge suchen,
  Strg+Shift+A Arbeitsmodus, H (oder ?) zeigt alle Kürzel – am Laptop steht unten rechts dezent ein Hinweis darauf.
- **In Erinnerungen & Co.** (CalDAV, JMAP): alle Listen als Aufgabenlisten in Apple Erinnerungen,
  Thunderbird oder DAVx⁵ + Tasks.org – Abhaken, Ändern und Neues in beide Richtungen. Einrichtung:
  [api-und-ki.md](api-und-ki.md#aufgaben-apps-caldav-und-jmap).
- **Teilen → Shopping** (installierte App auf Android): Geteiltes aus Browser, Netflix, IMDb & Co. öffnet
  „Hinzufügen“ – Name (der Titel der Seite) und Liste wählen. Mit Link ist eine Merkliste vorausgewählt,
  sonst die Hauptliste; die zuletzt gewählte Liste merkt sich die App. Auf Einkaufslisten gibt es zusätzlich
  „Zutaten aus dem Rezept“. Geteilter Text ohne Link wird wie eingetippt zu Einträgen.
- **Von der Packliste auf die Einkaufsliste** (oder auf eine Vorlage): im Editor eines Eintrags
  *🛒 Auf Einkaufsliste setzen …* bzw. *◇ Auf Vorlage setzen …* – Liste wählen, übernehmen. Auf der
  Einkaufsliste mit der passenden Lebensmittel-Kategorie und dem Vermerk, für welche Packliste.
- **Merklisten** 📌 für Filme, Bücher, Restaurants …: mit **Tipp von** und **Wo** („Dune @Ben #Netflix“),
  gruppierbar nach Ort oder Tippgeber; Erledigtes (gesehen, gelesen, besucht) bleibt unter „Erledigt“. Die
  Beschreibung der Liste („Filme und Serien, die wir sehen wollen“) hilft beim Icon jedes Eintrags.
- **ToDo-Listen** ✅ (standardmäßig **privat**): Aufgaben mit **Fälligkeit** („!morgen“, „!Fr“, „!12.11.“),
  **Wer** („@Ben“) und **Bereich** („#Garten“), gruppiert nach Fälligkeit (Überfällig, Heute, Nächste 7 Tage, Später),
  Bereich oder Person. Die Listen selbst lassen sich in **Kategorien** ordnen (Arbeit, Hobby, Urlaub …; beim
  Anlegen oder unter *⋮ → Bearbeiten …*) und stehen in der Seitenleiste darunter gruppiert.
- **Wiederkehrende Checklisten** ↺ (z. B. „Haus verlassen“, „Wochenputz“): *⋮ → ↺ Alles zurücksetzen*
  öffnet alles Abgehakte wieder (ToDo- und Packlisten). Bei ToDo-Listen optional automatisch – täglich, wöchentlich
  (montags) oder monatlich (am 1.), einstellbar beim Anlegen oder unter *⋮ → Bearbeiten …*. Der Server setzt
  um Mitternacht (deutsche Zeit) zurück, was vor Beginn des Zeitraums abgehakt wurde.
- **Reihenfolge der Listen und Abschnitte** in der Seitenleiste (z. B. Merklisten ganz nach unten):
  *Einstellungen → Reihenfolge*, je Benutzer. Sortiert wird per Ziehen am Griff ⠿, mit der Tastatur über die
  Pfeiltasten.
- **⋮ → Bearbeiten …**: Name, Beschreibung, Kategorie (ToDo-Listen) und Icon an einem Ort.
- **⋮ → Berechtigungen …**: sichtbar für den Haushalt oder nur für dich, **mit anderen Haushalten oder einzelnen
  Personen teilen** („+ Haushalt oder Person …“), wer dabei ist (der Besitzer kann Leute und Haushalte
  entfernen), Link teilen und erneuern. In der Seitenleiste: 🔒 privat, 🔗 per Link geteilt, 👥 mit anderen
  Haushalten oder Personen geteilt. Die Avatare in der Titelzeile zeigen alle mit Zugriff; ein Tipp
  darauf öffnet denselben Dialog.

## Zusammenarbeiten

- **Echtzeit**: Abhaken erscheint bei anderen in etwa 0,1 s, mit „✓ von Anna“.
- **Offline-first**: lokale Datenbank im Browser, Änderungen werden gepuffert und nachgeliefert (auch per
  Background Sync, wenn die App schon zu ist).
- **Haushalte, Teilen, Gäste**: siehe [haushalte-und-teilen.md](haushalte-und-teilen.md).
- **❓ Hilfe** (Seitenleiste): kurz und mit Beispielen – für Gäste (mit den Namen der Admins, falls jemand einen
  eigenen Zugang möchte), für alle mit Konto und für Admins (die Haushaltsregeln mit der eingestellten Owner-Gruppe).
- **Als Text teilen** (*⋮ → Als Text teilen …*): die offenen Einträge als lesbarer Text, nach Kategorien in
  der eigenen Reihenfolge – auf dem Handy in den Teilen-Dialog (Messenger, Notizen), am Laptop in die
  Zwischenablage. Für alle, die ohne App einkaufen; geht auch offline.
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

- **Mealie**: Eingangskorb (auch für Rezepte und Wochenplan) und Katalog – siehe [mealie.md](mealie.md).
- **Home Assistant**: To-do-Listen, Sensoren, Aktionen – siehe [home-assistant.md](home-assistant.md).
- **REST-API, MCP-Server, Webhooks**: siehe [api-und-ki.md](api-und-ki.md).
