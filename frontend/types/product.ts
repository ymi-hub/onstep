// 뷰티박스 제품 도메인 카테고리
export type ProductDomain = 'beauty' | 'fashion' | 'acc';

// 뷰티 서브카테고리 (box/data.boxCats.beauty)
export type BeautySubCategory = 'skincare' | 'makeup';

// 사용 빈도 타입
export type FrequencyType = 'daily' | 'weekly' | 'per_week' | 'as_needed';

export interface Product {
  id: string;
  name: string;
  brand?: string;
  domain: ProductDomain;
  subCategory?: string;         // 서브 카테고리 키 (예: "skincare", "makeup", "custom")

  // 용량 정보 (잔여량 계산용)
  packageCount: number;         // 총 패키지 수 (예: 2개)
  unitPerPackage: number;       // 패키지당 용량 (예: 150)
  itemUnit: string;             // 단위 (예: "ml", "g", "개")
  totalAmount: number;          // 총 용량 — 계산값: packageCount * unitPerPackage

  // 사용 패턴
  dosePerUse: number;           // 1회 사용량
  usesPerDay: number;           // 하루 사용 횟수
  frequencyType: FrequencyType;
  frequencyValue?: number;      // 주 N회인 경우 N

  // 잔여량
  currentRemaining: number;

  // 날짜 (ISO date string: "YYYY-MM-DD")
  purchaseDate?: string;
  startDate?: string;
  expiryDate?: string;

  // 보관 위치
  boxLocation?: string;

  // 메타데이터 (ISO datetime string)
  createdAt: string;
  updatedAt: string;
}

// 잔여량 계산 결과
export interface RemainingStats {
  remainingDays: number;        // 예상 잔여 일수
  dailyUsage: number;           // 일일 소비량
  estimatedEndDate: string;     // 예상 소진 날짜
  fillRate: number;             // 잔여량 비율 (0~1)
}
