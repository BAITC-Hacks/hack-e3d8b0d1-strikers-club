"""Validated schemas for the small allowlist of read/proposal tools."""

from typing import Any

from pydantic import BaseModel, Field

from app.schemas.chat import Attribute, StrictModel


class SearchArguments(StrictModel):
    query: str | None = Field(default=None, max_length=500)
    article: str | None = Field(default=None, max_length=200)
    brand: str | None = Field(default=None, max_length=200)
    category: str | None = Field(default=None, max_length=200)
    attributes: list[Attribute] = Field(default_factory=list, max_length=50)


class ProductArguments(StrictModel):
    product_id: str = Field(min_length=1, max_length=200)


class AnalogArguments(ProductArguments):
    requirements: list[Attribute] = Field(default_factory=list, max_length=50)


class ProposalArguments(ProductArguments):
    quantity: int = Field(strict=True, ge=1, le=2147483647)


class ExternalArguments(StrictModel):
    query: str = Field(min_length=1, max_length=500)


class EmptyArguments(StrictModel):
    pass


TOOL_MODELS: dict[str, type[BaseModel]] = {
    "find_products": SearchArguments,
    "get_product_details": ProductArguments,
    "find_catalog_analogs": AnalogArguments,
    "search_external_analogs": ExternalArguments,
    "get_purchase_conditions": EmptyArguments,
    "prepare_cart_addition": ProposalArguments,
    "get_cart": EmptyArguments,
    "extract_product_identifiers": EmptyArguments,
}
DESCRIPTIONS = {
    "find_products": "Search EKT with freshly verified price and stock.",
    "get_product_details": "Get fresh official facts. Never invent missing values.",
    "find_catalog_analogs": "Rank alternatives using server rules; unknowns require review.",
    "search_external_analogs": "External variants only after catalog has no suitable matches.",
    "get_purchase_conditions": "Get approved purchase terms; unknown means ask manager.",
    "prepare_cart_addition": "Propose adding. Does NOT change cart; confirmation is required.",
    "get_cart": "Read the current demo cart.",
    "extract_product_identifiers": "Read identifiers extracted from the current attachment.",
}


def strict_schema(model: type[BaseModel]) -> dict[str, Any]:
    schema = model.model_json_schema()

    def visit(node: Any) -> None:
        if isinstance(node, dict):
            node.pop("default", None)
            if node.get("type") == "object":
                node["additionalProperties"] = False
                node["required"] = list(node.get("properties", {}))
            for value in node.values():
                visit(value)
        elif isinstance(node, list):
            for value in node:
                visit(value)

    visit(schema)
    return schema


def function_tools() -> list[dict[str, Any]]:
    return [
        {
            "type": "function",
            "name": name,
            "description": DESCRIPTIONS[name],
            "parameters": strict_schema(model),
            "strict": True,
        }
        for name, model in TOOL_MODELS.items()
    ]
