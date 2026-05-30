// lib/parseRoutine.ts — Groq API 호출 유틸리티 (무료, 카드 불필요)
import { incrementGroqUsage } from './groqUsage';
//
// 함수 두 가지:
//   parseRoutinePhases  — ROUTINE EDIT AI 패널용 (단계 시퀀스만 추출)
//   parseRoutineText    — /import 페이지용 (전체 세션 구조 파싱)

// ── 타입 ────────────────────────────────────────────────────────────────────

export type ParsedPhase = {
  order: number;
  preText?: string;         // 제품명 앞 설명 텍스트 (예: "그럼 그때에는")
  products: string[];       // 제품명 배열 (한국어, 조사 제거)
  instruction: string;      // 제품명 뒤 사용법/설명
  waitMinutes: number;      // 대기 시간(분), 없으면 0
};

export type ParsedRoutine = {
  time: 'morning' | 'evening';
  label: string;
  dayNumber?: number;
  expertTip?: string | null;
  phases: ParsedPhase[];
};

export type ParsedResult = {
  session: number;
  date: string | null;
  tag?: string | null;
  routines: ParsedRoutine[];
};

// ── 공통 유틸 ────────────────────────────────────────────────────────────────

function cleanJson(raw: string): string {
  // 마크다운 코드 블록 제거
  let s = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  // 모델이 JSON 앞뒤에 한국어 설명을 붙인 경우 → { } 범위만 추출
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start !== -1 && end !== -1 && start < end) {
    s = s.slice(start, end + 1);
  }

  return s;
}

async function callGroq(prompt: string): Promise<string> {
  const apiKey = process.env.NEXT_PUBLIC_GROQ_API_KEY;
  if (!apiKey) throw new Error('Groq API 키가 없습니다. .env.local에 NEXT_PUBLIC_GROQ_API_KEY를 추가하세요.');

  // JSON 출력에 1024 토큰으로 충분 — 2048은 불필요하게 TPM 한도를 소비함
  const body = JSON.stringify({
    model: 'llama-3.1-8b-instant',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.1,
    max_tokens: 1024,
  });

  const doFetch = () =>
    fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body,
    });

  let res = await doFetch();

  // 429 Rate limit → 오류 메시지에서 대기 시간 파싱 후 1회 재시도
  if (res.status === 429) {
    const errBody = await res.json().catch(() => ({})) as { error?: { message?: string } };
    const msg = errBody.error?.message ?? '';
    const match = msg.match(/try again in ([\d.]+)s/);
    // 명시된 대기 시간 + 1초 여유; 파싱 실패 시 35초 기본값
    const waitMs = match ? Math.ceil(parseFloat(match[1])) * 1000 + 1000 : 35000;
    await new Promise(r => setTimeout(r, waitMs));
    res = await doFetch();
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(err.error?.message ?? `Groq API 오류 (${res.status})`);
  }

  const data = await res.json() as { choices?: { message?: { content?: string } }[] };
  const raw = data.choices?.[0]?.message?.content ?? '';
  if (!raw) throw new Error('AI 응답이 비어 있습니다.');
  return cleanJson(raw);
}

// ── 1. ROUTINE EDIT 패널용 — 단계 시퀀스만 추출 ──────────────────────────────
//
// 사용자가 이미 슬롯(아침/저녁)과 DAY를 선택한 상태에서 호출.
// 아침1/아침2 구분, time/dayNumber 파싱 불필요 — 텍스트에서 단계만 뽑음.

