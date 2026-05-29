// app/api/parse-routine/route.ts — Gemini API 프록시 (개발 환경 전용)
//
// 💡 이 파일은 Next.js API Route 입니다.
//    서버에서 실행되므로 GEMINI_API_KEY가 클라이언트에 노출되지 않습니다.
//
// 🚨 주의: output: 'export' (Static Export) 빌드에서는 API Route가 동작하지 않습니다.
//    프로덕션 배포 시에는 Firebase Function (functions/index.js) 을 사용하세요.
//    import 페이지에서 NEXT_PUBLIC_PARSE_API_URL 환경변수로 URL을 전환합니다.

import { GoogleGenerativeAI } from '@google/generative-ai';
import { NextRequest, NextResponse } from 'next/server';

// POST /api/parse-routine
// 요청 body: { text: string }   ← 사용자가 붙여넣은 루틴 텍스트
// 응답 body: { result: ParsedRoutine } 또는 { error: string }
export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'GEMINI_API_KEY가 설정되지 않았습니다. .env.local을 확인해주세요.' },
      { status: 500 }
    );
  }

  let text: string;
  try {
    const body = await req.json() as { text?: string };
    text = body.text?.trim() ?? '';
  } catch {
    return NextResponse.json({ error: '요청 형식이 잘못되었습니다.' }, { status: 400 });
  }

  if (!text) {
    return NextResponse.json({ error: '텍스트를 입력해주세요.' }, { status: 400 });
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const prompt = `
다음 한국어 스킨케어 루틴 텍스트를 분석해서 JSON으로 변환해주세요.

━━ 1. 헤더 파싱 ━━
형식: "{날짜} {N차} ({태그})"   ← 태그는 선택 사항
예: "20260522 20차 (관리3차)" → date:"2026-05-22", session:20, tag:"관리3차"
예: "20260522 20차"           → date:"2026-05-22", session:20, tag:null
날짜 변환: "20260522" → "2026-05-22"

━━ 2. 섹션 레이블 인식 ━━
빈 줄 뒤에 단독으로 나타나는 레이블:
  아침은      → time:"morning", dayNumber:1
  하루아침은  → time:"morning", dayNumber:2
  저녁은      → time:"evening", dayNumber:1
  하루저녁은  → time:"evening", dayNumber:2
같은 레이블이 여러 번 나오면: 첫 번째=dayNumber:1, 두 번째=dayNumber:2

━━ 3. 팁 문장 인식 ━━
"이떄는", "이때는", "참고로", "주의" 등으로 시작하는 문단
→ 직전 섹션의 expertTip으로 저장 (routines phases에 포함하지 않음)

━━ 4. 제품 기호 의미 ━━
⬛ "-" 로 연결된 제품들: 순서대로 하나씩 레이어링 (각자 따로 바름)
⬛ "+" 로 연결된 제품들: 섞어서 함께 바름

예:
  "버터토너- 델마세럼- 오션크림" → 3개를 순서대로 각자 바름
  "인투쉘+인투베일을 섞어서" → 2개를 섞어서 함께 바름

━━ 5. 단계(phase) 분리 규칙 ━━

Phase 경계 판별 (새 phase가 시작되는 시점):
  ① 동작 어미 뒤 "-": "~하고-", "~고-", "~뒤에-", "~바르고-"
  ② 특수: "N분뒤에띄어내고-" → waitMinutes:N 기록 후 새 phase
  ③ 마지막 phase: "마무리", "마무리!", "마무리해주세요!" 등으로 끝남 (trailing "-" 없음)

"-"로 나열된 제품 + "+" 로 연결된 제품 그룹이 같은 세그먼트에 있을 때:
  ① "-"로만 나열된 부분 → Phase A: products 배열에 차례로 포함, instruction:""
  ② "+"로 연결된 그룹 → Phase B: products 배열에 각각 포함, instruction:"섞어서..."

예:
"버터토너- 델마세럼- 톡스세럼- 광택세럼- 펄세럼-페를 4종+듀얼리즈+기미가라크림을 섞어서 두껍게 펴바르고-"
→ Phase A: products:["버터토너","델마세럼","톡스세럼","광택세럼","펄세럼"], instruction:""
→ Phase B: products:["페를 4종","듀얼리즈","기미가라크림"], instruction:"섞어서 두껍게 펴바르고"

예외: "-"로 나열된 제품들 전체에 "섞어서" 동작이 적용될 때는 하나의 Phase로:
"인투토너-인투앰플-인투쉘+인투베일을 섞어서 얇게 펴바르고-"
→ Phase: products:["인투토너","인투앰플","인투쉘","인투베일"], instruction:"섞어서 얇게 펴바르고"

━━ 6. 제품명 추출 규칙 ━━
- 한국어 고유명사 그대로 보존
- 조사 제거: "에", "을", "를", "이", "가"
  예: "구해줘앰플에" → "구해줘앰플", "새살세럼을" → "새살세럼"
  예: "톡스크림에 톡스세럼" → products:["톡스크림","톡스세럼"]
- "인미 4종", "페를 4종" 등 수량 포함 이름 → 그대로 보존
- 동사/부사("섞어서","얇게","두껍게","펴바르고","마무리") → instruction 텍스트

━━ 7. 완전한 예시 변환 ━━

입력:
"구해줘앰플에 새살세럼 섞어서 얇게 펴바르고- 인투토너-인투앰플-인투쉘+인투베일을 섞어서 얇게 펴바르고-델마세럼-라이지앰플-블랙크림으로 마무리"

출력 phases:
[
  {"order":1,"products":["구해줘앰플","새살세럼"],"instruction":"섞어서 얇게 펴바르고","waitMinutes":0},
  {"order":2,"products":["인투토너","인투앰플","인투쉘","인투베일"],"instruction":"섞어서 얇게 펴바르고","waitMinutes":0},
  {"order":3,"products":["델마세럼","라이지앰플","블랙크림"],"instruction":"으로 마무리","waitMinutes":0}
]

입력:
"버터토너- 델마세럼- 톡스세럼- 펄세럼-페를 4종+듀얼리즈+기미가라크림을 섞어서 두껍게 펴바르고- 인미리코드팩 20분뒤에띄어내고- 델마크림-오션크림으로 마무리!"

출력 phases:
[
  {"order":1,"products":["버터토너","델마세럼","톡스세럼","펄세럼"],"instruction":"","waitMinutes":0},
  {"order":2,"products":["페를 4종","듀얼리즈","기미가라크림"],"instruction":"섞어서 두껍게 펴바르고","waitMinutes":0},
  {"order":3,"products":["인미리코드팩"],"instruction":"떼어내고","waitMinutes":20},
  {"order":4,"products":["델마크림","오션크림"],"instruction":"으로 마무리","waitMinutes":0}
]

━━ 8. 출력 JSON 형식 ━━
{
  "session": <숫자>,
  "date": "<YYYY-MM-DD 또는 null>",
  "tag": "<태그 또는 null>",
  "routines": [
    {
      "time": "morning" 또는 "evening",
      "label": "<원문 레이블>",
      "dayNumber": <1 또는 2>,
      "expertTip": "<팁 문장 또는 null>",
      "phases": [
        {
          "order": <1부터 순서>,
          "products": ["제품명1", "제품명2"],
          "instruction": "<사용법, 없으면 빈 문자열>",
          "waitMinutes": <대기 분, 없으면 0>
        }
      ]
    }
  ]
}

순수 JSON만 반환. 마크다운 코드 블록(\`\`\`) 절대 금지. JSON 외 텍스트 포함 금지.

입력 텍스트:
${text}
`.trim();

  try {
    const result = await model.generateContent(prompt);
    const responseText = result.response.text().trim();

    // Gemini가 가끔 ```json ... ``` 형식으로 반환할 때 처리
    const cleanJson = responseText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '');

    const parsed = JSON.parse(cleanJson);
    return NextResponse.json({ result: parsed });
  } catch (err) {
    console.error('[OnStep] Gemini 파싱 오류:', err);
    return NextResponse.json(
      { error: 'AI 분석 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' },
      { status: 500 }
    );
  }
}
