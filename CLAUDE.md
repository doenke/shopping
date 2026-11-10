# Shopping – Hinweise für Claude

## Versionierung (vom Nutzer festgelegt, bitte pflegen)

App (Server + PWA, Docker-Image) und Home-Assistant-Integration haben **getrennte** Versionen im Format
`x.yy.zzz`:

- `x` – Hauptversion, nur von Hand in `versions.json` (`major`). Bei einer neuen Hauptversion `since` auf
  den Tag setzen, damit `yy` wieder bei 1 beginnt.
- `yy` – Zahl der Tage (Europe/Berlin) seit `since`, an denen sich die Dateien der Komponente geändert
  haben (`paths` in `versions.json`). Wird automatisch aus der Git-Historie gezählt – nichts von Hand
  hochzählen.
- `zzz` – Nummer des CI-Laufs (`GITHUB_RUN_NUMBER`), lokal `0`.

Berechnung: `node scripts/version.mjs app|homeassistant`. Die CI (`.github/workflows/ci.yml`) setzt damit
den Image-Tag `ghcr.io/doenke/shopping:<app-version>` (plus `latest`), baut die Version in die App ein
(Einstellungen unten, `/healthz`) und erstellt für die Integration ein GitHub-Release `v<ha-version>` mit
`shopping.zip` (HACS `zip_release`), aber nur, wenn sich `custom_components/` oder `hacs.json` seit dem
letzten Release geändert haben. `manifest.json` im Repo bleibt bei `0.0.0`; die echte Version steht im ZIP.

Pflege: Kommen neue Verzeichnisse zu einer Komponente hinzu, `paths` in `versions.json` ergänzen. Nach
einem Push die Versionen aus der CI-Zusammenfassung dem Nutzer nennen.

## Arbeitsweise

- Antworten an den Nutzer auf Deutsch; direkt auf `main` arbeiten.
- Keine persönlichen Domains in Repo-Dateien, keine Benachrichtigungen einbauen.
- Tests: `pnpm test` (braucht PostgreSQL, `TEST_DATABASE_URL`), App im Browser: `pnpm build && pnpm e2e`
  (Playwright, `apps/e2e`), HA: `ha-tests/` mit pytest. Formatierung: `pnpm format` (CI prüft `format:check`).
- Aufgaben aus der ToDo-Liste „Shopping App“ (MCP Shoppingliste): Umgesetztes nach dem Push abhaken,
  bei angefangenen oder wartenden Aufgaben den Stand in die Notiz schreiben.

## Landkarte (zuerst lesen, statt den Code abzusuchen)

Monorepo (pnpm): `packages/shared` (Modell, Parser, Sync-Regeln – von App, Server, API und MCP gemeinsam
genutzt), `apps/server` (Fastify 5, Drizzle, PostgreSQL), `apps/web` (React-PWA, Dexie), `apps/e2e`
(Playwright), `custom_components/shopping` + `ha-tests` (Home Assistant). Ausführliches in
`docs/entwicklung.md`, Funktionen für Nutzer in `docs/funktionen.md`.

- **Sync**: Die App liest nur aus Dexie (`apps/web/src/db.ts`), schreibt über `sync.mutateItem` in eine
  Outbox (`apps/web/src/sync/engine.ts`); der Server wendet an in `apps/server/src/sync/service.ts`
  (`applyItem`). Zusammenführen per Feld-LWW mit HLC (`packages/shared/src/lww.ts`); Einträge immer über
  `applyItemPatch`/`mergeItem` (`people.ts`). Eigene Uhren unter einem Feld: `done:<name>` (Abhaken pro
  Person), `att:<id>` (Anhänge). Ein `attributes`-Patch ändert diese nie.
- **Eintrags-Daten** stecken großteils in `attributes`: `due`, `person`/`persons`/`done`, `container`
  (Packstück/Bereich/Wo), `status`, `url` (erster Link), `attachments` (weitere Links, Orte). Helfer je
  Thema in `packages/shared/src/*.ts` (`due`, `packing`, `people`, `status`, `links`, `attachments`).
- **Listen verschieben**: Der Server ignoriert `listId`-Änderungen – Verschieben = Kopie anlegen + Original
  löschen (`moveItems` in `apps/web/src/actions.ts`).
- **Eingabezeichen** (Parser `packages/shared/src/parser.ts`): `@` wer, `#` Packstück/Bereich/Wo, `!` fällig,
  `*` Ort (allein: Standort), Link im Text. Semikolon (und neue Zeile) trennt Einträge, Komma nicht.
- **Hinzufügen** überall über `planAdd` (`plan-add.ts`): legt zusammen statt zu verdoppeln.
- **Web**: `App.tsx` (Routing, Seitenleiste), `components/ListView|PackingView|MemoView` (Kacheln),
  `components/work/*` (ToDo: Tabelle, Kanban, Details), `components/ItemEditor.tsx` (Details-Dialog),
  `components/Attachments.tsx`, Tastatur `keyboard.ts`, Auswahl `selection.ts`, Ziehen `itemDrag.ts`.
  CSS in `apps/web/src/styles/NN-*.css` (Reihenfolge in `styles.css`), Farben in `13-design.css`.
- **Server-Module**: `api/` (REST v1 + OpenAPI, `service.ts` ist die Logik für REST und MCP), `mcp/`,
  `dav/` + `jmap/` (CalDAV/JMAP über `tasks/`), `icons/`, `mealie/`, `sharing/`, `places.ts` (Photon),
  `files/` (Datei-Anhänge in PostgreSQL; App-Seite mit Offline-Warteschlange in `apps/web/src/files.ts`).
- **Tests**: Unit `packages/shared/src/shared.test.ts`, Server `apps/server/test/*.test.ts` (eigene DB je
  Datei über `test/helpers.ts`), Browser `apps/e2e/tests/*.spec.ts` (Projekte `phone` und `laptop`,
  Hilfen in `helpers.ts`; Netzwerk-Antworten wie Photon mit `page.route` nachbilden).

## Umgebung (Cloud-Sitzung)

- Test-PostgreSQL läuft auf Port 54329 (Daten `/var/lib/postgresql/shopping-test`). Fällt sie aus
  („ECONNREFUSED 127.0.0.1:54329“), neu starten:
  `su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/postgresql/shopping-test -l /var/lib/postgresql/shopping-test.log -o '-p 54329' -w start"`
- Kleine Sprünge statt großer: gezielt lesen (`grep -n`, Zeilenbereiche), Logs mit `tail`/`grep` kürzen,
  Screenshots nur wenn der Nutzer etwas sehen soll.
