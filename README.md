# Shopping – Einkaufslisten-App

Selbst gehostete, offline-fähige Listen-App für Einkauf, Packen und Merken,
mit nativer Mealie-Anbindung, Login über Pocket ID, REST-API für Home Assistant und
eingebautem MCP-Server.

## Was die App kann

- Login über **Pocket ID** (OIDC mit PKCE), langlebige Sessions; das **Profilbild** aus Pocket ID
  erscheint bei Mitgliedern, „✓ von …“ und „Hinzugefügt von“ (lokale Kopie, auch offline)
- Einkaufslisten mit **Hauptliste** ⭐, Artikel mit **Menge, Einheit, Eigenschaften, Notiz**
- **Eigenschaften je Listentyp**: Einkauf „bio“, „TK“, „festkochend“ …; Packliste „Handgepäck“, „aufladen“,
  „kaufen“, „leihen“ …; ToDo „wichtig“, „dringend“, „Hilfe nötig“ …; Merkliste „Highlight“, „zu zweit“, „Kino“ …
  (Merklisten erkennen keine Eigenschaften im Text – „Der kleine Prinz“ bleibt der Titel)
- **Eine Eingabezeile für alles**: „2 kg Kartoffeln“, „500g Hack gemischt bio“, „Milch, Butter, 6 Eier“
- Doppelte Artikel werden zusammengeführt (1 l + 2 l Milch = 3 l)
- **Eigene Reihenfolge** pro Benutzer (auf allen Geräten, auch in API und Home Assistant): Kategorien z. B. nach
  dem Weg durch den Laden (*⋮ → Kategorien sortieren …*), Listen in der Seitenleiste (*↕ Listen sortieren*);
  beides auch unter *Einstellungen → Reihenfolge*
- **🏠 Zuhause / 🛒 Einkaufen** (pro Gerät): zu Hause öffnet Antippen den Artikel statt ihn abzuhaken;
  im Einkaufen-Modus (Knopf 🛒 in der Titelzeile, grüner Kopf) hakt Antippen ab und der Bildschirm bleibt an.
  Zurück auf Zuhause geht es von selbst, wenn alles gekauft ist oder eine Stunde nichts abgehakt wurde
- **Offline-first**: lokale Datenbank im Browser, Änderungen werden gepuffert und
  nachgeliefert (auch per Background Sync, wenn die App schon zu ist)
- **Echtzeit**: Abhaken erscheint bei anderen in ~0,1 s, mit „✓ von Anna“
- PWA zum Installieren auf Android; am Laptop drei Spalten mit Katalog zum Durchklicken
- Lebensmittel-Katalog (Grundkatalog + **Import aus Mealie**, Labels → Kategorien)
- Kategorien nach Supermarkt-Bereichen, **generierte Icons** im einheitlichen Stil (Kategorie-Icon bzw.
  Anfangsbuchstabe, solange ein Artikel noch keins hat), offline verfügbar
- **Haushalte**: Listen gehören automatisch dem ganzen Haushalt, können aber **privat** 🔒 sein
  („⋮ → Privat machen“). Der Haushalt kommt aus Pocket ID (Haushalts-Tag), ohne Tag gilt der Standard-Haushalt.
- **Teilen per Link** über den Teilen-Dialog des Handys: Wer den Link angemeldet öffnet,
  ist dabei (Besitzer kann den Link erneuern, Mitglieder können die Liste verlassen)
- **Gäste ohne Account**: Link öffnen, Namen eingeben, nur diese Liste; Link erneuern wirft Gäste raus.
  „Wer ist dabei?“ zeigt Mitglieder, der Besitzer kann Leute entfernen.
- **Mealie-Eingangskorb** (ersetzt einen n8n-Flow): Was in Mealie auf der
  Einkaufsliste landet, kommt strukturiert (Menge, Einheit, Kategorie, „für Chili“) in die
  Zielliste und wird in Mealie abgehakt – per Notifier sofort, sonst alle 15 Minuten
- **Rezept und Wochenplan aus Mealie**: Portionen anpassen, Zutaten-Checkliste,
  Vorrat (Salz, Öl …) vorab abgewählt, gleiche Zutaten zusammengefasst
- **Eine Schaltfläche „+ Neu“** für alles: Name, Typ (Einkauf, Packliste, Merkliste, ToDo), Vorlage,
  „Als Vorlage anlegen“, privat, Beschreibung
- **Vorlagen** (◇) für jeden Listentyp: nicht abhakbar, füllen neue Listen vor, „Als Vorlage speichern“,
  optionale Artikel. **Mit Vorlage abgleichen** in beide Richtungen: was der Liste fehlt, was der Vorlage
  fehlt und abweichende Mengen – einzeln auswählbar; die Liste merkt sich ihre Vorlage
