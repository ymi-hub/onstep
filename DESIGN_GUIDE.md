# OnStep Design Guide v3
> 레퍼런스: MindBridge (마음 밑줄 다이어리) + 좋은 커피 위대한 커피 (2026-06-14)
> 방향: 웜 샌드 베이지 배경 · 순백 카드 · 초콜릿 브라운 텍스트 — 포근하고 감성적인 라이프 다이어리 느낌

---

## 1. 색상 시스템 (Color System)

### 배경 계층

| 역할 | 값 | 설명 |
|------|-----|------|
| 페이지 배경 | `#F2EDE6` | 웜 샌드 베이지 — MindBridge 핵심 BG |
| 중첩 배경 (nested) | `#EDE4D8` | 카드 내부 빈 영역, 비활성 배지 |
| 쉘 배경 (body) | `#E2D9D0` | 앱 외부 테두리 — 더 깊은 모래색 |

### 카드

| 역할 | 값 | 설명 |
|------|-----|------|
| 카드 배경 | `#FFFFFF` | 순백 — 배경과 대비 |
| 카드 그림자 | `0 4px 16px rgba(78,56,47,.08)` | 웜 셰도우 (차가운 블랙 그림자 ✗) |
| 카드 테두리 | `1px solid rgba(78,56,47,.06)` | 매우 연한 웜 브라운 테두리 |

### 텍스트

| 역할 | 값 | 설명 |
|------|-----|------|
| Primary (헤드라인) | `#4E382F` | 초콜릿 브라운 — 차갑지 않은 다크 |
| Secondary (설명) | `#9B8B83` | 웜 그레이 |
| Tertiary / Placeholder | `#C9B9AE` | 연한 모래색 |
| 완료 텍스트 | `#B0ABA5` + `line-through` | 취소선 + 흐림 |

### 브랜드 / 카테고리 색

| 역할 | 값 | 설명 |
|------|-----|------|
| CTA 버튼 (Primary) | `#4E382F` | 다크 브라운 — MindBridge 스타일 |
| **포인트 컬러** | **`#E85D6B`** (`--color-point`) | **핑크 코랄 — 체크박스·완료 버튼·타임칩·카테고리 배지. `globals.css` 한 곳만 수정하면 전체 앱 일괄 적용** |
| 포인트 텍스트 | `#FFFFFF` (`--color-point-fg`) | 포인트 컬러 위 텍스트/아이콘 |
| Habits | `#F2A05E` | 피치 오렌지 |
| Meds | `#6BABDA` | 스카이 블루 |
| Health | `#5CB87E` | 민트 그린 |
| 커피 브라운 (중간 톤) | `#8B6F47` | WeatherWidget 아이콘 tint 등 |

---

## 2. 타이포그래피

| 용도 | 폰트 | 크기 | 굵기 | 색 |
|------|------|------|------|-----|
| 페이지 타이틀 | Plus Jakarta Sans | 40px | 700 | `#4E382F` |
| 섹션 헤더 (`#Daily`) | Plus Jakarta Sans | 18px | 800 | `#4E382F` |
| 섹션 서브 레이블 | Plus Jakarta Sans | 11px | 700, letter-spacing .14em | `#9B8B83` |
| 행 타이틀 | Plus Jakarta Sans | 14px | 600 | `#4E382F` |
| 시간 레이블 | Plus Jakarta Sans | 13px | 600 | `#4E382F` |
| 서브텍스트 / 설명 | Plus Jakarta Sans | 13px | 400–500 | `#9B8B83` |
| 비활성 / placeholder | Plus Jakarta Sans | 12px | 500 | `#C9B9AE` |
| 필터 칩 레이블 | Plus Jakarta Sans | 11px | 700, letter-spacing .08em | — |
| 감성 포인트 | NelnaLizzyChae (필기체) | 16–20px | 400 | `#9B8B83` |

---

## 3. 카드 디자인 패턴 (Card Patterns)

### 기본 카드 (Standard Card)
> FlowCard, SessionHero, RoutineEmptyCard, LoginRequiredCard 등

```
background:    #FFFFFF
border-radius: 20px
border:        1px solid rgba(78,56,47,.06)
box-shadow:    0 4px 16px rgba(78,56,47,.08)
padding:       16px–20px
margin:        0 20px

앱 컨테이너: maxWidth 390px (iPhone 15 기준)
```

### 중첩 내부 카드 (Inner Card)
> 카드 안에 또 카드가 들어가는 구조 (e.g. FlowCard 안의 제품 카드)

