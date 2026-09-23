from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import uuid4

import pytest

from app.core.config import Settings
from app.core.exceptions import CartConflict
from app.models.chat_session import ChatSession
from app.models.products import Product
from app.repositories.chat_sessions import RedisChatSessionRepository
from app.services.cart import CartService
from tests.conftest import TEST_API_KEY, ApiSession


@dataclass
class CatalogStub:
    product: Product = field(
        default_factory=lambda: Product(
            id="123", name="Кабель", price=Decimal("850.50"), quantity=Decimal(10)
        )
    )
    calls: list[tuple[str, bool]] = field(default_factory=list)

    async def details(self, product_id: str, *, fresh: bool = False) -> Product:
        self.calls.append((product_id, fresh))
        return self.product.model_copy(deep=True)


@pytest.fixture
def session() -> ChatSession:
    return ChatSession(session_id=uuid4(), token_digest="a" * 64)


@pytest.fixture
def catalog() -> CatalogStub:
    return CatalogStub()


@pytest.fixture
def cart(catalog: CatalogStub) -> CartService:
    return CartService(catalog, Settings(environment="test", api_key=TEST_API_KEY))


async def test_prepare_never_adds_and_confirm_checks_fresh_stock_again(
    cart: CartService, catalog: CatalogStub, session: ChatSession
) -> None:
    proposal = await cart.prepare(session, "123", 2)
    assert session.cart == {}
    assert session.confirmation_status == "WAITING_CONFIRMATION"
    assert proposal.demo is True
    result = await cart.confirm(session, proposal.operation_id, "123", 2)
    assert result.status == "added"
    assert result.cart.total_quantity == 2
    assert result.cart.total_amount == Decimal("1701.00")
    assert result.demo is True
    assert result.cart.cart_url == f"/api/cart?session_id={session.session_id}"
    assert "token" not in result.cart.cart_url
    assert catalog.calls == [("123", True), ("123", True)]
    assert session.pending_cart_action is None


async def test_confirm_is_idempotent_and_rejects_changed_repeat_payload(
    cart: CartService, catalog: CatalogStub, session: ChatSession
) -> None:
    proposal = await cart.prepare(session, "123", 2)
    first = await cart.confirm(session, proposal.operation_id, "123", 2)
    second = await cart.confirm(session, proposal.operation_id, "123", 2)
    assert first == second
    assert session.cart["123"].quantity == 2
    assert len(catalog.calls) == 2
    with pytest.raises(CartConflict):
        await cart.confirm(session, proposal.operation_id, "123", 3)
    with pytest.raises(CartConflict):
        await cart.confirm(session, proposal.operation_id, "other", 2)
    with pytest.raises(CartConflict):
        await cart.confirm(session, uuid4(), "123", 2)


async def test_no_confirmation_or_cancel_never_changes_cart(
    cart: CartService, session: ChatSession
) -> None:
    with pytest.raises(CartConflict):
        await cart.confirm(session, uuid4(), "123", 1)
    proposal = await cart.prepare(session, "123", 1)
    cart.cancel(session)
    with pytest.raises(CartConflict):
        await cart.confirm(session, proposal.operation_id, "123", 1)
    assert cart.get(session).items == []


async def test_changed_quantity_and_stale_operation_need_new_proposal(
    cart: CartService, session: ChatSession
) -> None:
    old = await cart.prepare(session, "123", 1)
    with pytest.raises(CartConflict):
        await cart.confirm(session, old.operation_id, "123", 2)
    new = await cart.prepare(session, "123", 2)
    assert old.operation_id != new.operation_id
    with pytest.raises(CartConflict):
        await cart.confirm(session, old.operation_id, "123", 1)
    assert session.cart == {}
    await cart.confirm(session, new.operation_id, "123", 2)
    assert session.cart["123"].quantity == 2


@pytest.mark.parametrize("quantity", [0, -1, True, 1.5, 2147483648])
async def test_invalid_quantities_never_fetch_or_change_cart(
    cart: CartService, catalog: CatalogStub, session: ChatSession, quantity: int
) -> None:
    with pytest.raises(CartConflict):
        await cart.prepare(session, "123", quantity)
    assert catalog.calls == []
    assert session.cart == {}


@pytest.mark.parametrize("missing", ["price", "quantity"])
async def test_unknown_facts_cannot_be_treated_as_zero_or_added(
    cart: CartService, catalog: CatalogStub, session: ChatSession, missing: str
) -> None:
    catalog.product = catalog.product.model_copy(update={missing: None})
    with pytest.raises(CartConflict):
        await cart.prepare(session, "123", 1)
    assert session.cart == {}
    assert session.pending_cart_action is None


async def test_price_change_replaces_proposal_without_adding(
    cart: CartService, catalog: CatalogStub, session: ChatSession
) -> None:
    old = await cart.prepare(session, "123", 2)
    catalog.product.price = Decimal("950")
    changed = await cart.confirm(session, old.operation_id, "123", 2)
    assert changed.status == "reconfirmation_required"
    assert session.cart == {}
    replacement = changed.pending_cart_action
    assert replacement is not None
    assert replacement.operation_id != old.operation_id
    assert replacement.price_at_proposal == Decimal("950")
    with pytest.raises(CartConflict):
        await cart.confirm(session, old.operation_id, "123", 2)
    result = await cart.confirm(session, replacement.operation_id, "123", 2)
    assert result.cart.total_amount == Decimal("1900")


