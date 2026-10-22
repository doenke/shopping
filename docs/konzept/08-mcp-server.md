# 08 – MCP-Server

Ein MCP-Server ist **fest eingebaut** (gleicher Prozess, gleiche
Geschäftslogik wie die REST-API) und erlaubt KI-Assistenten (Claude, HA
Assist mit LLM, n8n-AI-Agent …), Listen zu lesen und zu bearbeiten.

## Transport & Auth

- **Streamable HTTP** unter `https://…/mcp` (aktueller MCP-Standard für
  Remote-Server).
- **Auth nach MCP-Spezifikation (OAuth 2.1):** Korb ist Resource Server und
  veröffentlicht `/.well-known/oauth-protected-resource`. Zwei Varianten:
  1. Korb agiert selbst als schlanker Authorization Server (Login-Schritt
     leitet an den OIDC-Provider weiter, Consent-Seite „Claude möchte auf
     deine Listen zugreifen“, Dynamic Client Registration) – **empfohlen**,
     funktioniert mit jedem OIDC-Provider.
  2. Direkt der OIDC-Provider als Authorization Server, falls er die
     MCP-Anforderungen (DCR) erfüllt.
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

Listen und Artikel dürfen per Name statt ID angesprochen werden („Einkauf“),
Mehrdeutigkeiten werden als Fehler mit Kandidaten zurückgegeben.
Tool-Beschreibungen und Schemas werden aus denselben Zod-Schemas erzeugt
wie die REST-API.

## Ressourcen & Prompts

- Ressourcen: `korb://lists/{id}` (Liste als Markdown), `korb://templates`.
  Abonnierbar → Client bekommt Änderungen mit.
- Prompts: „Wocheneinkauf planen“ (Mealplan + Vorlage „Basis“ + Verlauf
  kombinieren), „Liste nach Laden sortieren“.

## Sicherheit

- Scopes wie bei API-Tokens; standardmäßig kein Löschen ganzer Listen per MCP.
- Alle MCP-Änderungen tragen `source = mcp` und den Client-Namen →
  in der App sichtbar („hinzugefügt von Claude“), rückgängig machbar.
