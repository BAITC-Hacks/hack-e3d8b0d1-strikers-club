"""Deterministic comparison; a numerical score never certifies interchangeability."""

import re
import unicodedata
from decimal import Decimal, InvalidOperation
from pathlib import Path

from pydantic import BaseModel, Field, TypeAdapter

from app.models.products import Analog, Product


class CategoryProfile(BaseModel):
    name: str
    aliases: list[str]
    critical: list[str]
    functional: list[str] = Field(default_factory=list)
    dimensional: list[str] = Field(default_factory=list)
    critical_weight: float = Field(default=0.35, ge=0, le=1)


_KEY_ALIASES: dict[str, tuple[str, ...]] = {
    "current": ("ток", "номинальный ток", "rated current", "rated_current", "выходной ток"),
    "voltage": ("напряжение", "номинальное напряжение", "rated voltage", "rated_voltage"),
    "poles": ("полюса", "число полюсов", "кол-во полюсов", "количество полюсов"),
    "trip_curve": ("характеристика", "характеристика срабатывания", "кривая отключения"),
    "breaking_capacity": ("отключающая способность", "номинальная отключающая способность"),
    "protection_type": ("тип защиты", "тип узо"),
    "material": ("материал", "материал жил", "материал проводника"),
    "cores": ("число жил", "количество жил", "кол-во жил"),
    "cross_section": ("сечение", "сечение жил", "сечение жилы", "сечение проводника"),
    "insulation": ("изоляция", "материал изоляции"),
    "installation": ("тип прокладки", "способ прокладки"),
    "length": ("длина",),
    "coil_voltage": ("напряжение катушки", "напряжение управления"),
    "contacts": ("число контактов", "количество контактов", "конфигурация контактов"),
    "supply_type": ("ac/dc", "тип тока", "род тока"),
    "utilization_category": ("категория применения",),
    "power": ("мощность", "номинальная мощность", "выходная мощность"),
    "luminous_flux": ("световой поток",),
    "color_temperature": ("цветовая температура",),
    "socket": ("цоколь", "тип цоколя"),
    "ip": ("степень защиты", "класс защиты ip", "ip rating"),
    "mounting": ("монтаж", "способ монтажа", "тип монтажа", "крепление"),
    "width": ("ширина",),
    "height": ("высота",),
    "depth": ("глубина",),
    "diameter": ("диаметр",),
    "series": ("серия",),
    "positions": ("число постов", "количество постов"),
    "mechanism": ("механизм", "тип механизма"),
    "color": ("цвет",),
    "input_voltage": ("входное напряжение", "напряжение на входе"),
    "output_voltage": ("выходное напряжение", "напряжение на выходе"),
    "housing": ("тип корпуса",),
    "modules": ("число модулей", "количество модулей"),
    "panel": ("наличие панели", "монтажная панель"),
    "connection": ("тип подключения", "способ подключения"),
    "compatible_series": ("совместимая серия",),
    "frequency": ("частота",),
    "fire_rating": ("пожарный класс", "класс пожарной безопасности"),
}


def normalize_text(value: str) -> str:
    value = unicodedata.normalize("NFKC", value).casefold().replace("ё", "е")
    return re.sub(r"\s+", " ", value.replace("—", "-").replace("–", "-")).strip()


def normalize_identifier(value: str) -> str:
    return re.sub(r"[^\w]", "", normalize_text(value))


_KEY_LOOKUP = {
    normalize_text(alias).replace("_", " "): key
    for key, aliases in _KEY_ALIASES.items()
    for alias in (key, *aliases)
}


def normalize_key(value: str) -> str:
    normalized = normalize_text(value).replace("_", " ")
    return _KEY_LOOKUP.get(normalized, normalized)


_UNITS: dict[str, tuple[Decimal, str]] = {
    "в": (Decimal(1), "v"),
    "v": (Decimal(1), "v"),
    "кв": (Decimal(1000), "v"),
    "kv": (Decimal(1000), "v"),
    "а": (Decimal(1), "a"),
    "a": (Decimal(1), "a"),
    "ка": (Decimal(1000), "a"),
    "ka": (Decimal(1000), "a"),
    "ма": (Decimal("0.001"), "a"),
    "ma": (Decimal("0.001"), "a"),
    "вт": (Decimal(1), "w"),
    "w": (Decimal(1), "w"),
    "квт": (Decimal(1000), "w"),
    "kw": (Decimal(1000), "w"),
    "мм": (Decimal(1), "mm"),
    "mm": (Decimal(1), "mm"),
    "см": (Decimal(10), "mm"),
    "cm": (Decimal(10), "mm"),
    "м": (Decimal(1000), "mm"),
    "m": (Decimal(1000), "mm"),
    "мм2": (Decimal(1), "mm2"),
    "mm2": (Decimal(1), "mm2"),
    "гц": (Decimal(1), "hz"),
    "hz": (Decimal(1), "hz"),
    "°c": (Decimal(1), "celsius"),
    "°с": (Decimal(1), "celsius"),
    "к": (Decimal(1), "k"),
    "k": (Decimal(1), "k"),
    "лм": (Decimal(1), "lm"),
    "lm": (Decimal(1), "lm"),
}
_VALUE_ALIASES = {
    "медь": "cu",
    "copper": "cu",
    "алюминий": "al",
    "aluminum": "al",
    "aluminium": "al",
    "пвх": "pvc",
    "переменный": "ac",
    "переменный ток": "ac",
    "постоянный": "dc",
    "постоянный ток": "dc",
    "дин-рейка": "din",
    "din-рейка": "din",
}


