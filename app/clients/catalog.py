"""Bounded, read-only EKT API adapter with deliberately conservative normalization."""

import asyncio
import ipaddress
import json
from decimal import Decimal, InvalidOperation
from typing import cast
from urllib.parse import urljoin, urlsplit

import httpx
from pydantic import ValidationError

from app.core.config import Settings
from app.core.exceptions import IntegrationNotConfigured, ProductNotFound, UpstreamUnavailable
from app.models.products import Product, ProductCertificate, ProductStore


def _mapping(value: object) -> dict[str, object]:
    if not isinstance(value, dict):
        return {}
    return {str(key).casefold(): item for key, item in value.items()}


def _pick(data: dict[str, object], *keys: str) -> object:
    for key in keys:
        value = data.get(key)
        if value is not None:
            return value
    return None


def _text(value: object) -> str | None:
    if isinstance(value, str):
        return value.strip() or None
    if isinstance(value, (int, float, Decimal)) and not isinstance(value, bool):
        return str(value)
    if isinstance(value, dict):
        return _text(_pick(_mapping(value), "value", "name", "title", "text"))
    if isinstance(value, list):
        items = [_text(item) for item in value]
        return "; ".join(item for item in items if item is not None) or None
    return None


def _decimal(value: object) -> Decimal | None:
    if isinstance(value, dict):
        value = _pick(_mapping(value), "value", "amount", "price", "quantity")
    text = _text(value)
    if text is None or len(text) > 128:
        return None
    try:
        result = Decimal(text.replace("\u00a0", "").replace(" ", "").replace(",", "."))
    except InvalidOperation:
        return None
    if not result.is_finite() or result < 0 or result > Decimal("1e18"):
        return None
    if result != 0 and (result.adjusted() < -12 or len(result.as_tuple().digits) > 30):
        return None
    return result


def safe_public_url(value: object, *, product: bool = False) -> str | None:
    """Validate display links; URLs are never fetched by this adapter."""
    text = _text(value)
    if not text or any(ord(char) < 32 for char in text) or "\\" in text:
        return None
    if text.startswith("/") and not text.startswith("//"):
        text = urljoin("https://ekt.kz", text)
    try:
        parsed = urlsplit(text)
        host = (parsed.hostname or "").casefold().rstrip(".")
        port = parsed.port
    except ValueError:
        return None
    if parsed.scheme not in {"http", "https"} or not host or parsed.username or parsed.password:
        return None
    if port not in {None, 80, 443}:
        return None
    if product:
        if parsed.scheme != "https" or not (host == "ekt.kz" or host.endswith(".ekt.kz")):
            return None
    if host == "localhost" or host.endswith((".localhost", ".local", ".internal")):
        return None
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        if "." not in host or "%" in host or host.replace(".", "").isdigit():
            return None
    else:
        if not address.is_global:
            return None
    return text


def _attributes(value: object) -> dict[str, str]:
    """Accept maps, named property records and nested groups without stringifying objects."""
    result: dict[str, str] = {}

    def visit(node: object, depth: int = 0) -> None:
        if depth > 8:
            return
        if isinstance(node, list):
            for child in node:
                visit(child, depth + 1)
            return
        data = _mapping(node)
        if not data:
            return
        name = _text(_pick(data, "name", "key", "title", "code"))
        named_value = _text(_pick(data, "value", "values", "val"))
        if name and named_value:
            unit = _text(data.get("unit"))
            result[name] = f"{named_value} {unit}" if unit else named_value
            return
        for key, child in data.items():
            if isinstance(child, dict):
                child_data = _mapping(child)
                if "value" in child_data or "values" in child_data:
                    child_name = _text(_pick(child_data, "name", "title", "key")) or key
                    child_value = _text(_pick(child_data, "value", "values"))
                    if child_value:
                        unit = _text(child_data.get("unit"))
                        result[child_name] = f"{child_value} {unit}" if unit else child_value
                else:
                    visit(child, depth + 1)
            elif isinstance(child, list):
                if all(isinstance(item, (str, int, float)) for item in child):
                    rendered = _text(child)
                    if rendered:
                        result[key] = rendered
                else:
                    visit(child, depth + 1)
            else:
                rendered = _text(child)
                if rendered:
                    result[key] = rendered

    visit(value)
    return result


