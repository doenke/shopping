# 08 – MCP-Server

Ein MCP-Server ist **fest eingebaut** (gleicher Prozess, gleiche
Geschäftslogik wie die REST-API) und erlaubt KI-Assistenten (Claude, HA
Assist mit LLM, n8n-AI-Agent …), Listen zu lesen und zu bearbeiten.

## Transport & Auth

- **Streamable HTTP** unter `https://…/mcp` (aktueller MCP-Standard für
  Remote-Server).
- **Auth nach MCP-Spezifikation (OAuth 2.1):** Shopping ist Resource Server und
  veröffentlicht `/.well-known/oauth-protected-resource`. Zwei Varianten:
  1. Shopping agiert selbst als schlanker Authorization Server (Login-Schritt
     leitet an Pocket ID weiter, Consent-Seite „Claude möchte auf
     deine Listen zugreifen“, Dynamic Client Registration) – **empfohlen**,
     unabhängig davon, was Pocket ID an MCP-Spezialitäten unterstützt.
  2. Direkt Pocket ID als Authorization Server, falls es die
     MCP-Anforderungen (u. a. Dynamic Client Registration) erfüllt –
     beim Bau prüfen.
- **Fallback:** API-Token als Bearer (für lokale/einfache Clients).

## Tools

| Tool | Zweck | Wichtige Parameter |
|------|-------|--------------------|
| `list_lists` | Alle Listen und Vorlagen | `type`, `include_templates` |
| `get_list` | Inhalt einer Liste | `list`, `include_checked` |
| `add_items` | Artikel hinzufügen; versteht Freitext | `list`, `items: ["2 kg Kartoffeln", "Milch laktosefrei"]` oder strukturiert |
| `update_item` | Menge/Einheit/Eigenschaften/Notiz ändern | `item_id`, Felder |
| `check_items` / `uncheck_items` | Abhaken | `item_ids` oder Namen |
| `remove_items` | Entfernen | `item_ids` |
| `create_list` | Neue Liste, optional aus Vorlage | `name`, `type`, `template` |
| `apply_template` | Vorlage in Liste übernehmen | `template`, `list` |
| `search_catalog` | Lebensmittel nachschlagen | `query` |
| `search_mealie_recipes` | Rezepte in Mealie finden | `query` |
| `import_mealie_recipe` | Zutaten eines Rezepts übernehmen | `recipe`, `servings`, `skip_pantry` |
| `import_mealie_mealplan` | Wochenplan übernehmen | `from`, `to`, `list` |
| `get_history` | Häufig/zuletzt gekaufte Artikel | `limit` |

Ohne Angabe von `list` arbeiten alle Tools mit der **Hauptliste** des Nutzers.
Listen und Artikel dürfen per Name statt ID angesprochen werden („Einkauf“),
Mehrdeutigkeiten werden als Fehler mit Kandidaten zurückgegeben.
Tool-Beschreibungen und Schemas werden aus denselben Zod-Schemas erzeugt
wie die REST-API.

## Ressourcen & Prompts

- Ressourcen: `shopping://lists/{id}` (Liste als Markdown), `shopping://templates`.
  Abonnierbar → Client bekommt Änderungen mit.
- Prompts: „Wocheneinkauf planen“ (Mealplan + Vorlage „Basis“ + Verlauf
  kombinieren), „Liste nach Laden sortieren“.

## Sicherheit

- Der MCP-Client handelt im Namen des angemeldeten Nutzers und sieht nur
  dessen Listen (eigene + über Link beigetretene).
- Scopes wie bei API-Tokens; standardmäßig kein Löschen ganzer Listen per MCP.
- Alle MCP-Änderungen tragen `source = mcp` und den Client-Namen →
  in der App sichtbar („hinzugefügt von Claude“), rückgängig machbar.