def normalize_value(value: str) -> str:
    normalized = normalize_text(value).replace(",", ".").replace("²", "2")
    normalized = re.sub(r"\bip\s+(\d+)", r"ip\1", normalized)
    numeric = re.fullmatch(r"([+-]?\d+(?:\.\d+)?)\s*([^\s]*)", normalized)
    if numeric:
        try:
            number = Decimal(numeric.group(1))
        except InvalidOperation:
            return normalized
        unit = numeric.group(2)
        factor, canonical = _UNITS.get(unit, (Decimal(1), unit))
        return f"{(number * factor).normalize():f}{canonical}"
    # Preserve intervals and enumerations as explicit constraints; never assume
    # one nominal value satisfies an unparsed range or accessory requirement.
    normalized = re.sub(r"\s*([;/xх×-])\s*", r"\1", normalized)
    normalized = normalized.replace("×", "x").replace("х", "x")
    return _VALUE_ALIASES.get(normalized, normalized)


def normalized_attributes(product: Product) -> dict[str, str]:
    return {normalize_key(key): normalize_value(value) for key, value in product.attributes.items()}


class AnalogEngine:
    def __init__(self, profiles_path: Path | None = None) -> None:
        path = (
            profiles_path or Path(__file__).resolve().parent.parent / "data/category_profiles.json"
        )
        self.profiles = TypeAdapter(list[CategoryProfile]).validate_json(path.read_text("utf-8"))

    def profile(self, product: Product) -> CategoryProfile | None:
        category = normalize_text(product.category or "")
        for profile in self.profiles:
            if category == profile.name or any(
                normalize_text(a) in category for a in profile.aliases
            ):
                return profile
        return None

    def compare(
        self,
        reference: Product,
        candidate: Product,
        requirements: dict[str, str] | None = None,
        *,
        require_available: bool = True,
    ) -> Analog | None:
        if candidate.id == reference.id:
            return None
        if require_available and (candidate.quantity is None or candidate.quantity <= 0):
            return None
        source_profile = self.profile(reference)
        candidate_profile = self.profile(candidate)
        if source_profile and candidate_profile and source_profile.name != candidate_profile.name:
            return None
        source_category = normalize_text(reference.category or "")
        target_category = normalize_text(candidate.category or "")
        category_match = bool(source_category and source_category == target_category) or bool(
            source_profile and candidate_profile and source_profile.name == candidate_profile.name
        )
        if source_category and target_category and not category_match:
            return None
        expected = normalized_attributes(reference)
        actual = normalized_attributes(candidate)
        required = {
            normalize_key(key): normalize_value(val) for key, val in (requirements or {}).items()
        }
        expected.update(required)
        critical = set(source_profile.critical if source_profile else expected) | set(required)
        functional = set(source_profile.functional if source_profile else expected)
        dimensions = set(source_profile.dimensional if source_profile else ())
        matches: list[str] = ["category"] if category_match else []
        differences: list[str] = []
        unknown: list[str] = []
        matching_keys: set[str] = set()
        for key in sorted(set(expected) | critical):
            source = expected.get(key)
            target = actual.get(key)
            if (
                source is None
                or target is None
                or source in {"unknown", "неизвестно"}
                or target in {"unknown", "неизвестно"}
            ):
                unknown.append(key)
            elif source == target:
                matches.append(key)
                matching_keys.add(key)
            elif key in critical:
                return None  # Known electrical/mechanical conflicts cannot be recommended.
            else:
                differences.append(f"{key}: {target} (requested: {source})")
        if not category_match:
            unknown.append("category")
        if source_profile is None:
            unknown.append("category_criticality")
        if not category_match and not matching_keys:
            return None
        brand_match = bool(
            reference.brand
            and candidate.brand
            and normalize_text(reference.brand) == normalize_text(candidate.brand)
        )
        if reference.brand and candidate.brand and not brand_match:
            differences.append(f"brand: {candidate.brand} (requested: {reference.brand})")

        def fraction(keys: set[str]) -> float:
            return len(keys & matching_keys) / len(keys) if keys else 0.0

        price_similarity = 0.0
        if reference.price and candidate.price:
            price_similarity = float(
                min(reference.price, candidate.price) / max(reference.price, candidate.price)
            )
        critical_weight = source_profile.critical_weight if source_profile else 0.35
        # Profile critical weight is configurable; other documented weights keep
        # their proportions and the result is normalized to the full weight sum.
        score = (
            critical_weight * fraction(critical)
            + 0.25 * fraction(functional)
            + 0.15 * fraction(dimensions)
            + 0.10 * category_match
            + 0.05 * brand_match
            + 0.05 * bool(candidate.quantity and candidate.quantity > 0)
            + 0.05 * price_similarity
        ) / (critical_weight + 0.65)
        needs_review = bool(set(unknown) & critical) or not source_profile or not category_match
        return Analog(
            product_id=candidate.id,
            product=candidate,
            score=round(score, 4),
            match=matches,
            differences=differences,
            unknown=unknown,
            quantity=candidate.quantity,
            recommendation="requires_review" if needs_review else "possible_alternative",
        )
