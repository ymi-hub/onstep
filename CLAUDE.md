================================================================
OnStep 프로젝트 - Next.js 전환 작업 지시서
================================================================

작성일: 2026-05-28
프로젝트: ymi-hub/onstep
저장소: https://github.com/ymi-hub/onstep
배포 사이트: https://onstep-lifeos.web.app


----------------------------------------------------------------
1. 프로젝트 배경
----------------------------------------------------------------

OnStep은 "Zero Setting · Life OS" 컨셉의 라이프 매니지먼트 웹앱이다.
주요 기능: 스킨케어 루틴, 케어 플랜, 자산 관리, Outfit Planner, ROI 분석.

기존 작업 흐름:
1. design 폴더에 HTML/CSS로 디자인 시안 + 프로토타입 구축 (완료, 배포 중)
2. Flutter로 앱 구현 시도 (보류, flutter-archive 브랜치에 보존)
3. Next.js로 전환 결정 (현재 단계) ← 여기

전환 결정 이유:
- AI 활용 기능 추가 시 API 키 보안 및 구조적으로 유리
- TypeScript로 데이터 타입 안정성 확보 (잔량 자동 계산 등에 필수)
- React 컴포넌트로 재사용성 향상
- 데이터 중심 기능(제품 등록, 사용 기록, 통계)에 적합
- design 폴더의 디자인 자산을 그대로 보존하며 마이그레이션 가능
- 무료 운영 원칙과 호환 (Firebase Hosting + Next.js Static Export)


----------------------------------------------------------------
2. 현재 프로젝트 상태
----------------------------------------------------------------

폴더 구조:
onstep/
├── frontend/              ← Next.js 16.2.6 설치 완료 (빈 상태)
│   ├── app/              ← Next.js 기본 페이지 (기본 환영 페이지만 있음)
│   ├── package.json
│   ├── tsconfig.json
│   ├── next.config.ts
│   └── ...
├── design/                ← 기존 HTML 디자인 시안 (보존, 레퍼런스)
│   ├── index.html
│   ├── today.html
│   ├── log.html
│   ├── setup.html
│   ├── box.html
│   ├── onboarding.html
│   ├── screens.html
│   ├── concepts.html
│   ├── spec.html
│   ├── ux-flow.html
│   ├── shared.css
│   ├── shared.js
│   ├── manifest.json
│   ├── logo.png / logo-v2.png
│   └── favicon.png
├── backend/               ← Firebase Functions 등 (기존 유지)
├── .firebase/             ← Firebase 설정
├── .firebaserc            ← Firebase 프로젝트 정보 (onstep-lifeos)
├── firebase.json          ← 현재 design 폴더를 호스팅 중
├── firestore.rules        ← Firestore 보안 규칙
├── firestore.indexes.json
├── storage.rules
├── CLAUDE.md              ← 기존 프로젝트 가이드
└── 기획/                  ← 기획 문서

Git 브랜치:
- main: 현재 작업 브랜치 (Next.js 설치 완료)
- flutter-archive: Flutter 코드 보존용 (GitHub에 백업됨)

Firebase 프로젝트:
- onstep-lifeos (v1, 현재 사용 중)
- onstep-lifeos-v2 (v2, 추후 사용)


----------------------------------------------------------------
3. 기술 스택 결정사항
----------------------------------------------------------------

프론트엔드:
- Next.js 16.2.6 (App Router)
- TypeScript
- Tailwind CSS
- React 컴포넌트 기반

백엔드:
- Firebase Firestore (DB)
- Firebase Authentication (인증)
- Firebase Storage (이미지 저장)
- Firebase Hosting (배포)

AI (필요 시 추가):
- Google Gemini API (무료 한도 활용, 일일 1500회)
- 한국어 텍스트 분석에 적합
- 사용자가 한글 파일 텍스트를 붙여넣어 자동 변환하는 기능에 사용 예정

배포:
- Firebase Hosting (Static Export 방식)
- 도메인: onstep-lifeos.web.app (기본 무료 도메인)

운영 원칙:
- 모든 외부 서비스는 무료 한도 내에서만 사용
- 비용 발생하는 결제 안 함


----------------------------------------------------------------
4. 디자인 시스템 (design 폴더 기반)
----------------------------------------------------------------

폰트:
- Cormorant Garamond (로고, 헤더용 세리프)
- DM Sans (본문용 산세리프)
- Google Fonts에서 로드

색상:
- 배경: #0D0D1A (딥 네이비)
- 카드 배경: rgba(255,255,255,.04)
- 카드 호버: rgba(255,255,255,.08)
- 본문 텍스트: #FFFFFF
- 흐릿한 텍스트: rgba(255,255,255,.3) ~ rgba(255,255,255,.5)
- 포인트 컬러: #E94F6B (코랄 핑크)

