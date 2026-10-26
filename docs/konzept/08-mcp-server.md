# 08 – MCP-Server

*Stand: Oktober 2026.*

Ein MCP-Server ist **fest eingebaut** (gleicher Prozess, gleiche Geschäftslogik wie die REST-API)
und erlaubt KI-Assistenten (Claude, Home Assistant mit LLM, n8n-Agenten …), Listen zu lesen und zu
bearbeiten.

## Transport & Auth

- **Streamable HTTP** unter `${PUBLIC_URL}/mcp`, zustandslos: pro Anfrage ein Server im Namen des
  Nutzers, JSON-Antworten.
- **OAuth 2.1 nach MCP-Spezifikation:** Shopping ist Resource Server
  (`/.well-known/oauth-protected-resource`) **und** schlanker Authorization Server
  (`/.well-known/oauth-authorization-server`): Dynamic Client Registration, PKCE S256, Login über
  Pocket ID, Zustimmungsseite „Claude möchte auf Shopping zugreifen“, Zugriffstoken 1 h,
  Refresh-Token 90 Tage mit Rotation. So bleibt Shopping unabhängig davon, was der OIDC-Provider
  kann.
- Verbundene Assistenten stehen in den Einstellungen und lassen sich dort trennen.
- **Alternative:** API-Token als Bearer, für einfache Clients.

## Tools

| Tool | Zweck |
|------|-------|
| `list_lists` | alle Listen (optional Vorlagen, archivierte) mit offenen Artikeln |
| `get_list` | Inhalt einer Liste, nach Kategorien |
| `add_items` | Artikel als natürlicher Text („2 kg Kartoffeln festkochend“) oder strukturiert |
| `update_item` | Menge, Einheit, Eigenschaften, Notiz, Kategorie ändern |
| `check_items` / `uncheck_items` | abhaken / zurück auf die Liste |
| `remove_items` | ganz entfernen |
| `create_list` | neue Liste (Typ, Beschreibung, Kategorie, privat), optional aus Vorlage |
| `archive_list` | Packliste archivieren oder zurückholen |
| `apply_template` | Vorlage in eine Liste übernehmen |
| `search_catalog` | Lebensmittel nachschlagen |
| `get_history` | zuletzt gekaufte Artikel |
| `search_mealie_recipes`, `import_mealie_recipe`, `import_mealie_mealplan` | Mealie |

Ohne Angabe einer Liste arbeiten alle Tools mit der **Hauptliste**. Listen und Artikel dürfen per
Name statt ID angesprochen werden; Mehrdeutigkeiten kommen als Fehler mit Kandidaten zurück. Die
Server-Anweisungen erklären die Listentypen (`@…`, `#…`, `!morgen`).

## Ressourcen & Prompts

- Ressource `shopping://lists/{id}`: eine Liste als Markdown.
- Prompt „Wocheneinkauf planen“: Wochenplan aus Mealie, Basis-Vorlage und Verlauf zu einer
  Einkaufsliste zusammenführen.

## Sicherheit

- Der Client handelt im Namen des Nutzers und sieht nur dessen Listen.
- Rechte wie bei API-Tokens; ganze Listen löschen geht per MCP nicht.
- Änderungen sind mit dem Client-Namen gekennzeichnet („hinzugefügt von Anna über Claude“).
