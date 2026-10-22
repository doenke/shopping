"""Base entity: one device per Shopping list."""

from __future__ import annotations

from typing import Any

from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN
from .coordinator import ShoppingCoordinator


class ShoppingListEntity(CoordinatorEntity[ShoppingCoordinator]):
    """Something that belongs to a list."""

    _attr_has_entity_name = True

    def __init__(self, coordinator: ShoppingCoordinator, list_id: str) -> None:
        super().__init__(coordinator)
        self.list_id = list_id
        name = coordinator.data[list_id]["name"]
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, f"{coordinator.config_entry.entry_id}_{list_id}")},
            name=name,
            manufacturer="Shopping",
            model="Einkaufsliste",
            entry_type=DeviceEntryType.SERVICE,
            configuration_url=f"{coordinator.client.url}/#/list/{list_id}",
        )

    @property
    def shopping_list(self) -> dict[str, Any]:
        """The current state of the list."""
        return self.coordinator.data[self.list_id]

    @property
    def available(self) -> bool:
        return super().available and self.list_id in self.coordinator.data
