// 구버전 Firestore 데이터 → 현재 포맷 자동 변환
// 데이터를 건드리지 않고 메모리상에서만 변환 (Firestore 쓰기 없음)

import type { Session, SlotDay, RoutineItem } from '@/types/routine';

/** 구버전 슬롯 raw → SlotDay[] */
export function migrateRawSlot(raw: unknown): SlotDay[] {
  const s = raw as Record<string, unknown>;
  if (Array.isArray(s.days)) return s.days as SlotDay[];
  const items: RoutineItem[] = Array.isArray(s.items) ? s.items as RoutineItem[] : [];
  if (Array.isArray(s.phases)) {
    const ph = s.phases as Array<{ productIds?: string[]; instruction?: string }>;
    ph.forEach((p, i) => {
      (p.productIds ?? []).forEach((id) => items.push({ type: 'product', id }));
      if (p.instruction) items.push({ type: 'desc', text: p.instruction });
      if (i < ph.length - 1) items.push({ type: 'plus' });
    });
  }
  return [{ id: 1, items, tipItems: [], expertTip: (s.expertTip as string) ?? '' }];
}

/** Firestore 문서 raw → Session (구버전 포맷 자동 변환) */
export function migrateSession(raw: Record<string, unknown>, id: string): Session {
  const r = raw;
  if (r.morning && (r.morning as Record<string, unknown>).days) {
    return { id, ...(r as Omit<Session, 'id'>) };
  }
  if (Array.isArray(r.days)) {
    const days = r.days as Array<{ dayNumber: number; morning: unknown; evening: unknown }>;
    return {
      id,
      sessionNumber: r.sessionNumber as number,
      startDate: (r.startDate as string) ?? '',
      endDate: (r.endDate as string) ?? '',
      morningTime: (r.morningTime as string) ?? '07:30',
      eveningTime: (r.eveningTime as string) ?? '22:00',
      morning: { days: days.map((d, i) => ({ ...migrateRawSlot(d.morning)[0], id: i + 1 })) },
      evening: { days: days.map((d, i) => ({ ...migrateRawSlot(d.evening)[0], id: i + 1 })) },
      createdAt: (r.createdAt as string) ?? '',
      updatedAt: (r.updatedAt as string) ?? '',
    };
  }
  return {
    id,
    sessionNumber: (r.sessionNumber as number) ?? 1,
    startDate: (r.startDate as string) ?? '',
    endDate: (r.endDate as string) ?? '',
    morningTime: (r.morningTime as string) ?? '07:30',
    eveningTime: (r.eveningTime as string) ?? '22:00',
    morning: { days: [{ id: 1, items: [], tipItems: [], expertTip: '' }] },
    evening: { days: [{ id: 1, items: [], tipItems: [], expertTip: '' }] },
    createdAt: (r.createdAt as string) ?? '',
    updatedAt: (r.updatedAt as string) ?? '',
  };
}
