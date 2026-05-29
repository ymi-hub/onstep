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
  // 환경변수에서 API 키 가져오기 (서버에서만 접근 가능)
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'GEMINI_API_KEY가 설정되지 않았습니다. .env.local을 확인해주세요.' },
      { status: 500 }
    );
  }

  // 요청 본문 파싱
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

  // Gemini API 초기화
  const genAI = new GoogleGenerativeAI(apiKey);
  // gemini-2.5-flash: 무료 한도 500회/일
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  // 💡 프롬프트 설계:
  //    - 한국어 루틴 텍스트를 구조화된 JSON으로 변환
  //    - "-"는 제품 구분자이며, 한국어 연결 어미 뒤에 오는 "-"는 단계 구분자
  //    - "아침은"/"하루아침은", "저녁은"/"하루저녁은" 패턴으로 dayNumber 결정
  //    - 마크다운 코드 블록 없이 순수 JSON만 반환하도록 지시
  const prompt = `
다음 한국어 스킨케어 루틴 텍스트를 분석해서 JSON으로 변환해주세요.

【날짜/회차 추출】
- "20260522 20차" → date: "2026-05-22", session: 20
- "20차", "20회차" → session: 20
- 날짜가 없으면 date: null, 회차가 없으면 session: 1

【시간대 레이블 → time + dayNumber 변환】
- "아침은", "아침1" → time: "morning", dayNumber: 1
- "하루아침은", "아침2" → time: "morning", dayNumber: 2
- "저녁은", "저녁1" → time: "evening", dayNumber: 1
- "하루저녁은", "저녁2" → time: "evening", dayNumber: 2
- 같은 레이블이 여러 번 나오면 첫 번째 = dayNumber:1, 두 번째 = dayNumber:2

【단계(phase) 분리 방법】
"-"는 제품 구분자 또는 단계 구분자입니다.
새 단계(phase)가 시작되는 경우:
① 한국어 연결 어미("~하고-", "~고-", "~뒤-", "~바르고-") 뒤의 "-"
② "N분뒤에띄어내고-" 패턴 (waitMinutes: N 기록 후 새 단계)
같은 단계에서 "-"로만 연결된 제품들은 하나의 phase에 넣으세요.

【제품 추출 규칙】
- 제품명은 한국어 고유명사 (예: "구해줘앰플", "인투토너", "기미씨크림", "인미 4종")
- "+"로 연결된 제품들 → 같은 phase의 products 배열에 분리해서 포함
- 제품명 뒤 조사("에", "을", "를", "이", "가") 제거 (예: "구해줘앰플에" → "구해줘앰플")
- 동사/부사("섞어서", "얇게", "두껍게", "펴바르고", "마무리해주세요") → instruction 텍스트
- 팁/코멘트 문장("이떄는", "참고로", "주의:" 로 시작) → 무시

【구체적인 변환 예시】
입력:
"구해줘앰플에 새살세럼 섞어서 얇게 펴바르고- 인투토너-인투앰플-인투쉘+인투베일을 섞어서 얇게 펴바르고-인미리코드팩 20분뒤에띄어내고-델마크림으로 마무리"

출력 phases:
[
  {"order":1,"products":["구해줘앰플","새살세럼"],"instruction":"섞어서 얇게 펴바르고","waitMinutes":0},
  {"order":2,"products":["인투토너","인투앰플","인투쉘","인투베일"],"instruction":"섞어서 얇게 펴바르고","waitMinutes":0},
  {"order":3,"products":["인미리코드팩"],"instruction":"띄어내고","waitMinutes":20},
  {"order":4,"products":["델마크림"],"instruction":"으로 마무리","waitMinutes":0}
]

【출력 JSON 형식 (이 구조 반드시 준수)】
{
  "session": <숫자>,
  "date": "<YYYY-MM-DD 또는 null>",
  "routines": [
    {
      "time": "morning" 또는 "evening",
      "label": "<원문 레이블>",
      "dayNumber": <1 또는 2>,
      "phases": [
        {
          "order": <1부터 순서>,
          "products": ["제품명1", "제품명2"],
          "instruction": "<사용법>",
          "waitMinutes": <대기 분, 없으면 0>
        }
      ]
    }
  ]
}

반드시 순수 JSON만 반환. 마크다운 코드 블록(\`\`\`) 절대 금지. JSON 외 텍스트 포함 금지.

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