function buildPhasesPrompt(text: string, productNames?: string[]): string {
  const boxSection = productNames && productNames.length > 0
    ? `\n## BOX 등록 제품 목록 (이 이름 기준으로 제품명 인식)\n${productNames.join(', ')}\n- 위 목록 단어가 어느 문장에든 등장하면 반드시 products[]에 추출\n- 한 글자 오타(예: 모해때↔모해뗴)도 같은 제품으로 인식\n- 목록에 없어도 제품명처럼 보이면 products[]에 추출\n`
    : '';

  return `한국어 스킨케어 루틴 텍스트에서 단계 목록을 JSON으로 추출하세요.${boxSection}

## 구분 규칙
- "-" = 단계 구분자 (앞뒤 공백 무관)
- "+" = 같은 단계 혼합 제품 구분자
- "-" 없어도 줄바꿈·문장 경계로 다른 제품+동작이면 별도 phase로 분리
- "아침1", "아침2", "저녁1" 등 레이블 줄 무시
- "그다음", "그리고" = 연결어, 무시

## 제품명 추출
- 제품명에 조사(에, 을, 를, 으로, 로) 포함하지 않음
- 공백 포함 제품명 허용: "인미 4종", "페를 4종", "라이지 토너" 등
- "위에" = 위치 지시어, 제품명 아님
- 혼합 패턴:
  · A+B+C → ["A","B","C"]
  · A에 B를/을 → ["A","B"]
  · A B를/을 섞어서 → ["A","B"]

## instruction 추출
- 마지막 제품명 뒤 조사+설명 전체 → instruction
- 대화체 어미 제거: "해주세요", "해주시는데요", "주시고", "주시면", "거든요", "있을꺼에요"
- "그다음", "그래서", "이렇게" = 연결어, instruction에 포함 안 함
- 조사만 있고 설명 없으면 → instruction: ""
- **모든 텍스트 보존**: 어떤 문장도 건너뛰지 않음
- **제품명은 어느 문장에서든 항상 products[]에 추출**: 설명 문장·조건 문장이어도 스킨케어 제품명이 보이면 반드시 products[]에 포함
  · "저녁에 이렇게 다패치나 듀얼슥을 사용해서 팩을 하고 나시면"
    → preText:"저녁에 이렇게", products:["다패치","듀얼슥"], instruction:"나 사용해서 팩을 하고 나시면"
- **제품 앞 텍스트 → preText**: 제품명 앞 설명은 preText에 저장
  · "그럼 그때에는 델마세럼으로 충분히 흡수시켜서 물기를 많이 주신 상태에서"
    → preText:"그럼 그때에는", products:["델마세럼"], instruction:"으로 충분히 흡수시켜서 물기를 많이 주신 상태에서"
- **제품 뒤 텍스트 → instruction**: 결과 설명 포함 전부 instruction에 저장
  · "톡스세럼으로 흡수시켜주시면 피부가 몽글해지면서 달라붙거든요?"
    → products:["톡스세럼"], instruction:"으로 흡수시켜주시면 피부가 몽글해지면서 달라붙거든요"
- **제품명이 전혀 없는 순수 설명** → products:[] 이고 preText에 전체 저장
  · "자 여기서 포인트가 있어요" → preText:"자 여기서 포인트가 있어요", products:[], instruction:""
  · "피부가 좀 찐득거릴수있어요" → preText:"피부가 좀 찐득거릴수있어요", products:[], instruction:""

## waitMinutes
- "N분뒤에 띄어내고" / "N분뒤에띄어내고" → waitMinutes: N
- "N분정도 있따가" / "N분 후에" → waitMinutes: N
- 제품 없이 대기만 있는 경우 → products:[]

---
## 파싱 예시

"구해줘앰플에 새살세럼 섞어서 얇게 펴바르고"
→ products:["구해줘앰플","새살세럼"], instruction:"섞어서 얇게 펴바르고", waitMinutes:0

"구해줘앰플 새살세럼을 섞어서 얇게 펴바르고"
→ products:["구해줘앰플","새살세럼"], instruction:"을 섞어서 얇게 펴바르고", waitMinutes:0

"인투쉘+인투베일을 섞어서 얇게 펴바르고"
→ products:["인투쉘","인투베일"], instruction:"을 섞어서 얇게 펴바르고", waitMinutes:0

"올라가실+톡스크림마스크+오션세럼을 섞어서 두껍게 펴바르고"
→ products:["올라가실","톡스크림마스크","오션세럼"], instruction:"을 섞어서 두껍게 펴바르고", waitMinutes:0

"기미가라크림에 콜라겐겔을 섞어서 두껍게 펴바르고"
→ products:["기미가라크림","콜라겐겔"], instruction:"을 섞어서 두껍게 펴바르고", waitMinutes:0

"라이지부스터를 듬뿍 펴바르고"
→ products:["라이지부스터"], instruction:"를 듬뿍 펴바르고", waitMinutes:0

"구해줘앰플을 듬뿎 펴바른뒤"
→ products:["구해줘앰플"], instruction:"을 듬뿎 펴바른뒤", waitMinutes:0

"인미부스터를 두껍게 펴바른뒤"
→ products:["인미부스터"], instruction:"를 두껍게 펴바른뒤", waitMinutes:0

"기미씨크림을 얇게 펴바르고"
→ products:["기미씨크림"], instruction:"을 얇게 펴바르고", waitMinutes:0

"위에 기미타파 붙이고 모공타파 위에 붙여요"
→ products:["기미타파","모공타파"], instruction:"붙이기", waitMinutes:0

"그다음 20분뒤에띄어내고"
→ products:[], instruction:"20분뒤에 띄어내고", waitMinutes:20

"인투팩 20분뒤에 띄어내고"
→ products:["인투팩"], instruction:"20분뒤에 띄어내고", waitMinutes:20

"와팩 10분뒤에띄어내고"
→ products:["와팩"], instruction:"10분뒤에 띄어내고", waitMinutes:10

"톡스크림+기미비비크림+모해뗴를 섞어서 얇게 펴바르고 10분정도 있따가"
→ products:["톡스크림","기미비비크림","모해뗴"], instruction:"를 섞어서 얇게 펴바르고", waitMinutes:10

"온도디바이스로 롤링 그다음"
→ products:["온도디바이스"], instruction:"으로 롤링", waitMinutes:0

"델마세럼으로 충분히 흡수시켜서 물기를 많이 주신 상태에서"
→ products:["델마세럼"], instruction:"으로 충분히 흡수시켜서", waitMinutes:0

"톡스세럼으로 흡수시켜주시면"
→ products:["톡스세럼"], instruction:"으로 흡수시켜주시면", waitMinutes:0

"디볼륨에 광채슬리밍팩 섞어서 얇게 펴바르고"
→ products:["디볼륨","광채슬리밍팩"], instruction:"섞어서 얇게 펴바르고", waitMinutes:0

"페를 4종을 섞어서 얇게 펴발라주시고"
→ products:["페를 4종"], instruction:"을 섞어서 얇게 펴발라주시고", waitMinutes:0

"필잇업크림으로 마무리해주시는데요"
→ products:["필잇업크림"], instruction:"으로 마무리", waitMinutes:0

"블랙크림으로 마무리해주세요"
→ products:["블랙크림"], instruction:"으로 마무리", waitMinutes:0

"델마세럼"
→ products:["델마세럼"], instruction:"", waitMinutes:0

--- 복합 예문 (제품 앞뒤 설명 혼합) ---
입력:
  자 여기서 포인트가 있어요
  저녁에 이렇게 다패치나 듀얼슥을 사용해서 팩을 하고 나시면
  피부가 좀 찐득거릴수있어요
  그럼 그때에는 델마세럼으로 충분히 흡수시켜서 물기를 많이 주신 상태에서
  톡스크림+기미비비크림+모해뗴를 섞어서 얇게 펴바르고 10분정도 있따가 톡스세럼으로 흡수시켜주시면 피부가 몽글해지면서 딱 달라붙거든요?
  그래서 이렇게도 한번 해보세요

정답 출력:
{"phases":[
  {"order":1,"preText":"자 여기서 포인트가 있어요","products":[],"instruction":"","waitMinutes":0},
  {"order":2,"preText":"저녁에 이렇게","products":["다패치","듀얼슥"],"instruction":"나 사용해서 팩을 하고 나시면","waitMinutes":0},
  {"order":3,"preText":"피부가 좀 찐득거릴수있어요","products":[],"instruction":"","waitMinutes":0},
  {"order":4,"preText":"그럼 그때에는","products":["델마세럼"],"instruction":"으로 충분히 흡수시켜서 물기를 많이 주신 상태에서","waitMinutes":0},
  {"order":5,"products":["톡스크림","기미비비크림","모해뗴"],"instruction":"를 섞어서 얇게 펴바르고","waitMinutes":10},
  {"order":6,"products":["톡스세럼"],"instruction":"으로 흡수시켜주시면 피부가 몽글해지면서 달라붙거든요","waitMinutes":0},
  {"order":7,"preText":"그래서 이렇게도 한번 해보세요","products":[],"instruction":"","waitMinutes":0}
]}

---
## 출력 규칙 (반드시 준수)
- JSON 객체만 출력. JSON 앞뒤로 설명·서두·결론 문장 절대 추가 금지.
- 제품명·instruction 값은 한국어 그대로 유지.

## 출력 형식
{"phases":[{"order":1,"preText":"제품 앞 설명(없으면 생략)","products":["제품명"],"instruction":"사용법","waitMinutes":0}]}

## 입력 텍스트
${text}`;
}

