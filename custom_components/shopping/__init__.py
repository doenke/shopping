"""The Shopping integration: shopping lists as to-do lists, with live updates."""

from __future__ import annotations

from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.typing import ConfigType
import homeassistant.helpers.config_validation as cv

from .api import ShoppingClient
from .const import CONF_TOKEN, CONF_URL, DOMAIN
from .coordinator import ShoppingConfigEntry, ShoppingCoordinator
from .services import async_setup_services

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
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ShoppingConfigEntry) -> bool:
    """Unload; the background task is cancelled with the entry."""
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
