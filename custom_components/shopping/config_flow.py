"""Config flow: Shopping address + personal API token."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigFlow, ConfigFlowResult
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import ShoppingAuthError, ShoppingClient, ShoppingError
from .const import CONF_TOKEN, CONF_URL, DOMAIN

STEP_USER = vol.Schema({vol.Required(CONF_URL): str, vol.Required(CONF_TOKEN): str})
STEP_REAUTH = vol.Schema({vol.Required(CONF_TOKEN): str})


class ShoppingConfigFlow(ConfigFlow, domain=DOMAIN):
    """Ask for URL and token, check them, one entry per Shopping user."""

    VERSION = 1

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
