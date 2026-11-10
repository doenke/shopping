# REST-API, KI-Assistenten (MCP), Aufgaben-Apps (CalDAV, JMAP), Webhooks

[← zurück zur README](../README.md)

## REST-API

- API-Tokens in *Einstellungen → API & Integrationen*, mit Rechten „Lesen“, „Ändern“ und „Mealie-Import“.
  Mitschicken als `Authorization: Bearer shp_…`.
- OpenAPI-Dokumentation unter `/api/docs`.
- Echtzeit-Ereignisse per Server-Sent Events.
- `Idempotency-Key` als Header macht Wiederholungen sicher (gleicher Schlüssel, gleiche Antwort).
- Listen und Artikel kommen in der Reihenfolge des Token-Besitzers.

## KI-Assistenten (MCP)

MCP-Server-Adresse: `https://<deine-adresse>/mcp`. In Claude als *Custom Connector* eintragen; beim Verbinden
meldest du dich über Pocket ID an und erlaubst den Zugriff. Verbundene Assistenten stehen in den Einstellungen
und lassen sich dort trennen. Für einfache Clients geht statt OAuth auch ein API-Token.

Was ein Assistent hinzufügt, ist in der App gekennzeichnet („hinzugefügt von Anna über Claude“).

## Aufgaben-Apps: CalDAV und JMAP

Alle Listen (ohne Vorlagen und Archiv) gibt es auch als **Aufgabenlisten** für andere Apps – zum Ansehen,
Abhaken und Ergänzen, in beide Richtungen.

**CalDAV** – Apple Erinnerungen (Einstellungen → Erinnerungen → Accounts → Andere → CalDAV-Account),
Thunderbird, DAVx⁵ mit Tasks.org oder jtx Board auf Android:

| | |
|---|---|
| Server | `https://<deine-adresse>` (die App findet `/.well-known/caldav` → `/dav/`) |
| Benutzername | beliebig |
| Passwort | ein API-Token mit „Lesen“ (+ „Ändern“ zum Abhaken und Bearbeiten) |

- Jede Liste ist ein Aufgabenkalender (VTODO), jeder Eintrag eine Aufgabe. Titel: Name, dahinter Menge,
  Eigenschaften und Personen („Milch – 2 l · bio“). Dazu Notiz, Fälligkeit (ToDo-Listen), Link und
  Packstück/Bereich als Kategorie.
- **Status** (ToDo-Listen mit eigenen Status): der Standard-Status ist „offen“ (NEEDS-ACTION), jeder andere
  „in Bearbeitung“ (IN-PROCESS, der Name steht in `X-SHOPPING-STATUS`). Stellt eine App eine Aufgabe auf
  „in Bearbeitung“, kommt sie in den ersten Status nach dem Standard; zurück auf „offen“ heißt Standard –
  aber nur, wenn die App `X-SHOPPING-STATUS` mitgeschickt hat (Apps, die alles neu schreiben, setzen den
  Status so nicht versehentlich zurück). JMAP: `progress` „in-process“ genauso, dazu `shopping:status`.
- Zurück kommen: erledigt/offen, Titel (wie eingetippt gelesen – „2 l Hafermilch“ ändert auch die Menge),
  Notiz, Fälligkeit, Link; neue Aufgaben werden Einträge, gelöschte verschwinden. Was eine App ändert, ist
  in Shopping mit dem Namen des Tokens gekennzeichnet.
- Unterstützt: PROPFIND, REPORT (calendar-query, calendar-multiget, sync-collection), GET, PUT (mit
  ETag/If-Match), DELETE, PROPPATCH (nur Umbenennen). Listen anlegen oder löschen geht nur in der App.

**JMAP** (RFC 8620 mit JMAP for Tasks): Sitzung unter `https://<deine-adresse>/.well-known/jmap`, Anmeldung
per `Authorization: Bearer shp_…` (oder Basic mit dem Token als Passwort). Methoden: `Core/echo`,
`TaskList/get`, `TaskList/changes`, `Task/get`, `Task/query` (Filter `inTaskList`, `completed`, `text`),
`Task/changes`, `Task/set` (anlegen, ändern, löschen; Rückverweise mit `#…`). Tasks im JSCalendar-Format:
`title`, `description`, `due`, `progress`, `links`, `keywords`; dazu `shopping:name` und `shopping:type`.

## Webhooks

Für eigene Automationen (z. B. n8n): In den Einstellungen eine Adresse eintragen, Shopping schickt jede
Änderung dorthin – HMAC-signiert im Header `X-Shopping-Signature` (`t=…,v1=HMAC-SHA256(t.body)`) und mit
Nachlieferung, falls das Ziel kurz nicht erreichbar ist. Nach vielen Fehlschlägen in Folge schaltet sich ein
Webhook ab.
