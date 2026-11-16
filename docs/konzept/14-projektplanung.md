# 14 – Projektplanung (ToDo-Listen)

Stand November 2026. ToDo-Listen können als Projekt geplant werden: Dauer, Vorgänger/Nachfolger, Aufwand,
Termine, Meilensteine, Netzplan (früheste/späteste Termine, Puffer, kritischer Pfad). Danach folgen eine
Gantt-Ansicht und eine Planungsautomatik.

## Grundsätze

- **Zweite Ebene.** Die normale ToDo-Ansicht wird nicht komplizierter. Projektplanung wird pro Liste
  eingeschaltet (`settings.planning`) und erscheint nur dann – in den Aufgabendetails als eigener Bereich
  „Projektplanung“, später als Gantt-Ansicht.
- **Fälligkeit bleibt eigenes Feld.** `attributes.due` ist die Deadline („muss fertig sein bis“). Liegt das
  geplante Ende danach, gibt es eine Konfliktwarnung.
- **Ganze Tage, Modell minutengenau.** Dauer und Aufwand sind Minuten (ein Arbeitstag = 480 min), Termine
  `YYYY-MM-DD` – später auch `YYYY-MM-DDTHH:mm` im selben Feld.

## Datenmodell

`attributes.pm` am Eintrag (Helfer in `packages/shared/src/pm.ts`):

| Feld | Inhalt |
| --- | --- |
| `start`, `end` | geplanter Start/Ende, `{ v: Datum, src }` |
| `dur` | geplante Dauer in Minuten Arbeitszeit, `{ v, src }` |
| `milestone` | Meilenstein (Dauer 0) |
| `effort`, `spent` | geplanter / geleisteter Aufwand in Minuten |
| `notBefore` | darf nicht vor diesem Tag beginnen |
| `deps` | Vorgänger: `{ <id>: { type: FS/SS/FF/SF, lag: Minuten } }` |

- `src`: `set` = Vorgabe (bindet die Planung), `calc` = von der Planungsautomatik geschrieben (nur Hinweis).
  Start und Ende als Vorgabe legen die Dauer fest.
- **Abhängigkeiten stehen nur beim Nachfolger.** Nachfolger werden abgeleitet (`successorsOf`). Wer beim
  Vorgänger einen Nachfolger einträgt, ändert den Nachfolger. Kreise lehnt die App ab (`wouldCreateCycle`);
  kommen sie doch per Sync, ignoriert die Rechnung diese Verknüpfungen und markiert sie (`cycle`).
- **Eigene Uhr je Feld** (`hlc["pm:<feld>"]`, `hlc["pm:dep:<id>"]`), geändert nur über den `pm`-Teil eines
  Eintrags-Patches (`{ feld: wert | null }`, `{ "dep:<id>": dep | null }`). Ein `attributes`-Patch lässt
  `pm` unberührt.
- **Nicht gespeichert:** früheste/späteste Termine, Puffer, kritischer Pfad – `schedule()` rechnet sie
  auf jedem Gerät gleich aus.
- **Verschieben** in eine andere Liste nimmt die Planungsdaten mit (`pmChangesForCopy`); Verknüpfungen zu
  Einträgen, die zurückbleiben, entfallen – Abhängigkeiten gelten innerhalb einer Liste.

## Arbeitskalender (Listeneinstellung)

`settings.workDays`: Wochentage zum Anhaken (0 = So … 6 = Sa, Vorgabe Mo–Fr). Perspektivisch
`settings.workHours: { "1": { from: "08:00", to: "16:00" } }` je Tag. `settings.projectStart`: Beginn des
Projekts (sonst heute).

## Schritte

1. Datenmodell und Rechenkern – erledigt.
2. Bereich „Projektplanung“ in den Aufgabendetails (zugeklappt, `components/Planning.tsx`), Schalter,
   Arbeitstage und Projektbeginn in den Listeneinstellungen – erledigt.
3. Gantt-Ansicht (`components/work/GanttChart.tsx`, Stil `14-gantt.css`) – erledigt. Ziehen schreibt
   Vorgaben: verschieben = `start` (ein vorgegebenes `end` wandert mit), rechter Rand = `dur`.
4. Planungsautomatik – erledigt, live in `schedule()` (Optionen `resourcesOf`, `level`,
   `durationFromEffort`; Listeneinstellungen `level`/`effortDuration`, an außer `false`):
   - Ressourcenabgleich seriell: unter den Aufgaben, deren Vorgänger stehen, zuerst die mit dem spätesten
     Start am frühesten (dann Listenposition), zum ersten Zeitpunkt, an dem alle ihre Personen frei sind.
     Feste Start/Ende bleiben (Konflikt `resource`), Erledigtes belegt niemanden. Späteste Termine danach
     ohne Ressourcen gerechnet. `waitsFor` sagt, auf wen/was eine Aufgabe wartet.
   - Dauer aus Aufwand: ohne vorgegebene Dauer `effort ÷ Personen`.
   Nicht gemacht: berechnete Termine festschreiben (`src: "calc"`), Kapazitäten pro Person (Teilzeit),
   Gantt auf dem Handy.

Später möglich: Ist-Start/-Ende, Fortschritt/Restaufwand, Sammelaufgaben, Ressourcen-Kapazitäten,
Basisplan, Abhängigkeiten über `RELATED-TO` in CalDAV.