스타일:
- 카드: border-radius 20px, 미묘한 테두리
- 로고: letter-spacing 8px, 그라데이션 텍스트
- 인터랙션: hover 시 translateY(-4px), transition 0.25s
- 다크 모드 기본
- 미니멀, 감성적, 세련된 톤

페이지 구성 (design 폴더 기준):
- index.html: 홈 (브랜드 소개 + 화면 카드 그리드)
- today.html: 오늘의 루틴 / Today 대시보드
- log.html: 사용 기록
- setup.html: 케어 플랜 등록 / 회차 편집
- box.html: 제품(박스) 관리
- onboarding.html: 신규 사용자 안내
- screens.html: 전체 화면 설계
- concepts.html: 컨셉 정리
- spec.html: 사양서
- ux-flow.html: UX 플로우

하단 탭 네비게이션 (setup.html 기준):
- TODAY
- LOG
- BOX
- SETUP


----------------------------------------------------------------
5. 핵심 기능 사양 (Phase 1)
----------------------------------------------------------------

가장 먼저 구현할 기능들:

[1] 제품 등록 (BOX)
- 제품명, 브랜드, 카테고리
- 수량 계층 입력: 총 패키지 수 × 패키지당 수량 = 총량 자동 계산
- 사용 패턴: 1회 사용량, 하루 횟수, 사용 주기
- 자동 계산: 일일 소비량, 예상 사용 기간, 예상 소진일, 유통기한 안전성
- 현재 잔량 (수동 보정 가능)

