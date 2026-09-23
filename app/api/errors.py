import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

from app.core.exceptions import ApplicationError
from app.schemas.errors import ErrorBody, ErrorDetail, ErrorResponse

logger = logging.getLogger(__name__)


def error_response(
    request: Request,
    *,
    status_code: int,
    code: str,
    message: str,
    details: list[ErrorDetail] | None = None,
) -> JSONResponse:
    request_id = str(getattr(request.state, "request_id", "unknown"))
    body = ErrorResponse(
        error=ErrorBody(code=code, message=message, details=details or []), request_id=request_id
    )
    return JSONResponse(
        status_code=status_code,
        content=body.model_dump(mode="json"),
        headers={"X-Request-ID": request_id, "Cache-Control": "no-store"},
    )


async def application_error_handler(request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, ApplicationError)
    if exc.status_code >= 500:
        logger.warning("dependency_unavailable", extra={"exception_type": type(exc).__name__})
    return error_response(request, status_code=exc.status_code, code=exc.code, message=exc.message)


async def validation_error_handler(request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, RequestValidationError)
    # Omit input, ctx and arbitrary validator messages: they may contain secrets.
    details = [
        ErrorDetail(
            location=list(error["loc"][:1] if error["type"] == "extra_forbidden" else error["loc"]),
            type=error["type"],
        )
        for error in exc.errors()
    ]
    return error_response(
        request,
        status_code=422,
        code="validation_error",
        message="Request validation failed.",
        details=details,
    )


async def http_error_handler(request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, HTTPException)
    response = error_response(
        request,
        status_code=exc.status_code,
        code="http_error",
        message="Request could not be handled.",
    )
    if exc.headers:
        response.headers.update(exc.headers)
    return response


async def unexpected_error_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.error("unexpected_error", extra={"exception_type": type(exc).__name__})
    return error_response(
        request, status_code=500, code="internal_error", message="An internal error occurred."
    )


def register_exception_handlers(app: FastAPI) -> None:
    app.add_exception_handler(ApplicationError, application_error_handler)
    app.add_exception_handler(RequestValidationError, validation_error_handler)
    app.add_exception_handler(HTTPException, http_error_handler)
    app.add_exception_handler(Exception, unexpected_error_handler)
