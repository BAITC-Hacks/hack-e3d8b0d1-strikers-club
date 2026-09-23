from __future__ import annotations

import os
from collections.abc import AsyncIterator, Awaitable
from contextlib import AsyncExitStack
from dataclasses import dataclass
from typing import Any, Protocol
from uuid import uuid4

import httpx
import pytest
import pytest_asyncio
from fakeredis import FakeServer
from fakeredis.aioredis import FakeRedis
from redis.asyncio import Redis

from app.core.config import Settings
from app.main import create_app

TEST_API_KEY = "test-api-key-with-at-least-32-characters"


@dataclass(frozen=True)
class ApiSession:
    client: httpx.AsyncClient
    redis: Redis
    settings: Settings


class ApiFactory(Protocol):
    def __call__(self, **overrides: Any) -> Awaitable[ApiSession]: ...


@pytest.fixture(params=["fake"] + (["redis"] if os.getenv("TEST_REDIS_URL") else []))
def redis_backend(request: pytest.FixtureRequest) -> str:
    return str(request.param)


async def clean_namespace(redis: Redis, prefix: str) -> None:
    keys = [key async for key in redis.scan_iter(match=f"{prefix}*")]
    if keys:
        await redis.delete(*keys)


@pytest_asyncio.fixture
async def api_factory(redis_backend: str) -> AsyncIterator[ApiFactory]:
    async with AsyncExitStack() as stack:

        async def make_api(**overrides: Any) -> ApiSession:
            values: dict[str, Any] = {
                "environment": "test",
                "api_key": TEST_API_KEY,
                "redis_key_prefix": f"test:{uuid4().hex}",
            }
            values.update(overrides)
            settings = Settings(**values)
            if redis_backend == "redis":
                redis = Redis.from_url(os.environ["TEST_REDIS_URL"], decode_responses=True)
            else:
                redis = FakeRedis(server=FakeServer(), decode_responses=True)
            stack.push_async_callback(redis.aclose)
            stack.push_async_callback(clean_namespace, redis, settings.redis_key_prefix)
            app = create_app(settings=settings, redis_client=redis)
            await stack.enter_async_context(app.router.lifespan_context(app))
            client = await stack.enter_async_context(
                httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=app),
                    base_url="http://testserver",
                    headers={"X-API-Key": TEST_API_KEY},
                )
            )
            return ApiSession(client=client, redis=redis, settings=settings)

        yield make_api


@pytest_asyncio.fixture
async def api(api_factory: ApiFactory) -> ApiSession:
    return await api_factory()
