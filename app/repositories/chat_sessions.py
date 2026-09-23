"""One TTL-bound Redis document per session; no disk or process-local fallback."""

import hashlib
import hmac
import logging
import secrets
from collections.abc import AsyncIterator, Awaitable
from contextlib import asynccontextmanager
from typing import cast
from uuid import UUID, uuid4

from pydantic import ValidationError
from redis.asyncio import Redis
from redis.exceptions import RedisError

from app.core.config import Settings
from app.core.exceptions import (
    SessionBusy,
    SessionNotFound,
    SessionUnauthorized,
    StorageUnavailable,
)
from app.models.chat_session import ChatSession

logger = logging.getLogger(__name__)

_SAVE = """
if redis.call('GET', KEYS[2]) ~= ARGV[1] then
    return 'lock_lost'
end
if redis.call('EXISTS', KEYS[1]) == 0 then
    return 'missing'
end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
return 'ok'
"""

_RELEASE = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
end
return 0
"""


class RedisChatSessionRepository:
    def __init__(self, redis: Redis, settings: Settings) -> None:
        self._redis = redis
        self._settings = settings
        self._prefix = f"{settings.redis_key_prefix.rstrip(':')}:chat"

    def _key(self, session_id: UUID) -> str:
        return f"{self._prefix}:session:{session_id}"

    def _lock_key(self, session_id: UUID) -> str:
        return f"{self._prefix}:lock:{session_id}"

    async def create(self) -> tuple[ChatSession, str]:
        token = secrets.token_urlsafe(32)
        session = ChatSession(
            session_id=uuid4(), token_digest=hashlib.sha256(token.encode()).hexdigest()
        )
        try:
            created = await self._redis.set(
                self._key(session.session_id),
                session.model_dump_json(),
                ex=self._settings.chat_session_ttl_seconds,
                nx=True,
            )
        except RedisError as error:
            raise StorageUnavailable() from error
        if not created:
            raise StorageUnavailable()
        return session, token

    async def _read(self, session_id: UUID, token: str) -> ChatSession:
        try:
            raw = await self._redis.get(self._key(session_id))
        except RedisError as error:
            raise StorageUnavailable() from error
        if raw is None:
            raise SessionNotFound()
        try:
            session = ChatSession.model_validate_json(raw)
        except (ValidationError, ValueError, TypeError) as error:
            raise StorageUnavailable() from error
        digest = hashlib.sha256(token.encode()).hexdigest()
        if not hmac.compare_digest(session.token_digest, digest):
            raise SessionUnauthorized()
        if session.session_id != session_id:
            raise StorageUnavailable()
        return session

    @asynccontextmanager
    async def locked(self, session_id: UUID, token: str) -> AsyncIterator[ChatSession]:
        # Authenticate before acquiring the lock, including on concurrent requests.
        await self._read(session_id, token)
        lock_key = self._lock_key(session_id)
        owner = secrets.token_urlsafe(32)
        try:
            acquired = await self._redis.set(
                lock_key, owner, ex=self._settings.chat_lock_ttl_seconds, nx=True
            )
        except RedisError as error:
            raise StorageUnavailable() from error
        if not acquired:
            raise SessionBusy()
        try:
            # It may have expired while we acquired the lock.
            session = await self._read(session_id, token)
            original_digest = session.token_digest
            yield session
            if session.session_id != session_id or session.token_digest != original_digest:
                raise StorageUnavailable()
            # Retain idempotency entries for the session's full lifetime; never
            # evict old operations and accidentally permit a duplicate addition.
            if (
                len(session.completed_operations) > self._settings.cart_max_operations
                or len(session.cart) > self._settings.cart_max_lines
            ):
                raise StorageUnavailable()
            session.messages = session.messages[-self._settings.chat_max_messages :]
            payload = session.model_dump_json()
            # Revalidate nested collections mutated in-place by services.
            ChatSession.model_validate_json(payload)
            try:
                result = await cast(
                    Awaitable[object],
                    self._redis.eval(
                        _SAVE,
                        2,
                        self._key(session_id),
                        lock_key,
                        owner,
                        payload,
                        self._settings.chat_session_ttl_seconds,
                    ),
                )
            except RedisError as error:
                raise StorageUnavailable() from error
            if result in ("lock_lost", b"lock_lost"):
                raise SessionBusy()
            if result in ("missing", b"missing"):
                raise SessionNotFound()
            if result not in ("ok", b"ok"):
                raise StorageUnavailable()
        finally:
            try:
                await cast(Awaitable[object], self._redis.eval(_RELEASE, 1, lock_key, owner))
            except RedisError:
                # The lock has its own bounded TTL. Preserve any original error;
                # an already committed cart operation remains retry-idempotent.
                logger.warning("chat_session_lock_release_failed")
