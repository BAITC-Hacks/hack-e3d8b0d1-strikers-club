"""Validated, temporary chat and demonstration-cart state."""

from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, computed_field

Quantity = Annotated[int, Field(strict=True, ge=1, le=2147483647)]


class SessionModel(BaseModel):
    model_config = ConfigDict(extra="forbid", validate_assignment=True)


class ChatMessage(SessionModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=32000)


class PendingCartAction(SessionModel):
    operation_id: UUID
    product_id: str = Field(min_length=1, max_length=200)
    product_name: str = Field(min_length=1, max_length=2000)
    quantity: Quantity
    price_at_proposal: Decimal = Field(ge=0, allow_inf_nan=False)
    available_quantity: Decimal = Field(ge=0, allow_inf_nan=False)
    status: Literal["WAITING_CONFIRMATION"] = "WAITING_CONFIRMATION"
    expires_at: AwareDatetime
    requires_confirmation: Literal[True] = True
    demo: Literal[True] = True


class CartLine(SessionModel):
    product_id: str
    product_name: str
    quantity: Quantity
    price: Decimal = Field(ge=0, allow_inf_nan=False)


class CartResponse(SessionModel):
    items: list[CartLine]
    total_quantity: int = Field(ge=0)
    total_amount: Decimal = Field(ge=0, allow_inf_nan=False)
    cart_url: str
    demo: Literal[True] = True


class CartResult(SessionModel):
    operation_id: UUID
    product_id: str
    quantity: Quantity
    status: Literal["added", "reconfirmation_required"]
    message: str
    cart: CartResponse
    pending_cart_action: PendingCartAction | None = None
    demo: Literal[True] = True

    @computed_field  # type: ignore[prop-decorator]
    @property
    def success(self) -> bool:
        return self.status == "added"

    @computed_field  # type: ignore[prop-decorator]
    @property
    def cart_url(self) -> str:
        return self.cart.cart_url


class CompletedCartOperation(SessionModel):
    operation_id: UUID
    product_id: str
    quantity: Quantity
    message: str


class ChatSession(SessionModel):
    session_id: UUID
    token_digest: str = Field(pattern=r"^[0-9a-f]{64}$", repr=False)
    messages: list[ChatMessage] = Field(default_factory=list, max_length=1000)
    last_candidates: list[str] = Field(default_factory=list, max_length=100)
    pending_cart_action: PendingCartAction | None = None
    cart: dict[str, CartLine] = Field(default_factory=dict, max_length=1000)
    completed_operations: dict[str, CompletedCartOperation] = Field(
        default_factory=dict, max_length=1000
    )
    confirmation_status: Literal[
        "NONE", "WAITING_CONFIRMATION", "COMPLETED", "CANCELLED", "EXPIRED", "FAILED"
    ] = "NONE"
