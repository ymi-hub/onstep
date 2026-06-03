// 날짜 관련 공통 유틸리티

/**
 * Date 객체 또는 오늘 날짜를 "YYYY-MM-DD" 형식으로 반환
 */
export function toDateStr(d?: Date): string {
  const date = d ?? new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** 오늘 날짜를 "YYYY-MM-DD"로 반환 (toDateStr의 별칭) */
export const getTodayDateStr = (): string => toDateStr();
