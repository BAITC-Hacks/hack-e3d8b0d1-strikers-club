from decimal import Decimal

import httpx
import pytest
from fakeredis.aioredis import FakeRedis
from pydantic import SecretStr

from app.clients.catalog import EktCatalogClient, normalize_product, safe_public_url
from app.core.config import Settings
from app.core.exceptions import IntegrationNotConfigured, ProductNotFound, UpstreamUnavailable
from app.services.catalog import CatalogService


def settings(**overrides: object) -> Settings:
    values: dict[str, object] = {
        "api_key": SecretStr("test-api-key-with-at-least-32-characters"),
        "ekt_api_user": SecretStr("catalog-test-user"),
        "ekt_api_password": SecretStr("catalog-test-password"),
        "catalog_max_pages": 5,
    }
    values.update(overrides)
    return Settings.model_validate(values)


def test_normalization_handles_properties_groups_fractional_stock_and_unknowns() -> None:
    product = normalize_product(
        {
            "ID": 42,
            "NAME": "Кабель",
            "PRICE": {"value": "1 250,50"},
            "QUANTITY": "12,5",
            "DETAIL_PAGE_URL": "/catalog/cable/42/",
            "properties": {
                "ARTICLE": {"VALUE": "ABC-1", "NAME": "Артикул"},
                "electrical": [{"name": "Сечение", "value": "2,5", "unit": "мм²"}],
            },
            "stores": [{"name": "Алматы", "quantity": "3.25"}, {"name": "Астана"}],
            "certificates": [
                {"name": "Passport", "url": "https://manufacturer.example/passport.pdf"}
            ],
        }
    )
    assert product.id == "42"
    assert product.article == "ABC-1"
    assert product.price == Decimal("1250.50")
    assert product.quantity == Decimal("12.5")
    assert product.stores[1].quantity is None
    assert product.attributes["Сечение"] == "2,5 мм²"
    assert product.product_url == "https://ekt.kz/catalog/cable/42/"
    assert product.certificates[0].name == "Passport"
    unknown = normalize_product({"id": "1", "name": "Unknown", "quantity": False})
    assert unknown.quantity is None
    assert unknown.price is None
    assert unknown.certificates == []


@pytest.mark.parametrize(
    "price", ["nan", "Infinity", "-1", "1e999999999", "1e-999999999", {"amount": "unknown"}, True]
)
def test_invalid_prices_are_unknown(price: object) -> None:
    assert normalize_product({"id": "1", "name": "Test", "price": price}).price is None


@pytest.mark.parametrize(
    "url",
    [
        "javascript:alert(1)",
        "https://user:pass@ekt.kz/",
        "http://localhost/",
        "http://127.0.0.1/",
        "http://10.0.0.1/",
        "http://[::1]/",
        "file:///tmp/cert.pdf",
        "https://host.internal/a",
        "//evil.example/path",
        "https://ekt.kz\\@evil.example/",
        "https://example.com:22/",
    ],
)
def test_unsafe_display_links_are_discarded(url: str) -> None:
    assert safe_public_url(url) is None


def test_product_links_only_belong_to_ekt_https() -> None:
    assert safe_public_url("https://ekt.kz.evil.example/product", product=True) is None
    assert safe_public_url("http://ekt.kz/product", product=True) is None
    assert safe_public_url("https://shop.ekt.kz/product", product=True)


