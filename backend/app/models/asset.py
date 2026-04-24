import enum
from datetime import datetime, date
from sqlalchemy import String, Float, Integer, Boolean, Date, DateTime, Enum, JSON, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class AssetCategory(str, enum.Enum):
    clothing = "clothing"
    cosmetic = "cosmetic"
    accessory = "accessory"


class Asset(Base):
    __tablename__ = "assets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    category: Mapped[AssetCategory] = mapped_column(Enum(AssetCategory), nullable=False)
    brand: Mapped[str | None] = mapped_column(String(100))
    color: Mapped[str | None] = mapped_column(String(50))
    season: Mapped[str | None] = mapped_column(String(20))  # spring/summer/fall/winter/all
    purchase_price: Mapped[float] = mapped_column(Float, default=0.0)
    purchase_date: Mapped[date | None] = mapped_column(Date)
    usage_count: Mapped[int] = mapped_column(Integer, default=0)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime)
    image_url: Mapped[str | None] = mapped_column(String(500))
    tags: Mapped[list | None] = mapped_column(JSON)  # ["캐주얼", "출근룩", ...]
    notes: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    @property
    def cost_per_use(self) -> float:
        if self.usage_count == 0:
            return round(self.purchase_price, 0)
        return round(self.purchase_price / self.usage_count, 0)

    @property
    def roi_value(self) -> float:
        """사용 횟수가 많을수록 ROI↑ (구매가 대비 절약 효과)"""
        if self.purchase_price == 0:
            return 0.0
        return round((self.usage_count * self.cost_per_use) / self.purchase_price * 100, 1)