```
background:    #FFFFFF
border-radius: 16px
border:        1px solid rgba(78,56,47,.06)
box-shadow:    0 2px 8px rgba(78,56,47,.05)
padding:       16px
```

### 컬러 배지 카드 (Colored Badge Card)
> 스텝 번호, 카운트 배지 등

```
/* 활성 */
background:    #4E382F  (다크 브라운)
color:         #FFFFFF
border-radius: 50%
width/height:  36px

/* 비활성 */
background:    #EDE4D8  (웜 베이지)
color:         #C9B9AE
```

### 섹션 컬러 바 카드 (Color Bar Card)
> SectionHeader barColor 모드 — Reset Plan 등

```
background:    카테고리 색 (tint)
border-radius: 14px
padding:       13px 18px
margin:        16px 20px 8px
```

### 타이머 카드 (Timer Card)

> FlowCard(Skincare) + CareSection(Intensive Care) 내 대기 타이머 카드
> `className="care-step-card timer-card"` 적용

```
/* 기본 (비활성) */
background:    rgba(232,93,107,.04)   /* 연한 포인트 틴트 */
border:        1.5px solid var(--color-point)
border-radius: 16px
box-shadow:    0 4px 16px rgba(232,93,107,.06)
cursor:        pointer
transition:    all .2s ease-in-out

/* 활성 (타이머 실행 중) */
background:    rgba(232,93,107,.06)
border:        2px solid var(--color-point)
box-shadow:    0 6px 18px rgba(232,93,107,.18)

/* 호버 */
background:    var(--color-point)          /* 포인트 컬러 배경 */
border-color:  var(--color-point)
box-shadow:    0 10px 28px rgba(232,93,107,.4)

  └─ .timer-badge   → background: rgba(255,255,255,.22), color: #fff
  └─ .timer-main-text → color: #fff
  └─ .timer-mins    → color: rgba(255,255,255,.8)
  └─ svg circle     → stroke: rgba(255,255,255,.3)
  └─ svg polyline/path → stroke: rgba(255,255,255,.9)
  └─ .timer-stopwatch-btn → background: rgba(255,255,255,.8)
```

### 설명문구 칩 (Desc Chip)

> Skincare Flow + Intensive Care의 non-timer 설명 텍스트 칩

```
background:    var(--color-point)
color:         #FFFFFF
border-radius: 9999px
padding:       6px 14px
font-size:     12px
font-weight:   700
white-space:   nowrap
```

---

## 4. 바 / 행 디자인 패턴 (Bar / Row Patterns)

### 공통 구조
모든 체크 행은 동일한 레이아웃을 따른다:

```
[체크박스 22px] [아이콘/이모지 18px] [시간 42px] [타이틀 flex:1]
padding:       11px 14px
border-radius: 14px
gap:           10px
transition:    background .18s
```

### Habits 바 (피치 오렌지)

```
/* 미완료 */
background:    rgba(242,160,94,.18)
text-color:    #4E382F
border-radius: 14px

/* 완료 */
background:    rgba(242,160,94,.32)
text-color:    #B0ABA5  +  text-decoration: line-through

/* 체크박스 미완료 */
border:        2px solid #F2A05E
background:    transparent

/* 체크박스 완료 */
border:        2px solid rgba(242,160,94,.5)
background:    rgba(242,160,94,.4)
SVG stroke:    #F2A05E
```

### Meds 바 (스카이 블루)

```
/* 미완료 */
background:    rgba(107,171,218,.18)
text-color:    #4E382F

/* 완료 */
background:    rgba(107,171,218,.32)
text-color:    #B0ABA5  +  line-through

/* 체크박스 미완료 */
border:        2px solid #6BABDA
background:    transparent

/* 체크박스 완료 */
border:        2px solid rgba(107,171,218,.5)
background:    rgba(107,171,218,.4)
SVG stroke:    #6BABDA
```

### Health 바 (민트 그린) — 미구현, 추후 참고용

```
/* 미완료 */
background:    rgba(92,184,126,.18)
text-color:    #4E382F

/* 완료 */
background:    rgba(92,184,126,.32)
text-color:    #B0ABA5  +  line-through

/* 체크박스 */
border / fill: #5CB87E
```

---

## 5. 버튼 디자인 패턴 (Button Patterns)

### Primary CTA (다크 브라운 pill)
> "BOX 열기 →", "Google로 로그인", "저장" 등

```
background:    #4E382F
color:         #FFFFFF
border-radius: 9999px  (또는 12px for 사각형)
height:        44–48px
font:          13–14px, 700
```

