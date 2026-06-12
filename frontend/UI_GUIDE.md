# OnStep 공통 UI 가이드

> **목적**: 공통 UI 패턴을 정의하고 이름을 붙여두어,
> 나중에 "편집 버튼 CSS 일괄 적용" 같은 작업을 한 번에 할 수 있게 한다.

---

## 목차

1. [공통 UI 컴포넌트 정의](#1-공통-ui-컴포넌트-정의)
   - 편집 버튼 (EditButton)
   - 저장 버튼 (SaveButton) — *정의 예정*
   - 취소 버튼 (CancelButton) — *정의 예정*
   - 삭제 버튼 (DeleteButton) — *정의 예정*
2. [일괄 적용 방법](#2-일괄-적용-방법)
3. [변경 이력](#3-변경-이력)

---

## 1. 공통 UI 컴포넌트 정의

---

### 편집 버튼 (EditButton)

**언제 쓰나**: 시트·폼 안에서 카테고리, 태그, 도메인 등 "관리 모드"로 진입할 때 사용하는 소형 pill 버튼.

**확정된 스타일** (2026-06-12 일괄 적용 완료):

```
background : #0C0C0A
color      : #C5FF00
border     : none
borderRadius: 9999  (pill 형태)
padding    : 0 10px  (또는 5px 12px — 콘텍스트에 따라)
height     : 24px   (인라인 pill) / padding으로 대체 가능
fontSize   : 10px
fontWeight : 800
letterSpacing: .04em ~ .08em
cursor     : pointer
```

**적용된 위치 목록** (이 목록을 보고 일괄 검색·수정 가능):

| 파일 | 줄(참고) | 버튼 텍스트 | 비고 |
|---|---|---|---|
| `app/page.tsx` | ~2009 | 카테고리 편집 | OOTD 기록 시트 |
| `app/page.tsx` | ~2058 | 태그 편집 / 닫기 | OOTD 기록 시트 #태그 토글 |
| `app/log/page.tsx` | ~5356 | 태그 편집 / 닫기 | OOTD 라이브러리 편집 시트 #태그 토글 |
| `app/setup/page.tsx` | ~708 | 루틴 편집 | 스킨케어 세션 드롭다운 |
| `app/setup/page.tsx` | ~3295 | 카테고리 ▲/▼ | HEALTH 카테고리 토글 |
| `app/setup/page.tsx` | ~4719 | 편집 | 케어 아이템 카드 (이전: gray → 블랙+라임) |
| `app/setup/page.tsx` | ~4762 | 카테고리 편집 | Care탭 필터 카테고리 |
| `app/setup/page.tsx` | ~4918 | 카테고리 편집 | Care탭 집중케어 폼 |
| `app/box/page.tsx` | ~2011 | 도메인 편집 | BOX 하단 고정 버튼 (이전: gray → 블랙+라임) |

**일괄 변경 방법**:
```bash
# 편집 버튼 관련 코드를 모두 찾기
grep -rn "카테고리 편집\|태그 편집\|도메인 편집\|루틴 편집" frontend/app/
```

---

### 저장 버튼 (SaveButton) — 검토 중

> 현재 파일별로 스타일이 다름. 공통화 작업 예정.
> 아래 "저장/삭제/취소 버튼 현황 표" 참고.

---

### 취소 버튼 (CancelButton) — 검토 중

> 현재 파일별로 배경색이 #F4F4F0 / #EEEDE9 / #fff 혼재. 공통화 작업 예정.

---

### 삭제 버튼 (DeleteButton) — 검토 중

> 현재 두 가지 패턴 혼재:
> - 투명 배경 + 빨간 텍스트 (`color: #BA1A1A`)
> - 연한 빨간 배경 (`background: #FEE2E2 또는 rgba(186,26,26,.06)`)
> 공통화 작업 예정.

---

## 2. 일괄 적용 방법

### 편집 버튼 색상을 바꾸고 싶을 때

1. 이 파일의 "편집 버튼" 섹션에서 스타일을 수정한다.
2. Claude에게 요청: **"편집 버튼 CSS 일괄 적용"** — Claude는 위 "적용된 위치 목록"을 참고해 모든 파일을 한 번에 수정한다.

### 새 편집 버튼을 추가할 때

1. 위 스타일 그대로 적용한다.
2. "적용된 위치 목록"에 새 행을 추가한다.

---

## 3. 변경 이력

| 날짜 | 작업 | 파일 |
|---|---|---|
| 2026-06-12 | 편집 버튼 블랙+라임 pill 스타일 일괄 적용 (9곳) | page.tsx, log/page.tsx, setup/page.tsx, box/page.tsx |
