"""TTL-only catalog index and fresh facts for assistant responses."""

from hashlib import sha256

from pydantic import TypeAdapter, ValidationError
from redis.asyncio import Redis
from redis.exceptions import RedisError

from app.clients.catalog import EktCatalogClient
from app.core.config import Settings
from app.core.exceptions import ProductNotFound, StorageUnavailable
from app.models.products import Analog, Product
from app.services.analogs import (
    AnalogEngine,
    normalize_identifier,
    normalize_key,
    normalize_text,
    normalize_value,
    normalized_attributes,
)

_PRODUCTS = TypeAdapter(list[Product])


class CatalogService:
    def __init__(self, client: EktCatalogClient, redis: Redis, settings: Settings) -> None:
        self._client = client
        self._redis = redis
        self._settings = settings
        self._prefix = f"{settings.redis_key_prefix}:catalog"
        self._engine = AnalogEngine()

    async def _cached(self, key: str) -> str | bytes | None:
        try:
            value = await self._redis.get(key)
        except RedisError as error:
            raise StorageUnavailable() from error
        return value if isinstance(value, (str, bytes)) else None

    async def _store(self, key: str, value: str | bytes, ttl: int) -> None:
        try:
            await self._redis.set(key, value, ex=ttl)
        except RedisError as error:
            raise StorageUnavailable() from error

    async def _index(self) -> list[Product]:
        self._client.ensure_configured()
        key = f"{self._prefix}:index"
        cached = await self._cached(key)
        if cached is not None:
            try:
                return _PRODUCTS.validate_json(cached)
            except ValidationError:
                pass
        products = await self._client.list_products()
        await self._store(
            key, _PRODUCTS.dump_json(products), self._settings.catalog_cache_ttl_seconds
        )
        return products

    async def details(self, product_id: str, *, fresh: bool = False) -> Product:
        self._client.ensure_configured()
        digest = sha256(product_id.encode()).hexdigest()
        key = f"{self._prefix}:detail:{digest}"
        if not fresh:
            cached = await self._cached(key)
            if cached is not None:
                try:
                    product = Product.model_validate_json(cached)
                    if product.id == product_id:
                        return product
                except ValidationError:
                    pass
        product = await self._client.get_product(product_id)
        await self._store(key, product.model_dump_json(), self._settings.detail_cache_ttl_seconds)
        return product

    async def search(
        self,
        query: str = "",
        article: str | None = None,
        brand: str | None = None,
        category: str | None = None,
        attributes: dict[str, str] | None = None,
        limit: int = 10,
    ) -> list[Product]:
        wanted = {
            normalize_key(key): normalize_value(val) for key, val in (attributes or {}).items()
        }
        candidates: list[tuple[int, Product]] = []
        for product in await self._index():
            known = normalized_attributes(product)
            identifiers = [product.article or "", product.id]
            identifiers.extend(
                value
                for key, value in product.attributes.items()
                if normalize_key(key) in {"barcode", "штрихкод", "ean", "артикул"}
            )
            exact_article = article and normalize_identifier(article) in {
                normalize_identifier(value) for value in identifiers if value
            }
            if article and not exact_article:
                continue
            if brand and normalize_text(brand) not in normalize_text(product.brand or ""):
                continue
            if category and normalize_text(category) not in normalize_text(product.category or ""):
                continue
            if any(known.get(key) != value for key, value in wanted.items()):
                continue
            exact_query = bool(
                query
                and normalize_identifier(query)
                in {normalize_identifier(value) for value in identifiers if value}
            )
            haystack = normalize_text(
                " ".join(
                    filter(
                        None,
                        (
                            product.name,
                            product.article,
                            product.brand,
                            product.category,
                            product.description,
                            *product.attributes.values(),
                        ),
                    )
                )
            )
            if (
                query
                and not exact_query
                and not all(token in haystack for token in normalize_text(query).split())
            ):
                continue
            candidates.append((100 if exact_article or exact_query else 10, product))
        candidates.sort(key=lambda row: (-row[0], row[1].id))
        results: list[Product] = []
        for _, candidate in candidates:
            try:
                results.append(await self.details(candidate.id, fresh=True))
            except ProductNotFound:
                continue  # A deleted index entry is never shown as an available product.
            if len(results) >= max(1, min(limit, 50)):
                break
        return results

    async def analogs(
        self,
        product_id: str,
        requirements: dict[str, str] | None = None,
        limit: int = 5,
    ) -> list[Analog]:
        reference = await self.details(product_id, fresh=True)
        candidates: list[Analog] = []
        for product in await self._index():
            compared = self._engine.compare(
                reference, product, requirements, require_available=False
            )
            if compared is not None:
                candidates.append(compared)
        candidates.sort(key=lambda candidate: (-candidate.score, candidate.product_id))
        results: list[Analog] = []
        for candidate in candidates:
            try:
                fresh_product = await self.details(candidate.product_id, fresh=True)
            except ProductNotFound:
                continue
            compared = self._engine.compare(reference, fresh_product, requirements)
            if compared is not None:
                results.append(compared)
            if len(results) >= max(1, min(limit, 20)):
                break
        return sorted(results, key=lambda candidate: (-candidate.score, candidate.product_id))
