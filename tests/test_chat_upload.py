"""Multipart uploads keep file bytes in memory and user text in TTL history."""

from __future__ import annotations

import base64
import io
import json
import tempfile
from collections.abc import AsyncIterator
from typing import Any

import pytest
from PIL import Image

from app.services.uploads import UploadService
from tests.test_chat_api import ChatApi, chat_context

PDF = b"%PDF-1.7\nprivate-upload-document-marker\n%%EOF"
DEFAULT_MESSAGE = "Определи товары из вложения и проверь каталог."
MIB = 1024 * 1024
ENVELOPE_BYTES = 64 * 1024
RECOGNIZED = json.dumps(
    {
        "products": [
            {
                "article": "ABC-123",
                "barcode": None,
                "brand": None,
                "model": None,
                "category": None,
                "attributes": [],
                "quantity": None,
                "unreadable_fields": [],
                "confidence": 0.95,
            }
        ]
    }
)


@pytest.fixture(autouse=True)
def clean_scanner(monkeypatch: pytest.MonkeyPatch) -> list[bytes]:
    scanned: list[bytes] = []

    async def clean(self: UploadService, data: bytes) -> None:
        scanned.append(data)

    monkeypatch.setattr(UploadService, "_scan", clean)
    return scanned


@pytest.fixture
async def upload_api() -> AsyncIterator[ChatApi]:
    async with chat_context(max_upload_mb=1) as api:
        yield api


def png() -> bytes:
    output = io.BytesIO()
    Image.new("RGB", (2, 2), color="red").save(output, format="PNG")
    return output.getvalue()


def pdf_of_size(size: int) -> bytes:
    prefix, suffix = b"%PDF-1.7\n", b"\n%%EOF"
    return prefix + b"x" * (size - len(prefix) - len(suffix)) + suffix


async def session_document(api: ChatApi) -> dict[str, Any]:
    keys = [key async for key in api.redis.scan_iter(match="*:session:*")]
    assert len(keys) == 1
    raw = await api.redis.get(keys[0])
    assert raw is not None
    assert 0 < await api.redis.ttl(keys[0]) <= api.settings.chat_session_ttl_seconds
    result: dict[str, Any] = json.loads(raw)
    return result


def user_texts(payload: dict[str, Any]) -> list[str]:
    return [
        part["text"]
        for entry in payload["input"]
        if entry.get("role") == "user" and isinstance(entry.get("content"), list)
        for part in entry["content"]
        if part.get("type") == "input_text"
    ]


@pytest.mark.parametrize("kind", ["image", "document"])
async def test_multipart_text_and_file_reach_same_turn_without_file_retention(
    upload_api: ChatApi, clean_scanner: list[bytes], kind: str
) -> None:
    api = upload_api
    data, filename, mime = (
        (png(), "photo.png", "image/png")
        if kind == "image"
        else (PDF, "order.pdf", "application/pdf")
    )
    message = "Проверь этот товар и подбери аналог для влажного помещения"
    api.backend.turns = [RECOGNIZED, "Нашёл товар в каталоге."]
    response = await api.client.post(
        "/api/chat/upload",
        params={"session_id": api.session_id},
        files={"file": (filename, data, mime)},
        data={"message": f"  {message}\n"},
    )
    assert response.status_code == 200, response.text
    assert not response.json()["cart_changed"]
    assert clean_scanner == [data]
    assert len(api.backend.requests) == 2
    extraction = api.backend.requests[0]
    assert f"Запрос пользователя: {message}" in user_texts(extraction)
    parts = extraction["input"][0]["content"]
    file_part = next(part for part in parts if part["type"] in {"input_image", "input_file"})
    data_url = file_part["image_url"] if kind == "image" else file_part["file_data"]
    assert data_url == f"data:{mime};base64,{base64.b64encode(data).decode('ascii')}"
    assert message in user_texts(api.backend.requests[1])
    assert all(request["store"] is False for request in api.backend.requests)
    session = await session_document(api)
    assert session["messages"][0] == {"role": "user", "content": f"[Вложение]\n{message}"}
    assert len(session["messages"]) == 2
    encoded = base64.b64encode(data).decode("ascii")
    async for key in api.redis.scan_iter():
        raw = await api.redis.get(key)
        assert encoded not in raw
        assert "private-upload-document-marker" not in raw
        assert "base64" not in raw
    api.backend.turns = ["Уточните параметры."]
    assert (await api.say("Продолжим подбор")).status_code == 200
    replayed = api.backend.requests[-1]["input"][0]
    assert replayed == {"role": "user", "content": f"[Вложение]\n{message}"}


