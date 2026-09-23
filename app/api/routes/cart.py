import asyncio
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request

from app.api.routes.chat import Token
from app.core.config import Settings
from app.core.exceptions import UpstreamUnavailable
from app.core.security import require_api_key
from app.models.chat_session import CartResponse, CartResult
from app.repositories.chat_sessions import RedisChatSessionRepository
from app.schemas.chat import CartConfirmation
from app.schemas.errors import ErrorResponse
from app.services.cart import CartService

router = APIRouter(
    prefix="/cart",
    tags=["demo cart"],
    dependencies=[Depends(require_api_key)],
    responses={
        401: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
        409: {"model": ErrorResponse},
        502: {"model": ErrorResponse},
        503: {"model": ErrorResponse},
    },
)


@router.get("", response_model=CartResponse)
async def get_cart(
    request: Request, token: Token, session_id: Annotated[UUID, Query()]
) -> CartResponse:
    repository: RedisChatSessionRepository = request.app.state.chat_sessions
    service: CartService = request.app.state.cart_service
    async with repository.locked(session_id, token) as session:
        return service.get(session)


@router.post("/items", response_model=CartResult)
async def confirm_cart(data: CartConfirmation, request: Request, token: Token) -> CartResult:
    repository: RedisChatSessionRepository = request.app.state.chat_sessions
    service: CartService = request.app.state.cart_service
    settings: Settings = request.app.state.settings
    try:
        async with asyncio.timeout(settings.chat_timeout_seconds):
            async with repository.locked(data.session_id, token) as session:
                return await service.confirm(
                    session, data.operation_id, data.product_id, data.quantity
                )
    except TimeoutError as error:
        raise UpstreamUnavailable("Cart verification timed out. Please try again.") from error
