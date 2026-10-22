"""Shopping lists as to-do lists – also used by Assist ("Füge Milch zur Einkaufsliste hinzu")."""

from __future__ import annotations

from typing import Any

from homeassistant.components.todo import TodoItem, TodoItemStatus, TodoListEntity, TodoListEntityFeature
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .api import ShoppingError
from .coordinator import ShoppingConfigEntry, ShoppingCoordinator
from .entity import ShoppingListEntity

PARALLEL_UPDATES = 0


async def async_setup_entry(
    hass: HomeAssistant, entry: ShoppingConfigEntry, async_add_entities: AddConfigEntryEntitiesCallback
) -> None:
    """One to-do entity per list; lists created later show up automatically."""
    coordinator = entry.runtime_data
    known: set[str] = set()

    @callback
    def add_new() -> None:
        new = set(coordinator.data) - known
        if new:
            async_add_entities(ShoppingTodoList(coordinator, list_id) for list_id in new)
            known.update(new)

    add_new()
    entry.async_on_unload(coordinator.async_add_listener(add_new))


class ShoppingTodoList(ShoppingListEntity, TodoListEntity):
    """Open items are "needs action", bought ones ("Zuletzt verwendet") are completed."""

    _attr_name = None
    _attr_supported_features = (
        TodoListEntityFeature.CREATE_TODO_ITEM
        | TodoListEntityFeature.UPDATE_TODO_ITEM
        | TodoListEntityFeature.DELETE_TODO_ITEM
        | TodoListEntityFeature.SET_DESCRIPTION_ON_ITEM
    )

    def __init__(self, coordinator: ShoppingCoordinator, list_id: str) -> None:
        super().__init__(coordinator, list_id)
        self._attr_unique_id = f"{coordinator.config_entry.unique_id}_{list_id}"

    @property
    def todo_items(self) -> list[TodoItem]:
        items = self.shopping_list["items"]
        open_items = [i for i in items if not i["checked"]]
        done = sorted((i for i in items if i["checked"]), key=lambda i: i.get("checkedAt") or "", reverse=True)
        return [
            TodoItem(
                uid=i["id"],
                summary=i["name"],
                description=i["specification"] or None,
                status=TodoItemStatus.COMPLETED if i["checked"] else TodoItemStatus.NEEDS_ACTION,
            )
            for i in [*open_items, *done]
        ]

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return {"list_id": self.list_id, "main_list": self.shopping_list.get("isMain", False)}

    async def _call(self, coro: Any) -> None:
        try:
            await coro
        except ShoppingError as err:
            raise HomeAssistantError(str(err)) from err
        await self.coordinator.async_request_refresh()

    async def async_create_todo_item(self, item: TodoItem) -> None:
        # Free text goes through Shopping's parser: "2 Liter Milch" becomes Milch · 2 l.
        text = item.summary or ""
        if item.description:
            text = f"{text} ({item.description})"
        await self._call(self.coordinator.client.add(self.list_id, text=text))

    async def async_update_todo_item(self, item: TodoItem) -> None:
        current = next((i for i in self.shopping_list["items"] if i["id"] == item.uid), None)
        if current is None:
            raise HomeAssistantError("Artikel gibt es nicht mehr")
        patch: dict[str, Any] = {}
        if item.status is not None:
            patch["checked"] = item.status == TodoItemStatus.COMPLETED
        if item.summary is not None and item.summary != current["name"]:
            patch["name"] = item.summary
        if item.description != (current["specification"] or None):
            patch.update(await self._parse_description(item.description, item.summary or current["name"]))
        if patch:
            await self._call(self.coordinator.client.update_item(item.uid, patch))

    async def _parse_description(self, description: str | None, name: str) -> dict[str, Any]:
        """Turns an edited description like "2 l · laktosefrei" back into fields."""
        if not description:
            return {"quantity": None, "unit": None, "properties": [], "note": None}
        # Parse together with the name so the parser recognises amount and properties.
        parsed = await self.coordinator.client.parse(f"{description.replace('·', ' ')} {name}")
        first = parsed[0] if parsed else {}
        amount = (first.get("amounts") or [{}])[0]
        return {
            "quantity": amount.get("q"),
            "unit": amount.get("u"),
            "properties": first.get("properties", []),
            "note": first.get("note"),
        }

    async def async_delete_todo_items(self, uids: list[str]) -> None:
        for uid in uids:
            try:
                await self.coordinator.client.delete_item(uid)
            except ShoppingError as err:
                raise HomeAssistantError(str(err)) from err
        await self.coordinator.async_request_refresh()
