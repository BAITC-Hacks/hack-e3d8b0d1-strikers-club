from decimal import Decimal

import pytest

from app.models.products import Product
from app.services.analogs import AnalogEngine, normalize_value


@pytest.mark.parametrize(
    ("left", "right"),
    [
        ("0,4 кВ", "400 V"),
        ("0.5 кВт", "500 W"),
        ("2,5 мм²", "2.5 mm2"),
        ("50 Гц", "50 hz"),
        ("IP 65", "ip65"),
        ("10 см", "100 mm"),
        ("Медь", "Cu"),
    ],
)
def test_parameter_normalization(left: str, right: str) -> None:
    assert normalize_value(left) == normalize_value(right)


@pytest.mark.parametrize(
    ("category", "attributes", "mismatch_key", "mismatch"),
    [
        ("Автоматический выключатель", {"ток": "16 А", "напряжение": "230 В"}, "ток", "32 А"),
        ("Кабель", {"сечение": "2.5 мм²", "число жил": "3"}, "число жил", "2"),
        ("Светильник", {"мощность": "50 Вт", "напряжение": "230 В"}, "напряжение", "12 В"),
        ("Контактор", {"ток": "25 А", "напряжение катушки": "24 В"}, "напряжение катушки", "230 В"),
        (
            "Блок питания",
            {"выходное напряжение": "24 В", "мощность": "100 Вт"},
            "выходное напряжение",
            "12 В",
        ),
    ],
)
def test_five_categories_exclude_critical_mismatch_and_mark_missing_facts(
    category: str, attributes: dict[str, str], mismatch_key: str, mismatch: str
) -> None:
    engine = AnalogEngine()
    source = Product(id="source", name="Source", category=category, attributes=attributes)
    good = Product(
        id="good", name="Candidate", category=category, attributes=attributes, quantity=Decimal(4)
    )
    result = engine.compare(source, good)
    assert result is not None
    assert result.recommendation == "requires_review"  # Other profile-critical facts are unknown.
    assert result.unknown
    bad = good.model_copy(update={"attributes": {**attributes, mismatch_key: mismatch}})
    assert engine.compare(source, bad) is None


def test_user_requirement_is_mandatory_even_when_not_in_category_profile() -> None:
    engine = AnalogEngine()
    source = Product(id="s", name="Cable", category="Кабель", attributes={"цвет": "красный"})
    candidate = Product(
        id="c", name="Cable", category="Кабель", quantity=Decimal(2), attributes={"цвет": "синий"}
    )
    assert engine.compare(source, candidate, {"цвет": "красный"}) is None
    missing = candidate.model_copy(update={"attributes": {}})
    result = engine.compare(source, missing, {"цвет": "красный"})
    assert result is not None and result.recommendation == "requires_review"
    assert "color" in result.unknown


def test_unknown_category_cannot_claim_full_equivalence() -> None:
    source = Product(id="s", name="New part", category="Новая категория", attributes={"x": "1"})
    candidate = source.model_copy(update={"id": "c", "quantity": Decimal(1)})
    result = AnalogEngine().compare(source, candidate)
    assert result is not None
    assert result.recommendation == "requires_review"
    assert "category_criticality" in result.unknown


def test_noncritical_differences_are_explicit() -> None:
    source = Product(
        id="s",
        name="Lamp",
        category="Светильник",
        attributes={
            "power": "10 W",
            "voltage": "230 V",
            "socket": "E27",
            "ip": "IP20",
            "color_temperature": "3000 K",
        },
    )
    candidate = source.model_copy(
        update={
            "id": "c",
            "quantity": Decimal(1),
            "attributes": {
                **source.attributes,
                "color_temperature": "4000 K",
            },
        }
    )
    result = AnalogEngine().compare(source, candidate)
    assert result is not None
    assert result.recommendation == "possible_alternative"
    assert result.differences == ["color_temperature: 4000k (requested: 3000k)"]


@pytest.mark.parametrize("quantity", [None, Decimal(0)])
def test_unknown_and_zero_stock_cannot_be_available_analogs(quantity: Decimal | None) -> None:
    source = Product(id="s", name="Cable", category="Кабель")
    candidate = source.model_copy(update={"id": "c", "quantity": quantity})
    assert AnalogEngine().compare(source, candidate) is None
