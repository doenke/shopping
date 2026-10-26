"""Config flow: Shopping address + personal API token."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import voluptuous as vol

from homeassistant.config_entries import (
    ConfigEntry,
    ConfigFlow,
    ConfigFlowResult,
    ConfigSubentryFlow,
    SubentryFlowResult,
)
from homeassistant.core import callback
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import ShoppingAuthError, ShoppingClient, ShoppingError
from .const import CONF_LIST_ID, CONF_TOKEN, CONF_URL, DOMAIN, SUBENTRY_LIST

TYPE_ICON = {"shopping": "🛒", "packing": "🧳", "memo": "📌", "todo": "✅"}

STEP_USER = vol.Schema({vol.Required(CONF_URL): str, vol.Required(CONF_TOKEN): str})
STEP_REAUTH = vol.Schema({vol.Required(CONF_TOKEN): str})


class ShoppingConfigFlow(ConfigFlow, domain=DOMAIN):
    """Ask for URL and token, check them, one entry per Shopping user."""

    # 2: lists are added one by one (subentries) instead of all automatically.
    VERSION = 2

    @classmethod
    @callback
    def async_get_supported_subentry_types(cls, config_entry: ConfigEntry) -> dict[str, type[ConfigSubentryFlow]]:
        """"Liste hinzufügen" on the integration's page."""
        return {SUBENTRY_LIST: ListSubentryFlow}

    async def _validate(self, url: str, token: str) -> tuple[dict[str, Any] | None, dict[str, str]]:
        client = ShoppingClient(async_get_clientsession(self.hass), url, token)
        try:
            me = await client.me()
            await client.lists()
        except ShoppingAuthError:
            return None, {"base": "invalid_auth"}
        except ShoppingError:
            return None, {"base": "cannot_connect"}
        return me, {}

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            url = user_input[CONF_URL].strip().rstrip("/")
            me, errors = await self._validate(url, user_input[CONF_TOKEN].strip())
            if me:
                await self.async_set_unique_id(f"{url}#{me['id']}")
                self._abort_if_unique_id_configured()
                return self.async_create_entry(
                    title=f"Shopping ({me['displayName']})",
                    data={CONF_URL: url, CONF_TOKEN: user_input[CONF_TOKEN].strip()},
                )
        return self.async_show_form(
            step_id="user",
            data_schema=self.add_suggested_values_to_schema(STEP_USER, user_input),
            errors=errors,
        )

    async def async_step_reauth(self, entry_data: Mapping[str, Any]) -> ConfigFlowResult:
        """The token stopped working (revoked or expired)."""
        return await self.async_step_reauth_confirm()

    async def async_step_reauth_confirm(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        entry = self._get_reauth_entry()
        if user_input is not None:
            me, errors = await self._validate(entry.data[CONF_URL], user_input[CONF_TOKEN].strip())
            if me:
                await self.async_set_unique_id(f"{entry.data[CONF_URL]}#{me['id']}")
                self._abort_if_unique_id_mismatch(reason="wrong_account")
                return self.async_update_reload_and_abort(entry, data_updates={CONF_TOKEN: user_input[CONF_TOKEN].strip()})
        return self.async_show_form(step_id="reauth_confirm", data_schema=STEP_REAUTH, errors=errors)


class ListSubentryFlow(ConfigSubentryFlow):
    """Adds one Shopping list as a to-do list (plus a sensor with the open items)."""

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> SubentryFlowResult:
        entry = self._get_entry()
        client = ShoppingClient(async_get_clientsession(self.hass), entry.data[CONF_URL], entry.data[CONF_TOKEN])
        try:
            lists = await client.lists()
        except ShoppingError:
            return self.async_abort(reason="cannot_connect")
        taken = {s.data[CONF_LIST_ID] for s in entry.subentries.values() if s.subentry_type == SUBENTRY_LIST}
        offer = {l["id"]: l for l in lists if not l.get("isTemplate") and not l.get("archived") and l["id"] not in taken}
        if not offer:
            return self.async_abort(reason="no_lists")
        if user_input is not None:
            chosen = offer[user_input[CONF_LIST_ID]]
            return self.async_create_entry(title=chosen["name"], data={CONF_LIST_ID: chosen["id"]}, unique_id=chosen["id"])
        # Main list first, then by type and name.
        order = sorted(offer.values(), key=lambda l: (not l.get("isMain"), list(TYPE_ICON).index(l.get("type", "shopping")) if l.get("type") in TYPE_ICON else 9, l["name"].lower()))
        choices = {l["id"]: f"{TYPE_ICON.get(l.get('type', ''), '')} {l['name']}".strip() for l in order}
        return self.async_show_form(step_id="user", data_schema=vol.Schema({vol.Required(CONF_LIST_ID): vol.In(choices)}))