async def test_pagination_and_cache_never_replace_fresh_price_or_stock() -> None:
    paths: list[str] = []
    detail_calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal detail_calls
        paths.append(str(request.url))
        assert request.headers["authorization"].startswith("Basic ")
        if request.url.path.endswith("/detail"):
            detail_calls += 1
            return httpx.Response(
                200,
                json={
                    "data": {
                        "product": {
                            "id": "p1",
                            "name": "Cable",
                            "article": "ABC-1",
                            "price": str(100 + detail_calls),
                            "quantity": "2.5",
                        }
                    }
                },
            )
        page = request.url.params["page"]
        return httpx.Response(
            200,
            json={
                "data": [{"id": "p1", "name": "Cable", "article": "ABC-1", "price": 1}]
                if page == "1"
                else [{"id": "p2", "name": "Lamp"}],
                "meta": {"last_page": 2},
            },
        )

    config = settings()
    async with (
        httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http,
        FakeRedis() as redis,
    ):
        service = CatalogService(EktCatalogClient(http, config), redis, config)
        first = await service.search(article="ABC1")
        second = await service.search(query="ABC-1")
        cached = await service.details("p1")
        assert first[0].price == Decimal("101")
        assert second[0].price == Decimal("102")
        assert cached.price == Decimal("102")
        assert cached.quantity == Decimal("2.5")
        assert len(paths) == 4  # two pages and two fresh detail requests
        keys = [key async for key in redis.scan_iter()]
        assert keys
        for key in keys:
            assert 0 < await redis.ttl(key) <= config.catalog_cache_ttl_seconds


async def test_page_cap_stops_catalog_download() -> None:
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200, json=[{"id": str(calls), "name": "Item"}])

    config = settings(catalog_max_pages=2)
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        products = await EktCatalogClient(http, config).list_products()
    assert len(products) == calls == 2


async def test_duplicate_page_does_not_loop() -> None:
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200, json={"items": [{"id": "1", "name": "Item"}]})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        assert len(await EktCatalogClient(http, settings()).list_products()) == 1
    assert calls == 2


async def test_missing_configuration_never_calls_network() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError("Network must not be called without credentials")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        client = EktCatalogClient(http, settings(ekt_api_user=None, ekt_api_password=None))
        with pytest.raises(IntegrationNotConfigured):
            await client.get_product("1")


@pytest.mark.parametrize("status", [401, 403, 302, 429, 503])
async def test_failed_catalog_responses_are_public_errors_and_retries_bounded(status: int) -> None:
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(status, headers={"Location": "https://evil.example/"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        with pytest.raises(UpstreamUnavailable) as raised:
            await EktCatalogClient(http, settings()).get_product("1")
    assert calls == (2 if status in {429, 503} else 1)
    assert "catalog-test-password" not in str(raised.value)


async def test_missing_and_mismatched_product_ids_are_not_returned() -> None:
    for response, error in [
        (httpx.Response(404), ProductNotFound),
        (httpx.Response(200, json={"id": "other", "name": "Wrong"}), UpstreamUnavailable),
    ]:
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(lambda request, response=response: response)
        ) as http:
            with pytest.raises(error):
                await EktCatalogClient(http, settings()).get_product("1")


async def test_oversized_catalog_response_is_rejected() -> None:
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda request: httpx.Response(200, content=b"x" * 2048))
    ) as http:
        with pytest.raises(UpstreamUnavailable):
            await EktCatalogClient(http, settings(upstream_max_response_bytes=1024)).get_product(
                "1"
            )


async def test_analogs_skip_fresh_zero_stock_and_critical_mismatch() -> None:
    source = {"id": "base", "name": "Cable", "category": "Кабель", "properties": {"Сечение": "2.5"}}
    rows = [
        source,
        {**source, "id": "empty", "quantity": 10},
        {**source, "id": "live", "quantity": 0},
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/detail"):
            key = request.url.params["id"]
            return httpx.Response(
                200, json={**source, "id": key, "quantity": 3 if key == "live" else 0}
            )
        return httpx.Response(200, json={"data": rows, "meta": {"last_page": 1}})

    config = settings()
    async with (
        httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http,
        FakeRedis() as redis,
    ):
        result = await CatalogService(EktCatalogClient(http, config), redis, config).analogs("base")
        assert [candidate.product_id for candidate in result] == ["live"]
        assert result[0].quantity == Decimal("3")
        assert result[0].recommendation == "requires_review"


def test_top_level_barcode_is_available_for_exact_search() -> None:
    product = normalize_product({"id": "1", "name": "Cable", "barcode": "4871234567890"})
    assert product.attributes["barcode"] == "4871234567890"
