from datetime import date, datetime
from pydantic import BaseModel
from app.models.care_plan import TimeSlotCare


class CareProductCreate(BaseModel):
    time_slot: TimeSlotCare
    name: str
    brand: str | None = None
    category: str | None = None
    image_url: str | None = None
    order_index: int = 0


class CareProductRead(CareProductCreate):
    id: int
    care_plan_id: int
    created_at: datetime
    model_config = {"from_attributes": True}


class CarePlanCreate(BaseModel):
    session_number: int
    period_start: date | None = None
    period_end: date | None = None
    profile_image_url: str | None = None
    morning_description: str | None = None
    nightly_description: str | None = None
    curator_tip: str | None = None
    products: list[CareProductCreate] = []


class CarePlanRead(BaseModel):
    id: int
    session_number: int
    period_start: date | None
    period_end: date | None
    profile_image_url: str | None
    morning_description: str | None
    nightly_description: str | None
    curator_tip: str | None
    is_active: bool
    current_day: int
    total_days: int
    progress_pct: int
    products: list[CareProductRead]
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}
