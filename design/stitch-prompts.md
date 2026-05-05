# OnStep — Stitch 프롬프트 (Blanc Luxe Edition)
> **Design System: Blanc Luxe** — inspired by Chanel.com editorial language
> https://stitch.withgoogle.com/create 에 아래 프롬프트를 붙여넣으세요

---

## Design Language Reference

**Blanc Luxe tokens:**
- Colors: `#0A0A0A` noir, `#FFFFFF` blanc, `#FAF8F5` warm-white, `#F4F1ED` paper, `#C8BFB5` taupe, `#3A3730` ink-light
- Typography: Cormorant Garamond (italic display), Inter (700, 9px, ALL CAPS, letter-spacing .22em for labels)
- Borders: 1px solid #0A0A0A (all elements, NO rounded corners — border-radius: 0)
- Spacing: generous white space, 16–24px gutters
- No color accents — monochrome only (noir, blanc, taupe scales)
- Progress/status: 1px lines, not filled bars or pills

---

## Screen 1: TODAY

```
Mobile app screen for a luxury minimal skincare routine tracker called "OnStep".
Design language: Chanel.com editorial — stark white background #FAF8F5, zero border-radius on all elements, 1px solid #0A0A0A borders, Cormorant Garamond italic for headlines, Inter 700 9px ALL CAPS labels with letter-spacing 0.22em, no color accents, monochrome only.

App bar: white background with 1px bottom border. Left: thin hamburger. Center: "ONSTEP" in Inter 700 9px all-caps letter-spacing. Right: 40px square avatar with 1px border.

Below app bar, a faint giant watermark number "12" in Cormorant Garamond, 180px, opacity 4%, positioned behind content — this is the session number.

Tab row (1px bottom border, 2px solid #0A0A0A underline on active tab): "MORNING  |  NIGHT" in Inter 9px all-caps.

Hero section:
- Label row: "SESSION 12  ·  MORNING ROUTINE" in Inter 9px all-caps taupe color
- Large italic headline in Cormorant Garamond 28px: "7-Step Protocol"
- Progress: a single 1px horizontal line full width, with a thicker 1px overlay showing 57% completion
- Below progress: "4 / 7 완료" in Inter 9px

Product scroll (horizontal, no scrollbar visible):
- 3 product cards, each with 1px border, NO rounded corners:
  - Square image area (1:1 ratio), white background
  - Below image: "TONER" in Inter 9px all-caps taupe, then product name "자음수" in Inter 14px, brand "이니스프리" in Inter 9px taupe
  - Checkmark overlay on completed cards: a simple black check, no badge shape
- Cards are 100px wide with 8px gap

Expert tip zone: left-aligned, 2px solid #0A0A0A left border, "EXPERT NOTE" label above, italic quote text in Cormorant Garamond 15px

CTA button: full width, 1px solid #0A0A0A border, NO fill (outline only), text in Cormorant Garamond 18px italic "Complete Routine →"

Bottom navigation: 1px top border, 4 items. Labels: "TODAY  BOX  LOG  SETUP" in Inter 8px all-caps. Active item has 2px solid top border. Icons are minimal 1px stroke line icons.
```

---

## Screen 2: BOX

```
Mobile app product inventory screen for a luxury skincare/fashion tracker called "OnStep".
Design language identical to Screen 1: Blanc Luxe — #FAF8F5 background, 1px borders, zero radius, Cormorant Garamond italic headlines, Inter 700 9px all-caps labels, monochrome noir/blanc/taupe only.

App bar: "BOX" centered in Inter 9px all-caps. Right: square search icon 1px stroke.

Category filter row (horizontal scroll, no scrollbar):
- Text-only chips with 1px border: "ALL  TONER  SERUM  CREAM  SPF  AMPOULE"
- Active chip: filled #0A0A0A background with white text
- NO rounded corners on chips — they are rectangular

Product grid: 2 columns, 2px gap between all cards (very tight grid)
Each product card (1px border, no radius):
- Full bleed product image (1:1 ratio, white background)
- Below image area: small "SERUM" label in Inter 9px taupe, product name in Inter 13px medium weight
- Expiry indicator: a single 1px horizontal line at the very bottom edge of the card — full width = full stock, shorter = lower stock. No text, no percentage.

Floating action button: square (not circle), 1px border, "+" centered in Inter 24px. Positioned bottom-right 16px from edges.

Bottom nav: same style as Screen 1. BOX tab active (2px top border).
```

---

## Screen 3: LOG

