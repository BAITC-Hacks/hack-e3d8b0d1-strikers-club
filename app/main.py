from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from redis.asyncio import Redis

from app.api.errors import register_exception_handlers
from app.api.middleware import BodyLimitMiddleware, RequestContextMiddleware
from app.api.routes import cart, chat, health, products
from app.clients.catalog import EktCatalogClient
from app.clients.openai import OpenAIResponsesClient
from app.core.config import Settings
from app.core.logging import configure_logging
from app.core.redis import create_redis
from app.repositories.chat_sessions import RedisChatSessionRepository
from app.services.cart import CartService
from app.services.catalog import CatalogService
from app.services.chat import ChatService
from app.services.uploads import UploadService


def create_app(
    settings: Settings | None = None,
    redis_client: Redis | None = None,
    http_client: httpx.AsyncClient | None = None,
) -> FastAPI:
    config = settings or Settings()

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        configure_logging(config.log_level)
        client = redis_client if redis_client is not None else create_redis(config)
        application.state.settings = config
        application.state.redis = client
        http = (
            http_client
            if http_client is not None
            else httpx.AsyncClient(
                timeout=config.upstream_timeout_seconds,
                follow_redirects=False,
                limits=httpx.Limits(max_connections=50, max_keepalive_connections=20),
            )
        )
        catalog = CatalogService(EktCatalogClient(http, config), client, config)
        cart_service = CartService(catalog, config)
        application.state.chat_sessions = RedisChatSessionRepository(client, config)
        application.state.catalog_service = catalog
        application.state.cart_service = cart_service
        application.state.chat_service = ChatService(
            OpenAIResponsesClient(http, config),
            catalog,
            cart_service,
            config,
        )
        application.state.upload_service = UploadService(config)
        try:
            yield
        finally:
            if http_client is None:
                await http.aclose()
            if redis_client is None:
                await client.aclose()

    application = FastAPI(
        title=config.app_name,
        version="0.2.0",
        description="EKT chat assistant. Redis TTL only; demo cart.",
        lifespan=lifespan,
        docs_url="/docs" if config.environment != "production" else None,
        redoc_url=None,
        openapi_url="/openapi.json" if config.environment != "production" else None,
    )
    application.include_router(health.router, prefix=config.api_prefix)
    application.include_router(chat.router, prefix=config.api_prefix)
    application.include_router(cart.router, prefix=config.api_prefix)
    application.include_router(products.router, prefix=config.api_prefix)
    register_exception_handlers(application)
    application.add_middleware(
        BodyLimitMiddleware,
        max_bytes=config.max_request_bytes,
        upload_path=f"{config.api_prefix}/chat/upload",
        max_upload_bytes=config.max_upload_mb * 1024 * 1024,
    )
    application.add_middleware(TrustedHostMiddleware, allowed_hosts=config.allowed_hosts)
    if config.cors_origins:
        application.add_middleware(
            CORSMiddleware,
            allow_origins=config.cors_origins,
            allow_credentials=False,
            allow_methods=["GET", "POST"],
            allow_headers=[
                "Content-Type",
                "X-API-Key",
                "X-Request-ID",
                "X-Session-Token",
                "X-Filename",
            ],
            expose_headers=["X-Request-ID"],
        )
    application.add_middleware(RequestContextMiddleware)
    return application
