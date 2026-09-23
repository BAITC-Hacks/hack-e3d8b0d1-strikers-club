import asyncio
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Request, status

from app.core.config import Settings
from app.core.exceptions import SessionUnauthorized, UpstreamUnavailable
from app.core.security import require_api_key
from app.repositories.chat_sessions import RedisChatSessionRepository
from app.schemas.chat import ChatRequest, ChatResponse, SessionCreated
from app.schemas.errors import ErrorResponse
from app.services.chat import ChatService
from app.services.uploads import UploadService

router = APIRouter(
    prefix="/chat",
    tags=["chat"],
    dependencies=[Depends(require_api_key)],
    responses={
        401: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
        409: {"model": ErrorResponse},
        422: {"model": ErrorResponse},
        502: {"model": ErrorResponse},
        503: {"model": ErrorResponse},
    },
)


async def session_token(
    value: Annotated[str | None, Header(alias="X-Session-Token", max_length=128)] = None,
) -> str:
    if not value or len(value) < 32:
        raise SessionUnauthorized()
    return value


Token = Annotated[str, Depends(session_token)]


@router.post("/sessions", response_model=SessionCreated, status_code=status.HTTP_201_CREATED)
async def create_session(request: Request) -> SessionCreated:
    repository: RedisChatSessionRepository = request.app.state.chat_sessions
    settings: Settings = request.app.state.settings
    session, token = await repository.create()
    return SessionCreated(
        session_id=session.session_id,
        session_token=token,
        expires_in=settings.chat_session_ttl_seconds,
    )


@router.post("", response_model=ChatResponse)
async def chat_message(data: ChatRequest, request: Request, token: Token) -> ChatResponse:
    repository: RedisChatSessionRepository = request.app.state.chat_sessions
    service: ChatService = request.app.state.chat_service
    settings: Settings = request.app.state.settings
    try:
        async with asyncio.timeout(settings.chat_timeout_seconds):
            async with repository.locked(data.session_id, token) as session:
                return await service.handle(session, data.message)
    except TimeoutError as error:
        raise UpstreamUnavailable("Chat request timed out. Please try again.") from error


@router.post(
    "/upload",
    response_model=ChatResponse,
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {
                mime: {"schema": {"type": "string", "format": "binary"}}
                for mime in (
                    "image/jpeg",
                    "image/png",
                    "application/pdf",
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                )
            },
        }
    },
)
async def upload_attachment(
    request: Request,
    token: Token,
    session_id: Annotated[UUID, Query()],
    filename: Annotated[str, Header(alias="X-Filename", min_length=1, max_length=200)],
) -> ChatResponse:
    """Send raw file bytes; no multipart spool or Files API persistence."""
    repository: RedisChatSessionRepository = request.app.state.chat_sessions
    service: ChatService = request.app.state.chat_service
    uploads: UploadService = request.app.state.upload_service
    settings: Settings = request.app.state.settings
    try:
        async with asyncio.timeout(settings.chat_timeout_seconds):
            async with repository.locked(session_id, token) as session:
                attachment = await uploads.prepare(
                    await request.body(),
                    filename,
                    request.headers.get("content-type", ""),
                )
                return await service.handle(
                    session, "Определи товары из вложения и проверь каталог.", attachment
                )
    except TimeoutError as error:
        raise UpstreamUnavailable("Attachment processing timed out. Please try again.") from error
