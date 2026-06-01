// 건강·다이어트·운동 루틴
export type HealthType = 'diet' | 'exercise' | 'meal' | 'sleep' | 'custom';

export const HEALTH_TYPE_LABELS: Record<HealthType, string> = {
  diet:     '다이어트',
  exercise: '운동',
  meal:     '식단',
  sleep:    '수면',
  custom:   '기타',
};

export const HEALTH_TYPE_ICONS: Record<HealthType, string> = {
  diet:     '🥗',
  exercise: '🏃',
  meal:     '🍱',
  sleep:    '💤',
  custom:   '⭐',
};

export type HealthRoutine = {
  id: string;
  icon: string;          // 이모지
  name: string;          // 루틴 이름 (예: 간헐적 단식, 저탄고지)
  type: HealthType;      // 카테고리
  schedule: string;      // 스케줄 설명 (예: 16:8 단식, 매일 30분 걷기)
  repeatDays?: number[]; // 반복 요일 0=일~6=토 (비어있으면 매일)
  goal?: string;         // 목표 (선택)
  active: boolean;       // 활성 여부
  createdAt: string;
  updatedAt: string;
};
