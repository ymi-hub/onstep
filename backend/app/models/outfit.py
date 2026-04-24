from datetime import datetime, date
from sqlalchemy import Integer, Date, DateTime, JSON, Text, ForeignKey, Boolean
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class OutfitPlan(Base):
    """저녁에 미리 고른 내일 옷 조합"""

    __tablename__ = "outfit_plans"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    plan_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    asset_ids: Mapped[list] = mapped_column(JSON, default=list)  # [asset_id, ...]
    notes: Mapped[str | None] = mapped_column(Text)
    is_confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )
