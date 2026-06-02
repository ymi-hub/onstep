import type { RepeatType } from './habit';
export type { RepeatType };

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

// 루틴 내 개별 항목 (시간 + 내용)
export type HealthEntry = {
  id: string;       // 고유 ID (Date.now().toString())
  time: string;     // 시간 (예: "07:00", "19:30")
  desc: string;     // 내용 (예: "30분 러닝", "단백질 식단")
};

export type HealthRoutine = {
  id: string;
  icon: string;
  name: string;
  type: HealthType;
  schedule: string;
  entries: HealthEntry[];  // 시간별 세부 항목
  repeatDays?: number[];
  goal?: string;
  active: boolean;
  showInToday?: boolean; // TODAY 탭 노출 여부 (Habits와 동일)
  repeatType?: RepeatType;
  time?: string;
  alarm?: boolean;
  date?: string;
  weekdays?: number[];
  createdAt: string;
  updatedAt: string;
};
