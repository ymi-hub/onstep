// lib/groqUsage.ts — Groq API 사용량 로컬 추적
// Groq는 공개 사용량 API가 없어서 localStorage에 일별 카운트를 직접 저장

const STORAGE_KEY = 'groq_daily_usage';

type UsageData = { date: string; count: number };

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function getGroqUsage(): UsageData {
  if (typeof window === 'undefined') return { date: today(), count: 0 };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { date: today(), count: 0 };
    const data = JSON.parse(raw) as UsageData;
    // 날짜가 바뀌면 초기화
    if (data.date !== today()) return { date: today(), count: 0 };
    return data;
  } catch {
    return { date: today(), count: 0 };
  }
}

export function incrementGroqUsage(): UsageData {
  const current = getGroqUsage();
  const updated: UsageData = { date: today(), count: current.count + 1 };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch { /* ignore */ }
  return updated;
}
