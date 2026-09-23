from typing import Annotated

from fastapi import APIRouter, Depends, Path, Request

from app.core.security import require_api_key
from app.models.products import Product
from app.services.catalog import CatalogService

router = APIRouter(prefix="/products", tags=["catalog"], dependencies=[Depends(require_api_key)])


@router.get("/{product_id}", response_model=Product)
async def product_details(
    request: Request,
    product_id: Annotated[str, Path(min_length=1, max_length=200)],
) -> Product:
    service: CatalogService = request.app.state.catalog_service
    return await service.details(product_id, fresh=True)
