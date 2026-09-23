"""Validated catalog facts. Missing facts stay unknown instead of becoming zero."""

from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class ProductStore(BaseModel):
    name: str
    quantity: Decimal | None = Field(default=None, ge=0)


class ProductCertificate(BaseModel):
    name: str | None = None
    url: str


class Product(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=200)
    name: str = Field(min_length=1, max_length=2000)
    article: str | None = None
    brand: str | None = None
    category: str | None = None
    description: str | None = None
    price: Decimal | None = Field(default=None, ge=0)
    quantity: Decimal | None = Field(default=None, ge=0)
    stores: list[ProductStore] = Field(default_factory=list)
    attributes: dict[str, str] = Field(default_factory=dict)
    certificates: list[ProductCertificate] = Field(default_factory=list)
    product_url: str | None = None
    source: Literal["ekt_catalog"] = "ekt_catalog"


class Analog(BaseModel):
    kind: Literal["catalog_analog"] = "catalog_analog"
    product_id: str
    product: Product
    score: float = Field(ge=0, le=1)
    match: list[str]
    differences: list[str]
    unknown: list[str]
    quantity: Decimal | None
    recommendation: Literal["possible_alternative", "requires_review"]
