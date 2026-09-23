from collections.abc import Awaitable
from typing import cast

from fastapi import APIRouter, Request
from redis.asyncio import Redis
from redis.exceptions import RedisError

from app.core.exceptions import StorageUnavailable

router = APIRouter(prefix="/health", tags=["health"])


@router.get("/live")
async def liveness() -> dict[str, str]:
    return {"status": "ok"}


@router.get("")
@router.get("/ready")
async def readiness(request: Request) -> dict[str, str]:
    redis: Redis = request.app.state.redis
    try:
        await cast(Awaitable[bool], redis.ping())
    except (RedisError, OSError) as exc:
        raise StorageUnavailable() from exc
    return {"status": "ok", "redis": "ok"}
