// 사용 기록 타입
export type UsageType = 'use' | 'manual_adjust' | 'skip';

// Firestore: users/{uid}/usageLogs/{logId}
export interface UsageLog {
  id: string;
  routineId?: string;           // 연결된 루틴 세션 ID (선택)
  productId: string;
  loggedAt: string;             // ISO datetime (사용 시각)
  amount?: number;              // 사용량 (단위: Product.itemUnit)
  type: UsageType;
  note?: string;                // 컨디션/메모 (선택)
}

// Firestore: users/{uid}/moodLogs/{logId}
export interface MoodLog {
  id: string;
  date: string;                 // ISO date "YYYY-MM-DD"
  moodScore: 1 | 2 | 3 | 4 | 5;
  color?: string;               // 피부 컨디션 색상 태그
  note?: string;
}
