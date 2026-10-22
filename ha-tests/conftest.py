"""Runs the Home Assistant integration against a real Shopping server.

Needs a built server (pnpm build) and PostgreSQL (TEST_DATABASE_URL, like the server tests).
"""

from __future__ import annotations

from collections.abc import Generator
import http.cookiejar
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
import urllib.request
import uuid

import pytest
import pytest_socket

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))  # makes custom_components/shopping importable

ADMIN_URL = os.environ.get("TEST_DATABASE_URL", "postgres://postgres@127.0.0.1:54329/postgres")


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations: None, socket_enabled: None) -> None:
    """Allow loading custom_components/shopping and talking to the real server."""


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _psql(sql: str) -> None:
    subprocess.run(["psql", ADMIN_URL, "-qc", sql], check=True, capture_output=True)


class ShoppingServer:
    """A running Shopping server with a logged-in user "Anna"."""

    def __init__(self, url: str) -> None:
        self.url = url
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))

    def request(self, method: str, path: str, body: object | None = None, token: str | None = None) -> object:
        req = urllib.request.Request(
            f"{self.url}{path}",
            method=method,
            data=json.dumps(body).encode() if body is not None else None,
            headers={"content-type": "application/json"} if body is not None else {},
        )
        if token:
            req.add_header("Authorization", f"Bearer {token}")
        with self.opener.open(req) as res:
            raw = res.read()
            return json.loads(raw) if raw else None

    def new_token(self, scopes: list[str] | None = None) -> str:
        return self.request("POST", "/api/v1/tokens", {"name": "Home Assistant", "scopes": scopes or ["read", "write"]})["token"]  # type: ignore[index]


@pytest.fixture(scope="session")
def shopping() -> Generator[ShoppingServer]:
    pytest_socket.enable_socket()
    db = f"shopping_ha_{uuid.uuid4().hex[:10]}"
    _psql(f"CREATE DATABASE {db}")
    port = _free_port()
    url = f"http://127.0.0.1:{port}"
    db_url = ADMIN_URL.rsplit("/", 1)[0] + f"/{db}"
    proc = subprocess.Popen(
        ["node", str(ROOT / "apps/server/dist/main.js")],
        env={
            **os.environ,
            "DATABASE_URL": db_url,
            "PUBLIC_URL": url,
            "PORT": str(port),
            "HOST": "127.0.0.1",
            "SECRET_KEY": "ha-test-secret-0123456789",
            "DEV_LOGIN": "true",
            "LOG_LEVEL": "warn",
        },
    )
    try:
        for _ in range(100):
            try:
                urllib.request.urlopen(f"{url}/healthz", timeout=1)
                break
            except OSError:
                time.sleep(0.1)
        server = ShoppingServer(url)
        server.request("POST", "/auth/dev", {"name": "Anna"})
        token = server.new_token()
        server.request("POST", "/api/v1/lists", {"name": "Einkauf"}, token)
        yield server
    finally:
        proc.terminate()
        proc.wait(10)
        _psql(f"DROP DATABASE IF EXISTS {db} WITH (FORCE)")
