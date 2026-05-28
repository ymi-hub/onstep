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
  //    - 제품명은 원문 그대로 보존 (한국어)
  //    - 마크다운 코드 블록 없이 순수 JSON만 반환하도록 지시
  const prompt = `
다음 한국어 스킨케어 루틴 텍스트를 JSON으로 변환해주세요.

출력 형식 (반드시 이 구조를 따르세요):
{
  "session": <회차 번호, 숫자. 없으면 1>,
  "date": "<YYYY-MM-DD 형식 날짜. 없으면 null>",
  "routines": [
    {
      "time": "<morning 또는 evening>",
      "label": "<원문 레이블, 예: 아침1, 저녁2>",
      "phases": [
        {
          "order": <단계 순서, 1부터>,
          "products": ["<제품명1>", "<제품명2>"],
          "instruction": "<이 단계 사용법>",
          "waitMinutes": <대기 시간(분), 없으면 0>
        }
      ]
    }
  ]
}

변환 규칙:
- 아침 루틴: "아침", "AM", "morning" → time: "morning"
- 저녁 루틴: "저녁", "PM", "evening" → time: "evening"
- 제품명이 +로 연결된 경우 (예: "크림+세럼") → products 배열에 각각 분리
- "-" 뒤의 내용은 instruction (사용법)
- 회차 번호가 "1차", "2차" 형식이면 session 필드로 추출
- 날짜가 "20250712" 형식이면 "2025-07-12"로 변환
- JSON 외 다른 텍스트 절대 포함 금지
- 마크다운 코드 블록(\`\`\`) 없이 순수 JSON만 반환

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
