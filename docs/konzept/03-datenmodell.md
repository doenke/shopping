# 03 – Datenmodell

*Stand: Oktober 2026. Maßgeblich ist `apps/server/src/db/schema.ts`; hier steht das Warum.*

IDs sind UUIDs, die der Client selbst erzeugt – offline angelegte Listen und
Artikel brauchen keinen Server-Roundtrip (siehe [04](04-sync-und-offline.md)).
Synchronisierte Zeilen tragen eine globale, fortlaufende Nummer (`seq`), pro
Feld einen HLC-Zeitstempel (`hlc`) und werden nicht gelöscht, sondern als
`deleted` markiert.

## Übersicht

```
household ─── user ─┬─ session, api_token (auch OAuth-Tokens für MCP)
                    └─ list_member (via owner | link | household)
list ─┬─ list_item
      ├─ list_member
      └─ share_link (ein aktiver Link pro Liste)
catalog_item (Einkauf und Packen)
integration (Mealie)     webhook     idempotency_key     oauth_client
icon, icon_job, icon_usage           app_settings (z. B. Bild-KI)
```

## Haushalte und Nutzer

| Tabelle | Inhalt |
|---------|--------|
| `households` | Name und Schlüssel aus dem OIDC-Claim; Schlüssel `''` ist der Standard-Haushalt |
| `users` | OIDC-Subjekt, Name, Mail, Profilbild (lokale 128-px-Kopie), `is_admin`, `is_guest`, `household_id`, `default_list_id` (Hauptliste), eigene Reihenfolgen (`category_order`, `list_order`, `section_order`) |
| `sessions` | Hash des Session-Cookies, 90 Tage gleitend |

Hauptliste und Reihenfolgen sind per Feld-LWW synchronisiert (Mutation `me`), damit sie auf allen
Geräten eines Nutzers gleich sind.

## Zugriff

Zugriff auf eine Liste haben genau die Nutzer mit einem `list_member`-Eintrag. Die Herkunft
steht in `via`:

| `via` | Entsteht, wenn … |
|-------|------------------|
| `owner` | jemand die Liste anlegt |
| `household` | die Liste für den Haushalt sichtbar ist (Standard) – alle Mitglieder des Haushalts des Besitzers |
| `link` | ein angemeldeter Nutzer oder Gast den Link öffnet |

Wer eine Liste verlässt oder entfernt wird, bekommt `removed = true` und bleibt draußen, auch wenn
der Haushalt neu abgeglichen wird. Sichtbarkeit (`household` / `private`) und Haushaltswechsel beim
Login werden über diese Einträge abgebildet; Sync, Rechte und Echtzeit brauchen dadurch keine
Sonderfälle. Katalog, Kategorien, Einheiten und Icons sind für alle gemeinsam.

## Listen

| Feld | Bedeutung |
|------|-----------|
| `name`, `owner_id` | |
| `list_type` | `shopping`, `packing`, `memo`, `todo` |
| `is_template` | Vorlage: nicht abhakbar, füllt Listen vor |
| `visibility`, `household_id` | `household` (Standard, ToDo: `private`) oder `private` |
| `icon`, `icon_name` | Versions-Token des generierten Listen-Icons; Name, für den es angefordert wurde (Umbenennen → neues Icon) |
| `settings` (JSONB) | `description` (Beschreibung), `group` (Kategorie einer ToDo-Liste), `templateId` (zuletzt abgeglichene Vorlage) |
| `archived_at` | erledigte Packliste |

### Listentypen

| Typ | Abhaken heißt | `@…` / `#…` | Katalog | Besonderes |
|-----|---------------|-------------|---------|------------|
| `shopping` | gekauft → „Zuletzt verwendet“ | – | Lebensmittel | Einkaufen-Modus |
| `packing` | eingepackt, bleibt durchgestrichen stehen | Für wen / Packstück | Packartikel | Fortschritt, Archiv |
| `memo` | erledigt (gesehen, gelesen …) | Tipp von / Wo | – | ein Icon pro Eintrag |
| `todo` | erledigt | Wer / Bereich | – | Fälligkeit `!morgen`, standardmäßig privat |

Person und Packstück (bzw. Tipp von/Wo, Wer/Bereich) teilen sich die Felder `attributes.person` und
`attributes.container`; die Bezeichnungen hängen am Typ. Kategorien sind über alle Typen eindeutig
(Packlisten haben eigene, Merk- und ToDo-Listen je eine).

### Hauptliste

