import type { RepeatType } from './habit';
export type { RepeatType };

// interval 반복의 단위 (N일 / N주 / N개월 / N년)
export type IntervalUnit = 'day' | 'week' | 'month' | 'year';

// interval 프리셋 레이블
export const INTERVAL_PRESETS: { label: string; unit: IntervalUnit; value: number }[] = [
  { label: '매주',  unit: 'week',  value: 1  },
  { label: '매월',  unit: 'month', value: 1  },
  { label: '분기',  unit: 'month', value: 3  },
  { label: '반기',  unit: 'month', value: 6  },
  { label: '1년',   unit: 'year',  value: 1  },
];

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

  // ── interval 반복 전용 필드 (repeatType === 'interval') ──
  intervalUnit?: IntervalUnit;   // 반복 단위 (week / month / year 등)
  intervalValue?: number;        // 반복 값 (1 → 매주, 3 → 분기별)
  lastDoneDate?: string;         // 마지막 완료일 "YYYY-MM-DD"
  dueSoonDays?: number;          // 며칠 전부터 TODAY에 표시 (기본 3)
};
