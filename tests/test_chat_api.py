from __future__ import annotations

import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any
from uuid import uuid4

import httpx
import pytest
from fakeredis.aioredis import FakeRedis
from redis.asyncio import Redis

from app.core.config import Settings
from app.main import create_app
from app.services.uploads import UploadService
from tests.conftest import TEST_API_KEY


def function(name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "function_call",
        "name": name,
        "arguments": json.dumps(arguments),
        "call_id": uuid4().hex,
    }


@dataclass
class Backend:
    turns: list[str | list[dict[str, Any]]] = field(default_factory=list)
    requests: list[dict[str, Any]] = field(default_factory=list)
    stock: int = 12
    price: str = "850.00"
    provider_status: int = 200
    article: str = "ABC-123"
    catalog_empty: bool = False
    detail_reads: int = 0

    def product(self) -> dict[str, Any]:
        return {
            "id": "515291",
            "name": "Кабель ВВГнг 3x2.5",
            "article": self.article,
            "price": self.price,
            "quantity": self.stock,
            "category": "Кабель",
            "attributes": {"сечение": "2.5 мм²"},
            "product_url": "https://ekt.kz/product/515291",
        }

    def respond(self, request: httpx.Request) -> httpx.Response:
        if request.url.host == "ekt.kz":
            assert request.headers["authorization"].startswith("Basic ")
            if request.url.path.endswith("/detail"):
                self.detail_reads += 1
                return httpx.Response(200, json=self.product())
            page = request.url.params.get("page", "1")
            return httpx.Response(
                200, json=[] if self.catalog_empty or page != "1" else [self.product()]
            )
        assert request.url.host == "api.openai.com"
        payload = json.loads(request.content)
        self.requests.append(payload)
        assert payload["store"] is False
        assert "previous_response_id" not in payload
        assert "ekt-secret" not in request.content.decode()
        if self.provider_status != 200:
            return httpx.Response(self.provider_status, json={"error": "secret upstream details"})
        assert self.turns, "Unexpected paid-model request"
        turn = self.turns.pop(0)
        output = (
            turn
            if isinstance(turn, list)
            else [{"type": "message", "content": [{"type": "output_text", "text": turn}]}]
        )
        return httpx.Response(200, json={"status": "completed", "output": output})


@dataclass
class ChatApi:
    client: httpx.AsyncClient
    redis: Redis
    settings: Settings
    backend: Backend
    session_id: str
    token: str

    async def say(self, message: str) -> httpx.Response:
        return await self.client.post(
            "/api/chat", json={"session_id": self.session_id, "message": message}
        )

    async def cart(self) -> dict[str, Any]:
        response = await self.client.get("/api/cart", params={"session_id": self.session_id})
        assert response.status_code == 200, response.text
        return response.json()

    async def offer(self) -> dict[str, Any]:
        self.backend.turns = [
            [function("find_products", {"article": "ABC-123"})],
            [function("prepare_cart_addition", {"product_id": "515291", "quantity": 2})],
            "Добавить две штуки в демонстрационную корзину?",
        ]
        response = await self.say("Интересует ABC-123, две штуки")
        assert response.status_code == 200, response.text
        return response.json()


@asynccontextmanager
async def chat_context(**overrides: Any) -> AsyncIterator[ChatApi]:
    settings = Settings(
        api_key=TEST_API_KEY,
        environment="test",
        redis_key_prefix=f"chat-test:{uuid4().hex}",
        openai_api_key="openai-secret",
        ekt_api_user="ekt-user",
        ekt_api_password="ekt-secret",
        **overrides,
    )
    backend = Backend()
    async with FakeRedis(decode_responses=True) as redis:
        async with httpx.AsyncClient(transport=httpx.MockTransport(backend.respond)) as upstream:
            app = create_app(settings, redis, upstream)
            async with app.router.lifespan_context(app):
                async with httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=app),
                    base_url="http://testserver",
                    headers={"X-API-Key": TEST_API_KEY},
                ) as client:
                    response = await client.post("/api/chat/sessions")
                    assert response.status_code == 201, response.text
                    created = response.json()
                    token = created["session_token"]
                    client.headers["X-Session-Token"] = token
                    yield ChatApi(client, redis, settings, backend, created["session_id"], token)


