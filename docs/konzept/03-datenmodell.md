# 03 – Datenmodell

Alle IDs sind **UUIDv7**, vom Client erzeugbar (wichtig für Offline-Anlage,
siehe [04](04-sync-und-offline.md)). Jede synchronisierte Tabelle hat
`updated_hlc` (Hybrid Logical Clock), `server_seq` und `deleted_at`
(Tombstone statt hartem Löschen).

## Übersicht

Jeder angemeldete Nutzer darf Listen anlegen. Eine Liste sehen und
bearbeiten nur ihr **Besitzer** und alle, die den **Link** der Liste
geöffnet haben (siehe [05](05-auth-und-teilen.md)). Es gibt keine Rollen
und keine Haushaltsverwaltung.

```
user ─┬─ api_token
      ├─ list (owner)
      └─ list_member (über Link beigetreten)
list ─┬─ list_item ── list_item_source
      ├─ list_member
      └─ share_link (ein aktiver Link pro Liste)
catalog_item ─┬─ catalog_alias        unit ── unit_alias
              ├─ category             property (Eigenschaften-Vokabular)
              └─ icon (Versionen)
item_history („Zuletzt verwendet“, Vorschläge)
integration (Mealie)
change_log (server_seq, für Sync)
```

## Nutzer

| Tabelle | Felder (Auszug) |
|---------|-----------------|
| `user` | id, oidc_subject, email, display_name, avatar_url, `default_list_id` (persönliche Hauptliste), is_admin (aus Pocket-ID-Gruppe `admins`, derzeit ohne Auswirkung) |
| `list_member` | list_id, user_id, joined_at – entsteht, wenn ein angemeldeter Nutzer den Link öffnet |
| `guest` | id, share_link_id, display_name? – Gast ohne Account, der den Link geöffnet hat |

Zugriff auf eine Liste = `owner_id = user` **oder** Eintrag in `list_member`
(bzw. Gast-Session über einen gültigen Link). Katalog, Kategorien, Einheiten
und Icons sind dagegen für alle angemeldeten Nutzer gemeinsam.

## Listen – generisch von Anfang an

| Feld | Bedeutung |
|------|-----------|
| `id`, `name`, `icon`, `color` | |
| `owner_id` | wer die Liste angelegt hat |
| `list_type` | `shopping` (MVP), später `packing`, `todo`, … |
| `is_template` | `true` = Vorlage: nicht abhakbar, nur zum Vorbefüllen |
| `settings` (JSONB) | typspezifisch, z. B. Sortiermodus, Standard-Laden |
| `archived_at` | z. B. erledigte Packliste |

**Listentyp** bestimmt, welche Artikel-Felder und welche UI gelten:

| Typ | Abhaken heißt | Typische Zusatzfelder | Katalog |
|-----|---------------|-----------------------|---------|
| `shopping` | gekauft → wandert in „Zuletzt verwendet“ | Menge, Einheit, Eigenschaften, Kategorie | Lebensmittel |
| `packing` (später) | eingepackt, bleibt sichtbar durchgestrichen | Person, Behälter („Koffer“, „Handgepäck“) | Packartikel |
| `todo` (später) | erledigt | Fälligkeit | – |

Der Code behandelt `list_type` über eine kleine Registry
(`packages/shared/listTypes/*`), die Felder, Abhak-Verhalten und Katalog
festlegt. Neue Typen = neuer Registry-Eintrag, keine Schema-Migration.

### Hauptliste

Jeder Nutzer hat **seine** Hauptliste (`user.default_list_id`, ⭐ in der UI,
umstellbar per „Als Hauptliste festlegen“). Das kann eine eigene oder eine
über Link beigetretene Liste sein – typischerweise die gemeinsame
Haushalts-Einkaufsliste. Sie ist der Standard überall dort, wo keine Liste
angegeben wird:

- Standard für Home Assistant, Sprachbefehle, API ohne `list` und MCP
  (jeweils die Hauptliste des Nutzers, dem das Token gehört)
- Vorgeschlagenes Ziel beim Einrichten des Mealie-Eingangskorbs ([06](06-mealie-integration.md))
- Start-Ansicht der App

Die API bietet den Alias `/api/v1/lists/default`.
Die Reihenfolge der Listen in der Seitenleiste ist pro Nutzer (`list_member.position` bzw. Besitzer-Einstellung).

### Vorlagen

- Eine Vorlage ist eine Liste mit `is_template = true` – gleiche Artikel,
  gleiche Bearbeitung, gleiche Synchronisation.
- Unterschied: **keine Abhak-Funktion** (UI blendet Checkboxen aus, API lehnt
  `check` mit `409 template_not_checkable` ab).
- Aktionen:
  - **Neue Liste aus Vorlage** – kopiert alle Artikel.
  - **Vorlage in bestehende Liste übernehmen** – fügt hinzu, gleiche Artikel werden zusammengeführt (Mengen addiert).
  - **Liste als Vorlage speichern**.
- Optional pro Vorlagen-Artikel `optional = true`: beim Übernehmen erst mal
  abgewählt im Übernahme-Dialog (z. B. Packliste „Sonnencreme“ nur im Sommer).
