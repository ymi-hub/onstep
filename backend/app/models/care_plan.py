import enum
from datetime import datetime, date
from sqlalchemy import String, Integer, Boolean, Date, DateTime, Text, ForeignKey, Enum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class TimeSlotCare(str, enum.Enum):
    morning = "morning"
    nightly = "nightly"


class CarePlan(Base):
    __tablename__ = "care_plans"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_number: Mapped[int] = mapped_column(Integer, nullable=False)
    period_start: Mapped[date | None] = mapped_column(Date)
    period_end: Mapped[date | None] = mapped_column(Date)
    profile_image_url: Mapped[str | None] = mapped_column(String(500))
    morning_description: Mapped[str | None] = mapped_column(Text)
    nightly_description: Mapped[str | None] = mapped_column(Text)
    curator_tip: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    products: Mapped[list["CareProduct"]] = relationship(
        "CareProduct", back_populates="care_plan", cascade="all, delete-orphan"
    )

    @property
    def current_day(self) -> int:
        if not self.period_start:
            return 1
        delta = (date.today() - self.period_start).days + 1
        return max(1, delta)

    @property
    def total_days(self) -> int:
        if not self.period_start or not self.period_end:
            return 10
        return (self.period_end - self.period_start).days + 1

    @property
    def progress_pct(self) -> int:
        total = self.total_days
        if total == 0:
            return 0
        return min(100, round(self.current_day / total * 100))


class CareProduct(Base):
    __tablename__ = "care_products"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    care_plan_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("care_plans.id", ondelete="CASCADE"), index=True
    )
    time_slot: Mapped[TimeSlotCare] = mapped_column(
        Enum(TimeSlotCare), nullable=False
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    brand: Mapped[str | None] = mapped_column(String(100))
    category: Mapped[str | None] = mapped_column(String(50))  # cleanser/toner/serum/cream/sunscreen
    image_url: Mapped[str | None] = mapped_column(String(500))
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    care_plan: Mapped["CarePlan"] = relationship("CarePlan", back_populates="products")