async def test_lower_stock_requires_confirmation_of_reduced_integer_quantity(
    cart: CartService, catalog: CatalogStub, session: ChatSession
) -> None:
    old = await cart.prepare(session, "123", 2)
    catalog.product.quantity = Decimal("1.9")
    changed = await cart.confirm(session, old.operation_id, "123", 2)
    assert changed.status == "reconfirmation_required"
    replacement = changed.pending_cart_action
    assert replacement is not None
    assert replacement.quantity == 1
    assert session.cart == {}
    result = await cart.confirm(session, replacement.operation_id, "123", 1)
    assert result.cart.total_quantity == 1


async def test_zero_stock_clears_proposal_and_never_claims_success(
    cart: CartService, catalog: CatalogStub, session: ChatSession
) -> None:
    old = await cart.prepare(session, "123", 2)
    catalog.product.quantity = Decimal(0)
    result = await cart.confirm(session, old.operation_id, "123", 2)
    assert result.status == "reconfirmation_required"
    assert result.pending_cart_action is None
    assert session.cart == {}
    assert session.pending_cart_action is None


async def test_existing_cart_quantity_counts_against_stock(
    cart: CartService, catalog: CatalogStub, session: ChatSession
) -> None:
    first = await cart.prepare(session, "123", 8)
    await cart.confirm(session, first.operation_id, "123", 8)
    with pytest.raises(CartConflict):
        await cart.prepare(session, "123", 3)
    second = await cart.prepare(session, "123", 2)
    catalog.product.quantity = Decimal(9)
    result = await cart.confirm(session, second.operation_id, "123", 2)
    assert session.cart["123"].quantity == 8
    assert result.pending_cart_action is not None
    assert result.pending_cart_action.quantity == 1


async def test_expired_proposal_cannot_be_confirmed(
    cart: CartService, catalog: CatalogStub, session: ChatSession
) -> None:
    proposal = await cart.prepare(session, "123", 1)
    proposal.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    with pytest.raises(CartConflict):
        await cart.confirm(session, proposal.operation_id, "123", 1)
    assert session.cart == {}
    assert len(catalog.calls) == 1


async def test_idempotency_entries_are_retained_at_capacity(
    catalog: CatalogStub, session: ChatSession
) -> None:
    cart = CartService(
        catalog, Settings(environment="test", api_key=TEST_API_KEY, cart_max_operations=1)
    )
    first = await cart.prepare(session, "123", 1)
    result = await cart.confirm(session, first.operation_id, "123", 1)
    with pytest.raises(CartConflict):
        await cart.prepare(session, "123", 1)
    assert await cart.confirm(session, first.operation_id, "123", 1) == result
    assert session.cart["123"].quantity == 1


async def test_cart_line_capacity_is_enforced(catalog: CatalogStub, session: ChatSession) -> None:
    cart = CartService(
        catalog, Settings(environment="test", api_key=TEST_API_KEY, cart_max_lines=1)
    )
    first = await cart.prepare(session, "123", 1)
    await cart.confirm(session, first.operation_id, "123", 1)
    catalog.product.id = "other"
    with pytest.raises(CartConflict):
        await cart.prepare(session, "other", 1)
    assert list(session.cart) == ["123"]


async def test_cart_idempotency_survives_session_reload(
    api: ApiSession, catalog: CatalogStub
) -> None:
    repository = RedisChatSessionRepository(api.redis, api.settings)
    cart = CartService(catalog, api.settings)
    session, token = await repository.create()
    async with repository.locked(session.session_id, token) as stored:
        proposal = await cart.prepare(stored, "123", 2)
    async with repository.locked(session.session_id, token) as stored:
        first = await cart.confirm(stored, proposal.operation_id, "123", 2)
    async with repository.locked(session.session_id, token) as stored:
        repeated = await cart.confirm(stored, proposal.operation_id, "123", 2)
        assert cart.get(stored).total_quantity == 2
    assert first == repeated
    assert len(catalog.calls) == 2


async def test_duplicate_after_later_addition_returns_current_cart_without_readding(
    cart: CartService, session: ChatSession
) -> None:
    first = await cart.prepare(session, "123", 2)
    await cart.confirm(session, first.operation_id, "123", 2)
    second = await cart.prepare(session, "123", 3)
    await cart.confirm(session, second.operation_id, "123", 3)
    repeated = await cart.confirm(session, first.operation_id, "123", 2)
    assert repeated.quantity == 2
    assert repeated.cart.total_quantity == 5
    assert session.cart["123"].quantity == 5
    assert len(session.completed_operations) == 2
    assert "cart" not in session.completed_operations[str(first.operation_id)].model_dump()


async def test_failed_turn_after_demo_addition_does_not_commit_cart(
    api: ApiSession, catalog: CatalogStub
) -> None:
    repository = RedisChatSessionRepository(api.redis, api.settings)
    cart = CartService(catalog, api.settings)
    session, token = await repository.create()
    async with repository.locked(session.session_id, token) as stored:
        proposal = await cart.prepare(stored, "123", 2)
    with pytest.raises(RuntimeError, match="turn failed"):
        async with repository.locked(session.session_id, token) as stored:
            await cart.confirm(stored, proposal.operation_id, "123", 2)
            raise RuntimeError("turn failed")
    async with repository.locked(session.session_id, token) as stored:
        assert cart.get(stored).total_quantity == 0
        assert stored.completed_operations == {}
        assert stored.pending_cart_action is not None
        result = await cart.confirm(stored, proposal.operation_id, "123", 2)
        assert result.cart.total_quantity == 2
