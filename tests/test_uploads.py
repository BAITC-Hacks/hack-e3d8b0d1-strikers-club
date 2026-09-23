import asyncio
import base64
import io
import struct
import zipfile
from unittest.mock import AsyncMock

import pytest
from PIL import Image
from pydantic import SecretStr

from app.core.config import Settings
from app.core.exceptions import AttachmentTooLarge, InvalidAttachment, UploadScannerUnavailable
from app.services.uploads import MIME_TYPES, UploadService


def settings(**overrides: object) -> Settings:
    values: dict[str, object] = {"api_key": SecretStr("test-api-key-with-at-least-32-characters")}
    values.update(overrides)
    return Settings.model_validate(values)


def image_data(format: str = "PNG") -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (2, 2), color="white").save(buffer, format=format)
    return buffer.getvalue()


def office_data(extension: str, additions: dict[str, bytes] | None = None) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", '<Types xmlns="urn:test"/>')
        archive.writestr(
            "word/document.xml" if extension == ".docx" else "xl/workbook.xml", "<root/>"
        )
        for name, data in (additions or {}).items():
            archive.writestr(name, data)
    return buffer.getvalue()


@pytest.mark.parametrize(
    ("extension", "data"),
    [
        (".png", image_data()),
        (".jpg", image_data("JPEG")),
        (".pdf", b"%PDF-1.7\ncontent\n%%EOF"),
        (".docx", office_data(".docx")),
        (".xlsx", office_data(".xlsx")),
    ],
)
async def test_valid_attachments_are_scanned_and_passed_inline_without_original_filename(
    extension: str,
    data: bytes,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = UploadService(settings())
    scanner = AsyncMock()
    monkeypatch.setattr(service, "_scan", scanner)
    prepared = await service.prepare(data, f"user-private-title{extension}", MIME_TYPES[extension])
    scanner.assert_awaited_once_with(data)
    content = prepared.content_part
    if extension in {".png", ".jpg"}:
        assert content["type"] == "input_image"
        assert content["detail"] == "high"
        encoded = content["image_url"].split(",", 1)[1]
    else:
        assert content["type"] == "input_file"
        assert content["filename"] == f"attachment{extension}"
        encoded = content["file_data"].split(",", 1)[1]
    assert base64.b64decode(encoded) == data


@pytest.mark.parametrize(
    ("data", "filename", "mime"),
    [
        (b"", "a.pdf", "application/pdf"),
        (b"%PDF-1.7 %%EOF", "a.exe", "application/pdf"),
        (b"%PDF-1.7 %%EOF", "a.pdf", "image/png"),
        (image_data(), "a.jpg", "image/jpeg"),
        (b"not a PDF", "a.pdf", "application/pdf"),
        (b"PKbad", "a.docx", MIME_TYPES[".docx"]),
    ],
)
async def test_invalid_mime_extension_or_magic_is_rejected_before_scanning(
    data: bytes,
    filename: str,
    mime: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = UploadService(settings())
    scanner = AsyncMock()
    monkeypatch.setattr(service, "_scan", scanner)
    with pytest.raises(InvalidAttachment):
        await service.prepare(data, filename, mime)
    scanner.assert_not_awaited()


async def test_upload_size_limit_checked_before_decoding_or_scanning() -> None:
    with pytest.raises(AttachmentTooLarge):
        await UploadService(settings(max_upload_mb=1)).prepare(b"x" * 1048577, "a.png", "image/png")


@pytest.mark.parametrize(
    "relationship",
    [
        b'<Relationships><Relationship TargetMode = "External" Target="https://evil.example"/></Relationships>',
        b"<Relationships><Relationship TargetMode = 'External' Target='file:///tmp/secret'/></Relationships>",
        '<Relationships><Relationship TargetMode = "External" Target="https://evil.example"/></Relationships>'.encode(
            "utf-16"
        ),
        b'<Relationships><Relationship TargetMode="Exter&#110;al" Target="a"/></Relationships>',
        b'<Relationships><Relationship Target="https://evil.example"/></Relationships>',
        b'<!DOCTYPE x [<!ENTITY a "expanded">]><Relationships>&a;</Relationships>',
        '<!DOCTYPE x [<!ENTITY a "expanded">]><Relationships>&a;</Relationships>'.encode("utf-16"),
    ],
)
async def test_external_relationships_and_entities_are_rejected_in_all_encodings(
    relationship: bytes,
) -> None:
    data = office_data(".docx", {"word/_rels/document.xml.rels": relationship})
    with pytest.raises(InvalidAttachment):
        await UploadService(settings()).prepare(data, "a.docx", MIME_TYPES[".docx"])


@pytest.mark.parametrize(
    "name",
    [
        "../escape.xml",
        "..\\escape.xml",
        "/root.xml",
        "C:/root.xml",
        "word/vbaProject.bin",
        "word/embeddings/data",
        "xl/externalLinks/link.xml",
        "word/payload.zip",
    ],
)
async def test_archive_traversal_macros_and_embedded_payloads_are_rejected(name: str) -> None:
    with pytest.raises(InvalidAttachment):
        await UploadService(settings()).prepare(
            office_data(".docx", {name: b"<root/>"}), "a.docx", MIME_TYPES[".docx"]
        )


async def test_zip_bomb_ratio_and_entry_limits_are_rejected() -> None:
    service = UploadService(settings(max_archive_entries=2))
    with pytest.raises(InvalidAttachment):
        await service.prepare(
            office_data(".xlsx", {"xl/a.xml": b"<root/>"}), "a.xlsx", MIME_TYPES[".xlsx"]
        )
    bomb = office_data(".docx", {"word/big.xml": b"<root>" + b"a" * 200000 + b"</root>"})
    with pytest.raises(InvalidAttachment):
        await UploadService(settings()).prepare(bomb, "a.docx", MIME_TYPES[".docx"])


async def test_missing_scanner_fails_closed() -> None:
    with pytest.raises(UploadScannerUnavailable):
        await UploadService(settings(upload_scan_host=None)).prepare(
            image_data(), "a.png", "image/png"
        )


@pytest.mark.parametrize(
    ("response", "expected_error"),
    [
        (b"stream: OK\x00", None),
        (b"stream: Eicar-Test-Signature FOUND\x00", InvalidAttachment),
        (b"stream: INSTREAM size limit exceeded. ERROR\x00", UploadScannerUnavailable),
    ],
)
async def test_clamav_instream_protocol_and_socket_cleanup(
    response: bytes,
    expected_error: type[Exception] | None,
) -> None:
    payload = b"a" * 70000
    done = asyncio.Event()
    received = bytearray()

    async def handler(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            assert await reader.readexactly(10) == b"zINSTREAM\x00"
            while True:
                size = struct.unpack("!I", await reader.readexactly(4))[0]
                if size == 0:
                    break
                received.extend(await reader.readexactly(size))
            writer.write(response)
            await writer.drain()
        finally:
            writer.close()
            await writer.wait_closed()
            done.set()

    server = await asyncio.start_server(handler, "127.0.0.1", 0)
    async with server:
        service = UploadService(
            settings(
                upload_scan_host="127.0.0.1",
                upload_scan_port=server.sockets[0].getsockname()[1],
            )
        )
        if expected_error:
            with pytest.raises(expected_error):
                await service._scan(payload)
        else:
            await service._scan(payload)
        await asyncio.wait_for(done.wait(), 1)
    assert received == payload