export async function parseRoutinePhases(text: string, productNames?: string[]): Promise<ParsedPhase[]> {
  const json = await callGroq(buildPhasesPrompt(text, productNames));
  const parsed = JSON.parse(json) as { phases: ParsedPhase[] };
  incrementGroqUsage();
  return parsed.phases ?? [];
}

// ── 2. /import 페이지용 — 전체 세션 구조 파싱 ───────────────────────────────

function buildFullPrompt(text: string): string {
  return `한국어 스킨케어 루틴 텍스트를 JSON으로 변환해주세요.

=== 텍스트 패턴 규칙 ===
- "-" = 단계 구분자
- "+" = 혼합 사용 제품
- "아침N" → time:"morning", dayNumber:N
- "저녁N" → time:"evening", dayNumber:N
- "하루아침" → time:"morning", dayNumber:2
- "하루저녁" → time:"evening", dayNumber:2
- 제품명 뒤 조사(에, 을, 를, 으로, 로, 이, 가) 제거
- "N분뒤에 띄어내고" → waitMinutes:N
- 회차 "N차" → session:N
- 날짜 "20250712" → "2025-07-12"

=== 출력 형식 (순수 JSON만) ===
{
  "session": 1,
  "date": null,
  "tag": null,
  "routines": [
    {
      "time": "morning",
      "label": "아침1",
      "dayNumber": 1,
      "phases": [
        {
          "order": 1,
          "products": ["제품명1", "제품명2"],
          "instruction": "섞어서 얇게 펴바르고",
          "waitMinutes": 0
        }
      ]
    }
  ]
}

=== 입력 텍스트 ===
${text}`;
}

export async function parseRoutineText(text: string): Promise<ParsedResult> {
  const json = await callGroq(buildFullPrompt(text));
  return JSON.parse(json) as ParsedResult;
}
