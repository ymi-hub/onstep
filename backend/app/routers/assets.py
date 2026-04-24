from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.asset import Asset, AssetCategory
from app.schemas.asset import AssetCreate, AssetPatch, AssetRead

router = APIRouter(prefix="/assets", tags=["assets"])


@router.get("/", response_model=list[AssetRead])
async def list_assets(
    category: AssetCategory | None = Query(None),
    season: str | None = Query(None),
    is_active: bool = Query(True),
    db: AsyncSession = Depends(get_db),
):
    q = select(Asset).where(Asset.is_active == is_active)
    if category:
        q = q.where(Asset.category == category)
    if season:
        q = q.where(Asset.season == season)
    q = q.order_by(Asset.usage_count.desc())
    result = await db.execute(q)
    assets = result.scalars().all()
    return [_to_read(a) for a in assets]


@router.post("/", response_model=AssetRead, status_code=201)
async def create_asset(body: AssetCreate, db: AsyncSession = Depends(get_db)):
    now = datetime.utcnow()
    asset = Asset(**body.model_dump(), created_at=now, updated_at=now)
    db.add(asset)
    await db.commit()
    await db.refresh(asset)
    return _to_read(asset)


@router.patch("/{asset_id}", response_model=AssetRead)
async def patch_asset(
    asset_id: int, body: AssetPatch, db: AsyncSession = Depends(get_db)
):
    """인라인 편집 — 변경된 필드만 PATCH"""
    asset = await _get_or_404(db, asset_id)
    updates = body.model_dump(exclude_unset=True)
    if not updates:
        return _to_read(asset)
    updates["updated_at"] = datetime.utcnow()
    await db.execute(update(Asset).where(Asset.id == asset_id).values(**updates))
    await db.commit()
    await db.refresh(asset)
    return _to_read(asset)


@router.post("/{asset_id}/use", response_model=AssetRead)
async def record_use(asset_id: int, db: AsyncSession = Depends(get_db)):
    """착용/사용 기록 → usage_count +1, ROI 자동 갱신"""
    asset = await _get_or_404(db, asset_id)
    now = datetime.utcnow()
    await db.execute(
        update(Asset)
        .where(Asset.id == asset_id)
        .values(
            usage_count=Asset.usage_count + 1,
            last_used_at=now,
            updated_at=now,
        )
    )
    await db.commit()
    await db.refresh(asset)
    return _to_read(asset)


@router.delete("/{asset_id}", status_code=204)
async def deactivate_asset(asset_id: int, db: AsyncSession = Depends(get_db)):
    """삭제 대신 비활성화 (ROI 기록 보존)"""
    await _get_or_404(db, asset_id)
    await db.execute(
        update(Asset)
        .where(Asset.id == asset_id)
        .values(is_active=False, updated_at=datetime.utcnow())
    )
    await db.commit()


async def _get_or_404(db: AsyncSession, asset_id: int) -> Asset:
    result = await db.execute(select(Asset).where(Asset.id == asset_id))
    asset = result.scalar_one_or_none()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    return asset


def _to_read(a: Asset) -> AssetRead:
    return AssetRead(
        id=a.id,
        name=a.name,
        category=a.category,
        brand=a.brand,
        color=a.color,
        season=a.season,
        purchase_price=a.purchase_price,
        purchase_date=a.purchase_date,
        usage_count=a.usage_count,
        last_used_at=a.last_used_at,
        image_url=a.image_url,
        tags=a.tags,
        notes=a.notes,
        is_active=a.is_active,
        cost_per_use=a.cost_per_use,
        roi_value=a.roi_value,
        created_at=a.created_at,
        updated_at=a.updated_at,
    )
