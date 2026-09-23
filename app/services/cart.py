"""Explicit-confirmation cart operating exclusively inside expiring sessions.

This is a demonstration adapter. No request creates a real ekt.kz order/cart.
Catalog checks cannot reserve stock; an eventual real integration must perform
its own atomic inventory validation when fulfilling an order.
"""

from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Protocol
from uuid import UUID, uuid4

from app.core.config import Settings
from app.core.exceptions import CartConflict
from app.models.chat_session import (
    CartLine,
    CartResponse,
    CartResult,
    ChatSession,
    CompletedCartOperation,
    PendingCartAction,
)
from app.models.products import Product


class ProductCatalog(Protocol):
    async def details(self, product_id: str, *, fresh: bool = False) -> Product: ...


class CartService:
    def __init__(self, catalog: ProductCatalog, settings: Settings) -> None:
        self._catalog = catalog
        self._settings = settings

    @staticmethod
    def _validate_quantity(quantity: int) -> None:
        if type(quantity) is not int or not 1 <= quantity <= 2147483647:
            raise CartConflict("Количество должно быть целым положительным числом.")

    @staticmethod
    def _known_facts(product: Product) -> tuple[Decimal, Decimal]:
        if product.price is None or product.quantity is None:
            raise CartConflict("Цена или остаток неизвестны. Добавление сейчас недоступно.")
        if not product.price.is_finite() or not product.quantity.is_finite():
            raise CartConflict("Не удалось проверить цену и остаток товара.")
        return product.price, product.quantity

    def _check_capacity(self, session: ChatSession, product_id: str) -> None:
        if len(session.completed_operations) >= self._settings.cart_max_operations:
            raise CartConflict("Лимит операций этой временной корзины достигнут.")
        if product_id not in session.cart and len(session.cart) >= self._settings.cart_max_lines:
            raise CartConflict("Лимит позиций временной корзины достигнут.")

    @staticmethod
    def _existing_quantity(session: ChatSession, product_id: str) -> int:
        line = session.cart.get(product_id)
        return line.quantity if line else 0

    def _proposal(self, session: ChatSession, product: Product, quantity: int) -> PendingCartAction:
        price, stock = self._known_facts(product)
        self._validate_quantity(quantity)
        self._check_capacity(session, product.id)
        total_quantity = quantity + self._existing_quantity(session, product.id)
        if total_quantity > stock or total_quantity > 2147483647:
            raise CartConflict("Запрошенное количество с учётом корзины превышает остаток.")
        pending = PendingCartAction(
            operation_id=uuid4(),
            product_id=product.id,
            product_name=product.name,
            quantity=quantity,
            price_at_proposal=price,
            available_quantity=stock,
            expires_at=datetime.now(UTC)
            + timedelta(seconds=self._settings.cart_proposal_ttl_seconds),
        )
        session.pending_cart_action = pending
        session.confirmation_status = "WAITING_CONFIRMATION"
        return pending

    async def prepare(
        self, session: ChatSession, product_id: str, quantity: int = 1
    ) -> PendingCartAction:
        self._validate_quantity(quantity)
        self._check_capacity(session, product_id)
        product = await self._catalog.details(product_id, fresh=True)
        if product.id != product_id:
            raise CartConflict("Каталог вернул другой товар. Добавление остановлено.")
        return self._proposal(session, product, quantity)

    async def confirm(
        self,
        session: ChatSession,
        operation_id: UUID,
        product_id: str,
        quantity: int,
    ) -> CartResult:
        self._validate_quantity(quantity)
        completed = session.completed_operations.get(str(operation_id))
        if completed is not None:
            if completed.product_id != product_id or completed.quantity != quantity:
                raise CartConflict("Подтверждение не соответствует выполненной операции.")
            return CartResult(
                operation_id=completed.operation_id,
                product_id=completed.product_id,
                quantity=completed.quantity,
                status="added",
                message=completed.message,
                cart=self.get(session),
            )
        pending = session.pending_cart_action
        if pending is None:
            raise CartConflict("Нет активного предложения. Сначала выберите товар.")
        if (
            pending.operation_id != operation_id
            or pending.product_id != product_id
            or pending.quantity != quantity
        ):
            raise CartConflict("Подтверждение не соответствует последнему предложению.")
        if pending.expires_at <= datetime.now(UTC):
            session.pending_cart_action = None
            session.confirmation_status = "EXPIRED"
            raise CartConflict("Срок предложения истёк. Запросите новое предложение.")
        self._check_capacity(session, product_id)
        product = await self._catalog.details(product_id, fresh=True)
        if product.id != product_id:
            raise CartConflict("Каталог вернул другой товар. Добавление остановлено.")
        price, stock = self._known_facts(product)
        existing_quantity = self._existing_quantity(session, product_id)
        total_quantity = existing_quantity + quantity
        if price != pending.price_at_proposal or total_quantity > stock:
            available = max(0, int(min(stock, Decimal(2147483647))) - existing_quantity)
            new_quantity = min(quantity, available)
            session.pending_cart_action = None
            session.confirmation_status = "FAILED"
            replacement = self._proposal(session, product, new_quantity) if new_quantity else None
            message = (
                "Цена или остаток изменились. Корзина не изменена; подтвердите новое предложение."
                if replacement
                else "Товар больше недоступен в запрошенном количестве. Корзина не изменена."
            )
            return CartResult(
                operation_id=operation_id,
                product_id=product_id,
                quantity=quantity,
                status="reconfirmation_required",
                message=message,
                cart=self.get(session),
                pending_cart_action=replacement,
            )
        if total_quantity > 2147483647:
            raise CartConflict("Превышено максимальное количество позиции.")
        session.cart[product_id] = CartLine(
            product_id=product_id,
            product_name=product.name,
            quantity=total_quantity,
            price=price,
        )
        session.pending_cart_action = None
        session.confirmation_status = "COMPLETED"
        result = CartResult(
            operation_id=operation_id,
            product_id=product_id,
            quantity=quantity,
            status="added",
            message="Товар добавлен в демонстрационную корзину этой сессии.",
            cart=self.get(session),
        )
        session.completed_operations[str(operation_id)] = CompletedCartOperation(
            operation_id=operation_id,
            product_id=product_id,
            quantity=quantity,
            message=result.message,
        )
        return result

    @staticmethod
    def cancel(session: ChatSession) -> None:
        session.pending_cart_action = None
        session.confirmation_status = "CANCELLED"

    def get(self, session: ChatSession) -> CartResponse:
        items = [line.model_copy(deep=True) for line in session.cart.values()]
        return CartResponse(
            items=items,
            total_quantity=sum(line.quantity for line in items),
            total_amount=sum((line.price * line.quantity for line in items), start=Decimal(0)),
            cart_url=f"{self._settings.api_prefix}/cart?session_id={session.session_id}",
        )