@pytest.fixture
async def chat_api() -> AsyncIterator[ChatApi]:
    async with chat_context() as api:
        yield api


async def test_chat_search_proposal_confirmation_and_repeat(chat_api: ChatApi) -> None:
    proposal = await chat_api.offer()
    assert not proposal["cart_changed"]
    assert proposal["pending_cart_action"]["quantity"] == 2
    assert proposal["products"][0]["price"] == "850.00"
    assert (await chat_api.cart())["total_quantity"] == 0
    before = chat_api.backend.detail_reads
    confirmed = await chat_api.say("да, добавь")
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["cart_changed"]
    assert confirmed.json()["cart"]["demo"] is True
    assert (await chat_api.cart())["total_quantity"] == 2
    assert chat_api.backend.detail_reads > before
    again = await chat_api.say("да, добавь")
    assert not again.json()["cart_changed"]
    assert (await chat_api.cart())["total_quantity"] == 2
    assert len(chat_api.backend.requests) == 3  # server confirmation makes no LLM calls


async def test_button_idempotency_and_token_isolation(chat_api: ChatApi) -> None:
    result = await chat_api.offer()
    proposal = result["pending_cart_action"]
    payload = {
        "session_id": chat_api.session_id,
        **{k: proposal[k] for k in ("operation_id", "product_id", "quantity")},
    }
    rejected = await chat_api.client.post(
        "/api/cart/items", json=payload, headers={"X-Session-Token": "x" * 43}
    )
    assert rejected.status_code == 401
    first = await chat_api.client.post("/api/cart/items", json=payload)
    repeated = await chat_api.client.post("/api/cart/items", json=payload)
    assert first.status_code == repeated.status_code == 200
    assert repeated.json()["cart"]["total_quantity"] == 2
    assert repeated.json()["success"] is True
    forbidden_extra = await chat_api.client.post("/api/cart/items", json={**payload, "price": 0})
    assert forbidden_extra.status_code == 422


async def test_quantity_change_requires_second_confirmation(chat_api: ChatApi) -> None:
    first = await chat_api.offer()
    changed = (await chat_api.say("да, добавь 5")).json()
    assert not changed["cart_changed"]
    assert changed["pending_cart_action"]["quantity"] == 5
    assert (
        changed["pending_cart_action"]["operation_id"]
        != first["pending_cart_action"]["operation_id"]
    )
    assert (await chat_api.cart())["total_quantity"] == 0
    confirmed = (await chat_api.say("да")).json()
    assert confirmed["cart"]["total_quantity"] == 5


@pytest.mark.parametrize("changed", ["price", "stock"])
async def test_changed_facts_require_new_confirmation(chat_api: ChatApi, changed: str) -> None:
    await chat_api.offer()
    if changed == "price":
        chat_api.backend.price = "900.00"
    else:
        chat_api.backend.stock = 1
    response = await chat_api.say("да")
    assert response.status_code == 200, response.text
    assert not response.json()["cart_changed"]
    assert response.json()["pending_cart_action"]
    assert (await chat_api.cart())["total_quantity"] == 0
    confirmed = await chat_api.say("да")
    assert confirmed.json()["cart_changed"]


@pytest.mark.parametrize("text", ["нет", "отмена", "не надо"])
async def test_cancellation(chat_api: ChatApi, text: str) -> None:
    await chat_api.offer()
    assert (await chat_api.say(text)).json()["pending_cart_action"] is None
    assert not (await chat_api.say("да")).json()["cart_changed"]


async def test_no_proposal_no_addition_or_llm(chat_api: ChatApi) -> None:
    response = await chat_api.say("да, добавь")
    assert response.status_code == 200
    assert response.json()["pending_cart_action"] is None
    assert chat_api.backend.requests == []