[2] 루틴 등록 / 편집 (SETUP)
- 회차 번호 (Session #)
- 기간 (Period: 시작일 ~ 종료일)
- 루틴 시간 (Morning, Evening)
- DAY 1, DAY 2 등 일별 구분
- 제품 매핑 (박스에서 선택)
- 단계별 사용법 (예: "섞어서 얇게 펴바르고")

[3] 오늘의 루틴 (TODAY)
- 오늘 날짜의 루틴 표시
- 단계별 체크리스트
- 완료 시 사용 기록 자동 생성
- 잔량 자동 차감

[4] 사용 기록 (LOG)
- 날짜별 루틴 수행 기록
- 캘린더 뷰
- 컨디션/메모 기록 (선택)


----------------------------------------------------------------
6. 차별화 기능 (Phase 2, 추후)
----------------------------------------------------------------

[1] AI 텍스트 → 루틴 자동 변환
- 사용자가 한글 파일에서 루틴 텍스트를 복사 → OnStep에 붙여넣기
- Gemini API로 분석 → 구조화된 JSON 변환
- 회차 번호, 날짜, 시간대(아침/저녁), 제품, 사용법 자동 추출
- 결과 미리보기 후 사용자 확인 → 저장
- 본인이 현재 한글 파일에 정리해둔 루틴 텍스트를 그대로 활용

예시 입력:
"20250712 1차
아침1: 물마스크 -10분 뒤 러빙하여 흡수
       델마크림+델마크림마스크를 섞어 바른 뒤
       델마세럼+디스킨+라이지피엠에라지+레이어드밤 섞어 마무리!
저녁1: ...
저녁2: ..."

예시 출력 (JSON):
{
  "session": 1,
  "date": "2025-07-12",
  "routines": [
    {
      "time": "morning",
      "label": "아침1",
      "phases": [
        {
          "order": 1,
          "products": ["물마스크"],
          "instruction": "10분 뒤 러빙하여 흡수"
        },
        ...
      ]
    }
  ]
}

[2] 잔량 부족 알림
[3] 사용 통계 / 차트
[4] 컨디션 기록 (brewwww 영감)
[5] Outfit Planner
[6] 자산 관리
[7] ROI 분석


----------------------------------------------------------------
7. 데이터 구조 (Firestore)
----------------------------------------------------------------

컬렉션 설계:

/users/{userId}
  - email, displayName
  - createdAt, settings

/users/{userId}/products/{productId}
  - name, brand, category
  - packageCount, packageUnit
  - unitPerPackage, itemUnit
  - totalAmount (계산값)
  - dosePerUse, usesPerDay
  - frequencyType, frequencyValue
  - currentRemaining
  - purchaseDate, startDate, expiryDate
  - boxLocation (예: "뷰티")
  - createdAt, updatedAt

/users/{userId}/routines/{routineId}
  - sessionNumber
  - startDate, endDate
  - morningTime, eveningTime
  - days: [
      {
        dayNumber: 1,
        steps: [
          {
            time: "morning",
            phases: [
              {
                order: 1,
                productIds: [...],
                instruction: "...",
                mixMethod: "single|mix|sequence",
                waitMinutes: 10
              }
            ]
          }
        ]
      }
    ]
  - createdAt, updatedAt

/users/{userId}/usageLogs/{logId}
  - routineId, productId
  - loggedAt
  - amount, type (use/manual_adjust/skip)
  - note

/users/{userId}/moodLogs/{logId}
  - date, moodScore (1-5)
  - color, note


----------------------------------------------------------------
8. 작업 진행 방식 (점진적 마이그레이션)
----------------------------------------------------------------

원칙:
- design 폴더의 HTML은 절대 삭제하지 않음 (디자인 레퍼런스로 영구 보존)
- design의 디자인 시스템(색상, 폰트, 컴포넌트)을 Next.js로 가져와 일관성 유지
- 한 페이지씩 점진적으로 옮김 (한 번에 전체 마이그레이션 안 함)
- 각 단계마다 작동 확인 후 다음 단계로
- Git 커밋은 기능 단위로 작게 자주 함

작업 순서:

[Stage 1] 기반 세팅 (가장 먼저)
- frontend에 Firebase SDK 설치
- Firebase 설정 파일 (lib/firebase.ts) 작성
- 환경변수 (.env.local) 설정 가이드
- TypeScript 타입 정의 (types/product.ts, types/routine.ts 등)
- 공통 디자인 시스템 적용 (Tailwind 설정에 색상/폰트 추가)
- 레이아웃 컴포넌트 (Header, BottomNav 등)

[Stage 2] 홈 화면 (index.html → app/page.tsx)
- design/index.html을 Next.js 컴포넌트로 변환
- 디자인 100% 유지
- 카드 그리드 형태로 기능 진입점 표시

[Stage 3] 박스 (BOX) 페이지 (box.html → app/box/page.tsx)
- 제품 목록 표시
- 제품 등록 폼
- Firestore 연동 (CRUD)
- 제품 카드 컴포넌트

[Stage 4] 루틴 편집 (setup.html → app/setup/page.tsx)
- 회차 편집 화면
- 박스에서 제품 선택해서 매핑
- 단계별 사용법 입력
- DAY 1, DAY 2 등 일별 관리

[Stage 5] 오늘의 루틴 (today.html → app/today/page.tsx)
- 오늘 날짜의 루틴 표시
- 체크리스트 인터랙션
- 잔량 자동 차감

[Stage 6] 사용 기록 (log.html → app/log/page.tsx)
- 캘린더 뷰
- 일자별 사용 기록

[Stage 7] AI 텍스트 import 기능 (차별화 기능)
- Next.js API Routes로 Gemini API 호출
- 텍스트 입력 → 분석 → 미리보기 → 저장 흐름
- 환경변수에 API 키 안전하게 관리

[Stage 8] 배포 설정
- Next.js Static Export 설정 (next.config.ts)
- firebase.json 수정 (frontend/out 폴더 호스팅)
- 기존 design 호스팅은 별도 사이트로 분리하거나 정리


----------------------------------------------------------------
9. 절대 지켜야 할 원칙
----------------------------------------------------------------

[1] design 폴더 보존
- 기존 HTML 파일들은 절대 삭제하지 않음
- 디자인 레퍼런스이자 백업으로 영구 유지
- 새 디자인 결정 전에 design 폴더의 기존 디자인을 먼저 확인

[2] Firebase 무료 한도 준수
- 모든 외부 API는 무료 한도 내에서만 사용
- 결제 정보 등록 필요한 서비스 사용 안 함

[3] API 키 보안
- AI API 키는 절대 클라이언트 코드에 노출 안 함
- 모든 외부 API 호출은 Next.js API Routes (서버)에서만
- .env.local 사용, GitHub에 절대 커밋 안 함

[4] 타입 안정성
- 모든 데이터 구조는 TypeScript 타입으로 정의
- any 타입 사용 최소화

[5] 점진적 진행
- 한 번에 큰 변경 안 함
- Stage 단위로 진행, 각 단계마다 작동 확인
- Git 커밋 자주, 의미 있는 메시지로

[6] 디자인 일관성
- 기존 design의 색상, 폰트, 카드 스타일 그대로 유지
- 새 컴포넌트도 같은 디자인 언어 적용


----------------------------------------------------------------
10. 첫 작업 요청
----------------------------------------------------------------

위 사양서를 바탕으로 [Stage 1] 기반 세팅부터 시작해주세요.

[Stage 1] 구체적 작업:

1. frontend 폴더에서 다음 패키지 설치:
   - firebase (Firebase SDK)
   - date-fns (날짜 처리)
   
2. frontend/lib/firebase.ts 파일 생성:
   - Firebase 초기화 코드
   - Firestore, Auth, Storage 인스턴스 export
   - 환경변수 사용 (NEXT_PUBLIC_FIREBASE_*)

3. frontend/.env.local.example 파일 생성:
   - 필요한 환경변수 키 목록 (실제 값은 비워둠)
   - 본인이 직접 .env.local에 값 채울 수 있게 안내

4. frontend/types/ 폴더에 타입 정의:
   - product.ts (Product 타입)
   - routine.ts (Routine, RoutineStep, RoutinePhase 타입)
   - usage.ts (UsageLog 타입)

5. Tailwind 설정 수정 (frontend/tailwind.config.ts):
   - design 폴더의 색상 변수 추가
   - 폰트 패밀리 추가 (Cormorant Garamond, DM Sans)

6. frontend/app/globals.css 수정:
   - 다크 모드 기본 색상 설정
   - Google Fonts import (Cormorant Garamond, DM Sans)
   - 공통 스타일 변수

7. 레이아웃 컴포넌트:
   - frontend/components/BottomNav.tsx (TODAY, LOG, BOX, SETUP 탭)
   - 디자인은 design/setup.html의 하단 네비게이션 참고

8. 작업 완료 후:
   - npm run dev로 실행 확인
   - Git 커밋: "feat: Stage 1 - 기반 세팅 (Firebase, 타입, 디자인 시스템)"

각 단계마다 결과 보여주고 사용자 확인 후 다음 단계로 진행해주세요.
한 번에 모든 코드를 다 만들지 말고, 파일 하나씩 보여주면서 설명해주세요.


----------------------------------------------------------------
11. 진행 시 참고사항
----------------------------------------------------------------

- 본인은 코딩 학습 중이라 코드의 의미를 이해할 수 있도록 주석을 충분히 달아주세요
- 어려운 개념은 간단히 설명해주세요 (서버/클라이언트 컴포넌트 차이 등)
- 막히면 사용자에게 질문하지 말고, 합리적인 기본값으로 진행한 뒤 알려주세요
- 디자인이 모호하면 design 폴더의 HTML을 참고해서 진행하세요
- 환경변수 값은 본인이 Firebase 콘솔에서 가져와서 직접 입력할 예정이니, 가이드만 명확히 작성해주세요


----------------------------------------------------------------
12. 데이터 분류 체계 (3계층 구조)
----------------------------------------------------------------

OnStep은 모든 정보를 아래 3계층으로 구분한다.
코드 작성 시 변수명·필드명·UI 레이블이 이 계층 정의와 일치해야 한다.

[최상위] 도메인 (Domain)
  - 정의: 시스템의 거대한 독립적 영토 (물리적 분리)
  - 예시: beauty, fashion, acc, interior, health
  - 코드: domain 필드, DOMAIN_LABELS, DOMAIN_EMOJIS
  - 특징: 다른 도메인끼리 데이터가 섞이지 않는다

[중간층] 카테고리 (Category)
  - 정의: 각 도메인 내부의 수납 칸 (분류의 기준)
  - 예시: 스킨케어, 메이크업, 아우터, 하의, 주식, 푸드
  - 코드: category 필드 (Product.subCategory → 개선 예정)
  - 특징: 도메인 안에서만 의미가 있고, 화면 필터로 쓰인다

[하위층] 태그 (Tag)
  - 정의: 화면 간을 유기적으로 넘나드는 실시간 연결 고리 (컨텍스트)
  - 예시: #건성, #여름, #출근룩, #투자
  - 코드: tags 배열 필드
  - 특징: 도메인 경계를 넘어서 검색·필터·연결에 활용된다

계층별 Firestore 필드 현황:

  Product:
    domain      → Domain  ✓
    subCategory → Category (필드명 개선 예정: category로)
    category    → Tag 역할 (필드명 개선 예정: productType으로)

  CtItem (라이브러리 아이템):
    domain      → Domain  ✓
    tags        → Tag     ✓

  LifetipItem (라이프팁):
    tipCategory → Category (필드명 개선 예정: category로)
    tags        → Tag     ✓

  OOTDLog (오늘의 룩):
    category    → Category (구 필드 theme은 하위 호환 유지)
    (UI: 카테고리 / 카테고리 편집 / 카테고리 관리)

원칙:
  - 새 필드 추가 시 이 계층 정의에 맞는 이름을 사용한다
  - UI 레이블도 도메인/카테고리/태그 중 정확한 용어를 쓴다
  - "태그"라고 부르지만 실제론 카테고리인 것은 리팩토링 대상이다


================================================================
끝.
================================================================
