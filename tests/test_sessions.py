import asyncio
import hashlib
from uuid import uuid4

import pytest

from app.core.exceptions import (
    SessionBusy,
    SessionNotFound,
    SessionUnauthorized,
    StorageUnavailable,
)
from app.models.chat_session import ChatMessage, ChatSession
from app.repositories.chat_sessions import RedisChatSessionRepository
from tests.conftest import ApiFactory, ApiSession


async def test_session_secret_is_hashed_and_all_state_has_ttl(api: ApiSession) -> None:
    repository = RedisChatSessionRepository(api.redis, api.settings)
    session, token = await repository.create()
    assert len(token) >= 32
    raw = await api.redis.get(repository._key(session.session_id))
    assert token not in raw
    assert hashlib.sha256(token.encode()).hexdigest() in raw
    assert 0 < await api.redis.ttl(repository._key(session.session_id)) <= 3600
    async with repository.locked(session.session_id, token) as stored:
        assert stored.session_id == session.session_id
        assert 0 < await api.redis.ttl(repository._lock_key(session.session_id)) <= 120
        stored.messages.append(ChatMessage(role="user", content="hello"))
    assert await api.redis.exists(repository._lock_key(session.session_id)) == 0
    async with repository.locked(session.session_id, token) as stored:
        assert stored.messages[0].content == "hello"


async def test_session_tokens_cannot_access_another_session(api: ApiSession) -> None:
    repository = RedisChatSessionRepository(api.redis, api.settings)
    first, first_token = await repository.create()
    second, second_token = await repository.create()
    with pytest.raises(SessionUnauthorized):
        async with repository.locked(first.session_id, second_token):
            pytest.fail("A token from a different session must not authenticate")
    with pytest.raises(SessionUnauthorized):
        async with repository.locked(second.session_id, first_token):
            pytest.fail("A token from a different session must not authenticate")
    assert await api.redis.exists(repository._lock_key(first.session_id)) == 0
    async with repository.locked(first.session_id, first_token):
        async with repository.locked(second.session_id, second_token):
            pass


async def test_expired_and_unknown_sessions_are_not_recreated(api: ApiSession) -> None:
    repository = RedisChatSessionRepository(api.redis, api.settings)
    session, token = await repository.create()
    await api.redis.pexpire(repository._key(session.session_id), 1)
    await asyncio.sleep(0.02)
    for session_id in (session.session_id, uuid4()):
        with pytest.raises(SessionNotFound):
            async with repository.locked(session_id, token):
                pytest.fail("Missing sessions must not be re-created")
        assert await api.redis.exists(repository._key(session_id)) == 0


async def test_failed_chat_turn_rolls_back_session_and_releases_lock(api: ApiSession) -> None:
    repository = RedisChatSessionRepository(api.redis, api.settings)
    session, token = await repository.create()
    before = await api.redis.get(repository._key(session.session_id))
    with pytest.raises(RuntimeError, match="provider failure"):
        async with repository.locked(session.session_id, token) as stored:
            stored.messages.append(ChatMessage(role="user", content="not committed"))
            stored.last_candidates = ["product-1"]
            raise RuntimeError("provider failure")
    assert await api.redis.get(repository._key(session.session_id)) == before
    assert await api.redis.exists(repository._lock_key(session.session_id)) == 0


async def test_same_session_is_serialized_and_busy_requests_still_authenticate(
    api: ApiSession,
) -> None:
    repository = RedisChatSessionRepository(api.redis, api.settings)
    session, token = await repository.create()
    async with repository.locked(session.session_id, token):
        with pytest.raises(SessionUnauthorized):
            async with repository.locked(session.session_id, "wrong token"):
                pytest.fail("Authorization is required even while a turn runs")
        with pytest.raises(SessionBusy):
            async with repository.locked(session.session_id, token):
                pytest.fail("Only one operation per session can run")


async def test_expired_lock_cannot_save_or_unlock_new_owner(api: ApiSession) -> None:
    repository = RedisChatSessionRepository(api.redis, api.settings)
    session, token = await repository.create()
    before = await api.redis.get(repository._key(session.session_id))
    with pytest.raises(SessionBusy):
        async with repository.locked(session.session_id, token) as stored:
            stored.messages.append(ChatMessage(role="assistant", content="stale turn"))
            await api.redis.set(repository._lock_key(session.session_id), "new-owner", ex=30)
    assert await api.redis.get(repository._key(session.session_id)) == before
    assert await api.redis.get(repository._lock_key(session.session_id)) == "new-owner"


async def test_session_expiring_during_turn_is_never_resurrected(api: ApiSession) -> None:
    repository = RedisChatSessionRepository(api.redis, api.settings)
    session, token = await repository.create()
    with pytest.raises(SessionNotFound):
        async with repository.locked(session.session_id, token) as stored:
            stored.messages.append(ChatMessage(role="assistant", content="late result"))
            await api.redis.delete(repository._key(session.session_id))
    assert await api.redis.exists(repository._key(session.session_id)) == 0
    assert await api.redis.exists(repository._lock_key(session.session_id)) == 0


async def test_history_is_bounded_in_saved_document(api_factory: ApiFactory) -> None:
    api = await api_factory(chat_max_messages=2)
    repository = RedisChatSessionRepository(api.redis, api.settings)
    session, token = await repository.create()
    async with repository.locked(session.session_id, token) as stored:
        stored.messages = [ChatMessage(role="user", content=str(index)) for index in range(8)]
    raw = await api.redis.get(repository._key(session.session_id))
    saved = ChatSession.model_validate_json(raw)
    assert [message.content for message in saved.messages] == ["6", "7"]


async def test_corrupted_state_fails_closed(api: ApiSession) -> None:
    repository = RedisChatSessionRepository(api.redis, api.settings)
    session, token = await repository.create()
    await api.redis.set(repository._key(session.session_id), "invalid JSON", ex=30)
    with pytest.raises(StorageUnavailable):
        async with repository.locked(session.session_id, token):
            pytest.fail("Invalid state must not become a new session")
