"""Domain errors contain only public, non-sensitive messages."""


class ApplicationError(Exception):
    status_code = 500
    code = "internal_error"
    message = "An internal error occurred."

    def __init__(self, message: str | None = None) -> None:
        self.message = message or self.message
        super().__init__(self.message)


class StorageUnavailable(ApplicationError):
    status_code = 503
    code = "storage_unavailable"
    message = "Temporary storage is unavailable. Please retry later."


class AuthenticationRequired(ApplicationError):
    status_code = 401
    code = "authentication_required"
    message = "A valid X-API-Key header is required."


class IntegrationNotConfigured(ApplicationError):
    status_code = 503
    code = "integration_not_configured"
    message = "Required integration is not configured."


class UpstreamUnavailable(ApplicationError):
    status_code = 502
    code = "upstream_unavailable"
    message = "External service is unavailable or returned invalid data."


class ProductNotFound(ApplicationError):
    status_code = 404
    code = "product_not_found"
    message = "Product was not found in the catalog."


class SessionNotFound(ApplicationError):
    status_code = 404
    code = "session_not_found"
    message = "Session does not exist or has expired."


class SessionUnauthorized(ApplicationError):
    status_code = 401
    code = "session_unauthorized"
    message = "A valid X-Session-Token is required."


class SessionBusy(ApplicationError):
    status_code = 409
    code = "session_busy"
    message = "Another request is processing this session; retry later."


class CartConflict(ApplicationError):
    status_code = 409
    code = "cart_conflict"
    message = "Cart confirmation is missing, expired or no longer matches the proposal."


class InvalidAttachment(ApplicationError):
    status_code = 422
    code = "invalid_attachment"
    message = "The attachment is invalid or its format is unsupported."


class AttachmentTooLarge(ApplicationError):
    status_code = 413
    code = "attachment_too_large"
    message = "The attachment exceeds the configured size limit."


class UploadScannerUnavailable(ApplicationError):
    status_code = 503
    code = "upload_scanner_unavailable"
    message = "Attachment security scanner is unavailable."
