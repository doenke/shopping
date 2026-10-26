# 13 – Roadmap & Entscheidungen

## Entscheidungen

| Thema | Entscheidung |
|-------|--------------|
| Name | **Shopping** |
| Hosting | Docker (App + PostgreSQL), nicht PHP-Webspace |
| Sprache | TypeScript durchgehend, Monorepo |
| Client | PWA (React), Android-Fokus; native Hülle erst bei Bedarf |
| Sync | Offline-first, eigene Outbox + Delta-Sync, Feld-LWW mit HLC, WebSocket |
| Login | **Pocket ID** (OIDC); wer sich anmelden darf, steuern Gruppen in Pocket ID; Gruppe `admins` wird gelesen, aber vorerst nicht genutzt |
| Zugriff | Jeder angemeldete Nutzer darf Listen anlegen. Andere sehen und bearbeiten eine Liste **nur, wenn sie ihren Link geöffnet haben** – angemeldet werden sie dauerhaft Mitglied, ohne Account Gast. Keine Rollen, kein „nur ansehen“, keine Haushaltsverwaltung |
| Link | ein Link pro Liste, verschickt über den Teilen-Dialog des Handys; Besitzer kann ihn erneuern und Mitglieder entfernen; der Server versendet keine Mails |
| Listentypen | generisch über `list_type` + `is_template`, Start nur mit `shopping` |
| Hauptliste | jeder Nutzer hat seine Hauptliste; Standard für HA, MCP, API und Startansicht, Vorschlag als Mealie-Ziel |
| Mealie | **v2**; Mealie-Liste bleibt **Eingangskorb wie heute** (übernehmen + in Mealie abhaken, kein Rückkanal); alles landet in einer Zielliste; plus Rezept-/Wochenplan-Import |
| Kategorien | die 14 Kategorien wie bei Bring!, Reihenfolge änderbar; keine Laden-Profile |
| Icons | keine GPU → Gratis-Kontingente (bevorzugt Gemini mit Referenzbildern), über Wochen gestreckt; bezahlter Dienst nur als Fallback mit Kostendeckel |
| Bring-Daten | werden **nicht** übernommen |
| Benachrichtigungen | **keine** – kein Push, keine Hinweis-Mails, keine Matrix-Meldungen |
| HA | eigene Custom Integration mit `todo`-Entitäten, Push via SSE |
| MCP | im Server eingebaut, Streamable HTTP, OAuth über Pocket ID |

## Phasen

### Phase 1 – Fundament (MVP) ✅ umgesetzt
- Monorepo, Docker-Compose, CI
- Login mit Pocket ID, Listen mit Besitzer
- Einkaufslisten mit Hauptliste: Artikel mit Menge/Einheit/Eigenschaften/Notiz
- Offline-Sync + WebSocket-Echtzeit, PWA installierbar
- Katalog-Import aus Mealie, Grundkatalog, Bring!-Kategorien, Eingabe-Parser
- Kachel-UI (Handy) + Drei-Spalten-UI (Laptop), Buchstaben-Fallback statt Icons
- **Meilenstein:** Wocheneinkauf damit erledigen, zu zweit, im echten Supermarkt.

Aus Phase 2 vorgezogen, weil der Meilenstein „zu zweit“ sonst nicht erreichbar ist:
**Beitreten per Link** für angemeldete Nutzer (Link teilen, erneuern, Liste verlassen).

Bewusst noch offen aus Phase 1: Kategorien-Reihenfolge per Drag & Drop
(derzeit feste Bring!-Reihenfolge), Pflege-Ansicht für den Katalog (Dubletten,
Ausblenden).

### Phase 2 – Bring ablösen ✅ umgesetzt
- Mealie-Eingangskorb (Webhook + Abgleich alle 15 min) → n8n-Flow „mealie2bring“ abschalten
- Rezept- und Wochenplan-Import
- Vorlagen
- Gastzugang per Link ohne Account, Mitglieder anzeigen/entfernen

Umsetzungsdetails:
- Der Webhook ist nur ein Anstoß: Shopping liest die Mealie-Liste immer komplett neu.
  Jeder Mealie-Artikel bekommt eine feste ID, so entsteht auch bei doppelten Webhooks
  oder gescheitertem Abhaken in Mealie nie ein Duplikat.
