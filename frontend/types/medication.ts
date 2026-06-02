import type { RepeatType } from './habit';
export type { RepeatType };

// 약 복용 루틴
export type MedTime = 'morning' | 'lunch' | 'evening' | 'bedtime';

export const MED_TIME_LABELS: Record<MedTime, string> = {
  morning: '아침',
  lunch:   '점심',
  evening: '저녁',
  bedtime: '취침 전',
};

export type MedRoutine = {
  id: string;
  icon: string;        // 이모지 (기본 💊)
  name: string;        // 약 이름
  dosage: string;      // 용량 (예: 1정, 2캡슐)
  times: MedTime[];    // 복용 시간대 (복수 선택)
  startDate?: string;  // 시작일
  endDate?: string;    // 종료일 (처방 기간)
  note?: string;       // 주의사항
  active: boolean;     // 활성 여부
  showInToday?: boolean; // TODAY 화면 노출 여부
  repeatType?: RepeatType;
  time?: string;
  alarm?: boolean;
  date?: string;
  weekdays?: number[];
  createdAt: string;
  updatedAt: string;
};
