// 다이어트 식단 플랜

export type DietItem = {
  id: string;
  name: string;    // "파워칵테일", "웨이"
  qty: string;     // "2", "40", "1/2"
};

// 타임라인 슬롯 (시간대별 섭취)
export type DietSlot = {
  id: string;
  time?: string;       // "08:00" | undefined(공복시)
  timeStart?: string;  // 공복 슬롯 TODAY 표시 시작 "10:00"
  timeEnd?: string;    // 공복 슬롯 TODAY 표시 종료 "14:00"
  label: string;       // "아침 식사시", "+1시간후", "공복시"
  water: number;       // ml
  items: DietItem[];
  isWarning?: false;
};

// 경고 배너
export type DietWarning = {
  id: string;
  text: string;        // "공복 유지 4~5시간 꼭!! 지켜주세요!!"
  isWarning: true;
};

export type DietTimelineItem = DietSlot | DietWarning;

// 날짜 범위별 패턴
export type DietPattern = {
  id: string;
  label: string;       // "패턴 1 (1~3일)"
  dayStart: number;    // 1
  dayEnd: number;      // 3
  timeline: DietTimelineItem[];
};

// 전체 다이어트 프로그램
export type DietProgram = {
  id: string;
  name: string;        // "2주 다이어트"
  icon: string;        // 🥗
  startDate: string;   // "2026-06-01" — 시작일 기준 D-day 계산
  patterns: DietPattern[];
  active: boolean;
  showInToday: boolean;
  createdAt: string;
  updatedAt: string;
};

// 오늘 완료 기록
export type DietLog = {
  id: string;
  programId: string;
  slotId: string;
  dateStr: string;     // "2026-06-05"
  completedAt: string;
};
