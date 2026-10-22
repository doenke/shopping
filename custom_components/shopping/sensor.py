"""Number of open items per list – handy for dashboards and automations."""

from __future__ import annotations

from homeassistant.components.sensor import SensorEntity, SensorStateClass
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .coordinator import ShoppingConfigEntry, ShoppingCoordinator
from .entity import ShoppingListEntity

PARALLEL_UPDATES = 0


async def async_setup_entry(
    hass: HomeAssistant, entry: ShoppingConfigEntry, async_add_entities: AddConfigEntryEntitiesCallback
) -> None:
    coordinator = entry.runtime_data
    known: set[str] = set()

    @callback
    def add_new() -> None:
        new = set(coordinator.data) - known
        if new:
            async_add_entities(OpenItemsSensor(coordinator, list_id) for list_id in new)
            known.update(new)

    add_new()
    entry.async_on_unload(coordinator.async_add_listener(add_new))


class OpenItemsSensor(ShoppingListEntity, SensorEntity):
    """How many things are still to buy."""

    _attr_translation_key = "open_items"
    _attr_state_class = SensorStateClass.MEASUREMENT

    def __init__(self, coordinator: ShoppingCoordinator, list_id: str) -> None:
        super().__init__(coordinator, list_id)
        self._attr_unique_id = f"{coordinator.config_entry.unique_id}_{list_id}_open"

    @property
    def native_value(self) -> int:
        return sum(1 for i in self.shopping_list["items"] if not i["checked"])
