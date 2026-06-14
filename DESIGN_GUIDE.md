# OnStep Design Guide v2
> 참조: Habit Manager 앱 스크린샷 5장 분석 기반 (2026-06-14)
> 방향: 감성 · 심플 · 편안함 — iOS 네이티브 라이트 테마

---

## 1. 색상 시스템 (Color System)

### 기본 배경
| 역할 | 값 | 비고 |
|------|-----|------|
| 페이지 배경 | `#F2F2F7` | iOS 시스템 그레이, 부드럽고 눈 편함 |
| 카드 배경 | `#FFFFFF` | 순백 |
| 섹션 구분선 | `#E5E5EA` | 매우 연한 |
| 모달/팝업 배경 | `#FFFFFF` | 흰 카드 |

### 브랜드 컬러 (단일 액센트)
| 역할 | 값 | 비고 |
|------|-----|------|
| Primary | `#E85D6B` | 코랄 핑크 — 버튼, 활성 필터, 강조 |
| Primary Light | `rgba(232,93,107,.12)` | 배경 tint용 |
| Primary Tint | `#FFDCE8` | 그라데이션 배경 상단 등 |

### 카테고리 컬러 (Habits · Meds · Health)
| 카테고리 | 색 이름 | 기본값 | 미완료 배경 | 완료 배경 |
|---------|--------|--------|-----------|---------|
| Habits  | 피치 오렌지 | `#F2A05E` | `rgba(242,160,94,.18)` | `rgba(242,160,94,.35)` |
| Meds    | 스카이 블루 | `#6BABDA` | `rgba(107,171,218,.18)` | `rgba(107,171,218,.35)` |
| Health  | 민트 그린 | `#5CB87E` | `rgba(92,184,126,.18)` | `rgba(92,184,126,.35)` |
| Skincare | 라벤더 | `#9B8EC4` | `rgba(155,142,196,.18)` | `rgba(155,142,196,.35)` |

> 참조 앱의 습관 바: 미완료 = 매우 연한 tint, 완료 = 더 진한 tint + 체크마크 + 취소선

### 텍스트
| 역할 | 값 |
|------|-----|
| Primary | `#1C1C1E` |
| Secondary | `#8E8E93` |
| Tertiary / Placeholder | `#C7C7CC` |
| 파스텔 배경 위 (다크) | `#2D2020` (Habits), `#0E1E2D` (Meds), `#0D2018` (Health) |
| 완료 텍스트 | `#B0ABA5` + `text-decoration: line-through` |

---

## 2. 타이포그래피 (Typography)

| 용도 | 폰트 | 크기 | 굵기 |
|------|------|------|------|
| 페이지 타이틀 | Plus Jakarta Sans | 40px | 900 |
| 섹션 헤더 (`#Daily`) | Plus Jakarta Sans | 15px | 700 |
| 행 타이틀 | Plus Jakarta Sans | 14–15px | 700 |
| 서브텍스트 / 설명 | Plus Jakarta Sans | 13px | 400–500 |
| 뱃지 / 레이블 | Plus Jakarta Sans | 11px | 700, letter-spacing .08em |
| 감성 포인트 (팁, 인용) | NelnaLizzyChae (필기체) | 16–20px | 400 |
| 브랜드 로고 | Cormorant Garamond | — | 700, letter-spacing 8px |

> 참조 앱: 카드 타이틀은 굵고 검정 / 설명은 연한 회색 / 크기 차이로 계층 표현

---

## 3. 컴포넌트 스타일 (Components)

### 카드 (Card)
```
background:    #FFFFFF
border-radius: 20px
box-shadow:    0 2px 10px rgba(0,0,0,.06)
padding:       20px
```

### 습관 행 (Habit / Daily Check Row)
```
/* 미완료 */
background:    rgba(CAT_COLOR, .18)
border-radius: 14px
padding:       11px 14px
color:         카테고리별 다크 텍스트

/* 완료 */
background:    rgba(CAT_COLOR, .35)
text-decoration: line-through
color:         #B0ABA5

/* 체크박스 */
width/height:  22px, border-radius 50%
미완료: border 2px solid CAT_COLOR, bg transparent
완료:   border 2px solid rgba(CAT,0.4), bg rgba(CAT,0.3)
체크 SVG: stroke CAT_COLOR
```

> 참조 이미지 3의 Habit Bar: 완료=연한 민트 전체 배경, 미완료=더 연한 tint

