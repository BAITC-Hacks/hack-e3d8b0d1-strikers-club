"""Bounded multipart parsing that keeps uploaded bytes in memory."""

from dataclasses import dataclass

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError
from starlette.datastructures import UploadFile
from starlette.formparsers import MultiPartException, MultiPartParser

from app.api.middleware import MULTIPART_OVERHEAD_BYTES
from app.schemas.chat import UploadMessage


@dataclass(frozen=True, slots=True)
class UploadPayload:
    data: bytes
    filename: str
    content_type: str
    message: str | None


class MemoryMultipartParser(MultiPartParser):
    """The HTTP body limit is below the spool threshold, so files cannot roll to disk."""

    finished = False

    def on_end(self) -> None:
        self.finished = True

    def on_part_end(self) -> None:
        if self._current_part.file is None:
            try:
                text = self._current_part.data.decode("utf-8")
            except UnicodeDecodeError as error:
                raise MultiPartException("Form text must be UTF-8.") from error
            self.items.append((self._current_part.field_name, text))
        else:
            super().on_part_end()

    def close(self) -> None:
        # Includes incomplete parts, which Starlette does not put in FormData.
        for file in self._files_to_close_on_error:
            file.close()


def invalid_form(
    field: str | None = None,
    error_type: str = "value_error",
    *,
    source: str = "body",
) -> RequestValidationError:
    location = (source, field) if field else (source,)
    return RequestValidationError(
        [{"type": error_type, "loc": location, "msg": "Invalid upload form."}]
    )


async def parse_multipart_upload(request: Request, max_file_bytes: int) -> UploadPayload:
    parser = MemoryMultipartParser(
        request.headers,
        request.stream(),
        max_files=1,
        max_fields=1,
        max_part_size=8000 * 4,
    )
    parser.spool_max_size = max_file_bytes + MULTIPART_OVERHEAD_BYTES + 1
    try:
        form = await parser.parse()
        if not parser.finished:
            raise invalid_form()
        parts = form.multi_items()
        if len(parts) != len({name for name, _ in parts}):
            raise invalid_form()
        file = form.get("file")
        if not isinstance(file, UploadFile):
            raise invalid_form("file", "missing" if file is None else "value_error")
        fields = {key: value for key, value in parts if key != "file"}
        try:
            caption = UploadMessage.model_validate(fields)
        except ValidationError as error:
            errors = [{**item, "loc": ("body", *item["loc"])} for item in error.errors()]
            raise RequestValidationError(errors) from error
        return UploadPayload(
            data=await file.read(),
            filename=file.filename or "",
            content_type=file.content_type or "",
            message=caption.message,
        )
    except MultiPartException as error:
        raise invalid_form() from error
    finally:
        parser.close()
