// 루틴 시간대
export type RoutineTime = 'morning' | 'evening';

// 제품 적용 방식
export type MixMethod = 'single' | 'mix' | 'sequence';

// 루틴 1단계 (여러 제품을 한 번에 적용하는 단위)
export interface RoutinePhase {
  order: number;                // 단계 순서 (1부터 시작)
  productIds: string[];         // 이 단계에서 사용하는 제품 ID 목록
  instruction: string;          // 단계별 사용법 (예: "얇게 한 겹 도포")
  mixMethod?: MixMethod;        // 적용 방식
  waitMinutes?: number;         // 다음 단계 전 대기 시간(분)
}

// 루틴 슬롯 (아침/저녁 × DAY N)
export interface RoutineStep {
  time: RoutineTime;
  phases: RoutinePhase[];
}

// 특정 DAY의 루틴 구성
export interface RoutineDay {
  dayNumber: number;            // DAY 1, DAY 2, ...
  steps: RoutineStep[];
}

// 케어플랜 세션 전체
export interface Routine {
  id: string;
  sessionNumber: number;        // 회차 (예: 1, 2, ...)
  startDate: string;            // 세션 시작일 (ISO date: "YYYY-MM-DD")
  endDate: string;              // 세션 종료일
  morningTime: string;          // 아침 루틴 알람 시각 (예: "07:30")
  eveningTime: string;          // 저녁 루틴 알람 시각 (예: "22:00")
  days: RoutineDay[];
  // 메타데이터 (ISO datetime string)
  createdAt: string;
  updatedAt: string;
}

// 오늘의 루틴 체크리스트 아이템
export interface TodayCheckItem {
  phaseOrder: number;
  productIds: string[];
  instruction: string;
  isCompleted: boolean;
  completedAt?: string;         // ISO datetime
}
