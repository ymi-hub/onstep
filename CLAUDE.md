# OnStep — Claude 컨텍스트

## 프로젝트 개요
**Zero Setting: Life 관리는 리스트에서 즉시. 복잡한 설정은 NO.**

고민의 시간을 삭제하고 내일의 나를 자산화하는 Life OS 앱.

## 기술 스택
- **백엔드**: FastAPI + SQLAlchemy (async) + Alembic + SQLite
- **프론트엔드**: Flutter (Dart)
- **언어**: Python 3.11+, Dart 3.3+

## 프로젝트 구조
```
onstep/
├── backend/
│   ├── app/
│   │   ├── main.py            # FastAPI 앱 진입점
│   │   ├── database.py        # DB 연결 + Settings
│   │   ├── models/            # SQLAlchemy 모델
│   │   │   ├── asset.py       # 옷장/화장대 아이템 (ROI 계산 포함)
│   │   │   ├── routine.py     # 루틴 (is_forced=True = 스킵 불가)
│   │   │   └── outfit.py      # 내일 옷 플랜
│   │   ├── routers/
│   │   │   ├── flow_guide.py  # AM/PM/EVENING/NIGHT 엔진
│   │   │   └── assets.py      # 자산 CRUD + 인라인 PATCH
│   │   └── schemas/           # Pydantic 스키마
│   ├── alembic/               # DB 마이그레이션
│   └── requirements.txt
├── frontend/
│   └── lib/
│       ├── main.py            # 앱 진입점 + 1분 주기 테마 전환
│       ├── theme/app_theme.dart  # AM/PM/EVENING/NIGHT 4단계 테마
│       ├── screens/
│       │   ├── home_screen.dart   # Flow Guide 홈
│       │   └── assets_screen.dart # 자산 목록 + 인라인 편집
│       ├── models/            # Dart 데이터 모델
│       └── services/api_service.dart  # Dio HTTP 클라이언트
└── design/
    ├── screens.html           # 인터랙티브 프로토타입 (브라우저로 열기)
    └── stitch-prompts.md      # Google Stitch용 프롬프트
```

## 핵심 설계 원칙
1. **딱 하나의 선택지** — Flow Guide는 현재 시간대에 맞는 단 1개 행동만 제시
2. **저녁 강제 루틴** — 내일 옷 미준비 시 EVENING에 배너 강제 노출 (스킵 불가)
3. **자산 ROI** — `cost_per_use = purchase_price / usage_count`, ROI는 property로 자동 계산
4. **인라인 편집** — Assets PATCH는 변경된 필드만 전송 (`exclude_unset=True`)
5. **시간대 테마** — AM(크림/오렌지) → PM(하늘/블루) → EVENING(네이비/로즈) → NIGHT(미드나잇/라벤더)

## 개발 환경 세팅
```bash
# Mac 초기 세팅 (한 번만)
chmod +x setup.sh && ./setup.sh

# 이후 실행
make dev-backend   # 백엔드: http://localhost:8000
make dev-flutter   # Flutter 앱

# DB 마이그레이션
make migrate
```

## API 엔드포인트
| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/flow-guide/` | 현재 시간대 행동 추천 (날씨 포함) |
| GET | `/assets/` | 자산 목록 (카테고리/시즌 필터) |
| POST | `/assets/` | 자산 추가 |
| PATCH | `/assets/{id}` | 인라인 편집 |
| POST | `/assets/{id}/use` | 착용 기록 (+1) |
| DELETE | `/assets/{id}` | 비활성화 (ROI 기록 보존) |

## 환경변수 (backend/.env)
```
DATABASE_URL=sqlite+aiosqlite:///./onstep.db
OPENWEATHER_API_KEY=    # 날씨 연동 시 필요
SECRET_KEY=onstep-dev-secret
```
