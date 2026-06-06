// 뷰티박스 제품 도메인 카테고리
export type ProductDomain = 'beauty' | 'fashion' | 'acc' | 'health';

// 뷰티 서브카테고리 (box/data.boxCats.beauty)
export type BeautySubCategory = 'skincare' | 'makeup';

// 사용 빈도 타입
export type FrequencyType = 'daily' | 'weekly' | 'per_week' | 'as_needed';

export interface Product {
  id: string;
  name: string;
  brand?: string;
  domain: ProductDomain;
  subCategory?: string;         // 서브 카테고리 키 (예: "skincare", "makeup")
  category?: string;            // 세부 카테고리 (예: "토너", "세럼", "에센스")

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

  // 개수 기반 소비 기간 (itemUnit==='개' 일 때 사용)
  // totalCount = packageCount × unitPerPackage, 이 개수로 몇 개월 사용하는지
  // → dosePerUse = totalAmount / (usageDurationMonths * 30) 으로 역산해서 저장
  usageDurationMonths?: number; // 총 사용 기간 (개월), 미입력 시 undefined

  // 잔여량
  currentRemaining: number;

  // 날짜 (ISO date string: "YYYY-MM-DD")
  purchaseDate?: string;
  startDate?: string;
  expiryDate?: string;

  // 이미지
  imageUrl?: string;     // Firebase Storage URL (신규) 또는 Cloudinary URL (구 box.html 마이그레이션)
  storageUrl?: string;   // 레거시 필드 — 구 box.html 마이그레이션 데이터 일부에 존재, imageUrl 없을 때 폴백
  storageImageUrl?: string; // 보관 장소 이미지 URL (신규)

  // 구매 정보
  price?: string;        // 가격 (예: "₩45,000")
  source?: string;       // 구매처 (예: "올리브영")
  purchaseUrl?: string;  // 구매 링크

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
