from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, update
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.care_plan import CarePlan, CareProduct, TimeSlotCare
from app.schemas.care_plan import CarePlanCreate, CarePlanRead, CareProductCreate, CareProductRead

router = APIRouter(prefix="/care-plans", tags=["care-plans"])


@router.get("/active", response_model=CarePlanRead | None)
async def get_active_plan(db: AsyncSession = Depends(get_db)):
    """현재 활성 케어 플랜 (루틴 화면에서 로드)"""
    result = await db.execute(
        select(CarePlan)
        .options(selectinload(CarePlan.products))
        .where(CarePlan.is_active == True)
        .order_by(CarePlan.created_at.desc())
        .limit(1)
    )
    plan = result.scalar_one_or_none()
    if not plan:
        return None
    return _to_read(plan)


@router.get("/", response_model=list[CarePlanRead])
async def list_plans(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(CarePlan)
        .options(selectinload(CarePlan.products))
        .order_by(CarePlan.created_at.desc())
    )
    return [_to_read(p) for p in result.scalars().all()]


@router.post("/", response_model=CarePlanRead, status_code=201)
async def create_plan(body: CarePlanCreate, db: AsyncSession = Depends(get_db)):
    """케어 플랜 등록 — 기존 활성 플랜은 비활성화"""
    # 기존 활성 플랜 비활성화
    await db.execute(
        update(CarePlan)
        .where(CarePlan.is_active == True)
        .values(is_active=False, updated_at=datetime.utcnow())
    )
    now = datetime.utcnow()
    plan = CarePlan(
        session_number=body.session_number,
        period_start=body.period_start,
        period_end=body.period_end,
        profile_image_url=body.profile_image_url,
        morning_description=body.morning_description,
        nightly_description=body.nightly_description,
        curator_tip=body.curator_tip,
        created_at=now,
        updated_at=now,
    )
    db.add(plan)
    await db.flush()  # plan.id 확보

    for p in body.products:
        db.add(CareProduct(
            care_plan_id=plan.id,
            time_slot=p.time_slot,
            name=p.name,
            brand=p.brand,
            category=p.category,
            image_url=p.image_url,
            order_index=p.order_index,
            created_at=now,
        ))

    await db.commit()
    await db.refresh(plan)
    # products 재로드
    result = await db.execute(
        select(CarePlan)
        .options(selectinload(CarePlan.products))
        .where(CarePlan.id == plan.id)
    )
    plan = result.scalar_one()
    return _to_read(plan)


@router.patch("/{plan_id}/products", response_model=CarePlanRead)
async def update_products(
    plan_id: int,
    products: list[CareProductCreate],
    db: AsyncSession = Depends(get_db),
):
    """제품 목록 전체 교체 (순서 포함)"""
    plan = await _get_or_404(db, plan_id)
    # 기존 제품 삭제 후 재삽입
    existing = await db.execute(
        select(CareProduct).where(CareProduct.care_plan_id == plan_id)
    )
    for p in existing.scalars().all():
        await db.delete(p)
    now = datetime.utcnow()
    for p in products:
        db.add(CareProduct(care_plan_id=plan_id, created_at=now, **p.model_dump()))
    await db.execute(
        update(CarePlan)
        .where(CarePlan.id == plan_id)
        .values(updated_at=now)
    )
    await db.commit()
    result = await db.execute(
        select(CarePlan)
        .options(selectinload(CarePlan.products))
        .where(CarePlan.id == plan_id)
    )
    return _to_read(result.scalar_one())


async def _get_or_404(db: AsyncSession, plan_id: int) -> CarePlan:
    result = await db.execute(select(CarePlan).where(CarePlan.id == plan_id))
    plan = result.scalar_one_or_none()
    if not plan:
        raise HTTPException(404, "CarePlan not found")
    return plan


def _to_read(plan: CarePlan) -> CarePlanRead:
    return CarePlanRead(
        id=plan.id,
        session_number=plan.session_number,
        period_start=plan.period_start,
        period_end=plan.period_end,
        profile_image_url=plan.profile_image_url,
        morning_description=plan.morning_description,
        nightly_description=plan.nightly_description,
        curator_tip=plan.curator_tip,
        is_active=plan.is_active,
        current_day=plan.current_day,
        total_days=plan.total_days,
        progress_pct=plan.progress_pct,
        products=[
            CareProductRead.model_validate(p) for p in
            sorted(plan.products, key=lambda x: (x.time_slot, x.order_index))
        ],
        created_at=plan.created_at,
        updated_at=plan.updated_at,
    )
