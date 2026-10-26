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
- Tests: `pnpm test` (braucht PostgreSQL, `TEST_DATABASE_URL`), HA: `ha-tests/` mit pytest.
