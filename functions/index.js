// functions/index.js — Firebase Cloud Function: Gemini API 프록시
//
// 💡 이 파일이 필요한 이유:
//    Next.js Static Export (output: 'export') 빌드는 서버가 없어서
//    Next.js API Route (/api/parse-routine)가 프로덕션에서 동작하지 않습니다.
//    대신 이 Firebase Function이 Gemini API를 안전하게 호출합니다.
//    API 키는 Firebase Secret Manager에 저장되어 클라이언트에 노출되지 않습니다.
//
// 🔧 배포 방법 (최초 1회):
//    1. cd functions && npm install
//    2. firebase functions:secrets:set GEMINI_API_KEY  (값 입력 후 Enter)
//    3. firebase deploy --only functions
//
// 📍 배포 후 함수 URL 확인:
//    Firebase Console → Functions → parseRoutine → URL 복사
//    해당 URL을 frontend/.env.local의 NEXT_PUBLIC_PARSE_API_URL에 설정

const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// 💡 defineSecret: Firebase Secret Manager에서 안전하게 API 키를 읽어옴
//    firebase functions:secrets:set GEMINI_API_KEY 명령으로 등록
const geminiApiKey = defineSecret('GEMINI_API_KEY');

// CORS 허용 출처: 프로덕션 도메인 + 로컬 개발 환경
const ALLOWED_ORIGINS = [
  'https://onstep-lifeos.web.app',
  'https://onstep-lifeos.firebaseapp.com',
  'http://localhost:3000',
];

// parseRoutine — POST { text: string } → { result: ParsedRoutine }
exports.parseRoutine = onRequest(
  {
    // 이 Function이 GEMINI_API_KEY Secret에 접근할 수 있도록 선언
    secrets: [geminiApiKey],
    // Firebase Spark 플랜: Google API (generativelanguage.googleapis.com) 호출 가능
    region: 'us-central1',
    // 콜드 스타트 최소화를 위해 최소 인스턴스 0 (기본값, 무료 플랜)
    minInstances: 0,
  },
  async (req, res) => {
    // ── CORS 헤더 설정 ──
    const origin = req.headers.origin ?? '';
    if (ALLOWED_ORIGINS.includes(origin)) {
      res.set('Access-Control-Allow-Origin', origin);
    }
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');

    // preflight 요청 처리 (브라우저가 실제 요청 전에 OPTIONS로 확인)
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }

    // POST만 허용
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method Not Allowed' });
      return;
    }

    // 요청 본문에서 텍스트 추출
    const text = (req.body?.text ?? '').trim();
    if (!text) {
      res.status(400).json({ error: '텍스트를 입력해주세요.' });
      return;
    }

    // Gemini API 호출
    try {
      const genAI = new GoogleGenerativeAI(geminiApiKey.value());
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

      // 💡 프롬프트는 Next.js API Route와 동일한 내용 사용
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

      const result = await model.generateContent(prompt);
      const responseText = result.response.text().trim();

      // Gemini가 가끔 ```json ... ``` 형식으로 반환할 때 처리
      const cleanJson = responseText
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '');

      const parsed = JSON.parse(cleanJson);
      res.status(200).json({ result: parsed });
    } catch (err) {
      console.error('[OnStep Function] Gemini 오류:', err);
      res.status(500).json({ error: 'AI 분석 중 오류가 발생했습니다.' });
    }
  }
);
