// 칩 스트립 아이템 타입
export type RoutineItem =
  | { type: 'product'; id: string }
  | { type: 'desc'; text: string }
  | { type: 'tip'; text: string }
  | { type: 'plus' }
  | { type: 'minus' };

// 슬롯(아침/저녁)의 단일 DAY 데이터
export interface SlotDay {
  id: number;            // 1, 2, 3
  items: RoutineItem[];  // 메인 아이템 매핑
  tipItems: RoutineItem[]; // TIP 섹션 (Today에 조건부 표시)
  expertTip: string;     // EXPERT TIP 텍스트
}

// 아침 or 저녁 슬롯 전체 (여러 DAY 포함)
export interface Slot {
  days: SlotDay[];
}

// 케어플랜 세션 전체
export interface Session {
  id: string;
  sessionNumber: number;
  startDate: string;    // "YYYY-MM-DD"
  endDate: string;
  morningTime: string;  // "07:30"
  eveningTime: string;
  morning: Slot;        // 아침 슬롯 (독립 DAY 탭)
  evening: Slot;        // 저녁 슬롯 (독립 DAY 탭)
  createdAt: string;
  updatedAt: string;
}