### 필터 칩 (Filter Chip)
```
/* 활성 */
background: #E85D6B  (또는 카테고리 색)
color:      #FFFFFF
border:     none
height:     32px, padding 0 14px, border-radius 9999px

/* 비활성 */
background: #FFFFFF
color:      #8E8E93
border:     1px solid #E5E5EA
```

### 섹션 헤더 (Section Header)
```
폰트:   Plus Jakarta Sans
크기:   13px, 700, letter-spacing .1em
색상:   #8E8E93
액션:   우측 카운트/링크 — 같은 폰트, #C7C7CC
구분선: 없음 (공백으로 계층 표현)
```

### 하단 네비게이션 (Bottom Nav)
```
background:  #FFFFFF
border-top:  1px solid #E5E5EA
아이콘 색상(비활성): #8E8E93
아이콘 색상(활성):   #E85D6B  (코랄 핑크)
활성 탭 배경: rgba(232,93,107,.1) 작은 pill
```

### CTA 버튼 (Primary Button)
```
background:    #E85D6B
color:         #FFFFFF
border-radius: 9999px (pill)
height:        48px
font:          15px, 700
```

### 빈 상태 일러스트 (Empty State)
```
/* 참조 이미지 4 - "No Habits" */
일러스트:  소프트 핑크 원 + 라인 아이콘 (#E85D6B 계열, opacity 50%)
텍스트:    16px bold + 13px gray subtitle
배경:      흰색 또는 #F2F2F7
```

---

## 4. 아이콘 스타일 (Icon Style)

참조 이미지 1 (Habit Idea Grid) 기반:

```
/* 아이콘 컨테이너 */
width/height:  48px
border-radius: 16px  (라운드 스퀘어)
background:    rgba(ICON_COLOR, .15)  (아이콘 색의 연한 tint)

/* 아이콘 자체 */
size: 28px
color: 해당 카테고리/기능 컬러 (아이콘마다 고유 색)
style: 라인 아이콘 (filled 아님)
```

> 참조 앱: 각 카드마다 다른 색의 아이콘 — 보라, 골드, 민트, 블루, 핑크, 오렌지 등
> 포인트: 아이콘 하나씩 개성 있는 파스텔 색 부여 → 시각적 다채로움

---

## 5. 레이아웃 패턴 (Layout Patterns)

### 페이지 구조
```
상단 헤더:  padding 20px, 좌측 타이틀 + 우측 액션
콘텐츠:    padding 0 20px, gap 12–16px
하단 네비: fixed, height 60px + safe-area
```

### 그라데이션 배경 (선택)
```
/* 프로필/홈 상단 — 참조 이미지 2 */
background: linear-gradient(to bottom, #FFDCE8 0%, #F2F2F7 40%)
```

### 2열 카드 그리드 (참조 이미지 1)
```
display: grid
grid-template-columns: 1fr 1fr
gap: 12px
padding: 0 20px
카드: background #fff, radius 20px, shadow 0 2px 8px rgba(0,0,0,.06)
내부: 아이콘 (상단 좌 or 중앙) + 굵은 타이틀 + 연한 설명
```

---

## 6. 인터랙션 패턴 (Interaction)

| 요소 | 동작 |
|------|------|
| 행 탭 (체크인) | background 색 변경 + 체크마크 + 취소선 (transition .2s) |
| 카드 hover | 없음 (모바일 중심) |
| 필터 칩 | 즉시 색 전환 (transition .15s) |
| 스크롤 | 부드러운 스크롤, 오버스크롤 bounce |

---

## 7. 현재 OnStep 적용 현황

| 페이지 | 적용 상태 |
|--------|---------|
| Today | ✅ v2 배경 + 파스텔 바 적용 (2026-06-14) |
| Log | ⬜ 미적용 |
| Box | ⬜ 미적용 |
| Setup | ⬜ 미적용 |
| 하단 네비 | ⬜ 브랜드 액센트 #C5FF00 → #E85D6B 전환 예정 |

---

## 8. 기존 OnStep과 달라지는 점 요약

| | 이전 | v2 |
|--|------|-----|
| 배경 | `#FAFAF8` 웜 크림 | `#F2F2F7` 라이트 그레이 |
| 브랜드 포인트 | `#C5FF00` 라임 | `#E85D6B` 코랄 핑크 |
| 습관 바 | 포화 원색 pill | 파스텔 tint + radius 14px |
| 완료 처리 | opacity 50% | tint 강도↑ + 취소선 |
| 카드 radius | 16–20px | 20px 통일 |
| 섹션 구분 | `#` 해시태그 라벨 | 유지 (브랜드 개성) |
| 다크 모드 | 없음 | 없음 (라이트 전용) |