- Beispiele: „Wocheneinkauf Basis“, „Grillabend“, „Wochenend-Trip“ (Packliste).

## Listeneinträge

| Feld | Typ | Bedeutung |
|------|-----|-----------|
| `id`, `list_id` | uuid | |
| `catalog_item_id` | uuid? | Verweis in den Katalog (Icon, Kategorie, Einheiten); `null` = Freitext |
| `name` | text | Anzeigename (Kopie aus Katalog oder Freitext) |
| `quantity` | numeric? | z. B. `1.5` |
| `unit_id` | uuid? | z. B. kg |
| `properties` | text[] | strukturierte Eigenschaften: `bio`, `TK`, `laktosefrei`, … |
| `note` | text? | Freitext-Spezifikation wie bei Bring („die von Oma“) |
| `category_id` | uuid? | überschreibt Katalog-Kategorie |
| `checked` | bool | |
| `checked_at`, `checked_by` | | für „von Anna abgehakt“ |
| `position` | text | Fractional Index für manuelle Sortierung |
| `optional` | bool | nur in Vorlagen relevant |
| `attributes` | JSONB | typspezifische Felder (Packliste: Person, Behälter) |
| `created_by`, `updated_hlc`, `server_seq`, `deleted_at` | | Sync |

### Anzeige von Menge/Einheit/Eigenschaften

Auf der Kachel wie bei Bring unter dem Namen, z. B.
**Hackfleisch** · *500 g · gemischt · bio*.
Die Formatierung (Dezimalkomma, Brüche „½“, Plural) liegt in `packages/shared`.

### Herkunft & Zusammenführen

`list_item_source` merkt sich, woher Teilmengen kommen:

| Feld | Beispiel |
|------|----------|
| `list_item_id` | Zwiebeln |
| `source_type` | `mealie_recipe`, `mealie_list`, `template`, `manual`, `api`, `mcp` |
| `source_ref` | Mealie-Rezept-ID / Item-ID |
| `source_label` | „Chili con Carne“ |
| `quantity`, `unit_id` | 2 Stk |

Kommt derselbe Katalogartikel ein zweites Mal auf eine Liste (offen, nicht
abgehakt), wird **zusammengeführt** statt dupliziert:

- gleiche oder umrechenbare Einheit (g ↔ kg, ml ↔ l, EL ↔ TL) → addieren und
  in sinnvolle Einheit normalisieren (1200 g → 1,2 kg);
- nicht umrechenbar (2 Stk + 200 g) → Anzeige „2 Stk + 200 g“, Teilmengen
  bleiben in `list_item_source` erhalten;
- unterschiedliche Eigenschaften (bio vs. nicht bio) → zwei Einträge.

In der Detailansicht sieht man dann: *Zwiebeln 3 Stk – Chili (2), Salat (1)*.

## Einheiten

| Feld | Beispiel |
|------|----------|
| `name`, `plural`, `abbreviation` | Kilogramm / Kilogramm / kg |
| `dimension` | `mass`, `volume`, `count`, `package`, `other` |
| `base_factor` | 1000 (in Gramm) |
| `display_rules` | ab welchem Wert in größere Einheit wechseln |
| `mealie_unit_id` | Verknüpfung |

Mitgelieferter Grundstock: g, kg, ml, l, Stk, Pck, Dose, Glas, Flasche,
Bund, Kopf, Becher, Netz, Tüte, Prise, EL, TL, Scheibe, Zehe.
Aliase (`unit_alias`): „Stück“, „St.“, „Päckchen“, „Esslöffel“ …

## Eigenschaften

`property`-Vokabular (Name, Kurzlabel, optional Farbe):
`bio`, `TK`, `vegan`, `laktosefrei`, `glutenfrei`, `groß`, `klein`,
`reif`, `Angebot` … Frei erweiterbar; beim Tippen „Milch laktosefrei“
erkennt der Parser bekannte Eigenschaften (siehe [09](09-lebensmittel-datenbank.md)).

## Katalog, Kategorien, Icons

Siehe [09](09-lebensmittel-datenbank.md) und [10](10-icons-plan.md).

## Verlauf & Vorschläge

`item_history` (catalog_item_id/name, quantity, unit, properties,
last_used_at, use_count) speist „Zuletzt verwendet“, die Autovervollständigung
(gewichtet nach Häufigkeit) und die Priorisierung der Icon-Generierung.

## Integrationen & Tokens

| Tabelle | Inhalt |
|---------|--------|
| `integration` | owner_id, type (`mealie`), target_list_id, config (JSONB, Secrets verschlüsselt), status, last_sync_at |
| `api_token` | user_id, name, token_hash, scopes, list_ids?, last_used_at, expires_at – sieht nur die Listen seines Nutzers |
| `share_link` | list_id, token_hash, created_at, revoked_at – genau ein aktiver Link pro Liste, keine Rollen |

## Änderungsprotokoll

`change_log(server_seq bigserial, list_id, entity, entity_id, op, patch JSONB, hlc, actor)`

Grundlage für Delta-Sync (`since=server_seq`), SSE-Events und Webhooks.
Wird nach z. B. 90 Tagen kompaktiert; ältere Clients machen dann einen Voll-Sync.
