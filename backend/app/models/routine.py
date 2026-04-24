import enum
from datetime import datetime
from sqlalchemy import String, Integer, Boolean, DateTime, Enum, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class TimeSlot(str, enum.Enum):
    morning = "morning"      # 06:00–10:00
    midday = "midday"        # 10:00–14:00
    afternoon = "afternoon"  # 14:00–18:00
    evening = "evening"      # 18:00–22:00
    night = "night"          # 22:00–06:00


class RoutineCategory(str, enum.Enum):
    body = "body"          # 신체 자산 (림프 순환 등)
    style = "style"        # 스타일 자산
    mind = "mind"          # 마인드셋
    productivity = "productivity"


class Routine(Base):
    __tablename__ = "routines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    time_slot: Mapped[TimeSlot] = mapped_column(Enum(TimeSlot), nullable=False)
    duration_minutes: Mapped[int] = mapped_column(Integer, default=5)
    category: Mapped[RoutineCategory] = mapped_column(
        Enum(RoutineCategory), default=RoutineCategory.body
    )
    # 저녁 '내일 옷 고르기'처럼 스킵 불가 루틴
    is_forced: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    source_url: Mapped[str | None] = mapped_column(String(500))  # 블로그/인스타 링크
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
