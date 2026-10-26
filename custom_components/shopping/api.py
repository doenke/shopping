"""Small async client for the Shopping REST API."""

from __future__ import annotations

from collections.abc import AsyncIterator
import json
from typing import Any

import aiohttp


class ShoppingError(Exception):
    """Shopping could not be reached or answered with an error."""


class ShoppingAuthError(ShoppingError):
    """The API token is invalid, revoked or lacks a permission."""


class ShoppingClient:
    """Talks to Shopping with a personal API token."""

    def __init__(self, session: aiohttp.ClientSession, url: str, token: str) -> None:
        self._session = session
        self._url = url.rstrip("/")
        self._headers = {"Authorization": f"Bearer {token}"}

    @property
    def url(self) -> str:
        """Base URL of the Shopping server."""
        return self._url

    async def _request(self, method: str, path: str, body: Any = None) -> Any:
        try:
            # aiohttp would label an empty POST as octet-stream; send an empty JSON object instead.
            if body is None and method in ("POST", "PATCH"):
                body = {}
            async with self._session.request(
                method,
                f"{self._url}{path}",
                json=body,
                headers=self._headers,
                timeout=aiohttp.ClientTimeout(total=20),
            ) as res:
                data = await res.json(content_type=None) if res.content_length != 0 else None
                if res.status in (401, 403):
                    raise ShoppingAuthError((data or {}).get("detail", "Token abgelehnt"))
                if res.status >= 400:
                    raise ShoppingError((data or {}).get("detail", f"HTTP {res.status}"))
                return data
        except (aiohttp.ClientError, TimeoutError) as err:
            raise ShoppingError(f"Shopping nicht erreichbar: {err}") from err

    async def me(self) -> dict[str, Any]:
        """The user the token belongs to."""
        return await self._request("GET", "/api/v1/me")

    async def lists(self) -> list[dict[str, Any]]:
        """All lists – shopping, packing, Merk- and ToDo lists (no templates)."""
        return await self._request("GET", "/api/v1/lists")

    async def list(self, list_id: str) -> dict[str, Any]:
        """A list with all items, open and checked."""
        return await self._request("GET", f"/api/v1/lists/{list_id}?items=all")

    async def add(self, list_ref: str, *, text: str | None = None, items: list[Any] | None = None) -> dict[str, Any]:
        """Add items; free text is parsed ("2 l Milch, Butter")."""
        body: dict[str, Any] = {}
        if text:
            body["text"] = text
        if items:
            body["items"] = items
        return await self._request("POST", f"/api/v1/lists/{list_ref}/items", body)

    async def update_item(self, item_id: str, patch: dict[str, Any]) -> dict[str, Any]:
        """Change name, amount, properties, note, category or checked state."""
        return await self._request("PATCH", f"/api/v1/items/{item_id}", patch)

    async def delete_item(self, item_id: str) -> None:
        """Remove an item."""
        await self._request("DELETE", f"/api/v1/items/{item_id}")

    async def parse(self, text: str) -> list[dict[str, Any]]:
        """Split text into structured items without saving."""
        return await self._request("POST", "/api/v1/parse", {"text": text})

    async def clear_checked(self, list_ref: str) -> dict[str, Any]:
        """Empty "Zuletzt verwendet"."""
        return await self._request("POST", f"/api/v1/lists/{list_ref}/clear-checked")

    async def apply_template(self, list_ref: str, template: str, include_optional: bool) -> dict[str, Any]:
        """Put a template's items on a list."""
        return await self._request(
            "POST",
            f"/api/v1/lists/{list_ref}/apply-template",
            {"template": template, "includeOptional": include_optional},
        )

    async def import_mealie(self, list_ref: str, body: dict[str, Any]) -> dict[str, Any]:
        """Import a Mealie recipe or meal plan."""
        return await self._request("POST", f"/api/v1/lists/{list_ref}/import/mealie", body)

    async def events(self) -> AsyncIterator[tuple[str, Any]]:
        """Server-sent events: yields (event, data) until the connection ends."""
        try:
            async with self._session.get(
                f"{self._url}/api/v1/events",
                headers={**self._headers, "Accept": "text/event-stream"},
                timeout=aiohttp.ClientTimeout(total=None, sock_connect=20, sock_read=90),
            ) as res:
                if res.status in (401, 403):
                    raise ShoppingAuthError("Token abgelehnt")
                if res.status >= 400:
                    raise ShoppingError(f"HTTP {res.status}")
                event, data = "message", ""
                async for raw in res.content:
                    line = raw.decode("utf-8").rstrip("\r\n")
                    if not line:
                        if data:
                            yield event, json.loads(data)
                        event, data = "message", ""
                    elif line.startswith("event:"):
                        event = line[6:].strip()
                    elif line.startswith("data:"):
                        data += line[5:].strip()
        except (aiohttp.ClientError, TimeoutError) as err:
            raise ShoppingError(f"Event-Stream unterbrochen: {err}") from err
