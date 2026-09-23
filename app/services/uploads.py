"""In-memory attachment validation and ClamAV INSTREAM scanning."""

import asyncio
import base64
import io
import stat
import struct
import warnings
import zipfile
from dataclasses import dataclass
from pathlib import PurePath
from typing import Any
from xml.parsers import expat

from PIL import Image, UnidentifiedImageError

from app.core.config import Settings
from app.core.exceptions import (
    AttachmentTooLarge,
    InvalidAttachment,
    UploadScannerUnavailable,
)

MIME_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}


@dataclass(frozen=True, slots=True)
class Attachment:
    content_part: dict[str, Any]


class UploadService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    async def prepare(self, data: bytes, filename: str, content_type: str) -> Attachment:
        if len(data) > self.settings.max_upload_mb * 1024 * 1024:
            raise AttachmentTooLarge()
        if not data or len(filename) > 200:
            raise InvalidAttachment()
        extension = PurePath(filename).suffix.lower()
        mime = MIME_TYPES.get(extension)
        if mime is None or content_type.split(";")[0].strip().lower() != mime:
            raise InvalidAttachment()
        await asyncio.to_thread(self._validate, data, extension)
        await self._scan(data)
        encoded = base64.b64encode(data).decode("ascii")
        url = f"data:{mime};base64,{encoded}"
        if mime.startswith("image/"):
            return Attachment({"type": "input_image", "image_url": url, "detail": "high"})
        # Replace the user filename so it never becomes a provider instruction or log entry.
        return Attachment(
            {"type": "input_file", "filename": f"attachment{extension}", "file_data": url}
        )

    def _validate(self, data: bytes, extension: str) -> None:
        if extension in {".jpg", ".jpeg", ".png"}:
            try:
                with warnings.catch_warnings():
                    warnings.simplefilter("error", Image.DecompressionBombWarning)
                    with Image.open(io.BytesIO(data)) as image:
                        expected = "PNG" if extension == ".png" else "JPEG"
                        if image.format != expected or image.width * image.height > 25_000_000:
                            raise InvalidAttachment()
                        image.verify()
            except (
                UnidentifiedImageError,
                OSError,
                ValueError,
                Image.DecompressionBombWarning,
                Image.DecompressionBombError,
            ) as error:
                raise InvalidAttachment() from error
        elif extension == ".pdf":
            if not data.startswith(b"%PDF-") or b"%%EOF" not in data[-2048:]:
                raise InvalidAttachment()
        else:
            self._validate_archive(data, extension)

    def _validate_archive(self, data: bytes, extension: str) -> None:
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                infos = archive.infolist()
                limit = self.settings.max_archive_uncompressed_mb * 1024 * 1024
                if len(infos) > self.settings.max_archive_entries:
                    raise InvalidAttachment()
                if sum(info.file_size for info in infos) > limit:
                    raise InvalidAttachment()
                names = {info.filename for info in infos}
                if len(names) != len(infos):
                    raise InvalidAttachment()
                required = "word/document.xml" if extension == ".docx" else "xl/workbook.xml"
                if "[Content_Types].xml" not in names or required not in names:
                    raise InvalidAttachment()
                for info in infos:
                    name = info.filename.lower()
                    if (
                        info.flag_bits & 1
                        or ".." in PurePath(name).parts
                        or name.startswith("/")
                        or "\\" in name
                        or ":" in name
                        or stat.S_ISLNK(info.external_attr >> 16)
                    ):
                        raise InvalidAttachment()
                    if (
                        "vbaproject" in name
                        or "/embeddings/" in name
                        or "/externallinks/" in name
                        or name.endswith((".exe", ".bin", ".zip", ".docm", ".xlsm"))
                    ):
                        raise InvalidAttachment()
                    if info.file_size > max(info.compress_size, 1) * 200:
                        raise InvalidAttachment()
                    if name.endswith((".xml", ".rels")):
                        self._validate_xml(archive.read(info))
        except (
            zipfile.BadZipFile,
            RuntimeError,
            OSError,
            ValueError,
            NotImplementedError,
            EOFError,
        ) as error:
            raise InvalidAttachment() from error

    @staticmethod
    def _validate_xml(content: bytes) -> None:
        """Parse declarations and attributes, including UTF-16 and XML whitespace."""
        parser = expat.ParserCreate(namespace_separator="}")
        depth = 0
        count = 0

        def forbidden(*args: object) -> None:
            raise InvalidAttachment()

        def start(name: str, attrs: dict[str, str]) -> None:
            nonlocal depth, count
            depth += 1
            count += 1
            if depth > 100 or count > 200000:
                raise InvalidAttachment()
            if name.rsplit("}", 1)[-1].casefold() == "relationship":
                attributes = {key.rsplit("}", 1)[-1].casefold(): val for key, val in attrs.items()}
                if attributes.get("targetmode", "").strip().casefold() == "external":
                    raise InvalidAttachment()
                target = attributes.get("target", "").strip()
                if ":" in target or target.startswith(("/", "\\")):
                    raise InvalidAttachment()

        def end(name: str) -> None:
            nonlocal depth
            depth -= 1

        parser.StartDoctypeDeclHandler = forbidden
        parser.EntityDeclHandler = forbidden
        parser.StartElementHandler = start
        parser.EndElementHandler = end
        try:
            parser.Parse(content, True)
        except expat.ExpatError as error:
            raise InvalidAttachment() from error

    async def _scan(self, data: bytes) -> None:
        if not self.settings.upload_scan_host:
            raise UploadScannerUnavailable()
        writer: asyncio.StreamWriter | None = None
        try:
            async with asyncio.timeout(self.settings.upload_scan_timeout_seconds):
                reader, writer = await asyncio.open_connection(
                    self.settings.upload_scan_host,
                    self.settings.upload_scan_port,
                    limit=4096,
                )
                writer.write(b"zINSTREAM\x00")
                for offset in range(0, len(data), 65536):
                    chunk = data[offset : offset + 65536]
                    writer.write(struct.pack("!I", len(chunk)) + chunk)
                    await writer.drain()
                writer.write(struct.pack("!I", 0))
                await writer.drain()
                result = await reader.readuntil(b"\x00")
                if b"FOUND" in result:
                    raise InvalidAttachment("Attachment failed the security scan.")
                if result != b"stream: OK\x00":
                    raise UploadScannerUnavailable()
        except (
            OSError,
            TimeoutError,
            asyncio.IncompleteReadError,
            asyncio.LimitOverrunError,
        ) as error:
            raise UploadScannerUnavailable() from error
        finally:
            if writer is not None:
                writer.close()
                try:
                    async with asyncio.timeout(0.5):
                        await writer.wait_closed()
                except (OSError, TimeoutError):
                    pass
