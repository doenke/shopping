# 04 – Sync & Offline

*Stand: Oktober 2026.*

Zwei Anforderungen, die sich gegenseitig verstärken:

1. **Abhaken soll sofort bei allen anderen erscheinen.**
2. **Im Supermarkt ist das Netz schlecht** – oft „ein Balken, aber nichts geht“.

Daraus folgt: **Offline-first.** Die App arbeitet immer gegen ihre lokale
Datenbank und synchronisiert im Hintergrund. Der Server ist nie im
kritischen Pfad eines Tipps.

## Grundprinzip

```
 Tipp ──► lokale IndexedDB (sofort sichtbar) ──► Outbox ──► WebSocket ──► Server
                                                                         │
 andere Geräte ◄── persönliches Delta ab ihrem Cursor ◄── seq ◄──────────┘
```

- Jede Änderung ist eine kleine **Mutation**: `{mid, entity, id, patch, hlc}` mit
  `entity` = `list`, `item` oder `me` (Hauptliste, Reihenfolgen).
- Mutationen werden lokal sofort angewendet und in eine **Outbox** (IndexedDB)
  geschrieben. Die Outbox überlebt App-Kill, Neustart, Flugmodus.
- Der Server wendet an, vergibt eine fortlaufende Nummer (`seq`), bestätigt (`ack`)
  und schickt jedem verbundenen Gerät der betroffenen Nutzer sein Delta.
- Jeder Client merkt sich seinen Cursor. Nach einem Abbruch holt er alles seitdem nach.

## Konfliktauflösung

Listen bestehen aus kleinen Datensätzen; echte CRDTs (Yjs, Automerge) wären
Overkill. Stattdessen:

| Fall | Regel |
|------|-------|
| Zwei Geräte ändern **verschiedene Felder** desselben Artikels | beide Änderungen bleiben (Merge **pro Feld**) |
| Zwei Geräte ändern **dasselbe Feld** | Last-Writer-Wins nach **Hybrid Logical Clock** (robust gegen falsch gehende Handyuhren) |
| A hakt ab, B ändert offline die Menge | beides bleibt: abgehakt mit neuer Menge |
| A löscht, B ändert | Löschen gewinnt (Markierung `deleted`) |
| A und B fügen offline beide „Milch“ hinzu | der Server führt zusammen (gleicher Artikel, offen, gleiche Eigenschaften) → ein Eintrag, Mengen addiert, das Duplikat verweist per `merged_into` darauf |
| Reihenfolge | Fractional Indexing: Einfügen zwischen zwei Positionen, ohne andere umzuschreiben |

Felder, die nur der Server setzt (Icons, Mitgliedschaften), kommen als normale Zeilen im Delta mit.

## Echtzeit

- **WebSocket** pro Gerät für alle Listen des Nutzers. Kommt eine Liste dazu (Haushalt, Link),
  wird sie sofort nachgeladen; fällt eine weg, löscht der Client die lokale Kopie.
- Abhaken erscheint bei anderen Online-Geräten in etwa 0,1 s. Beim Gegenüber verschwindet der
  Artikel nicht schlagartig, sondern blendet mit „✓ von Anna“ aus.
- Integrationen (Home Assistant, Skripte) bekommen dasselbe als **Server-Sent Events**
  (`/api/v1/events`); ausgehende Webhooks hängen am selben Änderungsstrom.
- Ohne WebSocket gibt es dasselbe Protokoll per HTTP (`POST /api/v1/sync/push`,
  `GET /api/v1/sync/pull?since=`) – für Background Sync und als Rückfallebene.

## Schlechtes Netz im Supermarkt

Das eigentliche Problem ist selten „gar kein Netz“, sondern **„Netz, das nicht
antwortet“**: Der Browser meldet `online`, Anfragen hängen aber 30 s und mehr.

| Maßnahme | Wirkung |
|----------|---------|
| Niemals auf den Server warten | die Oberfläche reagiert immer sofort |
| Ping alle paar Sekunden, Antwort binnen 5 s, `ack` binnen 8 s | eine tote Verbindung wird in Sekunden erkannt und neu aufgebaut |
| Kleine Pakete, gebündelte Mutationen | geht auch über schwaches LTE |
| Idempotenz über die Mutations-ID | doppelt gesendete Mutation nach Timeout schadet nicht |
| **Background Sync** (Chrome/Android) | die Outbox wird gesendet, sobald Netz da ist – auch wenn die App schon zu ist |
| Sync beim Wieder-Sichtbarwerden und bei `online` | schneller Aufholvorgang an der Kasse |
| Unaufdringliche Statusanzeige | Punkt in der Titelzeile: verbunden, verbinde, offline mit ausstehenden Änderungen |

## Was liegt offline auf dem Gerät?

| Daten | Speicher |
|-------|----------|
| App-Shell (HTML/JS/CSS) | Service-Worker-Cache (Precache) |
| Alle Listen und Vorlagen inkl. Artikel, Nutzer, eigene Einstellungen | IndexedDB |
| Katalog (Namen, Aliase, Kategorien) | IndexedDB, bei Änderungen nachgeladen |
| Icons und Profilbilder | Cache Storage, versionierte URLs, im Hintergrund vorgeladen |

Offline funktioniert damit alles außer Mealie-Import, Teilen-Link und Icon-Erzeugung.
`navigator.storage.persist()` wird angefragt, damit Android den Speicher nicht räumt.

## Updates der App

Der Service Worker übernimmt eine neue Version sofort (`skipWaiting`, `clients.claim`), und die
Seite lädt sich einmal neu. Gesucht wird beim Zurückkehren in den Vordergrund und stündlich –
eine installierte App bleibt sonst tagelang auf dem alten Stand. Offene Änderungen gehen nicht
verloren, sie liegen in der Outbox.

## Sync-Protokoll

```jsonc
// Client → Server
{ "t": "hello", "since": 18233 }
{ "t": "push",  "mutations": [ { "mid": "…", "entity": "item", "id": "…",
                                 "patch": { "checked": true }, "hlc": "…" } ] }
{ "t": "ping" }

// Server → Client
{ "t": "ack",     "mids": ["…"], "rejected": [ { "mid": "…", "reason": "forbidden" } ] }
{ "t": "changes", "seq": 18241, "lists": [ … ], "items": [ … ], "members": [ … ], "me": { … } }
{ "t": "catalog", "seq": 18242 }   // Katalog oder Icons geändert → nachladen
{ "t": "resync" }                  // Cursor unbrauchbar → Vollabgleich
{ "t": "pong" }
```

## Umsetzung

- Schreibzugriffe und Delta-Abfragen laufen im Server hintereinander (In-Process-Mutex).
  So kann kein Cursor eine später committete Zeile überspringen. Das setzt **eine**
  Server-Instanz voraus.
- Die Merge-Logik (HLC, Feld-LWW, `planAdd`) liegt in `packages/shared` und ist in App und
  Server dieselbe.

Abgesichert durch Tests: zwei Clients offline in beliebiger Reihenfolge → gleicher Endzustand;
doppelte Zustellung → keine doppelten Artikel; Rechte entzogen → Ablehnung statt stiller Änderung.
