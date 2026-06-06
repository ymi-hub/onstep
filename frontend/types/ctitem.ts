import type { RoutineItem } from './routine';

export type CtType = 'care' | 'makeup' | 'lookbook' | 'log';

export type CtItem = {
  id: string;
  ctType: CtType;
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
  published: boolean;
  createdAt: string;
  updatedAt: string;
};
