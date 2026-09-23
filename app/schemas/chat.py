from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.models.chat_session import CartResponse, PendingCartAction
from app.models.products import Analog, Product


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SessionCreated(StrictModel):
    session_id: UUID
    session_token: str
    expires_in: int


class ChatRequest(StrictModel):
    session_id: UUID
    message: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=8000)]


class CartConfirmation(StrictModel):
    session_id: UUID
    operation_id: UUID
    product_id: str = Field(min_length=1, max_length=200)
    quantity: int = Field(strict=True, ge=1, le=2147483647)


class Attribute(StrictModel):
    name: str = Field(min_length=1, max_length=100)
    value: str = Field(max_length=300)


class IdentifiedProduct(StrictModel):
    article: str | None = Field(max_length=200)
    barcode: str | None = Field(max_length=200)
    brand: str | None = Field(max_length=200)
    model: str | None = Field(max_length=200)
    category: str | None = Field(max_length=200)
    attributes: list[Attribute] = Field(max_length=50)
    quantity: int | None = Field(ge=1, le=2147483647)
    unreadable_fields: list[str] = Field(max_length=50)
    confidence: float = Field(ge=0, le=1)


class ExtractionResult(StrictModel):
    products: list[IdentifiedProduct] = Field(max_length=50)


class ExternalVariant(StrictModel):
    name: str = Field(min_length=1, max_length=500)
    url: str = Field(max_length=2000)
    attributes: list[Attribute] = Field(max_length=50)
    differences: list[str] = Field(max_length=50)
    unknown: list[str] = Field(max_length=50)
    kind: Literal["external_variant"] = "external_variant"
    recommendation: Literal["requires_review"] = "requires_review"


class ExternalResults(StrictModel):
    variants: list[ExternalVariant] = Field(max_length=5)


class ChatResponse(StrictModel):
    session_id: UUID
    message: str
    cart_changed: bool = False
    pending_cart_action: PendingCartAction | None = None
    products: list[Product] = Field(default_factory=list)
    analogs: list[Analog] = Field(default_factory=list)
    external_variants: list[ExternalVariant] = Field(default_factory=list)
    extracted: list[IdentifiedProduct] = Field(default_factory=list)
    cart: CartResponse | None = None
    cart_url: str | None = None
    demo_cart: Literal[True] = True
