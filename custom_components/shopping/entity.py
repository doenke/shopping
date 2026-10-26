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
        name = (coordinator.data.get(list_id) or {}).get("name") or list_id
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
        """The current state of the list (empty while it is gone, e.g. deleted in the app)."""
        return self.coordinator.data.get(self.list_id) or {"id": self.list_id, "items": []}

    @property
    def available(self) -> bool:
        return super().available and self.list_id in self.coordinator.data
