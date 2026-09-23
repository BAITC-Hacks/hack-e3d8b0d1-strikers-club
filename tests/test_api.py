"""Shared HTTP guarantees and the supported public surface of the chat backend."""

import logging
from collections.abc import AsyncIterator
from typing import Any
from uuid import uuid4

import pytest
from redis.exceptions import ConnectionError as RedisConnectionError

from tests.conftest import ApiSession


async def test_items_routes_are_absent_from_openapi(api: ApiSession) -> None:
    response = await api.client.get("/openapi.json")
    assert response.status_code == 200
    schema = response.json()
    paths = set(schema["paths"])
    assert not any(path.startswith("/api/items") for path in paths)
    assert {
        "/api/chat",
        "/api/chat/sessions",
        "/api/chat/upload",
        "/api/cart",
        "/api/cart/items",
        "/api/products/{product_id}",
        "/api/health/ready",
    } <= paths
    assert not {"ItemCreate", "ItemUpdate", "ItemResponse", "ItemListResponse"} & set(
        schema["components"]["schemas"]
    )


@pytest.mark.parametrize("method", ["GET", "POST", "PUT", "PATCH", "DELETE"])
async def test_removed_items_routes_return_404(api: ApiSession, method: str) -> None:
    for path in ("/api/items", "/api/items/", f"/api/items/{uuid4()}"):
        response = await api.client.request(method, path)
        assert response.status_code == 404, (method, path, response.text)
        assert response.json()["error"]["code"] == "http_error"
        assert response.json()["request_id"] == response.headers["X-Request-ID"]


async def test_session_creation_requires_api_key(api: ApiSession) -> None:
    for key in (None, "wrong-secret"):
        request = api.client.build_request("POST", "/api/chat/sessions")
        request.headers.pop("X-API-Key")
        if key is not None:
            request.headers["X-API-Key"] = key
        response = await api.client.send(request)
        assert response.status_code == 401
        assert response.json()["error"]["code"] == "authentication_required"


@pytest.mark.parametrize("secret_in_key", [False, True])
async def test_validation_does_not_echo_secret_inputs_or_log_them(
    api: ApiSession,
    caplog: pytest.LogCaptureFixture,
    secret_in_key: bool,
) -> None:
    secret = "sensitive-value-never-include-in-errors"
    created = (await api.client.post("/api/chat/sessions")).json()
    body: dict[str, Any] = {"session_id": created["session_id"], "message": "Привет"}
    if secret_in_key:
        body[secret] = "value"
    else:
        body["message"] = {"credential": secret}
    # App logs intentionally do not propagate to the root logger.
    app_logger = logging.getLogger("app")
    app_logger.addHandler(caplog.handler)
    try:
        with caplog.at_level(logging.INFO):
            response = await api.client.post(
                "/api/chat",
                json=body,
                headers={"X-Session-Token": created["session_token"]},
            )
    finally:
        app_logger.removeHandler(caplog.handler)
    assert response.status_code == 422
    assert secret not in response.text
    assert secret not in caplog.text


async def test_request_id_is_echoed_if_valid_and_replaced_if_unsafe(api: ApiSession) -> None:
    valid = str(uuid4())
    response = await api.client.get("/api/health/live", headers={"X-Request-ID": valid})
    assert response.headers["X-Request-ID"] == valid
    invalid = "unsafe request id with spaces"
    response = await api.client.get("/api/health/live", headers={"X-Request-ID": invalid})
    assert response.headers["X-Request-ID"]
    assert response.headers["X-Request-ID"] != invalid


@pytest.mark.parametrize("chunked", [False, True])
async def test_oversized_request_returns_413(api: ApiSession, chunked: bool) -> None:
    if chunked:

        async def chunks() -> AsyncIterator[bytes]:
            yield b'{"message":"'
            yield b"x" * 10_000
            yield b"x" * 10_000
            yield b'"}'

        response = await api.client.post(
            "/api/chat",
            content=chunks(),
            headers={"Content-Type": "application/json"},
        )
    else:
        response = await api.client.post("/api/chat", json={"message": "x" * 20_000})
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "request_too_large"


async def test_health_endpoints_are_public(api: ApiSession) -> None:
    for path in ("/api/health/live", "/api/health/ready", "/api/health"):
        request = api.client.build_request("GET", path)
        request.headers.pop("X-API-Key")
        assert (await api.client.send(request)).status_code == 200


async def test_unavailable_redis_is_503_for_sessions_and_cart(
    api: ApiSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    created = (await api.client.post("/api/chat/sessions")).json()

    async def disconnected(*args: Any, **kwargs: Any) -> Any:
        raise RedisConnectionError("Redis connection unavailable")

    with monkeypatch.context() as patch:
        patch.setattr(api.redis, "execute_command", disconnected)
        responses = [
            await api.client.post("/api/chat/sessions"),
            await api.client.get(
                "/api/cart",
                params={"session_id": created["session_id"]},
                headers={"X-Session-Token": created["session_token"]},
            ),
            await api.client.get("/api/health/ready"),
        ]
        for response in responses:
            assert response.status_code == 503, response.text
            assert response.json()["error"]["code"] == "storage_unavailable"
        assert (await api.client.get("/api/health/live")).status_code == 200