def normalize_product(value: object) -> Product:
    data = _mapping(value)
    product_id = _text(_pick(data, "id", "product_id", "xml_id"))
    name = _text(_pick(data, "name", "title", "product_name"))
    if not product_id or not name:
        raise UpstreamUnavailable("Catalog returned an invalid product record.")
    properties = _attributes(_pick(data, "attributes", "properties", "characteristics", "params"))
    barcode = _text(_pick(data, "barcode", "ean", "штрихкод"))
    if barcode:
        properties.setdefault("barcode", barcode)
    property_keys = {key.casefold(): val for key, val in properties.items()}

    def field(*keys: str) -> str | None:
        return _text(_pick(data, *keys)) or _text(_pick(dict(property_keys), *keys))

    stores: list[ProductStore] = []
    raw_stores = _pick(data, "stores", "warehouses", "stock_by_store")
    if isinstance(raw_stores, list):
        for store in raw_stores:
            row = _mapping(store)
            store_name = _text(_pick(row, "name", "title", "store_name"))
            if store_name:
                stores.append(
                    ProductStore(
                        name=store_name,
                        quantity=_decimal(_pick(row, "quantity", "stock", "amount")),
                    )
                )
    certificates: list[ProductCertificate] = []
    raw_certificates = _pick(data, "certificates", "certificates_list")
    if isinstance(raw_certificates, list):
        for certificate in raw_certificates:
            row = _mapping(certificate)
            url = safe_public_url(_pick(row, "url", "link", "file") if row else certificate)
            if url:
                certificates.append(
                    ProductCertificate(name=_text(_pick(row, "name", "title")), url=url)
                )
    try:
        return Product(
            id=product_id,
            name=name,
            article=field("article", "artikul", "sku", "vendor_code", "артикул"),
            brand=field("brand", "manufacturer", "бренд", "производитель"),
            category=field("category", "section", "category_name", "категория"),
            description=field("description", "detail_text", "описание"),
            price=_decimal(_pick(data, "price", "retail_price", "base_price")),
            quantity=_decimal(_pick(data, "quantity", "stock", "available_quantity")),
            attributes=properties,
            stores=stores,
            certificates=certificates,
            product_url=safe_public_url(
                _pick(data, "product_url", "detail_page_url", "url", "link"), product=True
            ),
        )
    except ValidationError as error:
        raise UpstreamUnavailable("Catalog returned an invalid product record.") from error


def _page(value: object) -> tuple[list[object], int | None, bool | None]:
    if isinstance(value, list):
        return cast(list[object], value), None, None
    data = _mapping(value)
    metadata = _mapping(_pick(data, "meta", "pagination"))
    last = _decimal(_pick(data, "last_page", "total_pages")) or _decimal(
        _pick(metadata, "last_page", "total_pages", "pages")
    )
    last_page = int(last) if last is not None and last == int(last) else None
    links = _mapping(data.get("links"))
    next_page: bool | None = bool(links["next"]) if "next" in links else None
    for key in ("products", "items", "results", "data", "result"):
        if key in data:
            rows, nested_last, nested_next = _page(data[key])
            return (
                rows,
                last_page or nested_last,
                next_page if next_page is not None else nested_next,
            )
    raise UpstreamUnavailable("Catalog returned an unsupported page format.")


def _detail(value: object) -> object:
    data = _mapping(value)
    if _pick(data, "id", "product_id", "xml_id") is not None:
        return value
    for key in ("product", "item", "data", "result"):
        if key in data:
            return _detail(data[key])
    if isinstance(value, list) and len(value) == 1:
        return _detail(value[0])
    raise UpstreamUnavailable("Catalog returned an unsupported detail format.")


class EktCatalogClient:
    def __init__(self, http: httpx.AsyncClient, settings: Settings) -> None:
        self._http = http
        self._settings = settings

    def ensure_configured(self) -> None:
        if not self._settings.ekt_api_user or not self._settings.ekt_api_password:
            raise IntegrationNotConfigured("EKT catalog credentials are not configured.")

    async def _get(self, path: str, params: dict[str, str | int]) -> object:
        self.ensure_configured()
        user = self._settings.ekt_api_user
        password = self._settings.ekt_api_password
        assert user is not None and password is not None
        url = f"{self._settings.ekt_api_base_url.rstrip('/')}/{path.lstrip('/')}"
        for attempt in range(2):
            try:
                async with self._http.stream(
                    "GET",
                    url,
                    params=params,
                    auth=httpx.BasicAuth(user.get_secret_value(), password.get_secret_value()),
                    timeout=self._settings.upstream_timeout_seconds,
                    follow_redirects=False,
                ) as response:
                    if response.status_code == 404 and path == "products/detail":
                        raise ProductNotFound()
                    if response.status_code in {429, 502, 503, 504} and attempt == 0:
                        continue
                    response.raise_for_status()
                    body = bytearray()
                    async for chunk in response.aiter_bytes():
                        body.extend(chunk)
                        if len(body) > self._settings.upstream_max_response_bytes:
                            raise UpstreamUnavailable(
                                "Catalog response exceeds the configured limit."
                            )
                return cast(object, json.loads(body))
            except (httpx.TimeoutException, httpx.TransportError) as error:
                if attempt == 0:
                    await asyncio.sleep(0.1)
                    continue
                raise UpstreamUnavailable("Catalog is temporarily unavailable.") from error
            except (httpx.HTTPStatusError, ValueError, UnicodeError) as error:
                raise UpstreamUnavailable("Catalog returned an invalid response.") from error
        raise UpstreamUnavailable("Catalog is temporarily unavailable.")

    async def list_products(self) -> list[Product]:
        products: dict[str, Product] = {}
        for page_number in range(1, self._settings.catalog_max_pages + 1):
            rows, last_page, has_next = _page(await self._get("products", {"page": page_number}))
            if not rows:
                break
            before = len(products)
            for row in rows:
                product = normalize_product(row)
                products[product.id] = product
                if len(products) >= self._settings.catalog_max_products:
                    return list(products.values())
            if len(products) == before:
                break  # Some APIs ignore page=N; never enter an endless download loop.
            if (last_page is not None and page_number >= last_page) or has_next is False:
                break
        return list(products.values())

    async def get_product(self, product_id: str) -> Product:
        product = normalize_product(_detail(await self._get("products/detail", {"id": product_id})))
        if product.id != product_id:
            raise UpstreamUnavailable("Catalog returned a different product identifier.")
        return product
