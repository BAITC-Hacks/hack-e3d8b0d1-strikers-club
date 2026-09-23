from redis.asyncio import Redis
from redis.asyncio.retry import Retry
from redis.backoff import NoBackoff

from app.core.config import Settings


def create_redis(settings: Settings) -> Redis:
    # No automatic retries: an ambiguous network failure must not replay a mutation.
    return Redis.from_url(
        settings.redis_url.get_secret_value(),
        decode_responses=True,
        socket_timeout=settings.redis_socket_timeout_seconds,
        socket_connect_timeout=settings.redis_connect_timeout_seconds,
        max_connections=settings.redis_max_connections,
        health_check_interval=30,
        retry=Retry(NoBackoff(), 0),
    )