### Secondary / Outline

```
background:    transparent
color:         #4E382F
border:        1px solid rgba(78,56,47,.20)
border-radius: 9999px
height:        40px
font:          13px, 600
```

### Tab 버튼 (언더라인 스타일)
> FlowCard Morning / Night 탭

```
/* 활성 */
border-bottom: 2px solid #4E382F
color:         #4E382F
font-weight:   700
background:    transparent

/* 비활성 */
border-bottom: 2px solid transparent
color:         #C7C7CC
font-weight:   500
```

### 텍스트 링크

```
color:         #C9B9AE
font-size:     12px, 600
letter-spacing: .04em
(e.g. "List →")
```

---

## 6. 네비게이션 (Navigation)

### 하단 탭 (BottomNav)

```
background:    #F2EDE6  (페이지 BG와 일체감)
border-top:    1px solid rgba(78,56,47,.08)

/* 활성 탭 */
background:    rgba(78,56,47,.08)  (작은 pill)
icon-color:    #4E382F
label-color:   #4E382F
border-radius: 20px 20px 0 0

/* 비활성 탭 */
background:    transparent
icon-color:    #9B8B83
label-color:   #9B8B83
```

### Session 진행 도트

```
/* 오늘 */
background:    #E85D6B
width:         22px (wider pill)

/* 완료일 */
background:    rgba(232,93,107,.35)

/* 미래일 */
background:    #E8E7E4
```

---

## 7. 컴포넌트별 현황

| 컴포넌트 | 상태 | 비고 |
|---------|------|------|
| PageHeader | ✅ 완료 | 웜 다크 타이틀 적용 |
| SectionHeader | ✅ 완료 | `#4E382F` 타이틀 |
| WeatherWidget | ✅ 완료 | 커피 브라운 tint 박스 |
| BottomNav | ✅ 완료 | 활성 탭 아이콘·레이블 `var(--color-point)`, 베이지 BG |
| SessionHero | ✅ 완료 | 흰 카드 + 코랄 도트 |
| FlowCard | ✅ 완료 | 언더라인 탭, 웜 셰도우 |
| Habits 바 | ✅ 완료 | 파스텔 피치 tint |
| Meds 바 | ✅ 완료 | 파스텔 스카이 tint |
| Health 바 | ⬜ 미구현 | 민트 그린 tint 예정 |
| CTA 버튼 | ✅ 완료 | `#4E382F` + `#FFFFFF` |
| OOTD 섹션 | ✅ 완료 | 웜 카드 그림자, 포인트 컬러 뱃지, 브라운 텍스트 |
| OOTD 기록 시트 | ✅ 완료 | 웜 베이지 시트 배경, 브라운 버튼 |
| Reset Plan | ✅ 완료 | 포인트 컬러 상태 배지 + 타임칩 + 체크박스 |
| CatBadge | ✅ 완료 | 어두운 색 자동 흰 얼굴, 라임 `#C5FF00` 통일 |
| Log 페이지 | ✅ 1차 적용 | 웜 팔레트 일괄 적용, 라이브러리 고유 컬러(라임·앰버·오렌지) 유지, 부분 수정 예정 |
| Box 페이지 | ✅ 1차 적용 | 웜 팔레트 일괄 적용, 부분 수정 예정 |
| Setup 페이지 | ✅ 1차 적용 | 웜 팔레트 일괄 적용, 부분 수정 예정 |

---

## 8. 이전 버전 대비 변경점

| 요소 | v1 (라임) | v2 (코랄) | v3 (웜 브라운, 현재) |
|------|-----------|-----------|---------------------|
| 배경 | `#FAFAF8` | `#FAF8F5` | `#F2EDE6` ← 웜 샌드 베이지 |
| CTA 버튼 | `#0C0C0A` + `#C5FF00` 라임 | `#0C0C0A` + `#C5FF00` | `#4E382F` + `#FFFFFF` |
| 타이틀 색 | `#0C0C0A` 차가운 검정 | `#1C1C1E` | `#4E382F` 초콜릿 브라운 |
| BottomNav 활성 | 다크 블랙 | 코랄 `#E85D6B` | 다크 브라운 `#4E382F` |
| 카드 그림자 | 차가운 `rgba(0,0,0,.)` | `rgba(0,0,0,.)` | 웜 `rgba(78,56,47,.)` |
| WeatherWidget | 라임 박스 | 코랄 tint | 커피 브라운 tint |
