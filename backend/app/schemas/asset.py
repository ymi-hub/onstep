from datetime import date, datetime
from pydantic import BaseModel
from app.models.asset import AssetCategory


class AssetBase(BaseModel):
    name: str
    category: AssetCategory
    brand: str | None = None
    color: str | None = None
    season: str | None = None
    purchase_price: float = 0.0
    purchase_date: date | None = None
    image_url: str | None = None
    tags: list[str] | None = None
    notes: str | None = None


class AssetCreate(AssetBase):
    pass


class AssetPatch(BaseModel):
    """인라인 편집용 — 보낸 필드만 업데이트"""
    name: str | None = None
    brand: str | None = None
    color: str | None = None
    season: str | None = None
    purchase_price: float | None = None
    purchase_date: date | None = None
    image_url: str | None = None
    tags: list[str] | None = None
    notes: str | None = None
    is_active: bool | None = None


class AssetRead(AssetBase):
    id: int
    usage_count: int
    last_used_at: datetime | None
    is_active: bool
    cost_per_use: float
    roi_value: float
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
