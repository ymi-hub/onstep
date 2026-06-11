import type { RoutineItem } from './routine';

export type CtType = 'care' | 'makeup' | 'lookbook' | 'log';

// BOX 도메인 → 라이브러리 탭 라벨 매핑
export const DOMAIN_LABELS: Record<string, string> = {
  beauty:   '메이크업',
  fashion:  '룩북',
  acc:      '악세서리',
  interior: '인테리어',
};

export type CtItem = {
  id: string;
  ctType: CtType;
  domain?: string;   // BOX 도메인 (예: 'beauty', 'fashion', 'interior') — 동적 탭 생성 기준
  emoji: string;
  name: string;
  desc: string;
  category?: string;            // 집중케어 카테고리 (예: '열감', '수분', '알러지', '트러블')
  items: RoutineItem[];
  tipItems: RoutineItem[];
  expertTip?: string;
  imageUrl?: string;
  sourceUrl?: string;
  daily?: string;
  periodStart?: string;
  periodEnd?: string;
  dates?: string[];
  tpo?: string[];
  tags?: string[];
  published: boolean;
  order?: number;
  createdAt: string;
  updatedAt: string;
};
