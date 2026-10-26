"""End-to-end tests: Home Assistant <-> real Shopping server."""

from __future__ import annotations

import asyncio
from collections.abc import Callable

from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.helpers import entity_registry as er
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.shopping.const import CONF_LIST_ID, CONF_TOKEN, CONF_URL, DOMAIN, SUBENTRY_LIST

from conftest import ShoppingServer


async def wait_for(hass: HomeAssistant, cond: Callable[[], bool], timeout: float = 5) -> None:
    """Waits for something pushed via server-sent events (no polling involved)."""
    end = asyncio.get_running_loop().time() + timeout
    while not cond():
        if asyncio.get_running_loop().time() > end:
            raise AssertionError("timeout")
        await asyncio.sleep(0.05)
        await hass.async_block_till_done()


def list_id(shopping: ShoppingServer, name: str) -> str:
    return next(l["id"] for l in shopping.request("GET", "/api/v1/lists") if l["name"] == name)  # type: ignore[union-attr,index]


async def setup(hass: HomeAssistant, shopping: ShoppingServer, token: str | None = None, lists: tuple[str, ...] = ("Einkauf",)) -> MockConfigEntry:
    """The account with the given lists added (as "Liste hinzufügen" would)."""
    entry = MockConfigEntry(
        domain=DOMAIN,
        version=2,
        unique_id=f"{shopping.url}#{shopping.request('GET', '/api/v1/me')['id']}",  # type: ignore[index]
        data={CONF_URL: shopping.url, CONF_TOKEN: token or shopping.new_token()},
        subentries_data=[
            {"data": {CONF_LIST_ID: list_id(shopping, n)}, "subentry_type": SUBENTRY_LIST, "title": n, "unique_id": list_id(shopping, n)}
            for n in lists
        ],
    )
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


async def add_list(hass: HomeAssistant, entry: MockConfigEntry, name: str) -> None:
    """"Liste hinzufügen" on the integration page."""
    result = await hass.config_entries.subentries.async_init((entry.entry_id, SUBENTRY_LIST), context={"source": "user"})
    assert result["type"] is FlowResultType.FORM
    options = result["data_schema"].schema[CONF_LIST_ID].container
    chosen = next(k for k, v in options.items() if v.endswith(name))
    done = await hass.config_entries.subentries.async_configure(result["flow_id"], {CONF_LIST_ID: chosen})
    assert done["type"] is FlowResultType.CREATE_ENTRY
    assert done["title"] == name
    await hass.async_block_till_done()


async def get_items(hass: HomeAssistant, entity_id: str) -> list[dict]:
    res = await hass.services.async_call("todo", "get_items", {}, target={"entity_id": entity_id}, blocking=True, return_response=True)
    return res[entity_id]["items"]


