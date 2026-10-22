"""Actions: add items as text, apply templates, import from Mealie, clear bought items."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant, ServiceCall, ServiceResponse, SupportsResponse
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
import homeassistant.helpers.config_validation as cv

from .api import ShoppingError
from .const import (
    ATTR_CONFIG_ENTRY,
    ATTR_FROM,
    ATTR_INCLUDE_OPTIONAL,
    ATTR_INCLUDE_PANTRY,
    ATTR_ITEMS,
    ATTR_LIST,
    ATTR_RECIPE,
    ATTR_SERVINGS,
    ATTR_TEMPLATE,
    ATTR_TO,
    DOMAIN,
)
from .coordinator import ShoppingCoordinator

BASE = {vol.Optional(ATTR_CONFIG_ENTRY): cv.string, vol.Optional(ATTR_LIST, default="default"): cv.string}


def _coordinator(hass: HomeAssistant, call: ServiceCall) -> ShoppingCoordinator:
    """The account to act on: given explicitly, or the only one there is."""
    entries = [e for e in hass.config_entries.async_entries(DOMAIN) if e.state is ConfigEntryState.LOADED]
    if entry_id := call.data.get(ATTR_CONFIG_ENTRY):
        entries = [e for e in entries if e.entry_id == entry_id]
    if len(entries) != 1:
        raise ServiceValidationError("Bitte config_entry_id angeben (mehrere oder keine Shopping-Konten eingerichtet)")
    return entries[0].runtime_data


def async_setup_services(hass: HomeAssistant) -> None:
    async def run(call: ServiceCall, fn: Any) -> ServiceResponse:
        coordinator = _coordinator(hass, call)
        try:
            result = await fn(coordinator.client, call.data)
        except ShoppingError as err:
            raise HomeAssistantError(str(err)) from err
        await coordinator.async_request_refresh()
        return result if call.return_response else None

    async def add_items(call: ServiceCall) -> ServiceResponse:
        return await run(call, lambda c, d: c.add(d[ATTR_LIST], text=", ".join(d[ATTR_ITEMS])))

    async def apply_template(call: ServiceCall) -> ServiceResponse:
        return await run(call, lambda c, d: c.apply_template(d[ATTR_LIST], d[ATTR_TEMPLATE], d[ATTR_INCLUDE_OPTIONAL]))

    async def import_recipe(call: ServiceCall) -> ServiceResponse:
        def body(d: dict[str, Any]) -> dict[str, Any]:
            b: dict[str, Any] = {"recipe": d[ATTR_RECIPE], "includePantry": d[ATTR_INCLUDE_PANTRY]}
            if d.get(ATTR_SERVINGS):
                b["servings"] = d[ATTR_SERVINGS]
            return b

        return await run(call, lambda c, d: c.import_mealie(d[ATTR_LIST], body(d)))

    async def import_mealplan(call: ServiceCall) -> ServiceResponse:
        return await run(
            call,
            lambda c, d: c.import_mealie(
                d[ATTR_LIST], {"from": str(d[ATTR_FROM]), "to": str(d[ATTR_TO]), "includePantry": d[ATTR_INCLUDE_PANTRY]}
            ),
        )

    async def clear_checked(call: ServiceCall) -> ServiceResponse:
        return await run(call, lambda c, d: c.clear_checked(d[ATTR_LIST]))

    optional = SupportsResponse.OPTIONAL
    hass.services.async_register(
        DOMAIN, "add_items", add_items, vol.Schema({**BASE, vol.Required(ATTR_ITEMS): vol.All(cv.ensure_list, [cv.string])}), optional
    )
    hass.services.async_register(
        DOMAIN,
        "apply_template",
        apply_template,
        vol.Schema({**BASE, vol.Required(ATTR_TEMPLATE): cv.string, vol.Optional(ATTR_INCLUDE_OPTIONAL, default=False): cv.boolean}),
        optional,
    )
    hass.services.async_register(
        DOMAIN,
        "import_mealie_recipe",
        import_recipe,
        vol.Schema(
            {
                **BASE,
                vol.Required(ATTR_RECIPE): cv.string,
                vol.Optional(ATTR_SERVINGS): vol.All(vol.Coerce(float), vol.Range(min=0.5, max=100)),
                vol.Optional(ATTR_INCLUDE_PANTRY, default=False): cv.boolean,
            }
        ),
        optional,
    )
    hass.services.async_register(
        DOMAIN,
        "import_mealie_mealplan",
        import_mealplan,
        vol.Schema(
            {**BASE, vol.Required(ATTR_FROM): cv.date, vol.Required(ATTR_TO): cv.date, vol.Optional(ATTR_INCLUDE_PANTRY, default=False): cv.boolean}
        ),
        optional,
    )
    hass.services.async_register(DOMAIN, "clear_checked", clear_checked, vol.Schema(BASE), optional)
