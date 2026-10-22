"""End-to-end tests: Home Assistant <-> real Shopping server."""

from __future__ import annotations

import asyncio
from collections.abc import Callable

from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.shopping.const import CONF_TOKEN, CONF_URL, DOMAIN

from conftest import ShoppingServer


async def wait_for(hass: HomeAssistant, cond: Callable[[], bool], timeout: float = 5) -> None:
    """Waits for something pushed via server-sent events (no polling involved)."""
    end = asyncio.get_running_loop().time() + timeout
    while not cond():
        if asyncio.get_running_loop().time() > end:
            raise AssertionError("timeout")
        await asyncio.sleep(0.05)
        await hass.async_block_till_done()


async def setup(hass: HomeAssistant, shopping: ShoppingServer, token: str | None = None) -> MockConfigEntry:
    entry = MockConfigEntry(
        domain=DOMAIN,
        unique_id=f"{shopping.url}#{shopping.request('GET', '/api/v1/me')['id']}",  # type: ignore[index]
        data={CONF_URL: shopping.url, CONF_TOKEN: token or shopping.new_token()},
    )
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


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

    # A new list created elsewhere appears as a new entity.
    template = shopping.request("POST", "/api/v1/lists", {"name": "Grillabend", "isTemplate": True}, token)
    shopping.request("POST", f"/api/v1/lists/{template['id']}/items", {"text": "Würstchen, Grillkohle"}, token)  # type: ignore[index]
    shopping.request("POST", "/api/v1/lists", {"name": "Drogerie"}, token)
    await wait_for(hass, lambda: hass.states.get("todo.drogerie") is not None)
    assert hass.states.get("todo.grillabend") is None  # templates are not to-do lists

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