- **Packlisten** 🧳 mit eigenem Katalog (Kleidung, Dokumente, Technik …): Abgehakt heißt
  „eingepackt“ und bleibt durchgestrichen stehen, Fortschritt „12 von 30 eingepackt“, gruppiert nach
  Kategorie, **Packstück** oder **Person**. Beim Tippen ordnen „@Anna“ und „#Koffer“ zu
  („3 T-Shirts @Anna #Koffer“). Neue Packlisten entstehen aus Packvorlagen, erledigte kommen ins Archiv.
- **Merklisten** 📌 für Filme, Bücher, Restaurants …: mit **Tipp von** und **Wo** („Dune @Ben #Netflix“),
  gruppierbar nach Ort oder Tippgeber, Erledigtes (gesehen, gelesen, besucht) bleibt unter „Erledigt“.
  Jede Liste hat eine Beschreibung („Filme und Serien, die wir sehen wollen“); jeder Eintrag bekommt ein
  **eigenes Icon**, das mit dieser Beschreibung entsteht – bei Filmen also ein Motiv aus dem Film.
- **ToDo-Listen** ✅ (standardmäßig **privat**): Aufgaben als Checkliste mit **Fälligkeit** („!morgen“,
  „!Fr“, „!12.11.“), **Wer** („@Ben“) und **Bereich** („#Garten“), gruppiert nach Fälligkeit (Überfällig, Heute,
  Diese Woche …), Bereich oder Person. In Home Assistant mit Fälligkeitsdatum. Die Listen selbst lassen
  sich in **Kategorien** ordnen (Arbeit, Hobby, Urlaub …; beim Anlegen oder *⋮ → Kategorie …*) und
  stehen in der Seitenleiste darunter gruppiert.

- **REST-API** mit API-Tokens (lesen / ändern / Mealie), OpenAPI-Doku unter `/api/docs`,
  Echtzeit-Ereignisse per Server-Sent Events
- **Home Assistant**: Listen als To-do-Listen (auch für Assist: „Füge Milch zur
  Einkaufsliste hinzu“), Live-Updates per Push, Sensor „offene Artikel“, Aktionen
- **MCP-Server** für Claude & Co. mit OAuth-Anmeldung über Pocket ID
- Was über ein Token oder einen KI-Assistenten hinzukommt, ist gekennzeichnet („hinzugefügt von Anna über Claude“)
- **Webhooks** für eigene Automationen (z. B. n8n), HMAC-signiert, mit Nachlieferung; `Idempotency-Key` in der API

### Icons erzeugen

1. Kostenloses Cloudflare-Konto anlegen, unter *AI → Workers AI → REST API* die Account-ID
   ablesen und ein API-Token (Vorlage „Workers AI“) erstellen.
2. In der App *⚙ Einstellungen → 🖼 Icons verwalten → Bild-KI einrichten*: Account-ID und Token eintragen, speichern.
3. „Automatisch im Hintergrund“ einschalten. Neue Icons werden **automatisch freigegeben**, sobald ein
   Entwurf alle Prüfungen besteht (Hintergrund sauber, nichts abgeschnitten, nicht zu klein und – mit
   Anthropic-Key – die KI-Vorprüfung). Weitere Entwürfe werden dann gar nicht erst erzeugt.
   Durchgefallenes wird nicht freigegeben: die App zeigt dort das Kategorie-Icon, und der Entwurf steht
   unter „Nicht bestanden“, wo man ihn trotzdem nehmen kann. Wer lieber selbst auswählt, schaltet
   „Automatisch freigeben“ ab.
4. Zuerst entsteht der Stil an zwölf typischen Artikeln: die ersten vier freigegebenen werden Stil-Referenz ★,
   alles Weitere wird mit ihnen als Vorlage im selben Stil erzeugt – erst Kategorien, dann die Artikel nach
   Häufigkeit, bis zum Tageslimit (Standard 150 Bilder/Tag). Referenzen lassen sich in der Übersicht ändern.
   Neue Einträge kommen sofort dran (vor den übrigen Katalogartikeln): Merklisten-Einträge und frei
   getippte Einträge auf Einkaufs- und Packlisten, die nicht im Katalog stehen. Ein frei getippter Name
   bekommt ein Bild, das jeder Eintrag mit diesem Namen auf jeder Liste mitbenutzt.
   Auch jede **Liste** bekommt ein Icon aus ihrem Namen (und ihrer Beschreibung), das in der Seitenleiste
   und der Titelzeile das Typ-Symbol ersetzt; nach dem Umbenennen entsteht ein neues, und über
   *⋮ → Neues Listen-Icon* lässt es sich jederzeit neu erzeugen.
5. Optional einen **Anthropic-Key** (Claude): Claude zeichnet Icons als SVG (Sonnet, etwa 3–4 Cent
   pro Entwurf), prüft jeden Entwurf vorab („erkennbar? Schrift? passt zum Stil?“, Haiku, unter 0,1 Cent)
   und beschreibt Artikel aus Mealie. Was die Vorprüfung aussortiert, steht hinten und ist
   blass, bleibt aber wählbar; fällt alles durch, gibt es automatisch einen zweiten Versuch.
6. Optional einen OpenAI-Key (gpt-image). Für Claude und OpenAI gilt je eine Monatsgrenze in €.

In der App kann jeder über das Artikel-Menü „Icon gefällt mir nicht“ melden.

### Mealie-Eingangskorb einrichten

1. *Einstellungen → Mealie*: Adresse und API-Token eintragen, speichern.
2. *Eingangskorb einschalten*, Mealie-Einkaufsliste und Zielliste wählen, speichern.
3. Die angezeigte Apprise-URL in Mealie unter *Haushalt → Benachrichtigungen* als
   Notifier eintragen, Ereignis *Einkaufsliste* aktivieren.
4. Einen bisherigen n8n-Flow für Mealie-Einkaufslisten abschalten.

### Home Assistant

1. In der App: *Einstellungen → API & Integrationen* ein Token mit „Lesen“ und „Ändern“
   erzeugen (für Mealie-Aktionen zusätzlich „Mealie-Import“).
2. HACS → ⋮ → *Benutzerdefinierte Repositories* → diese URL eintragen, Typ **Integration**:

   ```
   https://github.com/doenke/shopping
   ```

   Dann „Shopping“ in HACS suchen, installieren und Home Assistant neu starten.
3. *Einstellungen → Geräte & Dienste → Integration hinzufügen → Shopping*: Adresse und Token.
4. Bei der Integration **„Liste hinzufügen“** – für jede Liste, die du in Home Assistant brauchst.
   Es wird nichts automatisch angelegt; entfernen geht über ⋮ bei der Liste.

Jede hinzugefügte Liste wird eine To-do-Liste (`todo.einkauf`) plus Sensor mit der Zahl offener
Artikel. Wer die Integration schon vorher eingerichtet hatte, behält seine bisherigen Listen (gleiche
Entitäten); neue kommen nur noch über „Liste hinzufügen“ dazu. Das Integrations-Icon bringt die
Integration selbst mit (ab Home Assistant 2026.3 angezeigt). Änderungen kommen per Push sofort an. Aktionen: `shopping.add_items`,
`shopping.apply_template`, `shopping.import_mealie_recipe`, `shopping.import_mealie_mealplan`,
`shopping.clear_checked` (Liste per Name, leer = Hauptliste).

Die HA-Instanz sieht dieselben Listen wie der Nutzer, dem das Token gehört.

### KI-Assistenten (MCP)

MCP-Server-Adresse: `https://<deine-adresse>/mcp`. In Claude als *Custom Connector*
eintragen; beim Verbinden meldest du dich über Pocket ID an und erlaubst den Zugriff.
Verbundene Assistenten stehen in den Einstellungen und lassen sich dort trennen.
Für einfache Clients geht statt OAuth auch ein API-Token als `Authorization: Bearer shp_…`.

### Haushalte

Wer zu welchem Haushalt gehört, steht in Pocket ID: Lege einen **Custom Claim** `household` an – am
Benutzer oder an einer Gruppe (dann gilt er für alle Mitglieder), z. B. `household = Müller`.
Alle mit demselben Tag sehen gegenseitig ihre Listen; wer keinen Tag hat, ist im Standard-Haushalt.
Der Tag wird bei jeder Anmeldung gelesen, ein Umzug nimmt die eigenen Listen mit.

| Variable | Standard | Bedeutung |
|----------|----------|-----------|
| `OIDC_HOUSEHOLD_CLAIM` | `household` | Name des Claims mit dem Haushalts-Tag |
| `DEFAULT_HOUSEHOLD_NAME` | `Haushalt` | Name des Haushalts für alle ohne Tag |

Neue Listen sind für den ganzen Haushalt da; „Privat – nur für mich“ beim Anlegen oder „⋮ → Privat machen“
nimmt sie heraus. Über den Link lassen sich Listen weiterhin mit anderen Haushalten und Gästen teilen.
Nur Pocket-ID-Benutzer gehören zu einem Haushalt, Gäste nie.

## Versionen

App und Home-Assistant-Integration haben getrennte Versionen `x.yy.zzz`: `x` ist die Hauptversion
(`versions.json`), `yy` zählt die Tage, an denen sich die jeweilige Komponente geändert hat, `zzz` den
CI-Lauf. Das Image gibt es als `ghcr.io/doenke/shopping:latest` und mit Versionsnummer; die App zeigt ihre
Version unten in den Einstellungen. Die Integration erscheint in HACS als Release `v…` mit Update-Hinweis.

## Betrieb

1. In Pocket ID einen OIDC-Client anlegen:
   - Callback-URL: `https://<deine-adresse>/auth/callback`
   - „Public Client“ / PKCE aktiv (dann kein Client-Secret nötig)
   - Zugriff über „Allowed User Groups“ steuern
2. `.env.example` nach `.env` und `docker-compose.example.yml` nach `docker-compose.yml` kopieren, `.env` ausfüllen.
3. `docker compose up -d` – die App ist auf `127.0.0.1:38417` erreichbar (dorthin zeigt der Reverse Proxy). `docker compose ps` zeigt beide
   Dienste als `healthy`, sobald App und Datenbank laufen (`/healthz` prüft auch die Datenbank).
4. Reverse Proxy mit HTTPS davor (WebSocket-Upgrade für `/ws` erlauben).

Datenbank-Migrationen laufen beim Start automatisch. Backup: `pg_dump` der Datenbank.

## Entwicklung

Voraussetzungen: Node 22, pnpm, eine PostgreSQL-Datenbank.

```bash
pnpm install
cp .env.example .env    # DATABASE_URL, PUBLIC_URL=http://localhost:5173, SECRET_KEY, DEV_LOGIN=true
pnpm --filter @shopping/server dev   # API auf :3000
pnpm --filter @shopping/web dev      # PWA auf :5173 (leitet /api, /auth, /ws an :3000 weiter)
```

Mit `DEV_LOGIN=true` kann man sich lokal nur mit einem Namen anmelden – **niemals in Produktion**.

```bash
pnpm typecheck
pnpm test     # Server-Tests brauchen TEST_DATABASE_URL (Standard: postgres://postgres@127.0.0.1:54329/postgres)
pnpm build
```

Struktur:

| Pfad | Inhalt |
|------|--------|
| `packages/shared` | Datenmodell, Eingabe-Parser, Einheiten, Kategorien, Sync-Logik (HLC, Feld-LWW), Grundkatalog |
| `apps/server` | Fastify: OIDC, Sync (WebSocket + HTTP), Katalog, Mealie, Postgres via Drizzle |
| `apps/web` | React-PWA: Dexie (IndexedDB), Sync-Engine, Service Worker |
| `custom_components/shopping` | Home-Assistant-Integration (HACS) |
| `ha-tests` | Tests der HA-Integration gegen einen echten Server (`pip install -r ha-tests/requirements.txt`, dann `pytest` in `ha-tests`) |

## Konzept

| # | Dokument | Inhalt |
|---|----------|--------|
| 01 | [Vision & Anforderungen](docs/konzept/01-vision-und-anforderungen.md) | Ziele, Anforderungen, Abgrenzung (u. a. keine Benachrichtigungen) |
| 02 | [Architektur & Technologie](docs/konzept/02-architektur-und-technologie.md) | Docker vs. PHP-Webspace, Stack, Deployment |
| 03 | [Datenmodell](docs/konzept/03-datenmodell.md) | Tabellen, Listentypen, Vorlagen, Mengen/Einheiten |
| 04 | [Sync & Offline](docs/konzept/04-sync-und-offline.md) | Offline-first, Echtzeit-Abhaken, schlechtes Netz im Supermarkt |
| 05 | [Login & Teilen](docs/konzept/05-auth-und-teilen.md) | Pocket ID, Zugriffsmodell, Teilen per Link |
| 06 | [Mealie-Integration](docs/konzept/06-mealie-integration.md) | Ersatz für den n8n-Flow, Rezepte, Wochenplan |
| 07 | [API & Home Assistant](docs/konzept/07-api-und-home-assistant.md) | REST, Echtzeit-Events, HA-Integration |
| 08 | [MCP-Server](docs/konzept/08-mcp-server.md) | Tools, Ressourcen, Auth |
| 09 | [Lebensmittel-Datenbank](docs/konzept/09-lebensmittel-datenbank.md) | Katalog, Aliase, Eingabe-Parser |
| 10 | [Icons – Plan](docs/konzept/10-icons-plan.md) | Generierungs-Pipeline, Review, Rollout |
| 11 | [Icons – Designrichtlinie](docs/konzept/11-icon-designrichtlinie.md) | Stil, Raster, Farben, Prompt-Vorlage |
| 12 | [UX & Oberfläche](docs/konzept/12-ux-und-oberflaeche.md) | Handy, Laptop, Einkaufsmodus |
| 13 | [Roadmap & Entscheidungen](docs/konzept/13-roadmap-und-entscheidungen.md) | Phasen, getroffene Entscheidungen |