Jeder Nutzer hat **seine** Hauptliste (`users.default_list_id`, ⭐), immer eine Einkaufsliste. Sie ist
Standard überall dort, wo keine Liste angegeben wird: Home Assistant, API (`/api/v1/lists/default`),
MCP, Teilen aus anderen Apps, Start der App, Vorschlag als Mealie-Ziel.

### Vorlagen

- Eine Vorlage ist eine Liste mit `is_template = true` – gleiche Artikel, gleiche Synchronisation,
  aber nicht abhakbar.
- Neue Liste aus Vorlage (Auswahl einzelner Artikel, optionale vorab abgewählt), „Als Vorlage
  speichern“, **Abgleich in beide Richtungen** (was der Liste fehlt, was der Vorlage fehlt, andere Mengen).
- `optional` pro Vorlagen-Artikel (z. B. Sonnencreme nur im Sommer).

## Listeneinträge (`list_items`)

| Feld | Bedeutung |
|------|-----------|
| `catalog_item_id` | Verweis in den Katalog (Icon, Kategorie, Einheit); `null` = freier Text |
| `name` | Anzeigename |
| `amounts` | Mengen `[{q: 1.5, u: "kg"}]`; mehrere, wenn nicht umrechenbar („2 Stk + 200 g“) |
| `properties` | Eigenschaften (`bio`, `TK`, `Handgepäck`, `dringend` …), Vokabular je Listentyp |
| `note` | freie Notiz („die von Oma“) |
| `category_id` | überschreibt die Katalog-Kategorie |
| `checked`, `checked_at`, `checked_by` | für „✓ von Anna“ |
| `position` | Fractional Index |
| `optional` | nur in Vorlagen |
| `attributes` | `person`, `container`, `due` (JJJJ-MM-TT), `sources` (Herkunft), `via` (Token- oder MCP-Client-Name) |
| `icon` | Versions-Token eines eigenen Icons (Merklisten-Einträge, frei getippte Einträge) |
| `created_by`, `merged_into` | Herkunft; zusammengeführte Duplikate verweisen auf den Eintrag, der bleibt |

### Herkunft & Zusammenführen

`attributes.sources` merkt sich, woher ein Artikel kommt (`mealie_recipe`, `mealie_list`,
`mealie_mealplan`, `template`, … mit Text wie „Chili con Carne“).

Kommt derselbe Artikel ein zweites Mal auf eine Liste (offen), wird **zusammengeführt** statt
dupliziert:

- gleiche oder umrechenbare Einheit (g ↔ kg, ml ↔ l, EL ↔ TL) → addieren und sinnvoll normalisieren (1200 g → 1,2 kg);
- nicht umrechenbar → mehrere Mengen („2 Stk + 200 g“);
- andere Eigenschaften (bio vs. nicht bio) oder auf Packlisten andere Person/Packstück → zwei Einträge;
- ein zuletzt gekaufter Artikel kommt zurück auf die Liste, statt neu angelegt zu werden.

Dieselbe Logik (`planAdd` in `packages/shared`) läuft in der App, im Server, in API und MCP.

## Einheiten und Eigenschaften

Einheiten sind fest im Code (`packages/shared/src/units.ts`): g, kg, ml, cl, l, EL, TL, Stk, Pck,
Dose, Glas, Flasche, Becher, Tüte, Netz, Kiste, Bund, Kopf, Zehe, Scheibe, Prise – mit Aliasen
(„Stück“, „Päckchen“, „Esslöffel“ …) und Dimension (Masse, Volumen, Anzahl).

Eigenschaften, die der Parser erkennt und der Editor vorschlägt, hängen am Listentyp
(`packages/shared/src/properties.ts`); Merklisten erkennen keine, damit Titel ganz bleiben.

## Katalog, Kategorien, Icons

Siehe [09](09-lebensmittel-datenbank.md) und [10](10-icons-plan.md).

## Integrationen & Maschinen-Zugriff

| Tabelle | Inhalt |
|---------|--------|
| `integrations` | Mealie: Besitzer, Konfiguration (Token verschlüsselt), Status, letzter Abgleich |
| `api_tokens` | API-Tokens **und** OAuth-Tokens für MCP (`kind`), nur als Hash, Rechte `read`/`write`/`mealie` |
| `oauth_clients` | per Dynamic Client Registration angemeldete MCP-Clients |
| `share_links` | ein aktiver Link pro Liste, nur als Hash |
| `webhooks` | Ziel-URL, Geheimnis, gespeicherte Position im Änderungsstrom, Fehlerzähler |
| `idempotency_keys` | Antworten auf `Idempotency-Key` (24 h) |
