import pytest
from redis.exceptions import ConnectionError as RedisConnectionError

from app.core.config import Settings
from app.core.redis import create_redis
from tests.conftest import TEST_API_KEY


@pytest.mark.asyncio
async def test_disabled_retries_still_await_async_failure_cleanup() -> None:
    client = create_redis(Settings(environment="test", api_key=TEST_API_KEY))
    retry = client.connection_pool.connection_kwargs["retry"]
    attempts = 0
    cleanups = 0

    async def operation() -> None:
        nonlocal attempts
        attempts += 1
        raise RedisConnectionError("Connection lost")

    async def cleanup(error: Exception) -> None:
        nonlocal cleanups
        assert isinstance(error, RedisConnectionError)
        cleanups += 1

    try:
        with pytest.raises(RedisConnectionError):
            await retry.call_with_retry(operation, cleanup)
        assert attempts == 1
        assert cleanups == 1
    finally:
        await client.aclose()
