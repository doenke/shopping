# 04 – Sync & Offline

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
 andere Geräte ◄── WebSocket-Broadcast ◄── change_log (server_seq) ◄────┘
```

- Jede Änderung ist eine kleine **Mutation**: `{id, entity, entityId, patch, hlc}`,
  z. B. `{entity:"item", entityId:"…", patch:{checked:true}, hlc:"…"}`.
- Mutationen werden lokal sofort angewendet und in eine **Outbox** (IndexedDB)
  geschrieben. Die Outbox überlebt App-Kill, Neustart, Flugmodus.
- Der Server wendet an, vergibt eine fortlaufende `server_seq`, bestätigt
  (`ack`) und verteilt an alle anderen verbundenen Clients der Liste.
- Jeder Client merkt sich seinen Cursor (`last_seq`). Nach Verbindungsabbruch:
  `pull since last_seq` → Lücke geschlossen.

## Konfliktauflösung

Einkaufslisten bestehen aus kleinen Datensätzen; echte CRDTs (Yjs,
Automerge) wären Overkill. Stattdessen:

| Fall | Regel |
|------|-------|
| Zwei Geräte ändern **verschiedene Felder** desselben Artikels | beide Änderungen bleiben (Merge **pro Feld**) |
| Zwei Geräte ändern **dasselbe Feld** | Last-Writer-Wins nach **Hybrid Logical Clock** (robust gegen falsch gehende Handyuhren) |
| A hakt ab, B ändert offline die Menge | beides bleibt: abgehakt mit neuer Menge |
| A löscht, B ändert | Löschen gewinnt (Tombstone), B sieht „wurde von A entfernt“ |
| A und B fügen offline beide „Milch“ hinzu | Server führt zusammen (gleicher Katalogartikel, offen, gleiche Eigenschaften) → ein Eintrag, Mengen addiert; Duplikat wird als zusammengeführt markiert |
| Reihenfolge | Fractional Indexing: Einfügen zwischen zwei Positionen ohne andere Einträge umzuschreiben |

IDs sind clientseitig erzeugte UUIDv7 – offline angelegte Artikel brauchen
kein Server-Roundtrip und keine ID-Umschreibung.

## Echtzeit

- **WebSocket** pro Gerät, Abo auf alle Listen des Nutzers (eigene + über
  Link beigetretene). Tritt der Nutzer einer Liste bei, wird sie sofort
  nachgeladen; wird er entfernt oder verlässt er sie, schickt der Server
  `removed` und der Client löscht die lokale Kopie.
- Ziel: Abhaken bei anderen Online-Geräten **< 1 s**.
- Beim Gegenüber verschwindet der Artikel nicht schlagartig, sondern
  mit kurzer Animation und Hinweis „✓ von Anna“ – sonst wundert man sich,
  wohin die Butter verschwunden ist.
- Fallback, wenn WebSocket durch Proxy/Netz blockiert: SSE + HTTP-POST,
  zuletzt Polling (alle 10 s, nur bei sichtbarer App).

## Schlechtes Netz im Supermarkt

Das eigentliche Problem ist selten „gar kein Netz“, sondern **„Netz, das
nicht antwortet“**: Der Browser meldet `online`, Anfragen hängen aber
30 s+. Maßnahmen:

| Maßnahme | Wirkung |
|----------|---------|
| Niemals auf den Server warten | UI reagiert immer sofort |
| App-Level-Heartbeat (Ping alle 10 s, Timeout 5 s) | tote Verbindung wird in Sekunden statt Minuten erkannt |
| Eigene Request-Timeouts (z. B. 8 s) + Retry mit Backoff und Jitter | hängende Requests blockieren nichts |
| Mutationen gebündelt, winzige Payloads (wenige hundert Byte) | geht auch über EDGE/schwaches LTE |
| Idempotenz über Mutations-ID | doppelt gesendete Mutation nach Timeout schadet nicht |
| **Background Sync API** (Chrome/Android) | Outbox wird gesendet, sobald Netz zurück ist – auch wenn die App schon zu ist |
| Sync beim Wieder-Sichtbarwerden der App (`visibilitychange`) und bei `online` | schneller Aufholvorgang an der Kasse/auf dem Parkplatz |
| Unaufdringliche Statusanzeige | Wolke-Symbol: ✓ synchron · ↻ 3 ausstehend · ⚠ offline seit 5 min |

## Was liegt offline auf dem Gerät?

| Daten | Speicher | Umfang |
|-------|----------|--------|
| App-Shell (HTML/JS/CSS) | Service-Worker-Cache (Precache) | ~300 KB |
| Alle Listen + Vorlagen des Nutzers inkl. Artikel | IndexedDB | klein |
| Lebensmittel-Katalog (Namen, Aliase, Kategorien, Einheiten) | IndexedDB | ~1–2 MB, delta-synchronisiert |
| Icons | Cache Storage, vorab geladen als Sprite/Bündel (WebP) | ~2–5 MB für 1.000 Icons |
| Verlauf („Zuletzt verwendet“) | IndexedDB | klein |

Damit funktioniert offline **alles**: Listen anschauen, abhaken, Artikel aus
dem Katalog suchen und hinzufügen, Vorlagen anwenden. Nur der Mealie-Import und das
Erzeugen eines neuen Gast-Links brauchen Netz (werden aber ebenfalls gequeued).

`navigator.storage.persist()` wird angefragt, damit Android den Speicher nicht
bei Platzmangel räumt.

## Sync-Protokoll (Skizze)

```jsonc
// Client → Server
{ "t": "hello", "clientId": "…", "lastSeq": 18233, "schema": 1 }
{ "t": "push",  "mutations": [ { "mid": "…", "entity": "item", "id": "…",
                                 "op": "upsert", "patch": { "checked": true }, "hlc": "…" } ] }
{ "t": "ping" }

// Server → Client
{ "t": "ack",     "mids": ["…"], "seq": 18240 }
{ "t": "changes", "changes": [ { "seq": 18241, "entity": "item", "id": "…",
                                 "patch": { "checked": true, "checkedBy": "…" }, "hlc": "…" } ] }
{ "t": "reject",  "mid": "…", "reason": "forbidden" }   // z. B. Rechte entzogen
{ "t": "resync" }                                         // Cursor zu alt → Vollabgleich
{ "t": "pong" }
```

Dasselbe Protokoll ist per HTTP verfügbar (`POST /api/v1/sync/push`,
`GET /api/v1/sync/pull?since=`) – für Background Sync, native Clients und
Notfälle ohne WebSocket.

## Tests, die das absichern müssen

- Zwei Clients offline, beide ändern, dann online in beliebiger Reihenfolge → gleicher Endzustand.
- Verbindung „hängt“ (Netzwerk-Throttling, 100 % Paketverlust) → UI bleibt bedienbar, Sync holt nach.
- App wird mit 20 ausstehenden Mutationen beendet → nach Neustart werden sie gesendet.
- Doppelte Zustellung einer Mutation → keine doppelten Artikel.
