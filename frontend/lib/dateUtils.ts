// 날짜 관련 공통 유틸리티
import type { IntervalUnit } from '@/types/healthroutine';

/**
 * Date 객체 또는 오늘 날짜를 "YYYY-MM-DD" 형식으로 반환
 */
export function toDateStr(d?: Date): string {
  const date = d ?? new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** 오늘 날짜를 "YYYY-MM-DD"로 반환 (toDateStr의 별칭) */
export const getTodayDateStr = (): string => toDateStr();

/**
 * 저녁(나이트) 루틴용 날짜 문자열.
 * 나이트 루틴은 18:00~다음날 04:00까지 이어지므로,
 * 04:00 이전이면 어제 날짜를 반환해 전날 나이트로 취급.
 */
export function getEveningDateStr(): string {
  const h = new Date().getHours();
  if (h < 4) {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return toDateStr(d);
  }
  return getTodayDateStr();
}

/**
 * 마지막 완료일(lastDoneDate) + 반복 단위/값으로 다음 수행일 계산.
 * lastDoneDate 없으면 오늘을 기준으로 계산.
 *
 * 예) calcNextDueDate('2026-05-01', 'month', 1) → '2026-06-01'
 *     calcNextDueDate('2026-03-15', 'month', 3) → '2026-06-15'  (분기)
 */
export function calcNextDueDate(
  lastDoneDate: string | undefined,
  unit: IntervalUnit,
  value: number,
): string {
  const base = lastDoneDate ? new Date(lastDoneDate + 'T12:00:00') : new Date();
  const d = new Date(base);
  switch (unit) {
    case 'day':   d.setDate(d.getDate() + value);         break;
    case 'week':  d.setDate(d.getDate() + value * 7);     break;
    case 'month': d.setMonth(d.getMonth() + value);       break;
    case 'year':  d.setFullYear(d.getFullYear() + value); break;
  }
  return toDateStr(d);
}

/**
 * 다음 수행일까지 남은 일수 반환.
 * 양수 = 앞으로 N일 후, 0 = 오늘, 음수 = N일 지남(초과).
 */
export function getDaysUntilDue(nextDueDateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(nextDueDateStr + 'T00:00:00');
  return Math.round((due.getTime() - today.getTime()) / 86400000);
}

/**
 * D-N 배지 레이블 반환.
 * 예) -2 → "2일 초과", 0 → "오늘", 1 → "내일", 5 → "D-5"
 */
export function dueBadgeLabel(daysUntil: number): string {
  if (daysUntil < 0)  return `${Math.abs(daysUntil)}일 초과`;
  if (daysUntil === 0) return '오늘';
  if (daysUntil === 1) return '내일';
  return `D-${daysUntil}`;
}

/**
 * D-N 배지 색상 반환 (배경색 기준).
 * 오늘 이전(초과/오늘) → 빨강, 3일 이내 → 노랑, 그 이상 → 회색
 */
export function dueBadgeColor(daysUntil: number): { bg: string; color: string } {
  if (daysUntil <= 0) return { bg: '#FEE2E2', color: '#DC2626' };
  if (daysUntil <= 3) return { bg: '#FEF3C7', color: '#B45309' };
  if (daysUntil <= 7) return { bg: '#F0FDF4', color: '#16A34A' };
  return { bg: '#F4F4F0', color: '#9A9490' };
}
