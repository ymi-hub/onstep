# OnStep — Claude 컨텍스트

## 프로젝트 개요

**Zero Setting: Life 관리는 리스트에서 즉시. 복잡한 설정은 NO.**

고민의 시간을 삭제하고 내일의 나를 자산화하는 Life OS 앱.

## 현재 구현 형태

**Firebase Hosting + Firestore 기반 HTML/JS 프로토타입** (4개 페이지 + 공유 유틸)

- `design/today.html` — Today: 루틴 체크, 메이크업/룩 일정
- `design/log.html`   — Log: Muse 라이브러리, 씬 필터, 룩 로그
- `design/box.html`   — Box: 뷰티박스 자산 관리, 보관장소
- `design/setup.html` — Setup: 루틴 세션 편집, 테마/스케줄 설정, 트래커
- `design/shared.js`  — 공통 유틸: 네비게이션, 이미지압축, Auth, CMS, BroadcastChannel
- `design/manifest.json` — PWA 매니페스트 (홈 화면 추가, 아이콘: logo.png)

배포: Firebase Hosting → <https://onstep-lifeos-v2-adee2.web.app>  
배포 명령: `firebase deploy --only hosting --project onstep-lifeos-v2`

## 기술 스택

- **호스팅**: Firebase Hosting (no-cache 헤더)
- **DB/Auth**: Firebase Firestore + Google Auth
- **프론트**: Vanilla HTML/CSS/JS (SPA 불필요)
- **PWA**: manifest.json + apple-touch-icon (logo.png)

## Firestore 데이터 스키마

### 데이터 원칙

- **Firestore = 원본** (모든 지속 데이터는 Firestore에 저장)
- **localStorage = 캐시** (오프라인 대응 + 속도 목적)
- 로그인 시 Firestore에서 로드 → localStorage 덮어쓰기
- 저장 시 localStorage 먼저 → Firestore 비동기 동기화

### 컬렉션 구조

```
users/{uid}/
  careplan/data          → 루틴 세션 (케어플랜 전체)
  extra/data             → 테마·뮤즈·룩로그·포트폴리오·씬태그
  box/data               → 뷰티박스 자산·보관장소·커스텀카테고리
  settings/data          → 루틴 트래커 항목

config/
  content                → CMS 텍스트 콘텐츠 (data-cms-key 요소)
```

### 상세 스키마

**`users/{uid}/careplan/data`**

```js
{
  session: 12,                    // 현재 세션 회차
  periodStart: '2026-04-10',      // 세션 시작일
  periodEnd:   '2026-04-20',      // 세션 종료일
  morningTime: '07:30',
  nightlyTime: '22:00',
  morning: {
    routines: [{ id, products: [{ id, name, brand, catKey, icon, imgData }], tip }]
  },
  nightly: { routines: [...] },
  history: [                      // 이전 세션 아카이브
    { session, periodStart, periodEnd, morning, nightly, published }
  ],
  published: false,
  savedAt: '2026-05-12T...',
  exercise: {}                    // 레거시 필드 (무시)
}
```

**`users/{uid}/extra/data`**

```js
{
  museItems:   [...],             // Muse 라이브러리 아이템
  careThemes:  [...],             // 집중케어 테마
  makeupThemes:{ themes: [...] }, // 메이크업 테마 + scheduledDates
  lookThemes:  [...],             // 룩 테마
  looks:       [...],             // 룩 로그 (mainPhoto 제외 저장)
  portfolio:   [...],             // 계획 포트폴리오
  logScenes:   [...],             // TPO 씬 태그 배열
  savedAt:     '...'
}
```

**`users/{uid}/box/data`**

```js
{
  assets:    [...],               // 뷰티박스 제품 목록
  locations: [...],               // 보관장소 목록
  boxCats: {                      // 커스텀 카테고리 구조
    beauty:  { skincare:[...], makeup:[...] },
    fashion: [...],
    acc:     [...]
  },
  savedAt: '...'
}
```

**`users/{uid}/settings/data`**

```js
{
  trackerItems: [{ id, name, time, alarm }],
  savedAt: '...'
}
```

**`config/content`**

```js
{
  setup_quote:      '...인용구 텍스트...',
  setup_quote_attr: 'THE CURATOR\'S NOTE V.2.4',
  // 추가 키: HTML에서 data-cms-key="키이름" 으로 연결
}
```

## localStorage 키 목록

| 키 | 내용 | Firestore 원본 경로 |
| --- | --- | --- |
| `onstep_care_plan` | 케어플랜 | `careplan/data` |
| `onstep_care_themes` | 케어 테마 | `extra/data.careThemes` |
| `onstep_makeup_themes` | 메이크업 테마 | `extra/data.makeupThemes` |
| `onstep_look_themes` | 룩 테마 | `extra/data.lookThemes` |
| `onstep_looks` | 룩 로그 | `extra/data.looks` |
| `onstep_muse_items` | 뮤즈 아이템 | `extra/data.museItems` |
| `onstep_planned_portfolio` | 포트폴리오 | `extra/data.portfolio` |
| `onstep_log_scenes` | 씬 태그 | `extra/data.logScenes` |
| `onstep_box_assets` | 박스 제품 | `box/data.assets` |
| `onstep_box_locations` | 보관장소 | `box/data.locations` |
| `onstep_box_cats` | 커스텀 카테고리 | `box/data.boxCats` |
| `onstep_tracker_items` | 루틴 트래커 | `settings/data.trackerItems` |

## 개발 규칙

1. **배포**: 파일 수정 후 반드시 `firebase deploy --only hosting --project onstep-lifeos-v2`
2. **JS 신택스 체크**: 배포 전 `node -e "new Function(scriptBlock)"` 검증
3. **새 지속 데이터 추가 시**: localStorage 저장 + Firestore 동기화 함수 함께 구현
4. **CMS 텍스트**: 앱 내 편집이 필요한 텍스트는 `data-cms-key="키"` 속성 부여
5. **크로스탭 동기화**: 설정 변경 후 `_broadcastState('키')` 호출

## 핵심 설계 원칙

1. **딱 하나의 선택지** — Flow Guide는 현재 시간대에 맞는 단 1개 행동만 제시
2. **자산 ROI** — 사용 횟수 추적, 잔여량 계산
3. **세션 아카이브** — 케어플랜 세션은 history 배열에 순차 누적
4. **실시간 동기화** — Firestore onSnapshot + BroadcastChannel 양방향