async def test_fabricated_mutation_tool_is_not_executed(chat_api: ChatApi) -> None:
    chat_api.backend.turns = [
        [function("confirm_add_to_cart", {"product_id": "515291"})],
        "Нужен товар.",
    ]
    response = await chat_api.say("Интересует товар")
    assert response.status_code == 200, response.text
    assert (await chat_api.cart())["total_quantity"] == 0
    tool_result = chat_api.backend.requests[-1]["input"][-1]
    assert json.loads(tool_result["output"])["error"] == "tool_not_allowed"


async def test_provider_error_rolls_back_session_and_hides_details(chat_api: ChatApi) -> None:
    chat_api.backend.provider_status = 500
    response = await chat_api.say("private user message")
    assert response.status_code == 502
    assert "secret upstream details" not in response.text
    keys = [key async for key in chat_api.redis.scan_iter(match="*:session:*")]
    raw = await chat_api.redis.get(keys[0])
    assert "private user message" not in raw
    assert chat_api.token not in raw
    assert await chat_api.redis.ttl(keys[0]) > 0


async def test_tool_loop_is_bounded() -> None:
    async with chat_context(chat_max_tool_rounds=2) as api:
        api.backend.turns = [[function("get_cart", {})], [function("get_cart", {})]]
        response = await api.say("Покажи корзину")
        assert response.status_code == 502
        assert len(api.backend.requests) == 2


async def test_history_replayed_without_provider_state(chat_api: ChatApi) -> None:
    chat_api.backend.turns = ["Здравствуйте.", "Уточните артикул."]
    await chat_api.say("Привет")
    await chat_api.say("Нужен кабель")
    second = chat_api.backend.requests[1]
    assert second["input"][0] == {"role": "user", "content": "Привет"}
    assert second["input"][1]["role"] == "assistant"
    assert second["model"] == "gpt-5.6-luna"
    assert second["store"] is False


async def test_conditions_unknown_and_html_escaped(chat_api: ChatApi) -> None:
    chat_api.backend.turns = [[function("get_purchase_conditions", {})], "<script>bad</script>"]
    response = await chat_api.say("Как оплатить?")
    assert response.status_code == 200
    assert "<script>" not in response.json()["message"]
    assert json.loads(chat_api.backend.requests[-1]["input"][-1]["output"])["confirmed"] is False


async def test_auth_required_for_every_chat_route(chat_api: ChatApi) -> None:
    for method, url, kwargs in [
        ("POST", "/api/chat/sessions", {}),
        ("POST", "/api/chat", {"json": {"session_id": chat_api.session_id, "message": "Привет"}}),
        ("GET", f"/api/cart?session_id={chat_api.session_id}", {}),
        ("GET", "/api/products/515291", {}),
    ]:
        response = await chat_api.client.request(
            method, url, headers={"X-API-Key": "invalid"}, **kwargs
        )
        assert response.status_code == 401


async def test_unconfigured_openai_does_not_break_health_or_sessions() -> None:
    settings = Settings(api_key=TEST_API_KEY, openai_api_key=None, environment="test")
    async with FakeRedis(decode_responses=True) as redis:
        app = create_app(settings, redis)
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="http://testserver",
                headers={"X-API-Key": TEST_API_KEY},
            ) as client:
                assert (await client.get("/api/health/ready")).status_code == 200
                session = (await client.post("/api/chat/sessions")).json()
                response = await client.post(
                    "/api/chat",
                    json={"session_id": session["session_id"], "message": "Привет"},
                    headers={"X-Session-Token": session["session_token"]},
                )
                assert response.status_code == 503
                assert response.json()["error"]["code"] == "integration_not_configured"


async def test_upload_needs_scanner(chat_api: ChatApi) -> None:
    response = await chat_api.client.post(
        "/api/chat/upload",
        params={"session_id": chat_api.session_id},
        content=b"%PDF-1.7\n%%EOF",
        headers={"X-Filename": "a.pdf", "Content-Type": "application/pdf"},
    )
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "upload_scanner_unavailable"
    assert chat_api.backend.requests == []


