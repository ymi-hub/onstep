import type { RoutineItem } from './routine';

export type CtType = 'care' | 'makeup' | 'lookbook' | 'log';

export type CtItem = {
  id: string;
  ctType: CtType;
  emoji: string;
  name: string;
  desc: string;
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
