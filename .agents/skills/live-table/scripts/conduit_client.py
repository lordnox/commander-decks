#!/usr/bin/env python3
"""Small HTTP client for live-conduit bins."""

from __future__ import annotations

import json
import os
from urllib.error import HTTPError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

DEFAULT_ORIGIN = "https://conduit.app.kopelke.online"
BIN_LABELS = (
    "host",
    "p1",
    "p1-inbox",
    "p2",
    "p2-inbox",
    "p3",
    "p3-inbox",
    "p4",
    "p4-inbox",
)


def origin_from_env() -> str:
    return (os.environ.get("LIVE_CONDUIT_URL") or DEFAULT_ORIGIN).rstrip("/")


def _request(
    origin: str,
    path: str,
    *,
    method: str = "GET",
    data: bytes | None = None,
    headers: dict[str, str] | None = None,
):
    request = Request(
        f"{origin.rstrip('/')}{path}",
        data=data,
        headers=headers or {},
        method=method,
    )
    return urlopen(request)


def mint(origin: str, api_key: str | None, labels=BIN_LABELS) -> dict:
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
        headers["X-API-Key"] = api_key
    body = json.dumps({"labels": list(labels)}, separators=(",", ":")).encode("utf-8")
    with _request(origin, "/v1/mint", method="POST", data=body, headers=headers) as response:
        return json.loads(response.read().decode("utf-8"))


def append(
    origin: str,
    write_key: str,
    body: bytes,
    kind: str = "snapshot",
):
    headers = {
        "Content-Type": "application/octet-stream",
        "X-Live-Conduit-Kind": kind,
    }
    path = f"/v1/bins/{quote(write_key, safe='')}"
    with _request(origin, path, method="POST", data=body, headers=headers) as response:
        response.read()
        return response.headers


def get_latest(origin: str, read_key: str) -> tuple[int, bytes, object]:
    path = f"/v1/bins/{quote(read_key, safe='')}"
    try:
        with _request(origin, path) as response:
            return response.status, response.read(), response.headers
    except HTTPError as error:
        if error.code not in (204, 404):
            raise
        return error.code, error.read(), error.headers


def destroy(origin: str, write_key: str) -> None:
    path = f"/v1/bins/{quote(write_key, safe='')}"
    with _request(origin, path, method="DELETE") as response:
        response.read()


def conduit_private_url(
    base: str,
    *,
    host_read: str,
    you: str,
    seat_read: str,
    inbox_write: str,
    origin: str | None = None,
) -> str:
    params = {
        "host": host_read,
        "you": you,
        "seat": seat_read,
        "inbox": inbox_write,
    }
    selected_origin = (origin or origin_from_env()).rstrip("/")
    if selected_origin != DEFAULT_ORIGIN:
        params["c"] = selected_origin
    return f"{base.rstrip('/')}/?{urlencode(params)}"


def conduit_public_url(
    base: str,
    *,
    host_read: str,
    origin: str | None = None,
) -> str:
    params = {"host": host_read}
    selected_origin = (origin or origin_from_env()).rstrip("/")
    if selected_origin != DEFAULT_ORIGIN:
        params["c"] = selected_origin
    return f"{base.rstrip('/')}/?{urlencode(params)}"
