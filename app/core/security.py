from secrets import compare_digest
from typing import Annotated

from fastapi import Depends, Request
from fastapi.security import APIKeyHeader

from app.core.config import Settings
from app.core.exceptions import AuthenticationRequired

api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


async def require_api_key(
    request: Request,
    supplied_key: Annotated[str | None, Depends(api_key_header)],
) -> None:
    settings: Settings = request.app.state.settings
    expected = settings.api_key.get_secret_value().encode("utf-8")
    if supplied_key is None or not compare_digest(supplied_key.encode("utf-8"), expected):
        raise AuthenticationRequired()