async def test_low_confidence_upload_no_cart_change_or_raw_retention(
    chat_api: ChatApi,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def clean(self: UploadService, data: bytes) -> None:
        return None

    monkeypatch.setattr(UploadService, "_scan", clean)
    chat_api.backend.turns = [
        json.dumps(
            {
                "products": [
                    {
                        "article": None,
                        "barcode": None,
                        "brand": None,
                        "model": None,
                        "category": None,
                        "attributes": [],
                        "quantity": None,
                        "unreadable_fields": ["article"],
                        "confidence": 0.2,
                    }
                ]
            }
        )
    ]
    data = b"%PDF-1.7\nprivate raw document\n%%EOF"
    response = await chat_api.client.post(
        "/api/chat/upload",
        params={"session_id": chat_api.session_id},
        content=data,
        headers={"X-Filename": "a.pdf", "Content-Type": "application/pdf"},
    )
    assert response.status_code == 200, response.text
    assert not response.json()["cart_changed"]
    assert "чёткое" in response.json()["message"]
    assert chat_api.backend.requests[0]["text"]["format"]["type"] == "json_schema"
    async for key in chat_api.redis.scan_iter():
        raw = await chat_api.redis.get(key)
        assert "private raw document" not in raw
        assert "base64" not in raw


async def test_external_search_gated_by_catalog(chat_api: ChatApi) -> None:
    chat_api.backend.turns = [
        [function("search_external_analogs", {"query": "кабель"})],
        "Нужен поиск.",
    ]
    response = await chat_api.say("Найди замену")
    assert response.status_code == 200
    output = json.loads(chat_api.backend.requests[-1]["input"][-1]["output"])
    assert output["error"] == "catalog_search_required_or_candidates_exist"


async def test_long_quantity_rejected_without_server_error(chat_api: ChatApi) -> None:
    await chat_api.offer()
    response = await chat_api.say("да, добавь " + "9" * 5000)
    assert response.status_code == 409
    assert (await chat_api.cart())["total_quantity"] == 0


async def test_escaped_long_answer_stays_bounded(chat_api: ChatApi) -> None:
    chat_api.backend.turns = ["&" * 16000]
    response = await chat_api.say("Привет")
    assert response.status_code == 200, response.text
    assert len(response.json()["message"]) <= 16000


async def test_new_unreadable_attachment_cancels_old_proposal(
    chat_api: ChatApi,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def clean(self: UploadService, data: bytes) -> None:
        return None

    monkeypatch.setattr(UploadService, "_scan", clean)
    await chat_api.offer()
    chat_api.backend.turns = ['{"products":[]}']
    response = await chat_api.client.post(
        "/api/chat/upload",
        params={"session_id": chat_api.session_id},
        content=b"%PDF-1.7\n%%EOF",
        headers={"X-Filename": "a.pdf", "Content-Type": "application/pdf"},
    )
    assert response.status_code == 200
    assert response.json()["pending_cart_action"] is None
    assert not (await chat_api.say("да")).json()["cart_changed"]


async def test_external_variants_need_cited_public_source() -> None:
    async with chat_context(external_search_enabled=True) as api:
        api.backend.catalog_empty = True
        variant = {
            "name": "Manufacturer replacement",
            "url": "https://manufacturer.example/a",
            "attributes": [],
            "differences": ["Mounting requires checking"],
            "unknown": ["IP"],
            "kind": "external_variant",
            "recommendation": "requires_review",
        }
        fake = {**variant, "url": "https://fabricated.example/a"}
        api.backend.turns = [
            [function("find_products", {"article": "NO-SUCH"})],
            [function("search_external_analogs", {"query": "NO-SUCH manufacturer"})],
            [
                {"type": "web_search_call", "action": {"sources": [{"url": variant["url"]}]}},
                {
                    "type": "message",
                    "content": [
                        {"type": "output_text", "text": json.dumps({"variants": [variant, fake]})}
                    ],
                },
            ],
            "Внешний вариант требует проверки менеджером.",
        ]
        response = await api.say("Найди замену NO-SUCH")
        assert response.status_code == 200, response.text
        assert len(response.json()["external_variants"]) == 1
        assert response.json()["external_variants"][0]["url"] == variant["url"]
        assert not response.json()["products"]
        assert api.backend.requests[2]["tools"] == [{"type": "web_search"}]