- Herkunft („für Chili con Carne“) steht in `attributes.sources` und bleibt beim
  Zusammenführen erhalten.
- Beim Skalieren von Rezepten werden Stück und Packungen aufgerundet (¾ Dose → 1 Dose).
- Gäste sind eigene Nutzer (`is_guest`), dürfen nur in ihrer Liste arbeiten, keine Listen
  anlegen und nicht an Einstellungen/Integrationen.

### Phase 3 – Offen machen ✅ umgesetzt
- REST-API mit Tokens, OpenAPI, SSE
- Home-Assistant-Integration (HACS)
- MCP-Server

Umsetzungsdetails:
- Token-Berechtigungen vereinfacht auf `read`, `write`, `mealie` (statt feiner Scopes).
- Eine gemeinsame Dienstschicht für REST und MCP; alle Schreibzugriffe laufen über
  die Sync-Engine und sind sofort in den Apps sichtbar.
- MCP-Server zustandslos (Streamable HTTP, JSON-Antworten), OAuth 2.1 mit Shopping als
  Authorization Server (dynamische Client-Registrierung, PKCE, Zustimmungsseite,
  Refresh-Token-Rotation, Zugriffstoken 1 h, Refresh 90 Tage).
- Die HA-Integration liegt im selben Repo (`custom_components/`, `hacs.json`) statt in
  einem eigenen; sie wird in der CI in einem echten Home Assistant gegen einen echten
  Server getestet.

### Phase 4 – Icons ✅ umgesetzt (Pipeline; die Icons selbst entstehen im Betrieb)
- Stil finden (Anker-Set) direkt in der App, alternativ eigene Bilder hochladen
- Kategorie-Icons, Review-Ansicht, Generierung mit Tagesbudget

Umsetzungsdetails:
- Gratis-Anbieter ist **Cloudflare Workers AI mit FLUX.2 [klein]** (Stand Oktober 2026):
  Tageskontingent von 10.000 Neurons, bis zu 4 Referenzbilder pro Anfrage, rund 50 Neurons
  pro 512er-Icon mit Referenzen. Die Gemini-Bild-API hat inzwischen kein Gratis-Kontingent
  mehr. Bezahl-Option: OpenAI gpt-image mit Monats-Kostengrenze.
