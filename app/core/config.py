from pathlib import Path
from typing import Literal, Self
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore", hide_input_in_errors=True
    )

    app_name: str = "Strikers Club Chat API"
    environment: Literal["development", "test", "production"] = "development"
    api_prefix: str = "/api"
    api_key: SecretStr
    redis_url: SecretStr = SecretStr("redis://localhost:6379/0")
    redis_key_prefix: str = Field(default="strikers:items", min_length=1, max_length=100)
    redis_socket_timeout_seconds: float = Field(default=1.0, gt=0, le=30)
    redis_connect_timeout_seconds: float = Field(default=1.0, gt=0, le=30)
    redis_max_connections: int = Field(default=100, ge=1, le=10000)
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"
    cors_origins: list[str] = Field(default_factory=list)
    allowed_hosts: list[str] = Field(
        default_factory=lambda: ["localhost", "127.0.0.1", "testserver"]
    )
    max_request_bytes: int = Field(default=16384, ge=1024, le=1048576)

    openai_api_key: SecretStr | None = None
    openai_api_base_url: str = "https://api.openai.com/v1"
    openai_model: str = "gpt-5.6-luna"
    openai_reasoning_effort: Literal["low", "medium", "high"] = "low"
    openai_max_output_tokens: int = Field(default=4096, ge=256, le=16384)
    openai_max_request_bytes: int = Field(default=33554432, ge=1024, le=67108864)
    openai_timeout_seconds: float = Field(default=45, gt=0, le=120)
    ekt_api_base_url: str = "https://ekt.kz/api"
    ekt_api_user: SecretStr | None = None
    ekt_api_password: SecretStr | None = None
    upstream_timeout_seconds: float = Field(default=15, gt=0, le=60)
    upstream_max_response_bytes: int = Field(default=2097152, ge=1024, le=10485760)
    catalog_cache_ttl_seconds: int = Field(default=1800, ge=1, le=86400)
    detail_cache_ttl_seconds: int = Field(default=300, ge=1, le=300)
    catalog_max_pages: int = Field(default=50, ge=1, le=1000)
    catalog_max_products: int = Field(default=10000, ge=1, le=100000)
    chat_session_ttl_seconds: int = Field(default=3600, ge=60, le=86400)
    chat_timeout_seconds: float = Field(default=90, ge=1, le=300)
    chat_lock_ttl_seconds: int = Field(default=120, ge=2, le=600)
    chat_max_messages: int = Field(default=40, ge=2, le=100)
    chat_max_tool_rounds: int = Field(default=5, ge=1, le=10)
    chat_max_tool_calls: int = Field(default=16, ge=1, le=32)
    cart_proposal_ttl_seconds: int = Field(default=600, ge=1, le=600)
    cart_max_operations: int = Field(default=100, ge=1, le=1000)
    cart_max_lines: int = Field(default=100, ge=1, le=1000)
    purchase_conditions_path: Path = Path("app/data/purchase_conditions.json")
    external_search_enabled: bool = False
    max_upload_mb: int = Field(default=20, ge=1, le=20)
    upload_scan_host: str | None = None
    upload_scan_port: int = Field(default=3310, ge=1, le=65535)
    upload_scan_timeout_seconds: float = Field(default=10, gt=0, le=60)
    max_archive_uncompressed_mb: int = Field(default=40, ge=1, le=100)
    max_archive_entries: int = Field(default=1000, ge=1, le=5000)

    @field_validator("ekt_api_base_url", "openai_api_base_url")
    @classmethod
    def validate_upstream_url(cls, value: str) -> str:
        parsed = urlsplit(value)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError("Upstream URLs must be HTTPS without credentials")
        if parsed.query or parsed.fragment:
            raise ValueError("Upstream base URLs cannot contain query or fragment")
        return value.rstrip("/")

    @field_validator("api_key")
    @classmethod
    def validate_api_key(cls, value: SecretStr) -> SecretStr:
        if len(value.get_secret_value()) < 32:
            raise ValueError("API_KEY must contain at least 32 characters")
        if value.get_secret_value().lower().startswith(("change", "replace", "your-")):
            raise ValueError("Replace the API_KEY placeholder with a generated secret")
        return value

    @field_validator("redis_url")
    @classmethod
    def validate_redis_url(cls, value: SecretStr) -> SecretStr:
        parsed = urlsplit(value.get_secret_value())
        if parsed.scheme not in {"redis", "rediss"} or not parsed.hostname:
            raise ValueError("REDIS_URL must be a valid redis:// or rediss:// URL")
        return value

    @field_validator("api_prefix")
    @classmethod
    def validate_api_prefix(cls, value: str) -> str:
        if not value.startswith("/") or value.endswith("/"):
            raise ValueError("API_PREFIX must start with / and have no trailing slash")
        return value

    @model_validator(mode="after")
    def validate_configuration(self) -> Self:
        if self.chat_lock_ttl_seconds <= self.chat_timeout_seconds + 5:
            raise ValueError("Chat lock TTL must exceed the chat timeout by more than 5 seconds")
        if self.cart_proposal_ttl_seconds > self.chat_session_ttl_seconds:
            raise ValueError("Cart proposal TTL must not exceed session TTL")
        if not self.allowed_hosts:
            raise ValueError("ALLOWED_HOSTS must not be empty")
        if self.environment == "production" and "*" in self.allowed_hosts:
            raise ValueError("Use explicit ALLOWED_HOSTS in production")
        if "*" in self.cors_origins:
            raise ValueError("Use explicit CORS_ORIGINS")
        return self
