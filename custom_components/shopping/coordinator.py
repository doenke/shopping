"""Keeps the lists of one Shopping account up to date – pushed via server-sent events."""

from __future__ import annotations

import asyncio
from datetime import timedelta
import logging
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryAuthFailed
from homeassistant.helpers.debounce import Debouncer
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .api import ShoppingAuthError, ShoppingClient, ShoppingError
from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

type ShoppingConfigEntry = ConfigEntry[ShoppingCoordinator]

# Push keeps things current; polling is only the safety net.
FALLBACK_INTERVAL = timedelta(minutes=15)
RECONNECT_DELAYS = (2, 5, 10, 30, 60)


class ShoppingCoordinator(DataUpdateCoordinator[dict[str, dict[str, Any]]]):
    """Data: list id -> list (with items)."""

    config_entry: ShoppingConfigEntry

    def __init__(self, hass: HomeAssistant, entry: ShoppingConfigEntry, client: ShoppingClient) -> None:
        super().__init__(
            hass,
            _LOGGER,
            config_entry=entry,
            name=DOMAIN,
            update_interval=FALLBACK_INTERVAL,
            # Several events in a row (e.g. a whole recipe) lead to one refresh.
            request_refresh_debouncer=Debouncer(hass, _LOGGER, cooldown=0.3, immediate=False),
        )
        self.client = client
        self.connected = False

    async def _async_update_data(self) -> dict[str, dict[str, Any]]:
        try:
            lists = await self.client.lists()
            details = await asyncio.gather(*(self.client.list(l["id"]) for l in lists))
        except ShoppingAuthError as err:
            raise ConfigEntryAuthFailed(str(err)) from err
        except ShoppingError as err:
            raise UpdateFailed(str(err)) from err
        return {d["id"]: d for d in details}

    def main_list_id(self) -> str | None:
        """The account's main list."""
        return next((l["id"] for l in (self.data or {}).values() if l.get("isMain")), None)

    async def listen(self) -> None:
        """Follows the event stream forever; reconnects with backoff."""
        attempt = 0
        while True:
            try:
                async for event, _data in self.client.events():
                    if event == "ready":
                        attempt = 0
                        self.connected = True
                    await self.async_request_refresh()
            except ShoppingAuthError:
                _LOGGER.warning("Shopping lehnt das Token ab – Event-Stream beendet")
                self.connected = False
                return
            except ShoppingError as err:
                _LOGGER.debug("Event-Stream unterbrochen: %s", err)
            self.connected = False
            await asyncio.sleep(RECONNECT_DELAYS[min(attempt, len(RECONNECT_DELAYS) - 1)])
            attempt += 1
            # Catch up on everything missed while disconnected.
            await self.async_request_refresh()