- FLUX kann keine Transparenz: Es zeichnet auf Magenta (#FF00FF), Shopping stellt frei
  (Flutfüllung vom Rand, weiche Kanten, Farbsaum entfernt, Bodenschatten mit entfernt).
- Bilder liegen in PostgreSQL statt im Dateisystem: kein zusätzliches Volume, das Backup
  per `pg_dump` enthält sie. Abgelehnte Entwürfe verlieren ihre Bilddaten.
- Englische Bildmotive für den Grundkatalog sind fest hinterlegt; Artikel aus Mealie
  bekommen ihr Motiv von einem kleinen Textmodell (Cloudflare), in der Prüfung änderbar.
- Ab 4 Stil-Referenzen (★) beginnt die Massenerzeugung: erst Kategorien, dann Artikel nach
  Häufigkeit auf den Listen. Neue Katalogartikel werden automatisch eingeplant.
- Auslieferung unter `/icons/item/{id}.webp?v=…` (öffentlich, unveränderlich gecacht),
  die PWA lädt alle freigegebenen Icons im Hintergrund vor und hat sie offline.
- Automatische Prüfungen: Hintergrund sauber, Motiv nicht angeschnitten, nicht zu klein.
- **Automatische Freigabe** (Standard, abschaltbar): der erste Entwurf, der alle Prüfungen besteht, geht
  sofort live; danach werden keine weiteren Entwürfe bezahlt. Im Stil-Schritt werden die ersten vier
  automatisch Stil-Referenz. Durchgefallenes bleibt ohne Freigabe (Kategorie-Icon) und kann von Hand
  genommen werden. Abweichung vom Konzept („jedes Icon wird vor Freigabe angesehen“) auf Wunsch.
- **Claude** (optional, Anthropic-Key): zeichnet Icons als SVG (Sonnet 5.5; Referenzen sind die
  SVG-Quellen der Stil-Anker, sonst deren Bilder), prüft jeden Entwurf per Bildverständnis vor
  (Haiku 5.5: erkennbar, keine Schrift, passt zum Stil – ersetzt die geplante OCR-Prüfung) und
  beschreibt Mealie-Artikel. SVGs werden vor dem Rendern auf erlaubte Elemente geprüft (keine
  externen Verweise, kein Text, kein Skript). Kosten werden aus den echten Token-Zahlen
  verbucht, mit Monatsgrenze. Bei Sicherheits-Ablehnungen springt serverseitig ein anderes
  Modell ein (`fallbacks: "default"`, nur Sonnet/Opus).

### Phase 5 – Ausbau ✅ umgesetzt (ohne Android-App)
- Packlisten (zweiter Listentyp)
- ~~TWA/Capacitor für Homescreen-Widget und Play Store~~ – verworfen, die PWA reicht

Umsetzungsdetails:
- Packlisten haben einen eigenen Katalog (`catalog_items.kind = 'packing'`, ~120 Artikel) und eigene
  Kategorien; Kategorie-IDs sind über alle Listentypen eindeutig.
- **Person** (frei getippt) und **Packstück** stehen in `attributes`; „@Anna“/„#Koffer“ im Eingabefeld.
  Gleiche Artikel werden nur zusammengeführt, wenn Person und Packstück gleich sind (auch beim
  serverseitigen Duplikat-Abgleich).
- Eingepackt bleibt sichtbar (durchgestrichen); Gruppierung nach Kategorie, Packstück oder Person.
- Neue Packlisten **aus Vorlage** (Vorlage bestimmt den Typ); erledigte werden archiviert, nicht
  zurückgesetzt. Vorlagen und Listen verschiedener Typen lassen sich nicht mischen (409).
- Änderungen über Tokens/MCP tragen `attributes.via` (Token- bzw. Client-Name).
- Ausgehende Webhooks: eigener Änderungsstrom pro Webhook mit gespeicherter Position (Nachlieferung
  nach Ausfall/Neustart), Signatur `t=…,v1=HMAC-SHA256`, 3 Wiederholungen, nach 20 Fehlschlägen aus.
- `Idempotency-Key` für schreibende REST-Aufrufe (24 h).

### Merklisten ✅ umgesetzt
- Dritter Listentyp `memo` für Filme, Bücher, Restaurants …; kein Katalog, Einträge sind freier Text.
- „Tipp von“ und „Wo“ nutzen dieselben Felder wie Person/Packstück (`@…`, `#…`), API-Namen `tipFrom`/`where`.
- Abgehakt = erledigt (gesehen, gelesen, besucht), bleibt unter „Erledigt“.
- Listen haben eine Beschreibung (`settings.description`, für alle Typen).
- Jeder Eintrag bekommt ein eigenes Icon (Icon-Ziel `entry`, Token in `list_items.icon`, vom Server
  gesetzt und mitsynchronisiert). Die Bildbeschreibung entsteht aus Eintrag, Listenname,
  **Listenbeschreibung** und „Wo“ (Claude Haiku bzw. Cloudflare-Textmodell) und steht auch im Bildprompt.

## Noch offen

Nichts Blockierendes. Beim Bau zu klären:

- Ob Pocket ID die MCP-OAuth-Anforderungen direkt erfüllt (sonst übernimmt Shopping die Rolle, siehe [08](08-mcp-server.md)).
- Aktuelle Gratis-Limits der Bild-Dienste.

### Haushalte ✅ umgesetzt
- Haushalt = OIDC-Claim (Standard `household`, z. B. Custom Claim in Pocket ID); ohne Tag Standard-Haushalt
  mit konfigurierbarem Namen (`DEFAULT_HOUSEHOLD_NAME`). Gäste gehören zu keinem Haushalt.
- Listen sind standardmäßig für den Haushalt des Besitzers sichtbar (`visibility = household`) oder privat.
- Umgesetzt über die vorhandenen Mitgliedschaften (`list_members.via = owner | link | household`):
  Sync, Rechte und Echtzeit bleiben unverändert. Wer eine Liste verlässt, bleibt draußen, bis sie
  neu geteilt wird. Ein Haushaltswechsel (beim Login) nimmt die eigenen Listen mit.
- Bestehende Daten: alle Accounts und Listen landen bei der Migration im Standard-Haushalt.

