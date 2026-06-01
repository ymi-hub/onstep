export type HealthCategory = {
  id: string;
  icon: string;   // 이모지
  name: string;   // 카테고리 이름
  order: number;  // 정렬 순서
  createdAt: string;
};

// 첫 진입 시 자동 생성할 기본 카테고리
export const DEFAULT_HEALTH_CATEGORIES: Omit<HealthCategory, 'id' | 'createdAt'>[] = [
  { icon: '🥗', name: '다이어트', order: 0 },
  { icon: '🏃', name: '운동',     order: 1 },
  { icon: '🍱', name: '식단',     order: 2 },
  { icon: '💤', name: '수면',     order: 3 },
  { icon: '⭐', name: '기타',     order: 4 },
];
