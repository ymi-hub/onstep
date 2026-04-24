from pydantic import BaseModel
from enum import Enum


class TimePhase(str, Enum):
    AM = "AM"        # 06:00–11:59  황금 모닝 루틴
    PM = "PM"        # 12:00–17:59  집중·행동 시간
    EVENING = "EVENING"  # 18:00–21:59  내일 준비 + 회복
    NIGHT = "NIGHT"  # 22:00–05:59  수면 모드


class WeatherInfo(BaseModel):
    temp: float
    feels_like: float
    condition: str  # "Clear", "Clouds", "Rain", ...
    humidity: int
    city: str = "Seoul"


class FlowGuideCard(BaseModel):
    phase: TimePhase
    greeting: str
    one_action: str          # 딱 하나의 행동 지시
    action_reason: str       # 왜 지금 이걸 해야 하는지
    duration_minutes: int
    routine_id: int | None
    outfit_ready: bool       # 내일 옷이 준비됐는지


class FlowGuideResponse(BaseModel):
    phase: TimePhase
    phase_label: str         # "GOOD MORNING", "FOCUS TIME", etc.
    weather: WeatherInfo | None
    card: FlowGuideCard
    forced_routine: str | None  # 저녁엔 항상 "내일 옷 고르기"
    tomorrow_outfit_set: bool