@pytest.mark.parametrize("transport", ["multipart", "raw"])
async def test_optional_message_preserves_default_instruction_and_raw_compatibility(
    upload_api: ChatApi, transport: str
) -> None:
    api = upload_api
    api.backend.turns = [RECOGNIZED, "Товар проверен."]
    kwargs: dict[str, Any] = (
        {"files": {"file": ("a.pdf", PDF, "application/pdf")}}
        if transport == "multipart"
        else {"content": PDF, "headers": {"X-Filename": "a.pdf", "Content-Type": "application/pdf"}}
    )
    response = await api.client.post(
        "/api/chat/upload", params={"session_id": api.session_id}, **kwargs
    )
    assert response.status_code == 200, response.text
    assert DEFAULT_MESSAGE in user_texts(api.backend.requests[-1])
    assert (await session_document(api))["messages"][0]["content"] == "[Вложение]"


async def test_unreadable_attachment_still_retains_only_supplied_text(upload_api: ChatApi) -> None:
    upload_api.backend.turns = ['{"products":[]}']
    message = "Нужен аналог этого кабеля"
    response = await upload_api.client.post(
        "/api/chat/upload",
        params={"session_id": upload_api.session_id},
        files={"file": ("a.pdf", PDF, "application/pdf")},
        data={"message": message},
    )
    assert response.status_code == 200, response.text
    assert len(upload_api.backend.requests) == 1
    assert (await session_document(upload_api))["messages"][0]["content"] == (
        f"[Вложение]\n{message}"
    )


@pytest.mark.parametrize("message", ["", " \t\r\n ", "я" * 8001])
async def test_invalid_optional_message_is_rejected_before_scan_or_llm(
    upload_api: ChatApi, clean_scanner: list[bytes], message: str
) -> None:
    response = await upload_api.client.post(
        "/api/chat/upload",
        params={"session_id": upload_api.session_id},
        files={"file": ("a.pdf", PDF, "application/pdf")},
        data={"message": message},
    )
    assert response.status_code == 422, response.text
    assert clean_scanner == []
    assert upload_api.backend.requests == []
    assert (await session_document(upload_api))["messages"] == []


async def test_8000_unicode_characters_are_valid(upload_api: ChatApi) -> None:
    message = "я" * 8000
    upload_api.backend.turns = ['{"products":[]}']
    response = await upload_api.client.post(
        "/api/chat/upload",
        params={"session_id": upload_api.session_id},
        files={"file": ("a.pdf", PDF, "application/pdf")},
        data={"message": message},
    )
    assert response.status_code == 200, response.text
    assert (await session_document(upload_api))["messages"][0]["content"] == (
        f"[Вложение]\n{message}"
    )


@pytest.mark.parametrize(
    "parts",
    [
        [("message", (None, "Нет файла"))],
        [("attachment", ("a.pdf", PDF, "application/pdf"))],
        [("file", (None, "This is a text field, not an uploaded file"))],
        [
            ("file", (None, "Shadowed text field")),
            ("file", ("a.pdf", PDF, "application/pdf")),
        ],
        [
            ("file", ("a.pdf", PDF, "application/pdf")),
            ("file", ("b.pdf", PDF, "application/pdf")),
        ],
        [
            ("file", ("a.pdf", PDF, "application/pdf")),
            ("message", (None, "Первое сообщение")),
            ("message", (None, "Второе сообщение")),
        ],
        [
            ("file", ("a.pdf", PDF, "application/pdf")),
            ("unexpected", (None, "Unknown field")),
        ],
        [
            ("file", ("a.pdf", PDF, "application/pdf")),
            ("message", ("message.txt", b"not text form field", "text/plain")),
        ],
    ],
    ids=[
        "missing-file",
        "wrong-file-field",
        "file-is-text",
        "duplicate-file-text-and-binary",
        "multiple-files",
        "duplicate-message",
        "unknown-field",
        "message-is-file",
    ],
)
async def test_multipart_shape_is_strict(
    upload_api: ChatApi, clean_scanner: list[bytes], parts: list[tuple[str, Any]]
) -> None:
    response = await upload_api.client.post(
        "/api/chat/upload", params={"session_id": upload_api.session_id}, files=parts
    )
    assert response.status_code == 422, response.text
    assert clean_scanner == []
    assert upload_api.backend.requests == []
    assert (await session_document(upload_api))["messages"] == []


@pytest.mark.parametrize("ending", [b"", b"\r\n--upload-boundary", b"\r\n--upload-boundary-"])
async def test_truncated_multipart_is_rejected(
    upload_api: ChatApi, clean_scanner: list[bytes], ending: bytes
) -> None:
    body = (
        b'--upload-boundary\r\nContent-Disposition: form-data; name="file"; filename="a.pdf"\r\n'
        b"Content-Type: application/pdf\r\n\r\n" + PDF + ending
    )
    response = await upload_api.client.post(
        "/api/chat/upload",
        params={"session_id": upload_api.session_id},
        content=body,
        headers={"Content-Type": "multipart/form-data; boundary=upload-boundary"},
    )
    assert response.status_code == 422, response.text
    assert clean_scanner == []
    assert upload_api.backend.requests == []


