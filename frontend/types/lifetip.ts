export type LifetipItem = {
  id: string;
  name: string;
  emoji: string;
  imageUrl?: string;
  sourceUrl?: string;
  tipCategory: string;
  published: boolean;
  productIds?: string[];   // BOX에서 연결한 제품 ID 목록
  memo?: string;           // 메모
  dates?: string[];        // Today ON 날짜 목록 (YYYY-MM-DD)
  createdAt: string;
  updatedAt: string;
};

// 카테고리명 → 기본 이모지 매핑
export const LIFETIP_EMOJI_MAP: Record<string, string> = {
  주식: '📈',
  투자: '📈',
  재테크: '💰',
  푸드: '🍽',
  음식: '🍽',
  맛집: '🍜',
  쇼핑: '🛍',
  생활: '🏠',
  루틴: '🏃',
  습관: '🏃',
  뷰티: '✨',
  스킨: '✨',
  여행: '✈️',
  독서: '📚',
  운동: '💪',
  인테리어: '🛋',
};

export function getLifetipEmoji(category: string): string {
  return LIFETIP_EMOJI_MAP[category] ?? '📌';
}
