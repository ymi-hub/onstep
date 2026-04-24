from datetime import datetime, date, timedelta
from zoneinfo import ZoneInfo

import httpx
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db, settings
from app.models.routine import Routine, TimeSlot
from app.models.outfit import OutfitPlan
from app.schemas.flow_guide import (
    FlowGuideCard,
    FlowGuideResponse,
    TimePhase,
    WeatherInfo,
)

router = APIRouter(prefix="/flow-guide", tags=["flow-guide"])

KST = ZoneInfo("Asia/Seoul")


def get_time_phase(hour: int) -> TimePhase:
    if 6 <= hour < 12:
        return TimePhase.AM
    elif 12 <= hour < 18:
        return TimePhase.PM
    elif 18 <= hour < 22:
        return TimePhase.EVENING
    else:
        return TimePhase.NIGHT


def phase_to_time_slot(phase: TimePhase) -> TimeSlot:
    mapping = {
        TimePhase.AM: TimeSlot.morning,
        TimePhase.PM: TimeSlot.midday,
        TimePhase.EVENING: TimeSlot.evening,
        TimePhase.NIGHT: TimeSlot.night,
    }
    return mapping[phase]


PHASE_META = {
    TimePhase.AM: {
        "label": "GOOD MORNING",
        "default_action": "오늘의 첫 번째 루틴을 시작하세요",
        "default_reason": "아침 루틴이 하루 전체 에너지를 결정합니다",
        "default_duration": 5,
    },
    TimePhase.PM: {
        "label": "FOCUS TIME",
        "default_action": "지금 가장 중요한 한 가지에 집중하세요",
        "default_reason": "오후의 집중력이 하루 성과를 완성합니다",
        "default_duration": 25,
    },
    TimePhase.EVENING: {
        "label": "EVENING RESET",
        "default_action": "내일 입을 옷을 지금 고르세요",
        "default_reason": "3분 투자로 내일 아침 30분을 버세요",
        "default_duration": 3,
    },
    TimePhase.NIGHT: {
        "label": "SLEEP MODE",
        "default_action": "화면을 끄고 수면 준비를 시작하세요",
        "default_reason": "수면이 내일의 자산을 충전합니다",
        "default_duration": 10,
    },
}


async def fetch_weather(city: str = "Seoul") -> WeatherInfo | None:
    if not settings.openweather_api_key:
        return None
    url = (
        f"https://api.openweathermap.org/data/2.5/weather"
        f"?q={city}&appid={settings.openweather_api_key}&units=metric&lang=kr"
    )
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            r = await client.get(url)
            if r.status_code == 200:
                d = r.json()
                return WeatherInfo(
                    temp=d["main"]["temp"],
                    feels_like=d["main"]["feels_like"],
                    condition=d["weather"][0]["main"],
                    humidity=d["main"]["humidity"],
                    city=city,
                )
    except Exception:
        pass
    return None


@router.get("/", response_model=FlowGuideResponse)
async def get_flow_guide(
    city: str = Query("Seoul"),
    db: AsyncSession = Depends(get_db),
):
    now = datetime.now(KST)
    hour = now.hour
    phase = get_time_phase(hour)
    meta = PHASE_META[phase]

    weather = await fetch_weather(city)

    # 현재 시간대에 맞는 루틴 조회
    slot = phase_to_time_slot(phase)
    result = await db.execute(
        select(Routine)
        .where(Routine.time_slot == slot, Routine.is_active == True)
        .order_by(Routine.is_forced.desc(), Routine.id)
        .limit(1)
    )
    routine = result.scalar_one_or_none()

    # 내일 옷 준비 여부
    tomorrow = (now + timedelta(days=1)).date()
    outfit_result = await db.execute(
        select(OutfitPlan).where(
            OutfitPlan.plan_date == tomorrow, OutfitPlan.is_confirmed == True
        )
    )
    tomorrow_outfit = outfit_result.scalar_one_or_none()
    outfit_ready = tomorrow_outfit is not None

    if routine:
        action = routine.title
        reason = routine.description or meta["default_reason"]
        duration = routine.duration_minutes
        routine_id = routine.id
    else:
        action = meta["default_action"]
        reason = meta["default_reason"]
        duration = meta["default_duration"]
        routine_id = None

    # 저녁엔 내일 옷이 미준비면 강제 노출
    forced = None
    if phase == TimePhase.EVENING and not outfit_ready:
        forced = "내일 옷이 아직 준비되지 않았어요. 지금 3분으로 내일 아침을 구하세요 →"

    card = FlowGuideCard(
        phase=phase,
        greeting=_build_greeting(now, weather),
        one_action=action,
        action_reason=reason,
        duration_minutes=duration,
        routine_id=routine_id,
        outfit_ready=outfit_ready,
    )

    return FlowGuideResponse(
        phase=phase,
        phase_label=meta["label"],
        weather=weather,
        card=card,
        forced_routine=forced,
        tomorrow_outfit_set=outfit_ready,
    )


def _build_greeting(now: datetime, weather: WeatherInfo | None) -> str:
    hour = now.hour
    if 6 <= hour < 12:
        base = "좋은 아침이에요"
    elif 12 <= hour < 18:
        base = "오후도 온스텝으로"
    elif 18 <= hour < 22:
        base = "오늘 하루 수고했어요"
    else:
        base = "편안한 밤 되세요"

    if weather:
        return f"{base} · {weather.temp:.0f}°C {weather.condition}"
    return base
