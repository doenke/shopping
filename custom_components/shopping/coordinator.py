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
from .const import CONF_LIST_ID, DOMAIN, SUBENTRY_LIST

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

    def chosen(self) -> dict[str, str]:
        """The lists added to Home Assistant: list id -> subentry id."""
        return {
            s.data[CONF_LIST_ID]: s.subentry_id for s in self.config_entry.subentries.values() if s.subentry_type == SUBENTRY_LIST
        }

    async def _async_update_data(self) -> dict[str, dict[str, Any]]:
        """Only the lists that were added; a list deleted in the app simply becomes unavailable."""
        try:
            lists = await self.client.lists()
            wanted = [l for l in lists if l["id"] in self.chosen()]
            details = await asyncio.gather(*(self.client.list(l["id"]) for l in wanted))
        except ShoppingAuthError as err:
            raise ConfigEntryAuthFailed(str(err)) from err
        except ShoppingError as err:
            raise UpdateFailed(str(err)) from err
        self._sync_titles(details)
        return {d["id"]: d for d in details}

    def _sync_titles(self, details: list[dict[str, Any]]) -> None:
        """A list renamed in the app is renamed here too."""
        chosen = self.chosen()
        for d in details:
            subentry = self.config_entry.subentries.get(chosen.get(d["id"], ""))
            if subentry and subentry.title != d["name"]:
                self.hass.config_entries.async_update_subentry(self.config_entry, subentry, title=d["name"])

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