async def test_config_flow(hass: HomeAssistant, shopping: ShoppingServer) -> None:
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": "user"})
    assert result["type"] is FlowResultType.FORM

    bad = await hass.config_entries.flow.async_configure(result["flow_id"], {CONF_URL: shopping.url, CONF_TOKEN: "shp_falsch"})
    assert bad["errors"] == {"base": "invalid_auth"}

    down = await hass.config_entries.flow.async_configure(result["flow_id"], {CONF_URL: "http://127.0.0.1:1", CONF_TOKEN: "shp_x"})
    assert down["errors"] == {"base": "cannot_connect"}

    ok = await hass.config_entries.flow.async_configure(result["flow_id"], {CONF_URL: f"{shopping.url}/", CONF_TOKEN: shopping.new_token()})
    assert ok["type"] is FlowResultType.CREATE_ENTRY
    assert ok["title"] == "Shopping (Anna)"
    assert ok["data"][CONF_URL] == shopping.url
    entry = hass.config_entries.async_entries(DOMAIN)[0]
    await hass.async_block_till_done()
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_todo_list_with_live_updates(hass: HomeAssistant, shopping: ShoppingServer) -> None:
    entry = await setup(hass, shopping)
    entity = "todo.einkauf"
    assert hass.states.get(entity) is not None

    # Assist / todo.add_item: free text goes through Shopping's parser.
    await hass.services.async_call("todo", "add_item", {"item": "2 Liter Milch laktosefrei"}, target={"entity_id": entity}, blocking=True)
    await wait_for(hass, lambda: hass.states.get(entity).state == "1")
    items = await get_items(hass, entity)
    assert items[0]["summary"] == "Milch"
    assert items[0]["description"] == "2 l · laktosefrei"
    assert hass.states.get("sensor.einkauf_open_items").state == "1"

    # Someone ticks it off in the app -> pushed to HA.
    shopping.request("POST", f"/api/v1/items/{items[0]['uid']}/check")
    await wait_for(hass, lambda: hass.states.get(entity).state == "0")
    assert (await get_items(hass, entity))[0]["status"] == "completed"

    # And back from HA.
    await hass.services.async_call(
        "todo", "update_item", {"item": "Milch", "status": "needs_action", "description": "3 l"}, target={"entity_id": entity}, blocking=True
    )
    milk = shopping.request("GET", "/api/v1/lists/default")["items"][0]  # type: ignore[index]
    assert milk["checked"] is False
    assert milk["specification"] == "3 l"

    await hass.services.async_call("todo", "remove_item", {"item": "Milch"}, target={"entity_id": entity}, blocking=True)
    assert shopping.request("GET", "/api/v1/lists/default?items=all")["items"] == []  # type: ignore[index]

    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_new_lists_and_actions(hass: HomeAssistant, shopping: ShoppingServer) -> None:
    entry = await setup(hass, shopping)
    token = shopping.new_token()

    # A new list created elsewhere does not show up by itself – it is added by hand.
    template = shopping.request("POST", "/api/v1/lists", {"name": "Grillabend", "isTemplate": True}, token)
    shopping.request("POST", f"/api/v1/lists/{template['id']}/items", {"text": "Würstchen, Grillkohle"}, token)  # type: ignore[index]
    shopping.request("POST", "/api/v1/lists", {"name": "Drogerie"}, token)
    await entry.runtime_data.async_refresh()
    await hass.async_block_till_done()
    assert hass.states.get("todo.drogerie") is None

    result = await hass.config_entries.subentries.async_init((entry.entry_id, SUBENTRY_LIST), context={"source": "user"})
    offered = list(result["data_schema"].schema[CONF_LIST_ID].container.values())
    assert offered == ["🛒 Drogerie"]  # not the main list (already added), no templates
    await hass.config_entries.subentries.async_configure(result["flow_id"], {CONF_LIST_ID: list_id(shopping, "Drogerie")})
    await hass.async_block_till_done()
    await wait_for(hass, lambda: hass.states.get("todo.drogerie") is not None)
    assert hass.states.get("todo.grillabend") is None
    assert hass.states.get("todo.einkauf") is not None

    # Nothing left to add.
    nothing = await hass.config_entries.subentries.async_init((entry.entry_id, SUBENTRY_LIST), context={"source": "user"})
    assert nothing["reason"] == "no_lists"

    res = await hass.services.async_call(
        DOMAIN, "add_items", {"items": ["Zahnpasta", "Duschgel"], "list": "Drogerie"}, blocking=True, return_response=True
    )
    assert [a["name"] for a in res["added"]] == ["Zahnpasta", "Duschgel"]
    await hass.services.async_call(DOMAIN, "apply_template", {"template": "Grillabend"}, blocking=True)
    await wait_for(hass, lambda: hass.states.get("todo.einkauf").state == "2")
    await hass.services.async_call(DOMAIN, "clear_checked", {"list": "Drogerie"}, blocking=True)

    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_revoked_token_asks_for_reauth(hass: HomeAssistant, shopping: ShoppingServer) -> None:
    token = shopping.new_token()
    entry = await setup(hass, shopping, token)
    tokens = shopping.request("GET", "/api/v1/tokens")
    token_id = next(t["id"] for t in tokens if token.startswith(t["prefix"]))  # type: ignore[union-attr]
    shopping.request("DELETE", f"/api/v1/tokens/{token_id}")

    await entry.runtime_data.async_refresh()
    await hass.async_block_till_done()
    flows = hass.config_entries.flow.async_progress()
    assert any(f["context"]["source"] == "reauth" for f in flows)

    result = await hass.config_entries.flow.async_configure(
        next(f["flow_id"] for f in flows if f["context"]["source"] == "reauth"), {CONF_TOKEN: shopping.new_token()}
    )
    assert result["reason"] == "reauth_successful"
    await hass.async_block_till_done()
    assert entry.state is ConfigEntryState.LOADED
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_todo_list_with_due_dates(hass: HomeAssistant, shopping: ShoppingServer) -> None:
    entry = await setup(hass, shopping)
    shopping.request("POST", "/api/v1/lists", {"name": "Haus", "type": "todo"})
    entity = "todo.haus"
    await add_list(hass, entry, "Haus")
    await wait_for(hass, lambda: hass.states.get(entity) is not None)
    # ToDo lists support due dates (feature flag), grocery lists do not.
    assert hass.states.get(entity).attributes["supported_features"] & 16
    assert not hass.states.get("todo.einkauf").attributes["supported_features"] & 16

    await hass.services.async_call(
        "todo", "add_item", {"item": "Reifen wechseln", "due_date": "2026-11-20", "description": "Winterreifen"}, target={"entity_id": entity}, blocking=True
    )
    await wait_for(hass, lambda: hass.states.get(entity).state == "1")
    items = await get_items(hass, entity)
    assert items[0]["summary"] == "Reifen wechseln"
    assert items[0]["due"] == "2026-11-20"
    assert items[0]["description"] == "Winterreifen"

    await hass.services.async_call("todo", "update_item", {"item": "Reifen wechseln", "due_date": "2026-11-22"}, target={"entity_id": entity}, blocking=True)
    task = shopping.request("GET", "/api/v1/lists/Haus")["items"][0]  # type: ignore[index]
    assert task["due"] == "2026-11-22"
    assert task["note"] == "Winterreifen"
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_removing_a_list(hass: HomeAssistant, shopping: ShoppingServer) -> None:
    shopping.request("POST", "/api/v1/lists", {"name": "Baumarkt"})
    entry = await setup(hass, shopping, lists=("Einkauf", "Baumarkt"))
    assert hass.states.get("todo.baumarkt") is not None
    subentry = next(s for s in entry.subentries.values() if s.title == "Baumarkt")
    hass.config_entries.async_remove_subentry(entry, subentry.subentry_id)
    await hass.async_block_till_done()
    await wait_for(hass, lambda: hass.states.get("todo.baumarkt") is None)
    assert hass.states.get("todo.einkauf") is not None
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_old_setup_keeps_its_lists(hass: HomeAssistant, shopping: ShoppingServer) -> None:
    """Version 1 had every list automatically; those stay, nothing new is added by itself."""
    shopping.request("POST", "/api/v1/lists", {"name": "Baumarkt"})
    unique = f"{shopping.url}#{shopping.request('GET', '/api/v1/me')['id']}"  # type: ignore[index]
    entry = MockConfigEntry(domain=DOMAIN, version=1, unique_id=unique, data={CONF_URL: shopping.url, CONF_TOKEN: shopping.new_token()})
    entry.add_to_hass(hass)
    ent_reg = er.async_get(hass)
    einkauf = list_id(shopping, "Einkauf")
    old = ent_reg.async_get_or_create("todo", DOMAIN, f"{unique}_{einkauf}", config_entry=entry, suggested_object_id="einkauf", original_name="Einkauf")

    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert entry.version == 2
    assert [s.title for s in entry.subentries.values()] == ["Einkauf"]
    # Same entity as before (automations keep working), now belonging to the added list.
    assert hass.states.get(old.entity_id) is not None
    assert ent_reg.async_get(old.entity_id).config_subentry_id == next(iter(entry.subentries))
    assert hass.states.get("todo.baumarkt") is None
    assert await hass.config_entries.async_unload(entry.entry_id)
