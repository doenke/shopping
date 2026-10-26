"""Shopping lists as to-do lists – also used by Assist ("Füge Milch zur Einkaufsliste hinzu")."""

from __future__ import annotations

from datetime import date
from typing import Any

from homeassistant.components.todo import TodoItem, TodoItemStatus, TodoListEntity, TodoListEntityFeature
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .api import ShoppingError
from .coordinator import ShoppingConfigEntry, ShoppingCoordinator
from .entity import ShoppingListEntity

PARALLEL_UPDATES = 0


async def async_setup_entry(
    hass: HomeAssistant, entry: ShoppingConfigEntry, async_add_entities: AddConfigEntryEntitiesCallback
) -> None:
    """One to-do entity per list added under the integration ("Liste hinzufügen")."""
    coordinator = entry.runtime_data
    for list_id, subentry_id in coordinator.chosen().items():
        async_add_entities([ShoppingTodoList(coordinator, list_id)], config_subentry_id=subentry_id)


class ShoppingTodoList(ShoppingListEntity, TodoListEntity):
    """Open items are "needs action", bought ones ("Zuletzt verwendet") are completed."""

    _attr_name = None

    def __init__(self, coordinator: ShoppingCoordinator, list_id: str) -> None:
        super().__init__(coordinator, list_id)
        self._attr_unique_id = f"{coordinator.config_entry.unique_id}_{list_id}"

    @property
    def _is_task_list(self) -> bool:
        """ToDo lists (and Merklisten) carry a note as description; ToDo lists also a due date."""
        return self.shopping_list.get("type") in ("todo", "memo")

    @property
    def supported_features(self) -> TodoListEntityFeature:
        features = (
            TodoListEntityFeature.CREATE_TODO_ITEM
            | TodoListEntityFeature.UPDATE_TODO_ITEM
            | TodoListEntityFeature.DELETE_TODO_ITEM
            | TodoListEntityFeature.SET_DESCRIPTION_ON_ITEM
        )
        if self.shopping_list.get("type") == "todo":
            features |= TodoListEntityFeature.SET_DUE_DATE_ON_ITEM
        return features

    def _description(self, item: dict[str, Any]) -> str | None:
        if self._is_task_list:
            return item.get("note") or None
        return item["specification"] or None

    @property
    def todo_items(self) -> list[TodoItem]:
        items = self.shopping_list["items"]
        open_items = [i for i in items if not i["checked"]]
        if self.shopping_list.get("type") == "todo":
            open_items.sort(key=lambda i: i.get("due") or "9999")
        done = sorted((i for i in items if i["checked"]), key=lambda i: i.get("checkedAt") or "", reverse=True)
        return [
            TodoItem(
                uid=i["id"],
                summary=i["name"],
                description=self._description(i),
                due=date.fromisoformat(i["due"]) if i.get("due") else None,
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
        if self._is_task_list:
            # Tasks are taken as they are (no grocery parsing), with note and due date.
            entry: dict[str, Any] = {"name": item.summary or "", "note": item.description or None}
            if isinstance(item.due, date):
                entry["due"] = item.due.isoformat()[:10]
            await self._call(self.coordinator.client.add(self.list_id, items=[entry]))
            return
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
        if self._is_task_list:
            if item.description != (current.get("note") or None):
                patch["note"] = item.description or None
            due = item.due.isoformat()[:10] if isinstance(item.due, date) else None
            if self.shopping_list.get("type") == "todo" and due != current.get("due"):
                patch["due"] = due
        elif item.description != (current["specification"] or None):
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