@pytest.mark.parametrize("header", ["X-API-Key", "X-Session-Token"])
@pytest.mark.parametrize("missing", [True, False], ids=["missing", "invalid"])
async def test_multipart_authentication_precedes_scanning(
    upload_api: ChatApi, clean_scanner: list[bytes], header: str, missing: bool
) -> None:
    request = upload_api.client.build_request(
        "POST",
        "/api/chat/upload",
        params={"session_id": upload_api.session_id},
        files={"file": ("a.pdf", PDF, "application/pdf")},
    )
    if missing:
        request.headers.pop(header)
    else:
        request.headers[header] = "x" * 43
    response = await upload_api.client.send(request)
    assert response.status_code == 401, response.text
    assert clean_scanner == []
    assert upload_api.backend.requests == []


@pytest.mark.parametrize("declared", [True, False], ids=["content-length", "chunked"])
async def test_total_upload_body_limit_bounds_multipart_envelope(
    upload_api: ChatApi, clean_scanner: list[bytes], declared: bool
) -> None:
    total = MIB + ENVELOPE_BYTES + 1
    headers = {"Content-Type": "multipart/form-data; boundary=upload-boundary"}
    if declared:
        headers["Content-Length"] = str(total)
        content: bytes | AsyncIterator[bytes] = b"small body with oversized declaration"
    else:

        async def chunks() -> AsyncIterator[bytes]:
            for offset in range(0, total, 65536):
                yield b"x" * min(65536, total - offset)

        content = chunks()
    response = await upload_api.client.post(
        "/api/chat/upload",
        params={"session_id": upload_api.session_id},
        content=content,
        headers=headers,
    )
    assert response.status_code == 413, response.text
    assert clean_scanner == []
    assert upload_api.backend.requests == []


async def test_exact_file_limit_is_accepted_with_multipart_overhead(
    upload_api: ChatApi, clean_scanner: list[bytes]
) -> None:
    data = pdf_of_size(MIB)
    upload_api.backend.turns = ['{"products":[]}']
    response = await upload_api.client.post(
        "/api/chat/upload",
        params={"session_id": upload_api.session_id},
        files={"file": ("a.pdf", data, "application/pdf")},
        data={"message": "Проверь приложенную спецификацию"},
    )
    assert response.status_code == 200, response.text
    assert clean_scanner == [data]


async def test_file_limit_cannot_use_multipart_envelope_allowance(
    upload_api: ChatApi, clean_scanner: list[bytes]
) -> None:
    response = await upload_api.client.post(
        "/api/chat/upload",
        params={"session_id": upload_api.session_id},
        files={"file": ("a.pdf", pdf_of_size(MIB + 1), "application/pdf")},
    )
    assert response.status_code == 413, response.text
    assert clean_scanner == []
    assert upload_api.backend.requests == []


async def test_files_above_default_spool_threshold_never_roll_over_to_disk(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def forbid_rollover(self: Any) -> None:
        pytest.fail("Attachment parsing attempted to spill file bytes to disk")

    monkeypatch.setattr(tempfile.SpooledTemporaryFile, "rollover", forbid_rollover)
    async with chat_context(max_upload_mb=2) as api:
        api.backend.turns = ['{"products":[]}']
        response = await api.client.post(
            "/api/chat/upload",
            params={"session_id": api.session_id},
            files={"file": ("large.pdf", pdf_of_size(MIB + 1024), "application/pdf")},
        )
        assert response.status_code == 200, response.text


async def test_upload_confirmation_text_never_confirms_previous_cart_proposal(
    upload_api: ChatApi,
) -> None:
    await upload_api.offer()
    before = len(upload_api.backend.requests)
    upload_api.backend.turns = ['{"products":[]}']
    response = await upload_api.client.post(
        "/api/chat/upload",
        params={"session_id": upload_api.session_id},
        files={"file": ("a.pdf", PDF, "application/pdf")},
        data={"message": "да, добавь"},
    )
    assert response.status_code == 200, response.text
    assert not response.json()["cart_changed"]
    assert response.json()["pending_cart_action"] is None
    assert (await upload_api.cart())["total_quantity"] == 0
    assert len(upload_api.backend.requests) == before + 1
    session = await session_document(upload_api)
    assert session["messages"][-2]["content"] == "[Вложение]\nда, добавь"
    again = await upload_api.say("да")
    assert again.status_code == 200
    assert not again.json()["cart_changed"]
    assert (await upload_api.cart())["total_quantity"] == 0
