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