```
Mobile app history and analytics screen called "OnStep". Blanc Luxe design system.
Background #FAF8F5, all elements 1px solid #0A0A0A border, zero border-radius, Cormorant Garamond italic, Inter 700 9px all-caps.

App bar: "LOG" centered. Right: filter icon (1px stroke).

Sub-tabs: "CALENDAR  |  LIBRARY" in Inter 9px all-caps, 1px bottom border, active has 2px underline.

LIBRARY tab is active:

Section: "PLANNED PORTFOLIO" in Inter 9px all-caps with letter-spacing.

Three content-type cards, each with 1px border:

Card 1 (케어 세션):
- Header row: "INTENSIVE CARE" in Inter 9px taupe + date "25 APR" right-aligned Inter 9px
- Large italic Cormorant Garamond 20px: "Spring Hydration Protocol"
- Stats row in Inter 9px: "SESSION 12  ·  7 PRODUCTS  ·  ACTIVATED"
- Thin 1px separator
- Product thumbnail strip: 4 tiny 32x32 square images with 1px borders, no gaps

Card 2 (메이크업):
- Header: "MAKEUP THEME" in Inter 9px taupe + date
- Italic headline: "Glass Skin · No-Makeup"
- Stats: "8 PRODUCTS  ·  T.P.O: DAILY / WORK"
- Same thumbnail strip

Card 3 (룩북):
- Header: "LOOKBOOK" in Inter 9px taupe + date
- Italic headline: "Minimal Monday"
- Stats: "5 PIECES  ·  SCHEDULED: MON WED FRI"

Bottom: floating square "+" button, same BOX screen style.

Bottom nav: LOG active.
```

---

## Screen 4: SETUP

```
Mobile app skincare/beauty routine builder called "OnStep". Blanc Luxe editorial design.
Background #FAF8F5, 1px solid #0A0A0A borders everywhere, zero border-radius, Cormorant Garamond italic display text, Inter 700 9px all-caps labels, pure monochrome.

App bar: "SETUP" centered Inter 9px all-caps.

CT (Content Type) tab row below app bar:
- "집중케어  메이크업  룩북" in Inter 9px all-caps
- Active tab "집중케어" has 2px bottom border
- 1px full-width bottom border on the tab container

ACTIVE TAB: 집중케어 panel

Session watermark: giant "12" in Cormorant Garamond, 160px, opacity 4%, sits behind card content

Session hero card (1px border):
- "INTENSIVE CARE SESSION" in Inter 9px all-caps taupe
- Italic headline Cormorant Garamond 26px: "Spring Radiance Protocol"
- "SESSION 12  ·  14 DAYS" in Inter 9px taupe

Baseline photo zone (1px dashed border, full width, 140px height):
- "BASELINE · 시작 전 피부 상태" in Inter 9px all-caps, taupe, top-left
- Center: a subtle camera icon (1px stroke), "Before 사진 추가" in Inter 12px taupe

Morning / Night product sections:
Each section header: "MORNING PROTOCOL" / "NIGHT PROTOCOL" in Inter 9px all-caps
Products as small horizontal list items, each with 1px bottom border:
- 32px square product thumbnail with 1px border
- Product name Inter 13px + category Inter 9px taupe
- Drag handle icon right-aligned (three horizontal 1px lines)

ok action button: full width, 1px border, Cormorant Garamond 18px italic text "ok →". NOT filled — outline only with generous padding.

Bottom nav: SETUP active.
```

---

## Stitch 사용 팁

1. 위 프롬프트를 그대로 붙여넣고 Generate 클릭
2. 생성 후 Color 패널에서 모든 색상을 `#0A0A0A` / `#FFFFFF` / `#FAF8F5` / `#C8BFB5` 로 교체
3. Font 패널: Display → **Cormorant Garamond Italic**, UI → **Inter**
4. Corner radius 패널: 전부 **0** 으로 설정
5. Border: 모든 컨테이너에 **1px solid #0A0A0A** 추가

---

## 참고: Blanc Luxe 컬러 팔레트

| Token | Hex | 용도 |
|-------|-----|------|
| noir | `#0A0A0A` | 기본 텍스트, 테두리, 활성 상태 |
| blanc | `#FFFFFF` | 카드 배경, 반전 버튼 |
| warm-white | `#FAF8F5` | 앱 기본 배경 |
| paper | `#F4F1ED` | 섹션 배경, 서브 카드 |
| taupe | `#C8BFB5` | 레이블, 보조 텍스트 |
| taupe-dark | `#8A7F77` | 비활성 아이콘 |
| ink-light | `#3A3730` | 본문 텍스트 |

> **No accent colors.** 시간대 테마나 카테고리 색상 없음. 오직 Noir–Blanc–Taupe 단계만 사용.
