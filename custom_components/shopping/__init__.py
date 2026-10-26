"""The Shopping integration: shopping lists as to-do lists, with live updates."""

from __future__ import annotations

from types import MappingProxyType
import logging

from homeassistant.config_entries import ConfigSubentry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr, entity_registry as er
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.typing import ConfigType
import homeassistant.helpers.config_validation as cv

from .api import ShoppingClient
from .const import CONF_LIST_ID, CONF_TOKEN, CONF_URL, DOMAIN, SUBENTRY_LIST
from .coordinator import ShoppingConfigEntry, ShoppingCoordinator
from .services import async_setup_services

_LOGGER = logging.getLogger(__name__)

PLATFORMS: list[Platform] = [Platform.TODO, Platform.SENSOR]

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Register the integration's actions."""
    async_setup_services(hass)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ShoppingConfigEntry) -> bool:
    """Connect to Shopping and start following its event stream."""
    client = ShoppingClient(async_get_clientsession(hass), entry.data[CONF_URL], entry.data[CONF_TOKEN])
    coordinator = ShoppingCoordinator(hass, entry, client)
    await coordinator.async_config_entry_first_refresh()
    entry.runtime_data = coordinator
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_create_background_task(hass, coordinator.listen(), f"{DOMAIN}_events")
    # A list added or removed ("Liste hinzufügen" / delete): set up again. Renames need nothing.
    chosen = set(coordinator.chosen())

    async def on_update(hass: HomeAssistant, entry: ShoppingConfigEntry) -> None:
        if set(entry.runtime_data.chosen()) != chosen:
            hass.config_entries.async_schedule_reload(entry.entry_id)

    entry.async_on_unload(entry.add_update_listener(on_update))
    return True


async def async_migrate_entry(hass: HomeAssistant, entry: ShoppingConfigEntry) -> bool:
    """Version 1 added every list automatically. Those already in Home Assistant become added lists
    (entities and automations stay as they are); new lists are only added by hand from now on."""
    if entry.version > 2:
        return False
    if entry.version == 1:
        ent_reg = er.async_get(hass)
        dev_reg = dr.async_get(hass)
        prefix = f"{entry.unique_id}_"
        lists: dict[str, str] = {}
        for ent in er.async_entries_for_config_entry(ent_reg, entry.entry_id):
            if ent.domain != "todo" or not ent.unique_id.startswith(prefix):
                continue
            list_id = ent.unique_id.removeprefix(prefix)
            device = dev_reg.async_get(ent.device_id) if ent.device_id else None
            lists[list_id] = (device.name if device else None) or ent.original_name or list_id
        for list_id, title in lists.items():
            hass.config_entries.async_add_subentry(
                entry,
                ConfigSubentry(data=MappingProxyType({CONF_LIST_ID: list_id}), subentry_type=SUBENTRY_LIST, title=title, unique_id=list_id),
            )
        hass.config_entries.async_update_entry(entry, version=2)
        _LOGGER.info("Shopping: %d bestehende Listen übernommen, weitere über „Liste hinzufügen“", len(lists))
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ShoppingConfigEntry) -> bool:
    """Unload; the background task is cancelled with the entry."""
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
