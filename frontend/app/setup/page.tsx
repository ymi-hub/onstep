// app/setup/page.tsx — SETUP 페이지 (루틴 케어 플랜 편집)
//
// 💡 이 파일의 구조:
//   1. 타입 정의 + 상수
//   2. 공통 UI (Appbar, BackButton)
//   3. HubView — 메인 허브 화면 (2열 카드 그리드)
//   4. SessionsView — 루틴 세션 목록
//   5. EditorView — 세션 편집 (칩 스트립 방식)
//   6. SetupPage — 메인 컴포넌트 (상태 관리 + Firestore CRUD)

'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  type User,
} from 'firebase/auth';
import {
  collection,
  query,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  orderBy,
} from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import type { Product } from '@/types/product';
import type { RoutineItem, SlotDay, Slot } from '@/types/routine';
import ExpertTipField, { buildExpertTipHtml } from '@/components/ExpertTipField';
import SearchBar from '@/components/SearchBar';

// ─── 타입 정의 ───────────────────────────────────────────────────────────────

type View = 'hub' | 'sessions' | 'editor' | 'tracker' | 'care' | 'makeup' | 'lookbook';

type RepeatType = 'allday' | 'once' | 'daily' | 'scheduled';

type Habit = {
  id: string;
  icon: string;
  name: string;
  repeatType: RepeatType;
  time: string;
  alarm: boolean;
  date?: string;
  weekdays?: number[];
  showInToday?: boolean;  // TODAY 화면에 노출 여부 (수동 선택)
  createdAt: string;
  updatedAt: string;
};

type CtType = 'care' | 'makeup' | 'lookbook';

type CtItem = {
  id: string;
  ctType: CtType;
  emoji: string;
  name: string;
  desc: string;
  items: RoutineItem[];
  tipItems: RoutineItem[];
  expertTip?: string;
  periodStart?: string;
  periodEnd?: string;
  dates?: string[];
  tpo?: string[];
  published: boolean;
  createdAt: string;
  updatedAt: string;
};

// Firestore 세션 (MORNING/EVENING 각각 독립 DAY 슬롯)
type Session = {
  id: string;
  sessionNumber: number;
  sessionTag?: string;   // 예: "관리실 3회", "4회관리"
  startDate: string;
  endDate: string;
  morningTime: string;
  eveningTime: string;
  morning: Slot;
  evening: Slot;
  createdAt: string;
  updatedAt: string;
};

type EditorDraft = {
  id: string | null;
  sessionNumber: number;
  sessionTag: string;    // 예: "관리실 3회" (없으면 빈 문자열)
  startDate: string;
  endDate: string;
  morningTime: string;
  eveningTime: string;
  morning: Slot;
  evening: Slot;
};

// ─── 상수 / 헬퍼 ─────────────────────────────────────────────────────────────

const FALLBACK_USER_ID = 'demo-user';

function emptySlotDay(id: number): SlotDay {
  return { id, items: [], tipItems: [], expertTip: '' };
}

function emptySlot(): Slot {
  return { days: [emptySlotDay(1)] };
}

function newDraft(sessionNum: number): EditorDraft {
  return {
    id: null,
    sessionNumber: sessionNum,
    sessionTag: '',
    startDate: '',
    endDate: '',
    morningTime: '07:30',
    eveningTime: '22:00',
    morning: emptySlot(),
    evening: emptySlot(),
  };
}

// "YYYY-MM-DD" → "M월 D일"
function fmtDate(s: string) {
  if (!s) return '—';
  const [, m, d] = s.split('-').map(Number);
  return `${m}월 ${d}일`;
}

// 구버전 슬롯 데이터 → SlotDay 배열로 변환 (공통 유틸)
function migrateRawSlot(raw: unknown): SlotDay[] {
  const s = raw as Record<string, unknown>;

  // 최신 포맷: days 배열 존재
  if (Array.isArray(s.days)) return s.days as SlotDay[];

  // 중간 포맷: items 배열 (DaySlot) - days 없음
  if (Array.isArray(s.items)) {
    return [{ id: 1, items: s.items as RoutineItem[], tipItems: [], expertTip: (s.expertTip as string) ?? '' }];
  }

  // 구 포맷: phases 배열
  if (Array.isArray(s.phases)) {
    const items: RoutineItem[] = [];
    const phases = s.phases as Array<{ productIds?: string[]; instruction?: string }>;
    phases.forEach((phase, i) => {
      (phase.productIds ?? []).forEach((id) => items.push({ type: 'product', id }));
      if (phase.instruction) items.push({ type: 'desc', text: phase.instruction });
      if (i < phases.length - 1) items.push({ type: 'plus' });
    });
    return [{ id: 1, items, tipItems: [], expertTip: '' }];
  }

  return [emptySlotDay(1)];
}

// Firestore 문서 → Session (모든 구버전 포맷 호환)
function migrateSession(raw: Record<string, unknown>, id: string): Session {
  const r = raw as Record<string, unknown>;

  // 최신 포맷: morning.days, evening.days 존재
  if (r.morning && (r.morning as Record<string, unknown>).days) {
    return { id, ...(r as Omit<Session, 'id'>) };
  }

  // 구 포맷: days 배열 (RoutineDay[])
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
    sessionTag: (r.sessionTag as string) ?? undefined,
    startDate: (r.startDate as string) ?? '',
    endDate: (r.endDate as string) ?? '',
    morningTime: (r.morningTime as string) ?? '07:30',
    eveningTime: (r.eveningTime as string) ?? '22:00',
    morning: emptySlot(),
    evening: emptySlot(),
    createdAt: (r.createdAt as string) ?? '',
    updatedAt: (r.updatedAt as string) ?? '',
  };
}

// ─── 공통 앱바 ───────────────────────────────────────────────────────────────
function Appbar({
  left,
  center,
  right,
}: {
  left?: React.ReactNode;
  center?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
        height: 56,
        background: 'rgba(250,250,248,.92)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(12,12,10,.07)',
        flexShrink: 0,
      }}
    >
      <div style={{ minWidth: 48, display: 'flex', alignItems: 'center' }}>{left}</div>
      <div
        style={{
          fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif",
          fontSize: 14,
          fontWeight: 700,
          letterSpacing: '.04em',
          textTransform: 'uppercase',
          color: '#0C0C0A',
        }}
      >
        {center}
      </div>
      <div style={{ minWidth: 48, display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
        {right}
      </div>
    </div>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#0C0C0A', display: 'flex', alignItems: 'center' }}
      aria-label="뒤로"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 12H5M12 5l-7 7 7 7" />
      </svg>
    </button>
  );
}

// ─── HUB 뷰 ─────────────────────────────────────────────────────────────────
function HubView({ onOpenSessions, onOpenTracker, onOpenCare, onOpenMakeup, onOpenLookbook }: {
  onOpenSessions: () => void;
  onOpenTracker: () => void;
  onOpenCare: () => void;
  onOpenMakeup: () => void;
  onOpenLookbook: () => void;
}) {
  const cards = {
    left: [
      { id: 'routine', badge: '#SESSION', title: 'ROUTINE SETUP', sub: 'DAILY CALIBRATIONS', cta: 'View Steps →', bg: 'linear-gradient(135deg,#f0ffe0 0%,#c5ff00 100%)', emoji: '🌿', onClick: onOpenSessions, href: undefined },
      { id: 'tracker', badge: '#DAILY', title: 'HABITS', sub: 'DAILY TRACKING', cta: 'Manage →', bg: 'linear-gradient(135deg,#f5ffe0 0%,#dcff80 100%)', emoji: '⏰', onClick: onOpenTracker, href: undefined },
      { id: 'look', badge: '#LOOKBOOK', title: 'PLANNING', sub: 'QUARTERLY VISION', cta: 'Curate Days →', bg: 'linear-gradient(135deg,#fff0f5 0%,#ffc0d0 100%)', emoji: '👗', onClick: onOpenLookbook, href: undefined },
    ],
    right: [
      { id: 'ai-import', badge: '#AI', title: 'AI 가져오기', sub: 'TEXT → ROUTINE', cta: '텍스트 붙여넣기 →', bg: 'linear-gradient(135deg,#f0ffe0 0%,#d8ffaa 100%)', emoji: '✨', onClick: null, href: '/import' },
      { id: 'makeup', badge: '#MAKEUP', title: 'STRATEGY', sub: 'IDENTITY FRAMEWORK', cta: 'Reconstruct →', bg: 'linear-gradient(135deg,#f5f0ff 0%,#d0b0ff 100%)', emoji: '💄', onClick: onOpenMakeup, href: undefined },
      { id: 'care', badge: '#INTENSIVE', title: 'SPECIAL CARE', sub: 'CRITICAL SYSTEMS', cta: 'Intervene →', bg: 'linear-gradient(135deg,#f0f8ff 0%,#a0c8ff 100%)', emoji: '🧴', onClick: onOpenCare, href: undefined },
    ],
  };

  type HubCardData = { id: string; badge: string; title: string; sub: string; cta: string; bg: string; emoji: string; onClick: (() => void) | null; href: string | undefined };
  function HubCard({ card }: { card: HubCardData }) {
    const isClickable = !!card.onClick || !!card.href;
    const cardStyle = {
      background: '#FFFFFF', border: '1px solid rgba(12,12,10,.07)', borderRadius: 16,
      overflow: 'hidden', cursor: isClickable ? 'pointer' : 'default',
      opacity: isClickable ? 1 : 0.55,
      boxShadow: '0 1px 2px rgba(0,0,0,.04),0 0 0 1px rgba(0,0,0,.03)',
      transition: 'transform .15s', textDecoration: 'none', display: 'block',
    };
    const cardContent = (
      <>
        <div style={{ width: '100%', aspectRatio: '1/1.5', background: card.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40 }}>{card.emoji}</div>
        <div style={{ padding: '10px 12px 0' }}>
          <div style={{ display: 'inline-block', fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: '.1em', background: '#C5FF00', color: '#0C0C0A', padding: '3px 8px', borderRadius: 4, marginBottom: 7, textTransform: 'uppercase' }}>{card.badge}</div>
          <div style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 14, fontWeight: 800, color: '#0C0C0A', lineHeight: 1.2, marginBottom: 3, letterSpacing: '-.01em' }}>{card.title}</div>
          <div style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: '#9A9490', paddingBottom: 10 }}>{card.sub}</div>
        </div>
        <div style={{ borderTop: '1px solid rgba(12,12,10,.07)', padding: '10px 12px', fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 12, fontWeight: 600, color: '#0C0C0A' }}>{card.cta}</div>
      </>
    );
    if (card.href) return <Link href={card.href} style={cardStyle}>{cardContent}</Link>;
    return <div onClick={card.onClick ?? undefined} style={cardStyle}>{cardContent}</div>;
  }

  return (
    <div style={{ background: '#FAFAF8', minHeight: '100%' }}>
      <div style={{ padding: '28px 16px 20px', borderBottom: '1px solid rgba(12,12,10,.07)' }}>
        <div style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 11, fontWeight: 600, letterSpacing: '.16em', textTransform: 'uppercase', color: '#9A9490', marginBottom: 4 }}>CONFIGURATION</div>
        <div>
          <div style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 60, fontWeight: 900, color: '#0C0C0A', lineHeight: 0.9, letterSpacing: '-.02em' }}>Setup</div>
          <div style={{ width: 40, height: 4, background: '#C5FF00', borderRadius: 2, marginTop: 8 }} />
        </div>
        <div style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 12, color: '#9A9490', marginTop: 14, lineHeight: 1.6 }}>Let&apos;s start today and tomorrow</div>
      </div>
      <div style={{ padding: '24px 16px 8px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{cards.left.map((c) => <HubCard key={c.id} card={c as HubCardData} />)}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 64 }}>{cards.right.map((c) => <HubCard key={c.id} card={c as HubCardData} />)}</div>
      </div>
      <div style={{ height: 100 }} />
    </div>
  );
}

// ─── SESSIONS 뷰 ─────────────────────────────────────────────────────────────
function SessionsView({
  sessions, products, loading, onBack, onNew, onEdit, onUpdateNumber,
}: {
  sessions: Session[];
  products: Product[];
  loading: boolean;
  onBack: () => void;
  onNew: () => void;
  onEdit: (s: Session) => void;
  onUpdateNumber: (id: string, num: number) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const font = "'Plus Jakarta Sans','Space Grotesk',sans-serif";

  // 검색 필터: 회차 번호 또는 태그
  const filteredSessions = search.trim()
    ? sessions.filter(s => {
        const q = search.toLowerCase();
        return String(s.sessionNumber).includes(q) || (s.sessionTag ?? '').toLowerCase().includes(q);
      })
    : sessions;

  // 제품 ID → 이름 조회
  function pName(id: string) {
    return products.find((p) => p.id === id)?.name ?? '?';
  }

  // 오늘 날짜가 세션 기간 안에 있으면 true
  function isActiveNow(s: Session) {
    if (!s.startDate || !s.endDate) return false;
    const now = new Date(); now.setHours(12, 0, 0, 0);
    const start = new Date(s.startDate); start.setHours(0, 0, 0, 0);
    const end = new Date(s.endDate); end.setHours(23, 59, 59, 999);
    return now >= start && now <= end;
  }

  // 슬롯 전체 DAY에서 제품 아이템 추출
  function slotProds(slot: Slot): { type: 'product'; id: string }[] {
    return slot.days.flatMap(d =>
      d.items.filter((i): i is { type: 'product'; id: string } => i.type === 'product')
    );
  }

  // 특정 DAY 슬롯에서 제품 추출 (detail 렌더용)
  function dayProds(day: SlotDay): { type: 'product'; id: string }[] {
    return day.items.filter((i): i is { type: 'product'; id: string } => i.type === 'product');
  }

  function toggle(id: string) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  // 단일 DAY 열 렌더링
  function DayCol({ day, isRight }: { day: SlotDay; isRight: boolean }) {
    const prods = dayProds(day);
    return (
      <div style={{
        flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4,
        ...(isRight
          ? { borderLeft: '1px solid rgba(12,12,10,.12)', paddingLeft: 10, marginLeft: -1 }
          : { paddingRight: 10 }),
      }}>
        {/* DAY 뱃지 */}
        <div style={{ fontFamily: font, fontSize: 10, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase' as const, color: '#9A9490', marginBottom: 4 }}>
          DAY {day.id}
        </div>
        {/* 제품 수 */}
        <div style={{ fontFamily: font, fontSize: 10, fontWeight: 700, color: '#BCBAB6', letterSpacing: '.06em', textAlign: 'right', marginBottom: 4 }}>
          {prods.length} STEPS
        </div>
        {/* 제품명 목록 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {prods.map((item, idx) => (
            <div key={idx} style={{ fontFamily: font, fontSize: 11, color: '#0C0C0A', padding: '4px 6px', background: '#FAFAF8', border: '1px solid rgba(12,12,10,.07)', borderRadius: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
              {pName(item.id)}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // 슬롯별 제품 목록 섹션 렌더링 (DAY 1/2 좌우 비교, DAY 3 아래)
  function SlotSection({ icon, label, slot }: {
    icon: string; label: string; slot: Slot;
  }) {
    const activeDays = slot.days.filter(d => dayProds(d).length > 0);
    if (activeDays.length === 0) return null;
    const total = activeDays.reduce((n, d) => n + dayProds(d).length, 0);
    const firstRow = activeDays.slice(0, 2);  // DAY 1 + DAY 2 좌우 배치
    const extraRows = activeDays.slice(2);    // DAY 3 이상은 아래에

    return (
      <div style={{ background: '#fff', border: '1px solid rgba(12,12,10,.07)', borderRadius: 12, padding: 14, marginBottom: 10, boxShadow: '0 1px 2px rgba(0,0,0,.04)' }}>
        {/* 슬롯 헤더 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, borderBottom: '1px solid rgba(12,12,10,.07)', paddingBottom: 8, marginBottom: 12 }}>
          <span style={{ fontFamily: font, fontSize: 12, fontWeight: 800, letterSpacing: '.12em', textTransform: 'uppercase' as const, color: '#9A9490' }}>
            {icon} {label}
          </span>
          <span style={{ marginLeft: 'auto', fontFamily: font, fontSize: 11, fontWeight: 700, color: '#BCBAB6' }}>
            {total} items
          </span>
        </div>

        {/* DAY 1 + DAY 2 좌우 비교 */}
        {firstRow.length === 1 ? (
          // 단일 DAY: 전체 너비
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {dayProds(firstRow[0]).map((item, idx) => (
              <div key={idx} style={{ fontFamily: font, fontSize: 11, color: '#0C0C0A', padding: '4px 6px', background: '#FAFAF8', border: '1px solid rgba(12,12,10,.07)', borderRadius: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                {pName(item.id)}
              </div>
            ))}
          </div>
        ) : (
          // 2개 이상: 좌우 비교
          <div style={{ display: 'flex', gap: 0, alignItems: 'flex-start' }}>
            {firstRow.map((day, i) => <DayCol key={day.id} day={day} isRight={i > 0} />)}
          </div>
        )}

        {/* DAY 3 이상: 아래에 추가 */}
        {extraRows.map((day) => (
          <div key={day.id} style={{ marginTop: 10, borderTop: '1px solid rgba(12,12,10,.06)', paddingTop: 10 }}>
            <DayCol day={day} isRight={false} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div style={{ position: 'fixed', top: 0, bottom: 0, left: 'max(0px,calc(50vw - 215px))', right: 'max(0px,calc(50vw - 215px))', zIndex: 100, background: '#FAFAF8', display: 'flex', flexDirection: 'column', overflowY: 'hidden' }}>
      <Appbar left={<BackButton onClick={onBack} />} center="ROUTINE SETUP" />
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* 헤더 */}
        <div style={{ padding: '20px 16px 16px', borderBottom: '1px solid rgba(12,12,10,.07)' }}>
          <div style={{ fontFamily: font, fontSize: 11, fontWeight: 700, letterSpacing: '.18em', textTransform: 'uppercase', color: '#9A9490', marginBottom: 8 }}>CARE ROUTINES</div>
          <div style={{ fontFamily: font, fontSize: 28, fontWeight: 800, color: '#0C0C0A', lineHeight: 1 }}>
            {loading ? '...' : sessions.length > 0 ? `${sessions.length} SESSIONS` : 'NO SESSIONS'}
          </div>
        </div>

        {/* 검색 바 */}
        <SearchBar value={search} onChange={setSearch} placeholder="회차 번호 · 태그 검색..." />

        {/* 새 세션 버튼 */}
        <div style={{ padding: '12px 16px 8px' }}>
          <button onClick={onNew} style={{ width: '100%', padding: 14, border: '1.5px dashed rgba(12,12,10,.14)', borderRadius: 12, background: 'none', fontFamily: font, fontSize: 12, fontWeight: 700, letterSpacing: '.06em', color: '#9A9490', cursor: 'pointer' }}>
            + 새 스킨케어 루틴 설정
          </button>
        </div>

        {loading ? (
          <div style={{ padding: '48px 16px', textAlign: 'center', color: '#9A9490', fontFamily: font, fontSize: 13 }}>로딩 중...</div>
        ) : (
          <div>
            {filteredSessions.length === 0 && search.trim() ? (
              <div style={{ padding: '36px 16px', textAlign: 'center', fontFamily: font, fontSize: 13, color: '#9A9490' }}>
                &ldquo;{search}&rdquo; 검색 결과 없음
              </div>
            ) : null}
            {filteredSessions.map((s) => {
              const isExpanded = expandedId === s.id;
              const isNow = isActiveNow(s);
              const morningCount = slotProds(s.morning).length;
              const eveningCount = slotProds(s.evening).length;

              return (
                <div key={s.id}>
                  {/* 세션 행 — 클릭하면 드롭다운 열림 */}
                  <div
                    onClick={() => toggle(s.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '12px 16px',
                      borderBottom: isExpanded ? 'none' : '1px solid rgba(12,12,10,.07)',
                      cursor: 'pointer',
                      background: isNow ? '#C5FF00' : 'transparent',
                      transition: 'background .12s',
                    }}
                  >
                    {/* 회차 번호 */}
                    <div style={{ fontFamily: font, fontSize: 22, fontWeight: 400, letterSpacing: '.04em', color: isNow ? '#5f6762' : '#C8C8C8', minWidth: 36, textAlign: 'right', flexShrink: 0 }}>
                      #{String(s.sessionNumber).padStart(2, '0')}
                    </div>

                    {/* 정보 */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: font, fontSize: 20, fontWeight: 400, color: '#0C0C0A', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' as const }}>
                        {/* 목록에서는 회차를 읽기 전용으로 표시 — 편집은 에디터에서 */}
                        {s.sessionNumber}회차 스킨케어
                        {s.sessionTag && (
                          <span style={{ fontFamily: font, fontSize: 11, fontWeight: 700, letterSpacing: '.04em', background: '#E8F5CC', color: '#4E7D00', padding: '2px 8px', borderRadius: 6, flexShrink: 0, border: '1px solid rgba(132,176,0,.3)' }}>{s.sessionTag}</span>
                        )}
                        {isNow && (
                          <span style={{ fontFamily: font, fontSize: 10, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase' as const, background: '#0C0C0A', color: '#C5FF00', padding: '2px 7px', borderRadius: 9999, flexShrink: 0 }}>NOW</span>
                        )}
                      </div>
                      <div style={{ fontFamily: font, fontSize: 13, color: '#777370', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                        {fmtDate(s.startDate)} – {fmtDate(s.endDate)}
                      </div>
                    </div>

                    {/* 오른쪽: 태그 + 시브론 */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                      {morningCount > 0 && (
                        <span style={{ fontFamily: font, fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 9999, background: isNow ? '#0C0C0A' : '#E4E2DC', color: isNow ? '#fff' : '#4A4846', whiteSpace: 'nowrap' as const }}>
                          ☀ {morningCount}
                        </span>
                      )}
                      {eveningCount > 0 && (
                        <span style={{ fontFamily: font, fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 9999, background: isNow ? '#0C0C0A' : '#E4E2DC', color: isNow ? '#fff' : '#4A4846', whiteSpace: 'nowrap' as const }}>
                          🌙 {eveningCount}
                        </span>
                      )}
                      <span style={{ color: '#9A9490', fontSize: 18, lineHeight: 1, transition: 'transform .2s', display: 'inline-block', transform: isExpanded ? 'rotate(90deg)' : 'none', flexShrink: 0 }}>›</span>
                    </div>
                  </div>

                  {/* 드롭다운 상세 — 아침/저녁 구성 + 편집 진입 */}
                  {isExpanded && (
                    <div style={{ padding: '14px 16px 16px', background: '#F4F4F0', borderBottom: '1px solid rgba(12,12,10,.07)' }}>
                      <SlotSection icon="☀️" label="아침 스킨케어" slot={s.morning} />
                      <SlotSection icon="🌙" label="저녁 스킨케어" slot={s.evening} />
                      {morningCount === 0 && eveningCount === 0 && (
                        <div style={{ fontFamily: font, fontSize: 12, color: '#9A9490', padding: '6px 0' }}>등록된 제품이 없습니다</div>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); onEdit(s); }}
                        style={{ width: '100%', marginTop: 12, padding: '12px', border: 'none', borderRadius: 12, background: '#0C0C0A', color: '#fff', fontFamily: font, fontSize: 12, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' as const, cursor: 'pointer' }}
                      >
                        편집 →
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <div style={{ height: 40 }} />
      </div>
    </div>
  );
}

// ─── EDITOR 뷰 ───────────────────────────────────────────────────────────────
// MORNING / EVENING 각각 독립 DAY 탭 + 아이템 매핑 + TIP 섹션 + EXPERT TIP
function EditorView({
  draft, setDraft, products, onBack, onSave, onSaveOnly, onDelete, saving,
}: {
  draft: EditorDraft;
  setDraft: React.Dispatch<React.SetStateAction<EditorDraft | null>>;
  products: Product[];
  onBack: () => void;
  onSave: () => void;      // 저장 + 목록 이동 (하단 버튼)
  onSaveOnly: () => void;  // 저장만, 화면 유지 (슬롯 중간 버튼)
  onDelete: () => void;
  saving: boolean;
}) {
  const f = "'Plus Jakarta Sans','Space Grotesk',sans-serif";

  // 슬롯별 활성 DAY 인덱스 (MORNING / EVENING 독립)
  const [activeDayIdx, setActiveDayIdx] = useState<{ morning: number; evening: number }>({ morning: 0, evening: 0 });

  // picker: { slot, section('main'|'tip') }
  type PickerTarget = { slot: 'morning' | 'evening'; section: 'main' | 'tip' };
  const [picker, setPicker] = useState<PickerTarget | null>(null);
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickerSelected, setPickerSelected] = useState<Set<string>>(new Set());

  // 인라인 입력: 슬롯 × 섹션 별
  type InputKey = { slot: 'morning' | 'evening'; section: 'main' | 'tip' };
  const [activeInput, setActiveInput] = useState<(InputKey & { type: 'desc' | 'tip' }) | null>(null);
  const [inputText, setInputText] = useState('');

  // 드래그 재정렬 상태
  type DragIdx = { slot: 'morning' | 'evening'; section: 'main' | 'tip'; idx: number };
  const [dragIdx, setDragIdx] = useState<DragIdx | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // 텍스트 입력 시 제품명 자동 하이라이팅
  const [highlightedProdIds, setHighlightedProdIds] = useState<Set<string>>(new Set());

  const filteredProducts = products.filter((p) => {
    if (!pickerSearch) return true;
    const q = pickerSearch.toLowerCase();
    return p.name.toLowerCase().includes(q) || (p.brand ?? '').toLowerCase().includes(q);
  });

  function productName(id: string): string {
    return products.find((p) => p.id === id)?.name ?? '?';
  }

  // 특정 슬롯·섹션·DAY 인덱스의 아이템 수정
  function updateSlotDay(
    slot: 'morning' | 'evening',
    dayIdx: number,
    updater: (day: SlotDay) => SlotDay
  ) {
    setDraft((d) => d && {
      ...d,
      [slot]: { days: d[slot].days.map((day, i) => i === dayIdx ? updater(day) : day) },
    });
  }

  function addItems(slot: 'morning' | 'evening', section: 'main' | 'tip', newItems: RoutineItem[]) {
    const dayIdx = activeDayIdx[slot];
    updateSlotDay(slot, dayIdx, (day) => ({
      ...day,
      items: section === 'main' ? [...day.items, ...newItems] : day.items,
      tipItems: section === 'tip' ? [...day.tipItems, ...newItems] : day.tipItems,
    }));
  }

  function removeItem(slot: 'morning' | 'evening', section: 'main' | 'tip', idx: number) {
    const dayIdx = activeDayIdx[slot];
    updateSlotDay(slot, dayIdx, (day) => ({
      ...day,
      items: section === 'main' ? day.items.filter((_, j) => j !== idx) : day.items,
      tipItems: section === 'tip' ? day.tipItems.filter((_, j) => j !== idx) : day.tipItems,
    }));
  }

  // 드래그 앤 드롭으로 아이템 위치 이동
  function moveItem(slot: 'morning' | 'evening', section: 'main' | 'tip', fromIdx: number, toIdx: number) {
    if (fromIdx === toIdx) return;
    const dayIdx = activeDayIdx[slot];
    updateSlotDay(slot, dayIdx, (day) => {
      const key = section === 'main' ? 'items' : 'tipItems';
      const arr = [...day[key]];
      const [moved] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, moved);
      return { ...day, [key]: arr };
    });
  }

  // 텍스트에서 제품명 매칭 → 하이라이트 Set 반환 (공용)
  // 로직:
  //   +, -, 공백, :, · 기준으로 토큰 분리
  //   각 토큰이 제품명과 정확히 일치하거나,
  //   제품명 + 한국어 조사 1-2자 (예: "라이지레이어드밤을" → "라이지레이어드밤" + "을") 이면 매칭
  //   startsWith 방향 사용 → 카테고리 단어 오매칭 방지
  //   (예: 토큰 "스킨케어"에서 제품 "케어"는 startsWith("케어")가 false라 매칭 안됨)
  function matchProductIds(text: string): Set<string> {
    if (!text.trim()) return new Set();
    const tokens = text.toLowerCase()
      .split(/[\s\+\-·,:]+/)
      .map(t => t.trim())
      .filter(Boolean);
    // 한국어 조사 (1자): 을,를,이,가,은,는,도,와,과,에,의,로,서,만,도
    const KO_PARTICLES = new Set(['을','를','이','가','은','는','도','와','과','에','의','로','서','만','랑','이랑']);
    const matched = products.filter((p) => {
      const name = p.name.toLowerCase().trim();
      if (!name) return false;
      return tokens.some(t => {
        if (t === name) return true;
        // 제품명 뒤에 한국어 조사 1자만 허용 (예: "쉬를"→"쉬", "라이지레이어드밤을"→"라이지레이어드밤")
        if (t.startsWith(name) && t.length === name.length + 1) {
          return KO_PARTICLES.has(t[t.length - 1]);
        }
        return false;
      });
    });
    return new Set(matched.map((p) => p.id));
  }

  // 아이템 추가용 인라인 텍스트 입력 처리 (메인 칩 스트립 하이라이팅)
  function handleTextInput(text: string) {
    setInputText(text);
    setHighlightedProdIds(matchProductIds(text));
  }

  // EXPERT TIP: 포커스 슬롯 추적 (편집 중 = textarea, 블러 = 하이라이팅 display)
  const [expertTipFocused, setExpertTipFocused] = useState<'morning' | 'evening' | null>(null);

  function setExpertTip(slot: 'morning' | 'evening', text: string) {
    const dayIdx = activeDayIdx[slot];
    updateSlotDay(slot, dayIdx, (day) => ({ ...day, expertTip: text }));
  }

  // DAY 추가/삭제 (슬롯별 독립, 최대 3개)
  function addSlotDay(slot: 'morning' | 'evening') {
    const nextId = draft[slot].days.length + 1;
    if (nextId > 3) return;
    setDraft((d) => d && { ...d, [slot]: { days: [...d[slot].days, emptySlotDay(nextId)] } });
    setActiveDayIdx((p) => ({ ...p, [slot]: draft[slot].days.length }));
  }

  function removeSlotDay(slot: 'morning' | 'evening', idx: number) {
    if (draft[slot].days.length <= 1) return;
    setDraft((d) => {
      if (!d) return d;
      const days = d[slot].days
        .filter((_, i) => i !== idx)
        .map((day, i) => ({ ...day, id: i + 1 }));
      return { ...d, [slot]: { days } };
    });
    setActiveDayIdx((p) => ({ ...p, [slot]: Math.min(p[slot], draft[slot].days.length - 2) }));
  }

  // picker 열기/확인
  function openPicker(slot: 'morning' | 'evening', section: 'main' | 'tip') {
    setPicker({ slot, section });
    setPickerSearch('');
    setPickerSelected(new Set());
  }

  function confirmPicker() {
    if (!picker) return;
    const newItems: RoutineItem[] = Array.from(pickerSelected).map((id) => ({ type: 'product', id }));
    if (newItems.length > 0) addItems(picker.slot, picker.section, newItems);
    setPicker(null);
  }

  // 인라인 텍스트 입력 확인
  function confirmInput() {
    if (!activeInput || !inputText.trim()) { setActiveInput(null); setInputText(''); setHighlightedProdIds(new Set()); return; }
    addItems(activeInput.slot, activeInput.section, [{ type: activeInput.type, text: inputText.trim() } as RoutineItem]);
    setActiveInput(null);
    setInputText('');
    setHighlightedProdIds(new Set());
  }

  function cancelInput() {
    setActiveInput(null);
    setInputText('');
    setHighlightedProdIds(new Set());
  }

  // ── 칩 컴포넌트 (드래그 재정렬 지원) ─────────────────────────────────────
  // ※ 함수로 직접 호출 (JSX 컴포넌트로 쓰면 EditorView 재렌더 시 리마운트 → 포커스 소실)
  function ItemChip(props: {
    item: RoutineItem; itemKey: number; isHighlighted?: boolean;
    isDragging: boolean; isDragOver: boolean; onRemove: () => void;
    onDragStart: (e: React.DragEvent) => void;
    onDragOver: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
  }) {
    const { item, itemKey, isHighlighted, isDragging, isDragOver, onRemove } = props;
    const delBtn = (
      <button
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        style={{ position: 'absolute', top: -8, right: -8, width: 18, height: 18, borderRadius: '50%', background: 'rgba(0,0,0,.28)', color: '#fff', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, cursor: 'pointer', zIndex: 1, lineHeight: 1 }}
        aria-label="제거"
      >×</button>
    );
    const drag = {
      draggable: true as const,
      onDragStart: props.onDragStart,
      onDragOver: props.onDragOver,
      onDrop: props.onDrop,
      onDragEnd: () => { setDragIdx(null); setDragOverIdx(null); },
    };
    const outline: React.CSSProperties = isDragOver
      ? { outline: '2px dashed #C5FF00', outlineOffset: 2 }
      : isHighlighted
      ? { outline: '2px solid #C5FF00', outlineOffset: 2 }
      : {};

    if (item.type === 'product') return (
      <div key={itemKey} {...drag} style={{ position: 'relative', flexShrink: 0, opacity: isDragging ? 0.35 : 1, borderRadius: 10, cursor: 'grab', ...outline }}>
        <div style={{ width: 72, height: 72, background: isHighlighted ? 'rgba(197,255,0,.12)' : '#fff', border: `1px solid ${isHighlighted ? 'rgba(132,176,0,.5)' : 'rgba(12,12,10,.07)'}`, borderRadius: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 6, transition: 'background .2s, border .2s' }}>
          <div style={{ width: 30, height: 30, borderRadius: 7, background: '#EEEDE9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, marginBottom: 5 }}>✦</div>
          <div style={{ fontFamily: f, fontSize: 10, color: '#0C0C0A', textAlign: 'center', lineHeight: 1.3, overflow: 'hidden', maxWidth: 60, wordBreak: 'break-all', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{productName(item.id)}</div>
        </div>{delBtn}
      </div>
    );
    if (item.type === 'desc') return (
      <div key={itemKey} {...drag} style={{ position: 'relative', flexShrink: 0, alignSelf: 'center', opacity: isDragging ? 0.35 : 1, borderRadius: 10, cursor: 'grab', ...outline }}>
        <div style={{ minWidth: 72, maxWidth: 150, height: 72, background: '#E8E6E0', border: '1px solid rgba(0,0,0,.06)', borderRadius: 10, padding: '8px 10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontFamily: f, fontSize: 12, color: '#0C0C0A', lineHeight: 1.35, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', wordBreak: 'break-word', textAlign: 'center' }}>{item.text}</div>
        </div>{delBtn}
      </div>
    );
    if (item.type === 'tip') return (
      <div key={itemKey} {...drag} style={{ position: 'relative', flexShrink: 0, alignSelf: 'center', opacity: isDragging ? 0.35 : 1, borderRadius: 10, cursor: 'grab', ...outline }}>
        <div style={{ minWidth: 72, maxWidth: 150, height: 72, background: 'rgba(197,255,0,.1)', border: '1.5px solid rgba(132,176,0,.4)', borderRadius: 10, padding: '8px 10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontFamily: f, fontSize: 12, fontWeight: 700, color: '#4E7D00', lineHeight: 1.35, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', wordBreak: 'break-word', textAlign: 'center' }}>{item.text}</div>
        </div>{delBtn}
      </div>
    );
    if (item.type === 'plus') return (
      <div key={itemKey} {...drag} style={{ position: 'relative', flexShrink: 0, opacity: isDragging ? 0.35 : 1, borderRadius: 10, cursor: 'grab', ...outline }}>
        <div style={{ width: 72, height: 72, border: '1.5px solid rgba(33,150,243,.4)', borderRadius: 10, background: 'rgba(33,150,243,.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, fontWeight: 300, color: '#1976D2' }}>+</div>{delBtn}
      </div>
    );
    return (
      <div key={itemKey} {...drag} style={{ position: 'relative', flexShrink: 0, opacity: isDragging ? 0.35 : 1, borderRadius: 10, cursor: 'grab', ...outline }}>
        <div style={{ width: 72, height: 72, border: '1.5px solid rgba(255,152,0,.4)', borderRadius: 10, background: 'rgba(255,152,0,.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, fontWeight: 300, color: '#E65100' }}>→</div>{delBtn}
      </div>
    );
  }

  // ── 칩 스트립 (함수 직접 호출 — JSX 컴포넌트로 쓰면 리마운트 발생) ──────
  function ChipStrip(p: {
    slotKey: 'morning' | 'evening'; section: 'main' | 'tip';
    items: RoutineItem[]; label: string; sublabel?: string;
    borderColor?: string; bgColor?: string; textColor?: string;
  }) {
    const { slotKey, section, items, label, sublabel, borderColor, bgColor, textColor } = p;
    const isInputActive = activeInput?.slot === slotKey && activeInput?.section === section;
    const isDesc = isInputActive && activeInput?.type === 'desc';
    const isTip = isInputActive && activeInput?.type === 'tip';
    const isDraggingHere = dragIdx?.slot === slotKey && dragIdx?.section === section;

    return (
      <div style={{ marginTop: 12 }}>
        <div style={{ fontFamily: f, fontSize: 12, fontWeight: 700, color: textColor ?? '#9A9490', letterSpacing: '.04em', paddingBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
          {label}{sublabel && <span style={{ fontSize: 11, fontWeight: 400, color: '#BCBAB6' }}>{sublabel}</span>}
        </div>

        {/* 칩 스트립 — ItemChip 함수 직접 호출로 리마운트 방지 */}
        {items.length > 0 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '8px 0 10px', alignItems: 'flex-end' }}>
            {items.map((item, idx) =>
              ItemChip({
                item, itemKey: idx,
                isHighlighted: item.type === 'product' && highlightedProdIds.has(item.id),
                isDragging: isDraggingHere && dragIdx?.idx === idx,
                isDragOver: isDraggingHere && dragOverIdx === idx,
                onRemove: () => removeItem(slotKey, section, idx),
                onDragStart: (e) => { e.dataTransfer.effectAllowed = 'move'; setDragIdx({ slot: slotKey, section, idx }); },
                onDragOver: (e) => { e.preventDefault(); setDragOverIdx(idx); },
                onDrop: (e) => { e.preventDefault(); if (dragIdx) moveItem(dragIdx.slot, dragIdx.section, dragIdx.idx, idx); setDragIdx(null); setDragOverIdx(null); },
              })
            )}
          </div>
        ) : (
          <div style={{ padding: 12, textAlign: 'center', fontSize: 12, color: '#BCBAB6', border: `1.5px dashed ${borderColor ?? 'rgba(12,12,10,.12)'}`, background: bgColor, borderRadius: 10, marginBottom: 8 }}>
            아이템을 추가하세요
          </div>
        )}

        {/* 텍스트 입력 (설명 / TIP) — 포커스 유지를 위해 DOM에서 직접 관리 */}
        {isDesc && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 8, alignItems: 'center' }}>
            <input
              value={inputText}
              onChange={(e) => handleTextInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') confirmInput(); if (e.key === 'Escape') cancelInput(); }}
              placeholder="설명 텍스트 입력... (제품명 입력하면 칩 하이라이트)"
              autoFocus
              style={{ flex: 1, border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 8, padding: '8px 10px', fontFamily: f, fontSize: 13, color: '#0C0C0A', background: '#fff', outline: 'none', boxSizing: 'border-box' as const }}
            />
            <button onClick={confirmInput} style={{ padding: '8px 14px', border: 'none', borderRadius: 8, background: '#0C0C0A', color: '#fff', fontFamily: f, fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' as const }}>추가</button>
            <button onClick={cancelInput} style={{ padding: '8px', border: 'none', background: 'transparent', color: '#9A9490', fontSize: 16, cursor: 'pointer' }}>✕</button>
          </div>
        )}
        {isTip && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 8, alignItems: 'center' }}>
            <input
              value={inputText}
              onChange={(e) => handleTextInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') confirmInput(); if (e.key === 'Escape') cancelInput(); }}
              placeholder="팁 텍스트 입력..."
              autoFocus
              style={{ flex: 1, border: '1.5px solid rgba(132,176,0,.3)', borderRadius: 8, padding: '8px 10px', fontFamily: f, fontSize: 13, color: '#4E7D00', background: 'rgba(197,255,0,.04)', outline: 'none', boxSizing: 'border-box' as const }}
            />
            <button onClick={confirmInput} style={{ padding: '8px 14px', border: 'none', borderRadius: 8, background: '#84B000', color: '#fff', fontFamily: f, fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' as const }}>추가</button>
            <button onClick={cancelInput} style={{ padding: '8px', border: 'none', background: 'transparent', color: '#9A9490', fontSize: 16, cursor: 'pointer' }}>✕</button>
          </div>
        )}

        {/* 액션 버튼 */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const, marginTop: 4 }}>
          <button onClick={() => openPicker(slotKey, section)} style={{ padding: '7px 12px', borderRadius: 9999, border: 'none', background: '#0C0C0A', color: '#C5FF00', fontFamily: f, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>제품 +</button>
          <button onClick={() => { setActiveInput({ slot: slotKey, section, type: 'desc' }); setInputText(''); }} style={{ padding: '7px 12px', borderRadius: 9999, border: '1.5px solid rgba(12,12,10,.14)', background: 'transparent', color: '#4A4846', fontFamily: f, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>설명 +</button>
          <button onClick={() => { setActiveInput({ slot: slotKey, section, type: 'tip' }); setInputText(''); }} style={{ padding: '7px 12px', borderRadius: 9999, border: '1.5px solid rgba(132,176,0,.4)', background: 'rgba(197,255,0,.1)', color: '#4A7700', fontFamily: f, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>TIP +</button>
          <button onClick={() => addItems(slotKey, section, [{ type: 'plus' }])} style={{ padding: '7px 12px', borderRadius: 9999, border: '1.5px solid rgba(33,150,243,.4)', background: 'rgba(33,150,243,.08)', color: '#1976D2', fontFamily: f, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>+</button>
          <button onClick={() => addItems(slotKey, section, [{ type: 'minus' }])} style={{ padding: '7px 12px', borderRadius: 9999, border: '1.5px solid rgba(255,152,0,.4)', background: 'rgba(255,152,0,.08)', color: '#E65100', fontFamily: f, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>→</button>
        </div>
      </div>
    );
  }

  // ── 슬롯 섹션 (함수 직접 호출) ────────────────────────────────────────────
  function SlotSection(p: { slotKey: 'morning' | 'evening'; icon: string; label: string }) {
    const { slotKey, icon, label } = p;
    const slot = draft[slotKey];
    const activeDIdx = activeDayIdx[slotKey];
    const activeDay = slot.days[activeDIdx] ?? slot.days[0];
    const time = slotKey === 'morning' ? draft.morningTime : draft.eveningTime;

    return (
      <div style={{ borderTop: '1px solid rgba(12,12,10,.07)', marginTop: 20, paddingTop: 16 }}>
        {/* 슬롯 헤더 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ fontFamily: f, fontSize: 14, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase' as const, color: '#0C0C0A' }}>{icon} {label}</div>
          <div style={{ fontFamily: f, fontSize: 12, fontWeight: 700, color: '#9A9490' }}>{time}</div>
        </div>

        {/* DAY 탭 (슬롯별 독립) */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' as const, marginBottom: 16, alignItems: 'center' }}>
          {slot.days.map((day, i) => (
            <button
              key={day.id}
              onClick={() => setActiveDayIdx((p) => ({ ...p, [slotKey]: i }))}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: `8px ${slot.days.length > 1 ? '10px' : '16px'} 8px 16px`, borderRadius: 9999, border: `1.5px solid ${activeDIdx === i ? '#0C0C0A' : 'rgba(12,12,10,.14)'}`, background: activeDIdx === i ? '#0C0C0A' : 'transparent', color: activeDIdx === i ? '#fff' : '#9A9490', fontFamily: f, fontSize: 13, fontWeight: 700, letterSpacing: '.06em', cursor: 'pointer', transition: 'all .15s' }}
            >
              DAY {day.id}
              {slot.days.length > 1 && (
                <span onClick={(e) => { e.stopPropagation(); removeSlotDay(slotKey, i); }} style={{ fontSize: 16, lineHeight: 1, opacity: .65, cursor: 'pointer', padding: '0 2px' }}>×</span>
              )}
            </button>
          ))}
          {slot.days.length < 3 && (
            <button onClick={() => addSlotDay(slotKey)} style={{ padding: '8px 14px', borderRadius: 9999, border: '1.5px dashed rgba(12,12,10,.2)', background: 'transparent', color: '#9A9490', fontSize: 16, cursor: 'pointer', lineHeight: 1 }}>+</button>
          )}
        </div>

        {/* 아이템 매핑 섹션 */}
        {ChipStrip({ slotKey, section: 'main', items: activeDay.items, label: '— 아이템 매핑', sublabel: '(BOX 뷰티)' })}

        {/* TIP 섹션 */}
        <div style={{ borderTop: '1px solid rgba(0,0,0,.05)', marginTop: 14, paddingTop: 2 }}>
          {ChipStrip({ slotKey, section: 'tip', items: activeDay.tipItems, label: '— TIP', sublabel: '(내용 있을 때만 Today 표시)', borderColor: 'rgba(132,176,0,.3)', bgColor: 'rgba(197,255,0,.03)', textColor: '#9A9490' })}
        </div>

        {/* EXPERT TIP — ExpertTipField 공통 컴포넌트 */}
        <div style={{ marginTop: 14 }}>
          <ExpertTipField
            value={activeDay.expertTip}
            onChange={(v) => setExpertTip(slotKey, v)}
            products={products}
            placeholder="루틴에 관한 전용 팁 설명 입력..."
          />
        </div>

        {/* 슬롯 하단 저장 버튼 — 화면 이동 없이 저장만 */}
        <div style={{ marginTop: 20, paddingTop: 14, borderTop: '1px solid rgba(12,12,10,.06)' }}>
          <button
            onClick={onSaveOnly}
            disabled={saving}
            style={{
              width: '100%', padding: '12px 0',
              background: saving ? '#D8D6CF' : '#C5FF00',
              color: saving ? '#9A9490' : '#0C0C0A',
              border: 'none', borderRadius: 10,
              fontFamily: f, fontSize: 13, fontWeight: 700,
              letterSpacing: '.06em', cursor: saving ? 'default' : 'pointer',
              transition: 'background .15s',
            }}
          >
            {saving ? '저장중...' : '저장 →'}
          </button>
        </div>
      </div>
    );
  }

  // ── 렌더 ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ position: 'fixed', top: 0, bottom: 0, left: 'max(0px,calc(50vw - 215px))', right: 'max(0px,calc(50vw - 215px))', zIndex: 200, background: '#FAFAF8', display: 'flex', flexDirection: 'column', overflowY: 'hidden' }}>
      {/* 에디터 앱바 */}
      {/* 에디터 앱바 — "스킨케어 루틴 설정" 고정 타이틀 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', height: 56, background: 'rgba(250,250,248,.92)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(12,12,10,.07)', flexShrink: 0 }}>
        <BackButton onClick={onBack} />
        <div style={{ fontFamily: f, fontSize: 14, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase' as const, color: '#0C0C0A' }}>
          스킨케어 루틴 설정
        </div>
        {/* 저장 버튼은 아래 세션 정보 헤더로 이동 */}
        <div style={{ minWidth: 48 }} />
      </div>

      {/* 본문 스크롤 */}
      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 24 }}>
        {/* 세션 정보 */}
        <div style={{ padding: '20px 16px 0' }}>
          <div style={labelStyle}>세션 정보</div>
          <div style={{ background: '#F4F4F0', borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* 회차 + 태그 — 1행 2열 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={fieldLabelStyle}>회차</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="number"
                    min={1}
                    value={draft.sessionNumber}
                    onChange={(e) => setDraft((d) => d && { ...d, sessionNumber: Math.max(1, parseInt(e.target.value) || 1) })}
                    style={{ ...dateInputStyle, width: '100%' } as React.CSSProperties}
                  />
                  <span style={{ fontFamily: f, fontSize: 13, fontWeight: 600, color: '#4A4846', whiteSpace: 'nowrap' as const }}>회차</span>
                </div>
              </div>
              <div>
                <label style={fieldLabelStyle}>예: 관리실 N차</label>
                <input
                  value={draft.sessionTag}
                  onChange={(e) => setDraft((d) => d && { ...d, sessionTag: e.target.value })}
                  placeholder="관리실 N차"
                  style={dateInputStyle}
                />
              </div>
            </div>
            {/* 기간 */}
            <div>
              <label style={fieldLabelStyle}>기간</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="date" value={draft.startDate} onChange={(e) => setDraft((d) => d && { ...d, startDate: e.target.value })} style={dateInputStyle} />
                <span style={{ color: '#9A9490', fontSize: 12 }}>~</span>
                <input type="date" value={draft.endDate} onChange={(e) => setDraft((d) => d && { ...d, endDate: e.target.value })} style={dateInputStyle} />
              </div>
            </div>
            {/* 아침/저녁 시간 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div><label style={fieldLabelStyle}>아침 시간</label><input type="time" value={draft.morningTime} onChange={(e) => setDraft((d) => d && { ...d, morningTime: e.target.value })} style={dateInputStyle} /></div>
              <div><label style={fieldLabelStyle}>저녁 시간</label><input type="time" value={draft.eveningTime} onChange={(e) => setDraft((d) => d && { ...d, eveningTime: e.target.value })} style={dateInputStyle} /></div>
            </div>
          </div>
        </div>

        {/* 슬롯 섹션 */}
        <div style={{ padding: '0 16px 16px' }}>
          {SlotSection({ slotKey: 'morning', icon: '☀️', label: '아침 스킨케어' })}
          {SlotSection({ slotKey: 'evening', icon: '🌙', label: '저녁 스킨케어' })}
        </div>

        {/* 세션 삭제 */}
        {draft.id && (
          <div style={{ padding: '16px 16px 0' }}>
            <button onClick={onDelete} style={{ width: '100%', padding: 14, background: 'none', border: '1.5px solid rgba(186,26,26,.3)', borderRadius: 10, fontFamily: f, fontSize: 13, color: '#BA1A1A', cursor: 'pointer', fontWeight: 700 }}>이 세션 삭제</button>
          </div>
        )}
      </div>

      {/* 하단 고정 저장 버튼 */}
      <div style={{ flexShrink: 0, padding: '10px 16px 16px', background: 'rgba(250,250,248,.97)', borderTop: '1px solid rgba(12,12,10,.07)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}>
        <button onClick={onSave} disabled={saving} style={{ width: '100%', height: 52, background: saving ? '#D8D6CF' : '#0C0C0A', color: saving ? '#9A9490' : '#C5FF00', border: 'none', borderRadius: 12, fontFamily: f, fontSize: 15, fontWeight: 700, cursor: saving ? 'default' : 'pointer', letterSpacing: '.04em' }}>
          {saving ? '저장중...' : '저장 →'}
        </button>
      </div>

      {/* 제품 picker 바텀시트 */}
      {picker && (
        <>
          <div onClick={() => setPicker(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 300 }} />
          <div style={{ position: 'fixed', bottom: 0, left: 'max(0px,calc(50vw - 215px))', right: 'max(0px,calc(50vw - 215px))', zIndex: 310, background: '#FAFAF8', borderRadius: '20px 20px 0 0', maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 -4px 40px rgba(0,0,0,.12)' }}>
            <div style={{ padding: '12px 16px 0', flexShrink: 0 }}>
              <div style={{ width: 32, height: 3, background: 'rgba(12,12,10,.14)', borderRadius: 2, margin: '0 auto 16px' }} />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ fontFamily: f, fontSize: 16, fontWeight: 800, color: '#0C0C0A' }}>
                  {picker.slot === 'morning' ? '☀️ 아침' : '🌙 저녁'} {picker.section === 'tip' ? 'TIP ' : ''}제품 선택
                </div>
                <button onClick={() => setPicker(null)} style={{ width: 28, height: 28, borderRadius: 8, background: '#E4E2DC', border: 'none', cursor: 'pointer', fontSize: 12, color: '#4A4846', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
              </div>
              <input type="search" value={pickerSearch} onChange={(e) => setPickerSearch(e.target.value)} placeholder="제품명 · 브랜드 검색..." autoFocus style={{ width: '100%', padding: '10px 12px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 8, fontFamily: f, fontSize: 13, color: '#0C0C0A', background: '#F4F4F0', outline: 'none', boxSizing: 'border-box' as const, marginBottom: 4 }} />
              <div style={{ fontFamily: f, fontSize: 11, color: '#9A9490', marginBottom: 8 }}>{pickerSelected.size > 0 ? `${pickerSelected.size}개 선택됨` : 'BOX에서 제품을 선택하세요'}</div>
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {products.length === 0 ? (
                <div style={{ padding: '40px 16px', textAlign: 'center', color: '#9A9490', fontFamily: f, fontSize: 13, lineHeight: 1.6 }}>BOX에 제품이 없습니다.<br />BOX 탭에서 먼저 제품을 추가해주세요.</div>
              ) : filteredProducts.length === 0 ? (
                <div style={{ padding: '40px 16px', textAlign: 'center', color: '#9A9490', fontFamily: f, fontSize: 13 }}>검색 결과 없음</div>
              ) : (
                filteredProducts.map((p) => {
                  const isSel = pickerSelected.has(p.id);
                  return (
                    <div key={p.id} onClick={() => setPickerSelected((prev) => { const n = new Set(prev); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid rgba(12,12,10,.07)', cursor: 'pointer', background: isSel ? 'rgba(197,255,0,.06)' : 'transparent' }}>
                      <div style={{ width: 36, height: 36, borderRadius: 8, background: '#EEEDE9', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>✦</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontFamily: f, fontSize: 14, fontWeight: 600, color: '#0C0C0A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                        {p.brand && <div style={{ fontFamily: f, fontSize: 12, color: '#9A9490', marginTop: 2 }}>{p.brand}</div>}
                      </div>
                      <div style={{ width: 22, height: 22, borderRadius: '50%', border: `1.5px solid ${isSel ? '#8AB000' : 'rgba(12,12,10,.14)'}`, background: isSel ? '#C5FF00' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#0C0C0A', flexShrink: 0 }}>{isSel ? '✓' : ''}</div>
                    </div>
                  );
                })
              )}
            </div>
            <div style={{ padding: '12px 16px 32px', flexShrink: 0, borderTop: '1px solid rgba(12,12,10,.07)' }}>
              <button onClick={confirmPicker} style={{ width: '100%', height: 52, background: '#0C0C0A', color: '#fff', border: 'none', borderRadius: 12, fontFamily: f, fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>완료{pickerSelected.size > 0 ? ` (${pickerSelected.size}개)` : ''}</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── TRACKER VIEW ────────────────────────────────────────────────────────────
function TrackerView({
  habits, onBack, onAddHabit, onUpdateHabit, onDeleteHabit, user, onToggleToday,
}: {
  habits: Habit[];
  user: User | null;
  onBack: () => void;
  onAddHabit: (h: Omit<Habit, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  onUpdateHabit: (id: string, h: Partial<Omit<Habit, 'id'>>) => Promise<void>;
  onDeleteHabit: (id: string) => Promise<void>;
  onToggleToday: (id: string, current: boolean) => void;
}) {
  const f = "'Plus Jakarta Sans','Space Grotesk',sans-serif";
  const WD_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

  const [newIcon, setNewIcon] = useState('✦');
  const [newName, setNewName] = useState('');
  const [newRepeat, setNewRepeat] = useState<RepeatType>('allday');
  const [newTime, setNewTime] = useState('07:00');
  const [newAlarm, setNewAlarm] = useState(false);
  const [newDate, setNewDate] = useState('');
  const [newWeekdays, setNewWeekdays] = useState<number[]>([]);
  const [adding, setAdding] = useState(false);

  const [habitSearch, setHabitSearch] = useState('');
  const filteredHabits = habitSearch.trim()
    ? habits.filter(h => h.name.toLowerCase().includes(habitSearch.toLowerCase()))
    : habits;

  const [editHabit, setEditHabit] = useState<Habit | null>(null);
  const [eIcon, setEIcon] = useState('');
  const [eName, setEName] = useState('');
  const [eRepeat, setERepeat] = useState<RepeatType>('allday');
  const [eTime, setETime] = useState('07:00');
  const [eAlarm, setEAlarm] = useState(false);
  const [eDate, setEDate] = useState('');
  const [eWeekdays, setEWeekdays] = useState<number[]>([]);

  function repeatLabel(h: Habit) {
    if (h.repeatType === 'allday') return '종일';
    if (h.repeatType === 'daily') return '매일';
    if (h.repeatType === 'once') return h.date ? `${h.date.slice(5, 7)}/${h.date.slice(8, 10)}` : '1회성';
    if (h.repeatType === 'scheduled') return (h.weekdays ?? []).map(d => WD_NAMES[d]).join('·') || '요일선택';
    return '';
  }

  async function handleAdd() {
    if (!newName.trim()) return;
    if (!user) { alert('Google 로그인이 필요합니다.'); return; }
    setAdding(true);
    try {
      await onAddHabit({
        icon: newIcon || '✦',
        name: newName.trim(),
        repeatType: newRepeat,
        time: newRepeat !== 'allday' ? newTime : '',
        alarm: newRepeat !== 'allday' ? newAlarm : false,
        ...(newRepeat === 'once' ? { date: newDate } : {}),
        ...(newRepeat === 'scheduled' ? { weekdays: newWeekdays } : {}),
      });
      setNewName(''); setNewIcon('✦'); setNewRepeat('allday');
      setNewTime('07:00'); setNewAlarm(false); setNewDate(''); setNewWeekdays([]);
    } catch (err) {
      console.error('[OnStep] TrackerView ADD 실패:', err);
      alert('저장에 실패했습니다. 다시 시도해주세요.');
    } finally { setAdding(false); }
  }

  function openEdit(h: Habit) {
    setEditHabit(h); setEIcon(h.icon); setEName(h.name);
    setERepeat(h.repeatType); setETime(h.time); setEAlarm(h.alarm);
    setEDate(h.date ?? ''); setEWeekdays(h.weekdays ?? []);
  }

  async function handleSaveEdit() {
    if (!editHabit || !eName.trim()) return;
    await onUpdateHabit(editHabit.id, {
      icon: eIcon || '✦', name: eName.trim(), repeatType: eRepeat,
      time: eRepeat !== 'allday' ? eTime : '', alarm: eRepeat !== 'allday' ? eAlarm : false,
      ...(eRepeat === 'once' ? { date: eDate } : {}),
      ...(eRepeat === 'scheduled' ? { weekdays: eWeekdays } : {}),
      updatedAt: new Date().toISOString(),
    });
    setEditHabit(null);
  }

  async function handleDeleteHabit() {
    if (!editHabit) return;
    if (!confirm('이 습관을 삭제하시겠어요?')) return;
    await onDeleteHabit(editHabit.id);
    setEditHabit(null);
  }

  function toggleWD(wd: number) { setNewWeekdays(p => p.includes(wd) ? p.filter(d => d !== wd) : [...p, wd]); }
  function toggleEWD(wd: number) { setEWeekdays(p => p.includes(wd) ? p.filter(d => d !== wd) : [...p, wd]); }

  function RepeatFormFields({ rt, setRt, wd, toggleWDFn, date_, setDate_, time_, setTime_, alarm_, setAlarm_ }: {
    rt: RepeatType; setRt: (r: RepeatType) => void;
    wd: number[]; toggleWDFn: (d: number) => void;
    date_: string; setDate_: (s: string) => void;
    time_: string; setTime_: (s: string) => void;
    alarm_: boolean; setAlarm_: (b: boolean) => void;
  }) {
    const rtypes: { key: RepeatType; label: string }[] = [
      { key: 'allday', label: '종일' }, { key: 'once', label: '1회성' },
      { key: 'daily', label: '매일' }, { key: 'scheduled', label: '일정등록' },
    ];
    return (
      <>
        <div style={{ display: 'flex', gap: 6 }}>
          {rtypes.map(r => (
            <button key={r.key} onClick={() => setRt(r.key)} style={{ flex: 1, padding: '9px 4px', border: `1.5px solid ${rt === r.key ? '#0C0C0A' : 'rgba(12,12,10,.14)'}`, borderRadius: 12, fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase' as const, color: rt === r.key ? '#fff' : '#4A4846', background: rt === r.key ? '#0C0C0A' : '#fff', cursor: 'pointer', transition: 'all .15s' }}>{r.label}</button>
          ))}
        </div>
        {rt === 'once' && (
          <input type="date" value={date_} onChange={e => setDate_(e.target.value)} style={{ width: '100%', padding: '12px 14px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 12, fontFamily: f, fontSize: 14, fontWeight: 700, color: '#0C0C0A', background: '#fff', outline: 'none', boxSizing: 'border-box' as const, marginTop: 8 }} />
        )}
        {rt === 'scheduled' && (
          <div style={{ display: 'flex', gap: 5, justifyContent: 'space-between', marginTop: 8 }}>
            {WD_NAMES.map((nm, d) => (
              <button key={d} onClick={() => toggleWDFn(d)} style={{ flex: 1, height: 38, borderRadius: 9999, border: `1.5px solid ${wd.includes(d) ? '#0C0C0A' : 'rgba(12,12,10,.14)'}`, fontFamily: f, fontSize: 12, fontWeight: 700, color: wd.includes(d) ? '#fff' : '#4A4846', background: wd.includes(d) ? '#0C0C0A' : '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all .15s', padding: 0 }}>{nm}</button>
            ))}
          </div>
        )}
        {rt !== 'allday' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
            <input type="time" value={time_} onChange={e => setTime_(e.target.value)} style={{ flex: 1, padding: '12px 14px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 12, fontFamily: f, fontSize: 14, fontWeight: 700, color: '#0C0C0A', background: '#fff', outline: 'none', boxSizing: 'border-box' as const }} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontFamily: f, fontSize: 12, fontWeight: 500, color: '#4A4846', cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' as const }}>
              <input type="checkbox" checked={alarm_} onChange={e => setAlarm_(e.target.checked)} style={{ width: 15, height: 15, accentColor: '#0C0C0A' }} />
              알람
            </label>
          </div>
        )}
      </>
    );
  }

  function HabitRow({ h, onEdit }: { h: Habit; onEdit: () => void }) {
    const isToday = !!h.showInToday;
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: '#fff', borderBottom: '1px solid rgba(12,12,10,.07)' }}>
        {/* 이모지 아이콘 */}
        <div style={{ width: 36, height: 36, borderRadius: 10, background: '#EEEDE9', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, lineHeight: 1 }}>
          {h.icon || '✦'}
        </div>

        {/* 이름 + 스케줄 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: f, fontSize: 14, fontWeight: 600, color: '#0C0C0A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
            {h.name}
          </div>
          <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, color: '#9A9490', letterSpacing: '.04em', marginTop: 2 }}>
            {repeatLabel(h)}{h.time && h.repeatType !== 'allday' ? ` · ${h.time}` : ''}
            {h.alarm && h.repeatType !== 'allday' ? ' 🔔' : ''}
          </div>
        </div>

        {/* TODAY 토글 — 선택 시 라임 뱃지 */}
        <button
          onClick={() => onToggleToday(h.id, isToday)}
          style={{
            height: 26, padding: '0 10px', borderRadius: 9999, border: 'none', cursor: 'pointer',
            background: isToday ? '#C5FF00' : '#F4F4F0',
            color: isToday ? '#0C0C0A' : '#9A9490',
            fontFamily: f, fontSize: 10, fontWeight: 800, letterSpacing: '.08em',
            textTransform: 'uppercase' as const,
            transition: 'all .18s', flexShrink: 0,
          }}
        >
          TODAY
        </button>

        {/* 편집 버튼 */}
        <button
          onClick={onEdit}
          style={{ width: 28, height: 28, background: 'none', border: 'none', cursor: 'pointer', color: '#9A9490', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', flexShrink: 0 }}
          aria-label="편집"
        >
          ✎
        </button>
      </div>
    );
  }

  return (
    <div style={{ position: 'fixed', top: 0, bottom: 0, left: 'max(0px,calc(50vw - 215px))', right: 'max(0px,calc(50vw - 215px))', zIndex: 100, background: '#FAFAF8', display: 'flex', flexDirection: 'column', overflowY: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', height: 56, background: 'rgba(250,250,248,.92)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(12,12,10,.07)', flexShrink: 0 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#0C0C0A', fontSize: 18, fontWeight: 400, lineHeight: 1 }}>✕</button>
        <div style={{ background: '#C5FF00', color: '#0C0C0A', fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase' as const, padding: '5px 12px', borderRadius: 9999 }}>EDIT MODE</div>
        <div style={{ width: 44 }} />
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* Hero */}
        <div style={{ padding: '28px 16px 20px', borderBottom: '1px solid rgba(12,12,10,.07)', position: 'relative' }}>
          <div style={{ position: 'absolute', top: 18, right: 18, fontSize: 36, opacity: .06, transform: 'rotate(10deg)', lineHeight: 1 }}>⏰</div>
          <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.18em', textTransform: 'uppercase' as const, color: '#9A9490', marginBottom: 10 }}>DAILY TRACKING</div>
          <div style={{ fontFamily: f, fontSize: 48, fontWeight: 900, color: '#0C0C0A', lineHeight: .95, letterSpacing: '-.02em', textTransform: 'uppercase' as const }}>HABITS</div>
          <div style={{ fontFamily: f, fontSize: 12, color: '#9A9490', marginTop: 12, lineHeight: 1.5 }}>습관 트래킹 · 타임 알림 · 데일리 체크</div>
        </div>

        {/* Add Form */}
        <div style={{ padding: '20px 16px 16px', borderBottom: '1px solid rgba(12,12,10,.07)' }}>
          <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.16em', textTransform: 'uppercase' as const, color: '#9A9490', marginBottom: 12 }}>NEW HABIT</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input value={newIcon} onChange={e => setNewIcon(e.target.value)} placeholder="✦" maxLength={2} style={{ width: 48, padding: '11px 6px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 12, fontSize: 22, textAlign: 'center', background: '#fff', outline: 'none', flexShrink: 0 }} />
              <input value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }} placeholder="습관 이름 (예: 모닝 워터 한 잔)" maxLength={40} style={{ flex: 1, padding: '12px 14px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 12, fontFamily: f, fontSize: 14, color: '#0C0C0A', background: '#fff', outline: 'none' }} />
            </div>
            {RepeatFormFields({ rt: newRepeat, setRt: setNewRepeat, wd: newWeekdays, toggleWDFn: toggleWD, date_: newDate, setDate_: setNewDate, time_: newTime, setTime_: setNewTime, alarm_: newAlarm, setAlarm_: setNewAlarm })}
            <button onClick={handleAdd} disabled={adding || !newName.trim()} style={{ padding: '12px 20px', background: newName.trim() ? '#0C0C0A' : 'rgba(12,12,10,.14)', color: newName.trim() ? '#fff' : '#9A9490', border: 'none', borderRadius: 12, fontFamily: f, fontSize: 12, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase' as const, cursor: newName.trim() ? 'pointer' : 'default', transition: 'all .18s' }}>
              + ADD
            </button>
          </div>
        </div>

        {/* All habits pool */}
        <div style={{ padding: '20px 16px 0' }}>
          <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.16em', textTransform: 'uppercase' as const, color: '#9A9490', marginBottom: 8 }}>전체 습관 목록</div>
          <SearchBar value={habitSearch} onChange={setHabitSearch} placeholder="습관 이름 검색..." />
          {habits.length === 0 ? (
            <div style={{ padding: '36px 16px', textAlign: 'center', fontFamily: f, fontSize: 13, color: '#9A9490', lineHeight: 1.6, border: '1.5px dashed rgba(12,12,10,.14)', borderRadius: 16, background: '#EEEDE9', marginTop: 8 }}>
              아직 등록된 습관이 없습니다.<br />위에서 새 습관을 추가해주세요.
            </div>
          ) : filteredHabits.length === 0 ? (
            <div style={{ padding: '36px 16px', textAlign: 'center', fontFamily: f, fontSize: 13, color: '#9A9490', marginTop: 8 }}>
              &ldquo;{habitSearch}&rdquo; 검색 결과 없음
            </div>
          ) : (
            <div style={{ background: '#fff', borderRadius: 20, overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,.06),0 0 0 1px rgba(0,0,0,.04)', marginTop: 8 }}>
              {filteredHabits.map(h => <HabitRow key={h.id} h={h} onEdit={() => openEdit(h)} />)}
            </div>
          )}
        </div>

        {/* DAILY HABITS — showInToday=true 습관 미리보기 */}
        {habits.some(h => h.showInToday) && (
          <div style={{ padding: '24px 16px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <span style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.16em', textTransform: 'uppercase' as const, color: '#9A9490' }}>
                DAILY HABITS
              </span>
              <span style={{ background: '#C5FF00', color: '#0C0C0A', fontFamily: f, fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 9999 }}>
                TODAY
              </span>
              <span style={{ fontFamily: f, fontSize: 11, color: '#BCBAB6', marginLeft: 'auto' }}>
                {habits.filter(h => h.showInToday).length}개
              </span>
            </div>
            <div style={{ background: '#fff', borderRadius: 16, overflow: 'hidden', border: '1px solid rgba(12,12,10,.07)', boxShadow: '0 1px 4px rgba(0,0,0,.06)' }}>
              {habits.filter(h => h.showInToday).map((h, idx) => (
                <div
                  key={h.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '12px 14px',
                    borderTop: idx > 0 ? '1px solid rgba(12,12,10,.07)' : 'none',
                    background: '#FAFAF8',
                  }}
                >
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: '#EEEDE9', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, lineHeight: 1 }}>
                    {h.icon || '✦'}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: f, fontSize: 14, fontWeight: 600, color: '#0C0C0A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                      {h.name}
                    </div>
                  </div>
                  {/* TODAY 버튼 — 재탭 시 목록에서 제거 */}
                  <button
                    onClick={() => onToggleToday(h.id, true)}
                    style={{
                      height: 26, padding: '0 10px', borderRadius: 9999, border: 'none', cursor: 'pointer',
                      background: '#C5FF00', color: '#0C0C0A',
                      fontFamily: f, fontSize: 10, fontWeight: 800, letterSpacing: '.08em',
                      textTransform: 'uppercase' as const,
                      flexShrink: 0,
                    }}
                  >
                    TODAY
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ height: 40 }} />
      </div>

      {/* Edit sheet */}
      {editHabit && (
        <>
          <div onClick={() => setEditHabit(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 310 }} />
          <div style={{ position: 'fixed', bottom: 0, left: 'max(0px,calc(50vw - 215px))', right: 'max(0px,calc(50vw - 215px))', zIndex: 311, background: '#FAFAF8', borderRadius: '20px 20px 0 0', padding: '10px 20px 48px', maxHeight: '88%', overflowY: 'auto' }}>
            <div style={{ width: 32, height: 3, background: 'rgba(12,12,10,.14)', borderRadius: 2, margin: '0 auto 20px' }} />
            <div style={{ fontFamily: f, fontSize: 20, fontWeight: 800, color: '#0C0C0A', marginBottom: 20 }}>습관 편집</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input value={eIcon} onChange={e => setEIcon(e.target.value)} placeholder="✦" maxLength={2} style={{ width: 48, padding: '11px 6px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 12, fontSize: 22, textAlign: 'center', background: '#fff', outline: 'none', flexShrink: 0 }} />
                <input value={eName} onChange={e => setEName(e.target.value)} placeholder="습관 이름" maxLength={40} style={{ flex: 1, padding: '12px 14px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 12, fontFamily: f, fontSize: 14, color: '#0C0C0A', background: '#fff', outline: 'none' }} />
              </div>
              {RepeatFormFields({ rt: eRepeat, setRt: setERepeat, wd: eWeekdays, toggleWDFn: toggleEWD, date_: eDate, setDate_: setEDate, time_: eTime, setTime_: setETime, alarm_: eAlarm, setAlarm_: setEAlarm })}
            </div>
            <button onClick={handleSaveEdit} style={{ marginTop: 20, width: '100%', padding: 14, background: '#0C0C0A', color: '#fff', border: 'none', borderRadius: 12, fontFamily: f, fontSize: 13, fontWeight: 700, cursor: 'pointer', letterSpacing: '.02em' }}>저장</button>
            <button onClick={handleDeleteHabit} style={{ marginTop: 10, width: '100%', padding: 14, background: 'none', color: '#BA1A1A', border: '1.5px solid rgba(186,26,26,.3)', borderRadius: 12, fontFamily: f, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>삭제</button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── CT PANEL (집중케어 / 메이크업북 / 룩북) ────────────────────────────────────
function CtPanel({
  ctType, ctItems, products, onBack, onAdd, onUpdate, onDelete,
}: {
  ctType: CtType;
  ctItems: CtItem[];
  products: Product[];
  onBack: () => void;
  onAdd: (item: Omit<CtItem, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  onUpdate: (id: string, item: Partial<Omit<CtItem, 'id'>>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const f = "'Plus Jakarta Sans','Space Grotesk',sans-serif";

  const META: Record<CtType, { panel: string; heroType: string; heroTitle: string; heroSub: string; sheetTitle: string; addBtn: string; icon: string }> = {
    care: { panel: '집중케어', heroType: 'INTENSIVE CARE', heroTitle: '집중케어', heroSub: '케어 프로그램 설계 · BOX 뷰티 제품 매핑 · 기간 & 스케줄 설정', sheetTitle: '집중케어 설계', addBtn: '+ 새 집중케어 설계', icon: '🧴' },
    makeup: { panel: '메이크업북', heroType: 'BEAUTY', heroTitle: '메이크업북', heroSub: '테마별 화장법 설계 · BOX 뷰티 제품 매핑 · Today 스케줄 연동', sheetTitle: '메이크업 테마 설계', addBtn: '+ 새 메이크업 테마 설계', icon: '💄' },
    lookbook: { panel: '룩북', heroType: 'FASHION', heroTitle: '룩북', heroSub: 'T.P.O 기반 코디 설계 · BOX 패션·액세서리 매핑 · Today OOTD 연동', sheetTitle: '룩 설계', addBtn: '+ 새 룩 설계', icon: '👗' },
  };
  const m = META[ctType];
  const TPO_OPTIONS = ['Daily', 'Work', 'Date', 'Party', 'Sport', 'Casual', 'Formal', 'Travel'];

  // Sheet state
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editItem, setEditItem] = useState<CtItem | null>(null);
  const [sEmoji, setSEmoji] = useState('');
  const [sName, setSName] = useState('');
  const [sDesc, setSDesc] = useState('');
  const [sItems, setSItems] = useState<RoutineItem[]>([]);
  const [sTipItems, setSTipItems] = useState<RoutineItem[]>([]);
  const [sExpertTip, setSExpertTip] = useState('');
  const [sPeriodStart, setSPeriodStart] = useState('');
  const [sPeriodEnd, setSPeriodEnd] = useState('');
  const [sDates, setSDates] = useState<string[]>([]);
  const [sTpo, setSTpo] = useState<string[]>([]);
  const [sPublished, setSPublished] = useState(false);
  const [saving, setSaving] = useState(false);

  // Product picker inside sheet
  const [picker, setPicker] = useState<'main' | 'tip' | null>(null);
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickerSelected, setPickerSelected] = useState<Set<string>>(new Set());

  // 목록 검색
  const [ctSearch, setCtSearch] = useState('');
  const filteredCtItems = ctSearch.trim()
    ? ctItems.filter(i => i.name.toLowerCase().includes(ctSearch.toLowerCase()))
    : ctItems;

  // Inline text input
  const [activeInput, setActiveInput] = useState<{ section: 'main' | 'tip'; type: 'desc' | 'tip' } | null>(null);
  const [inputText, setInputText] = useState('');

  // 드래그 재정렬 상태
  const [dragCtx, setDragCtx] = useState<{ section: 'main' | 'tip'; idx: number } | null>(null);
  const [dragOverCtx, setDragOverCtx] = useState<{ section: 'main' | 'tip'; idx: number } | null>(null);

  // 도메인 필터: care/makeup → 뷰티, lookbook → 패션·악세서리
  const domainProducts = ctType === 'lookbook'
    ? products.filter(p => p.domain === 'fashion' || p.domain === 'acc')
    : products.filter(p => p.domain === 'beauty');

  const filteredProducts = domainProducts.filter(p => {
    if (!pickerSearch) return true;
    const q = pickerSearch.toLowerCase();
    return p.name.toLowerCase().includes(q) || (p.brand ?? '').toLowerCase().includes(q);
  });

  function productName(id: string) { return products.find(p => p.id === id)?.name ?? '?'; }

  function openNew() {
    setEditItem(null); setSEmoji(m.icon); setSName(''); setSDesc('');
    setSItems([]); setSTipItems([]); setSExpertTip('');
    setSPeriodStart(''); setSPeriodEnd(''); setSDates([]); setSTpo([]);
    setSPublished(false); setSheetOpen(true);
  }

  function openEdit(item: CtItem) {
    setEditItem(item); setSEmoji(item.emoji); setSName(item.name); setSDesc(item.desc);
    setSItems(item.items); setSTipItems(item.tipItems); setSExpertTip(item.expertTip ?? '');
    setSPeriodStart(item.periodStart ?? ''); setSPeriodEnd(item.periodEnd ?? '');
    setSDates(item.dates ?? []); setSTpo(item.tpo ?? []);
    setSPublished(item.published); setSheetOpen(true);
  }

  function closeSheet() { setSheetOpen(false); setPicker(null); setActiveInput(null); }

  async function handleSave() {
    if (!sName.trim()) return;
    setSaving(true);
    const now = new Date().toISOString();
    // Firestore는 undefined 값을 허용하지 않으므로 조건부 스프레드로 필드 포함 여부 결정
    const data: Omit<CtItem, 'id' | 'createdAt' | 'updatedAt'> = {
      ctType,
      emoji: sEmoji || m.icon,
      name: sName.trim(),
      desc: sDesc.trim(),
      items: sItems,
      tipItems: sTipItems,
      expertTip: sExpertTip.trim(),
      published: sPublished,
      ...(ctType === 'care' && sPeriodStart ? { periodStart: sPeriodStart, ...(sPeriodEnd ? { periodEnd: sPeriodEnd } : {}) } : {}),
      ...(ctType !== 'care' ? { dates: sDates } : {}),
      ...(ctType === 'lookbook' ? { tpo: sTpo } : {}),
    };
    try {
      if (editItem) { await onUpdate(editItem.id, { ...data, updatedAt: now }); }
      else { await onAdd(data); }
      closeSheet();
    } catch (err) {
      console.error('[CtPanel] 저장 실패:', err);
      alert('저장에 실패했습니다. 로그인 상태를 확인해주세요.');
    } finally { setSaving(false); }
  }

  async function handleDeleteItem() {
    if (!editItem) return;
    if (!confirm('삭제하시겠어요?')) return;
    await onDelete(editItem.id);
    closeSheet();
  }

  async function togglePublished(item: CtItem) {
    await onUpdate(item.id, { published: !item.published, updatedAt: new Date().toISOString() });
  }

  function openPicker(section: 'main' | 'tip') {
    setPicker(section); setPickerSearch(''); setPickerSelected(new Set());
  }

  function confirmPicker() {
    if (!picker) return;
    const newItems: RoutineItem[] = Array.from(pickerSelected).map(id => ({ type: 'product', id }));
    if (picker === 'main') setSItems(p => [...p, ...newItems]);
    else setSTipItems(p => [...p, ...newItems]);
    setPicker(null);
  }

  function confirmInput() {
    if (!activeInput || !inputText.trim()) { setActiveInput(null); setInputText(''); return; }
    const item: RoutineItem = { type: activeInput.type, text: inputText.trim() };
    if (activeInput.section === 'main') setSItems(p => [...p, item]);
    else setSTipItems(p => [...p, item]);
    setActiveInput(null); setInputText('');
  }

  function renderChip(
    item: RoutineItem, onRemove: () => void, key: number,
    section: 'main' | 'tip', idx: number,
  ) {
    const isDragging = dragCtx?.section === section && dragCtx?.idx === idx;
    const isDragOver = dragOverCtx?.section === section && dragOverCtx?.idx === idx;

    const dragHandlers = {
      draggable: true as const,
      onDragStart: (e: React.DragEvent) => { e.dataTransfer.effectAllowed = 'move'; setDragCtx({ section, idx }); },
      onDragOver: (e: React.DragEvent) => { e.preventDefault(); setDragOverCtx({ section, idx }); },
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        if (!dragCtx || dragCtx.section !== section || dragCtx.idx === idx) { setDragCtx(null); setDragOverCtx(null); return; }
        const setter = section === 'main' ? setSItems : setSTipItems;
        setter(prev => {
          const arr = [...prev];
          const [moved] = arr.splice(dragCtx.idx, 1);
          arr.splice(idx, 0, moved);
          return arr;
        });
        setDragCtx(null); setDragOverCtx(null);
      },
      onDragEnd: () => { setDragCtx(null); setDragOverCtx(null); },
    };

    const delBtn = (
      <button onClick={e => { e.stopPropagation(); onRemove(); }} style={{ position: 'absolute', top: -8, right: -8, width: 18, height: 18, borderRadius: '50%', background: 'rgba(0,0,0,.28)', color: '#fff', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, cursor: 'pointer', zIndex: 1 }}>×</button>
    );
    const base: React.CSSProperties = {
      position: 'relative', flexShrink: 0, borderRadius: 10, cursor: 'grab',
      opacity: isDragging ? 0.4 : 1,
      outline: isDragOver ? '2px solid #1976D2' : 'none',
      transition: 'opacity .15s, outline .1s',
    };

    if (item.type === 'product') return (
      <div key={key} style={base} {...dragHandlers}>
        <div style={{ width: 72, height: 72, background: '#fff', border: '1px solid rgba(12,12,10,.07)', borderRadius: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 6 }}>
          <div style={{ width: 30, height: 30, borderRadius: 7, background: '#EEEDE9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, marginBottom: 5 }}>✦</div>
          <div style={{ fontFamily: f, fontSize: 10, color: '#0C0C0A', textAlign: 'center', lineHeight: 1.3, overflow: 'hidden', maxWidth: 60, wordBreak: 'break-all' as const, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const }}>{productName(item.id)}</div>
        </div>{delBtn}
      </div>
    );
    if (item.type === 'desc') return (
      <div key={key} style={base} {...dragHandlers}>
        <div style={{ minWidth: 72, maxWidth: 150, height: 72, background: '#E8E6E0', border: '1px solid rgba(0,0,0,.06)', borderRadius: 10, padding: '8px 10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontFamily: f, fontSize: 12, color: '#0C0C0A', lineHeight: 1.35, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' as const, wordBreak: 'break-word' as const, textAlign: 'center' }}>{item.text}</div>
        </div>{delBtn}
      </div>
    );
    if (item.type === 'tip') return (
      <div key={key} style={base} {...dragHandlers}>
        <div style={{ minWidth: 72, maxWidth: 150, height: 72, background: 'rgba(197,255,0,.1)', border: '1.5px solid rgba(132,176,0,.4)', borderRadius: 10, padding: '8px 10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontFamily: f, fontSize: 12, fontWeight: 700, color: '#4E7D00', lineHeight: 1.35, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' as const, wordBreak: 'break-word' as const, textAlign: 'center' }}>{item.text}</div>
        </div>{delBtn}
      </div>
    );
    if (item.type === 'plus') return (
      <div key={key} style={base} {...dragHandlers}>
        <div style={{ width: 72, height: 72, border: '1.5px solid rgba(33,150,243,.4)', borderRadius: 10, background: 'rgba(33,150,243,.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, fontWeight: 300, color: '#1976D2' }}>+</div>{delBtn}
      </div>
    );
    return (
      <div key={key} style={base} {...dragHandlers}>
        <div style={{ width: 72, height: 72, border: '1.5px solid rgba(255,152,0,.4)', borderRadius: 10, background: 'rgba(255,152,0,.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, fontWeight: 300, color: '#E65100' }}>→</div>{delBtn}
      </div>
    );
  }

  function ChipSection(p: { label: string; items: RoutineItem[]; section: 'main' | 'tip'; onRemove: (i: number) => void }) {
    const { label, items, section, onRemove } = p;
    const isActive = activeInput?.section === section;
    const isDesc = isActive && activeInput?.type === 'desc';
    const isTip = isActive && activeInput?.type === 'tip';
    return (
      <div style={{ marginTop: 12 }}>
        {label && <div style={{ fontFamily: f, fontSize: 12, fontWeight: 700, color: '#9A9490', letterSpacing: '.04em', paddingBottom: 6 }}>{label}</div>}
        {items.length > 0 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '8px 0 10px', alignItems: 'flex-end' }}>
            {items.map((item, idx) => renderChip(item, () => onRemove(idx), idx, section, idx))}
          </div>
        ) : (
          <div style={{ padding: 12, textAlign: 'center', fontSize: 12, color: '#BCBAB6', border: '1.5px dashed rgba(12,12,10,.12)', borderRadius: 10, marginBottom: 8 }}>아이템을 추가하세요</div>
        )}
        {isDesc && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 8, alignItems: 'center' }}>
            <input value={inputText} onChange={e => setInputText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') confirmInput(); if (e.key === 'Escape') { setActiveInput(null); setInputText(''); } }} placeholder="설명 텍스트 입력..." autoFocus style={{ flex: 1, border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 8, padding: '8px 10px', fontFamily: f, fontSize: 13, color: '#0C0C0A', background: '#fff', outline: 'none' }} />
            <button onClick={confirmInput} style={{ padding: '8px 14px', border: 'none', borderRadius: 8, background: '#0C0C0A', color: '#fff', fontFamily: f, fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' as const }}>추가</button>
            <button onClick={() => { setActiveInput(null); setInputText(''); }} style={{ padding: 8, border: 'none', background: 'transparent', color: '#9A9490', fontSize: 16, cursor: 'pointer' }}>✕</button>
          </div>
        )}
        {isTip && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 8, alignItems: 'center' }}>
            <input value={inputText} onChange={e => setInputText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') confirmInput(); if (e.key === 'Escape') { setActiveInput(null); setInputText(''); } }} placeholder="팁 텍스트 입력..." autoFocus style={{ flex: 1, border: '1.5px solid rgba(132,176,0,.3)', borderRadius: 8, padding: '8px 10px', fontFamily: f, fontSize: 13, color: '#4E7D00', background: 'rgba(197,255,0,.04)', outline: 'none' }} />
            <button onClick={confirmInput} style={{ padding: '8px 14px', border: 'none', borderRadius: 8, background: '#84B000', color: '#fff', fontFamily: f, fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' as const }}>추가</button>
            <button onClick={() => { setActiveInput(null); setInputText(''); }} style={{ padding: 8, border: 'none', background: 'transparent', color: '#9A9490', fontSize: 16, cursor: 'pointer' }}>✕</button>
          </div>
        )}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const, marginTop: 4 }}>
          <button onClick={() => openPicker(section)} style={{ padding: '7px 12px', borderRadius: 9999, border: 'none', background: '#0C0C0A', color: '#C5FF00', fontFamily: f, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>제품 +</button>
          <button onClick={() => { setActiveInput({ section, type: 'desc' }); setInputText(''); }} style={{ padding: '7px 12px', borderRadius: 9999, border: '1.5px solid rgba(12,12,10,.14)', background: 'transparent', color: '#4A4846', fontFamily: f, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>설명 +</button>
          <button onClick={() => { setActiveInput({ section, type: 'tip' }); setInputText(''); }} style={{ padding: '7px 12px', borderRadius: 9999, border: '1.5px solid rgba(132,176,0,.4)', background: 'rgba(197,255,0,.1)', color: '#4A7700', fontFamily: f, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>TIP +</button>
          <button onClick={() => { const i: RoutineItem = { type: 'plus' }; if (section === 'main') setSItems(p => [...p, i]); else setSTipItems(p => [...p, i]); }} style={{ padding: '7px 12px', borderRadius: 9999, border: '1.5px solid rgba(33,150,243,.4)', background: 'rgba(33,150,243,.08)', color: '#1976D2', fontFamily: f, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>+</button>
          <button onClick={() => { const i: RoutineItem = { type: 'minus' }; if (section === 'main') setSItems(p => [...p, i]); else setSTipItems(p => [...p, i]); }} style={{ padding: '7px 12px', borderRadius: 9999, border: '1.5px solid rgba(255,152,0,.4)', background: 'rgba(255,152,0,.08)', color: '#E65100', fontFamily: f, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>→</button>
        </div>
      </div>
    );
  }

  function CtCard({ item }: { item: CtItem }) {
    const prodItems = item.items.filter((i): i is { type: 'product'; id: string } => i.type === 'product');
    return (
      <div style={{ background: '#fff', border: `1.5px solid ${item.published ? '#0C0C0A' : 'rgba(12,12,10,.07)'}`, borderRadius: 16, overflow: 'hidden', marginBottom: 12, transition: 'border-color .2s' }}>
        <div style={{ padding: '14px 16px 10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <span style={{ fontSize: 20, lineHeight: 1, flexShrink: 0 }}>{item.emoji}</span>
            <span style={{ fontFamily: f, fontSize: 17, fontWeight: 700, color: '#0C0C0A', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{item.name}</span>
            <span style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase' as const, padding: '3px 8px', borderRadius: 8, flexShrink: 0, background: item.published ? '#0C0C0A' : '#E4E2DC', color: item.published ? '#fff' : '#9A9490' }}>
              {item.published ? 'ON' : 'OFF'}
            </span>
          </div>
          {item.desc && <div style={{ fontFamily: f, fontSize: 12, color: '#9A9490', lineHeight: 1.5, marginBottom: 10 }}>{item.desc}</div>}
          {prodItems.length > 0 && (
            <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4, marginBottom: 8 }}>
              {prodItems.slice(0, 5).map((it, idx) => (
                <div key={idx} style={{ flexShrink: 0, width: 40, textAlign: 'center' }}>
                  <div style={{ width: 40, height: 40, borderRadius: 8, background: '#EEEDE9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, marginBottom: 3 }}>✦</div>
                  <div style={{ fontFamily: f, fontSize: 11, fontWeight: 600, color: '#0C0C0A', overflow: 'hidden', whiteSpace: 'nowrap' as const, textOverflow: 'ellipsis' }}>{productName(it.id)}</div>
                </div>
              ))}
              {prodItems.length > 5 && <div style={{ flexShrink: 0, width: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: f, fontSize: 11, fontWeight: 700, color: '#9A9490' }}>+{prodItems.length - 5}</div>}
            </div>
          )}
          {item.periodStart && <div style={{ fontFamily: f, fontSize: 11, color: '#9A9490', marginBottom: 6 }}>{fmtDate(item.periodStart)} – {fmtDate(item.periodEnd ?? '')}</div>}
          {item.dates && item.dates.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
              {item.dates.map(d => <span key={d} style={{ fontFamily: f, fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 9999, background: '#E4E2DC', color: '#4A4846' }}>{fmtDate(d)}</span>)}
            </div>
          )}
          {item.tpo && item.tpo.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
              {item.tpo.map(tp => <span key={tp} style={{ fontFamily: f, fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 9999, background: 'rgba(197,255,0,.15)', color: '#4E7D00', border: '1px solid rgba(132,176,0,.3)' }}>{tp}</span>)}
            </div>
          )}
        </div>
        <div style={{ borderTop: '1px solid rgba(12,12,10,.07)', padding: '10px 16px 12px', display: 'flex', gap: 8 }}>
          <button onClick={() => togglePublished(item)} style={{ flex: 1, padding: 10, background: item.published ? '#0C0C0A' : 'rgba(12,12,10,.08)', color: item.published ? '#fff' : '#0C0C0A', border: 'none', borderRadius: 12, fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase' as const, cursor: 'pointer', transition: 'all .15s' }}>
            {item.published ? '활성 ON' : '활성 OFF'}
          </button>
          <button onClick={() => openEdit(item)} style={{ padding: '10px 14px', background: '#EEEDE9', color: '#4A4846', border: '1px solid rgba(12,12,10,.07)', borderRadius: 12, fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' as const, cursor: 'pointer' }}>편집</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: 'fixed', top: 0, bottom: 0, left: 'max(0px,calc(50vw - 215px))', right: 'max(0px,calc(50vw - 215px))', zIndex: 100, background: '#FAFAF8', display: 'flex', flexDirection: 'column', overflowY: 'hidden' }}>
      <Appbar left={<BackButton onClick={onBack} />} center={m.panel.toUpperCase()} />

      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ padding: '28px 20px 20px', borderBottom: '1px solid rgba(12,12,10,.07)' }}>
          <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase' as const, color: '#9A9490', marginBottom: 8 }}>{m.heroType}</div>
          <div style={{ fontFamily: f, fontSize: 32, fontWeight: 900, color: '#0C0C0A', lineHeight: 1, letterSpacing: '-.02em' }}>{m.heroTitle}</div>
          <div style={{ fontFamily: f, fontSize: 12, color: '#9A9490', marginTop: 8, lineHeight: 1.5 }}>{m.heroSub}</div>
        </div>

        {/* 검색 바 */}
        {ctItems.length > 0 && (
          <SearchBar value={ctSearch} onChange={setCtSearch} placeholder={`${m.heroTitle} 이름 검색...`} />
        )}

        {ctItems.length > 0 && (
          <div style={{ padding: '8px 20px 0', fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase' as const, color: '#9A9490' }}>
            {ctSearch.trim() ? `${filteredCtItems.length} / ${ctItems.length} items` : `${ctItems.length} items`}
          </div>
        )}

        <div style={{ padding: '8px 20px 4px' }}>
          <button onClick={openNew} style={{ width: '100%', padding: '12px', border: '1.5px dashed rgba(12,12,10,.14)', borderRadius: 12, background: 'none', fontFamily: f, fontSize: 12, fontWeight: 700, letterSpacing: '.06em', color: '#9A9490', cursor: 'pointer' }}>{m.addBtn}</button>
        </div>

        <div style={{ padding: '8px 20px' }}>
          {ctItems.length === 0 ? (
            <div style={{ padding: '36px 0', textAlign: 'center', fontFamily: f, fontSize: 13, color: '#9A9490', lineHeight: 1.6 }}>등록된 항목이 없습니다.</div>
          ) : filteredCtItems.length === 0 ? (
            <div style={{ padding: '36px 0', textAlign: 'center', fontFamily: f, fontSize: 13, color: '#9A9490' }}>
              &ldquo;{ctSearch}&rdquo; 검색 결과 없음
            </div>
          ) : filteredCtItems.map(item => <CtCard key={item.id} item={item} />)}
        </div>
        <div style={{ height: 40 }} />
      </div>

      {/* Sheet */}
      {sheetOpen && (
        <>
          <div onClick={closeSheet} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 120 }} />
          <div style={{ position: 'fixed', bottom: 0, left: 'max(0px,calc(50vw - 215px))', right: 'max(0px,calc(50vw - 215px))', zIndex: 130, background: '#FAFAF8', borderRadius: '20px 20px 0 0', maxHeight: '94%', overflowY: 'auto', paddingBottom: 40, boxShadow: '0 -4px 40px rgba(0,0,0,.12)' }}>
            <div style={{ position: 'sticky', top: 0, background: 'rgba(250,250,248,.96)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', zIndex: 1, paddingBottom: 14, borderBottom: '1px solid rgba(12,12,10,.07)' }}>
              <div style={{ width: 32, height: 3, background: 'rgba(12,12,10,.14)', borderRadius: 2, margin: '14px auto 0' }} />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px 0' }}>
                <div style={{ fontFamily: f, fontSize: 20, fontWeight: 800, color: '#0C0C0A' }}>{editItem ? `편집: ${editItem.name}` : m.sheetTitle}</div>
                <button onClick={closeSheet} style={{ width: 28, height: 28, borderRadius: 8, background: '#E4E2DC', border: 'none', cursor: 'pointer', fontSize: 12, color: '#4A4846', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
              </div>
            </div>

            {/* Emoji + Name + Desc */}
            <div style={{ padding: '16px 20px 0' }}>
              <span style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.16em', textTransform: 'uppercase' as const, color: '#9A9490', marginBottom: 8, display: 'block' }}>제목</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input value={sEmoji} onChange={e => setSEmoji(e.target.value)} placeholder={m.icon} maxLength={2} style={{ width: 48, padding: '11px 6px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 12, fontSize: 22, textAlign: 'center', background: '#fff', outline: 'none', flexShrink: 0 }} />
                <input value={sName} onChange={e => setSName(e.target.value)} placeholder="이름" style={{ flex: 1, padding: '12px 14px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 12, fontFamily: f, fontSize: 14, color: '#0C0C0A', background: '#fff', outline: 'none' }} />
              </div>
              <textarea value={sDesc} onChange={e => setSDesc(e.target.value)} placeholder="간단한 설명 (선택)..." rows={2} style={{ marginTop: 8, width: '100%', padding: '10px 14px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 12, fontFamily: f, fontSize: 13, color: '#0C0C0A', background: '#fff', outline: 'none', resize: 'none', boxSizing: 'border-box' as const, lineHeight: 1.5 }} />
            </div>

            {/* Item mapping */}
            <div style={{ padding: '0 20px' }}>
              <span style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.16em', textTransform: 'uppercase' as const, color: '#9A9490', marginTop: 16, marginBottom: 8, display: 'block' }}>
                — 아이템 매핑 <span style={{ fontSize: 11, fontWeight: 400, color: '#BCBAB6' }}>{ctType === 'lookbook' ? '(BOX 패션 · 악세서리)' : '(BOX 뷰티)'}</span>
              </span>
              {ChipSection({ label: '', items: sItems, section: 'main', onRemove: (i) => setSItems(p => p.filter((_, j) => j !== i)) })}
            </div>

            {/* TIP */}
            <div style={{ padding: '0 20px' }}>
              <div style={{ borderTop: '1px solid rgba(0,0,0,.05)', marginTop: 14, paddingTop: 2 }}>
                {ChipSection({ label: '— TIP (내용 있을 때만 Today 표시)', items: sTipItems, section: 'tip', onRemove: (i) => setSTipItems(p => p.filter((_, j) => j !== i)) })}
              </div>
            </div>

            {/* Expert tip — 모든 ctType (집중케어·메이크업북·룩북 공통) */}
            <div style={{ padding: '16px 20px 0' }}>
              <ExpertTipField
                value={sExpertTip}
                onChange={setSExpertTip}
                products={domainProducts}
                placeholder="전용 팁 설명 입력... (탭하여 입력)"
              />
            </div>

            {/* Period — care only (선택 사항, 나중에 편집 가능) */}
            {ctType === 'care' && (
              <div style={{ padding: '16px 20px 0' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.16em', textTransform: 'uppercase' as const, color: '#9A9490' }}>케어 기간</span>
                  <span style={{ fontFamily: f, fontSize: 11, color: '#BCBAB6' }}>선택 · 나중에 편집 가능</span>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="date" value={sPeriodStart} onChange={e => setSPeriodStart(e.target.value)} style={{ flex: 1, padding: '10px 12px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 8, fontFamily: f, fontSize: 14, color: '#0C0C0A', background: '#fff', outline: 'none' }} />
                  <span style={{ color: '#9A9490', fontSize: 12 }}>→</span>
                  <input type="date" value={sPeriodEnd} onChange={e => setSPeriodEnd(e.target.value)} style={{ flex: 1, padding: '10px 12px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 8, fontFamily: f, fontSize: 14, color: '#0C0C0A', background: '#fff', outline: 'none' }} />
                </div>
              </div>
            )}

            {/* T.P.O — lookbook only */}
            {ctType === 'lookbook' && (
              <div style={{ padding: '16px 20px 0' }}>
                <span style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.16em', textTransform: 'uppercase' as const, color: '#9A9490', marginBottom: 8, display: 'block' }}>T.P.O</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {TPO_OPTIONS.map(tp => (
                    <button key={tp} onClick={() => setSTpo(p => p.includes(tp) ? p.filter(x => x !== tp) : [...p, tp])} style={{ padding: '7px 14px', borderRadius: 9999, border: `1.5px solid ${sTpo.includes(tp) ? '#0C0C0A' : 'rgba(12,12,10,.14)'}`, background: sTpo.includes(tp) ? '#0C0C0A' : 'transparent', color: sTpo.includes(tp) ? '#fff' : '#4A4846', fontFamily: f, fontSize: 12, fontWeight: 700, cursor: 'pointer', transition: 'all .15s' }}>{tp}</button>
                  ))}
                </div>
              </div>
            )}

            {/* Dates — makeup/lookbook */}
            {ctType !== 'care' && (
              <div style={{ padding: '16px 20px 0' }}>
                <span style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.16em', textTransform: 'uppercase' as const, color: '#9A9490', marginBottom: 8, display: 'block' }}>예정 날짜</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                  {sDates.map(d => (
                    <span key={d} onClick={() => setSDates(p => p.filter(x => x !== d))} style={{ fontFamily: f, fontSize: 12, fontWeight: 700, padding: '5px 10px', borderRadius: 9999, background: '#0C0C0A', color: '#fff', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      {fmtDate(d)} <span style={{ opacity: .6, fontSize: 10 }}>✕</span>
                    </span>
                  ))}
                  <input type="date" onChange={e => { if (e.target.value && !sDates.includes(e.target.value)) { setSDates(p => [...p, e.target.value].sort()); e.target.value = ''; } }} style={{ padding: '5px 10px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 9999, fontFamily: f, fontSize: 12, color: '#0C0C0A', background: '#fff', outline: 'none' }} />
                </div>
              </div>
            )}

            {/* Published toggle */}
            <div style={{ padding: '20px 20px 0' }}>
              <div
                style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
                onClick={() => {
                  const next = !sPublished;
                  setSPublished(next);
                  // ON으로 켤 때 케어 기간 시작일이 비어있으면 오늘 날짜 자동 입력
                  if (next && ctType === 'care' && !sPeriodStart) {
                    setSPeriodStart(new Date().toISOString().slice(0, 10));
                  }
                }}
              >
                <div style={{ width: 44, height: 26, borderRadius: 13, background: sPublished ? '#0C0C0A' : '#D8D6CF', transition: 'background .2s', position: 'relative', flexShrink: 0 }}>
                  <div style={{ position: 'absolute', top: 3, left: sPublished ? 21 : 3, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.3)' }} />
                </div>
                <span style={{ fontFamily: f, fontSize: 14, fontWeight: 700, color: '#0C0C0A' }}>{sPublished ? 'Today에 표시 ON' : 'Today에 표시 OFF'}</span>
              </div>
            </div>

            {/* Action buttons */}
            <div style={{ padding: '16px 20px 4px', display: 'flex', gap: 8 }}>
              <button onClick={closeSheet} style={{ flex: 1, height: 52, background: '#EEEDE9', color: '#0C0C0A', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 12, fontFamily: f, fontSize: 13, fontWeight: 700, cursor: 'pointer', letterSpacing: '.04em' }}>취소</button>
              <button onClick={handleSave} disabled={saving || !sName.trim()} style={{ flex: 2, height: 52, background: sName.trim() ? '#0C0C0A' : 'rgba(12,12,10,.14)', color: sName.trim() ? '#fff' : '#9A9490', border: 'none', borderRadius: 12, fontFamily: f, fontSize: 15, fontWeight: 700, cursor: sName.trim() ? 'pointer' : 'default', transition: 'opacity .2s', letterSpacing: '.02em' }}>{saving ? '저장중...' : editItem ? '수정 저장' : '저장'}</button>
            </div>
            {editItem && (
              <div style={{ padding: '0 20px' }}>
                <button onClick={handleDeleteItem} style={{ width: '100%', padding: 14, background: 'none', border: '1.5px solid rgba(186,26,26,.3)', borderRadius: 12, fontFamily: f, fontSize: 13, color: '#BA1A1A', cursor: 'pointer', fontWeight: 700 }}>삭제</button>
              </div>
            )}
          </div>

          {/* Product picker (inside sheet) */}
          {picker && (
            <>
              <div onClick={() => setPicker(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.25)', zIndex: 141 }} />
              <div style={{ position: 'fixed', bottom: 0, left: 'max(0px,calc(50vw - 215px))', right: 'max(0px,calc(50vw - 215px))', zIndex: 142, background: '#FAFAF8', borderRadius: '20px 20px 0 0', maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 -4px 40px rgba(0,0,0,.12)' }}>
                <div style={{ padding: '12px 16px 0', flexShrink: 0 }}>
                  <div style={{ width: 32, height: 3, background: 'rgba(12,12,10,.14)', borderRadius: 2, margin: '0 auto 16px' }} />
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <div style={{ fontFamily: f, fontSize: 16, fontWeight: 800, color: '#0C0C0A' }}>{picker === 'tip' ? 'TIP ' : ''}제품 선택</div>
                    <button onClick={() => setPicker(null)} style={{ width: 28, height: 28, borderRadius: 8, background: '#E4E2DC', border: 'none', cursor: 'pointer', fontSize: 12, color: '#4A4846', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                  </div>
                  <input type="search" value={pickerSearch} onChange={e => setPickerSearch(e.target.value)} placeholder="제품명 · 브랜드 검색..." autoFocus style={{ width: '100%', padding: '10px 12px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 8, fontFamily: f, fontSize: 13, color: '#0C0C0A', background: '#F4F4F0', outline: 'none', boxSizing: 'border-box' as const, marginBottom: 4 }} />
                  <div style={{ fontFamily: f, fontSize: 11, color: '#9A9490', marginBottom: 8 }}>{pickerSelected.size > 0 ? `${pickerSelected.size}개 선택됨` : 'BOX에서 제품을 선택하세요'}</div>
                </div>
                <div style={{ flex: 1, overflowY: 'auto' }}>
                  {domainProducts.length === 0 ? (
                    <div style={{ padding: '40px 16px', textAlign: 'center', color: '#9A9490', fontFamily: f, fontSize: 13, lineHeight: 1.6 }}>BOX에 {ctType === 'lookbook' ? '패션·악세서리' : '뷰티'} 제품이 없습니다.<br />BOX 탭에서 먼저 추가해주세요.</div>
                  ) : filteredProducts.length === 0 ? (
                    <div style={{ padding: '40px 16px', textAlign: 'center', color: '#9A9490', fontFamily: f, fontSize: 13 }}>검색 결과 없음</div>
                  ) : filteredProducts.map(p => {
                    const isSel = pickerSelected.has(p.id);
                    return (
                      <div key={p.id} onClick={() => setPickerSelected(prev => { const n = new Set(prev); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid rgba(12,12,10,.07)', cursor: 'pointer', background: isSel ? 'rgba(197,255,0,.06)' : 'transparent' }}>
                        <div style={{ width: 36, height: 36, borderRadius: 8, background: '#EEEDE9', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>✦</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontFamily: f, fontSize: 14, fontWeight: 600, color: '#0C0C0A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{p.name}</div>
                          {p.brand && <div style={{ fontFamily: f, fontSize: 12, color: '#9A9490', marginTop: 2 }}>{p.brand}</div>}
                        </div>
                        <div style={{ width: 22, height: 22, borderRadius: '50%', border: `1.5px solid ${isSel ? '#8AB000' : 'rgba(12,12,10,.14)'}`, background: isSel ? '#C5FF00' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#0C0C0A', flexShrink: 0 }}>{isSel ? '✓' : ''}</div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ padding: '12px 16px 32px', flexShrink: 0, borderTop: '1px solid rgba(12,12,10,.07)' }}>
                  <button onClick={confirmPicker} style={{ width: '100%', height: 52, background: '#0C0C0A', color: '#fff', border: 'none', borderRadius: 12, fontFamily: f, fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>완료{pickerSelected.size > 0 ? ` (${pickerSelected.size}개)` : ''}</button>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ─── 공통 스타일 ──────────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif",
  fontSize: 11, fontWeight: 700, letterSpacing: '.16em', textTransform: 'uppercase',
  color: '#9A9490', marginBottom: 10,
};

const fieldLabelStyle: React.CSSProperties = {
  fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif",
  fontSize: 11, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase',
  color: '#9A9490', marginBottom: 5, display: 'block',
};

const dateInputStyle: React.CSSProperties = {
  flex: 1, width: '100%', padding: '10px 12px',
  border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 8,
  fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif",
  fontSize: 14, fontWeight: 600, color: '#0C0C0A',
  background: '#fff', outline: 'none', boxSizing: 'border-box',
  transition: 'border-color .15s',
};

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────────
const VALID_VIEWS: View[] = ['hub', 'sessions', 'editor', 'tracker', 'care', 'makeup', 'lookbook'];

export default function SetupPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [view, setView] = useState<View>('hub');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [draft, setDraft] = useState<EditorDraft | null>(null);
  const [saving, setSaving] = useState(false);
  // 에디터에서 저장 후 돌아올 때 SessionsView를 리마운트해 드롭다운을 닫힌 상태로 초기화
  const [sessionsKey, setSessionsKey] = useState(0);

  // Tracker habits
  const [habits, setHabits] = useState<Habit[]>([]);
  // CT items per type
  const [careItems, setCareItems] = useState<CtItem[]>([]);
  const [makeupItems, setMakeupItems] = useState<CtItem[]>([]);
  const [lookItems, setLookItems] = useState<CtItem[]>([]);

  const userId = user?.uid ?? FALLBACK_USER_ID;

  // ── URL hash로 뷰 초기화 (P10 딥링크 + P12 상태 복원) ──
  // /setup#sessions → sessions 뷰로 바로 진입
  useEffect(() => {
    const hash = typeof window !== 'undefined' ? window.location.hash.slice(1) : '';
    if (hash && VALID_VIEWS.includes(hash as View)) {
      setView(hash as View);
    }
  }, []);

  // 뷰 변경 + URL hash 동기화
  function goView(v: View) {
    setView(v);
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', v === 'hub' ? '/setup' : `/setup#${v}`);
    }
  }

  useEffect(() => {
    if (!auth) { setAuthLoading(false); return; }
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
      if (!u) { setSessions([]); setProducts([]); }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (authLoading || !user) { setLoadingSessions(false); return; }
    if (!db) { setLoadingSessions(false); return; }
    const q = query(collection(db, 'users', userId, 'routines'), orderBy('sessionNumber', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      setSessions(snap.docs.map((d) => migrateSession(d.data() as Record<string, unknown>, d.id)));
      setLoadingSessions(false);
    }, () => setLoadingSessions(false));
    return () => unsub();
  }, [userId, authLoading]);

  useEffect(() => {
    if (authLoading || !user || !db) return;
    const q = query(collection(db, 'users', userId, 'products'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      setProducts(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Product, 'id'>) })));
    }, () => {});
    return () => unsub();
  }, [userId, authLoading]);

  // Habits subscription
  useEffect(() => {
    if (authLoading || !user || !db) return;
    const q = query(collection(db, 'users', userId, 'habits'), orderBy('createdAt', 'asc'));
    const unsub = onSnapshot(q, (snap) => {
      setHabits(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Habit, 'id'>) })));
    }, () => {});
    return () => unsub();
  }, [userId, authLoading]);

  // CT items subscriptions
  useEffect(() => {
    if (authLoading || !user || !db) return;
    const makeCtSub = (col: string, setter: React.Dispatch<React.SetStateAction<CtItem[]>>) => {
      const q = query(collection(db!, 'users', userId, col), orderBy('createdAt', 'desc'));
      return onSnapshot(q, (snap) => {
        setter(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CtItem, 'id'>) })));
      }, () => {});
    };
    const u1 = makeCtSub('careItems', setCareItems);
    const u2 = makeCtSub('makeupItems', setMakeupItems);
    const u3 = makeCtSub('lookItems', setLookItems);
    return () => { u1(); u2(); u3(); };
  }, [userId, authLoading]);

  async function handleLogin() {
    if (!auth) return;
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, provider);
    }
    catch (err) { console.error('[OnStep] 로그인 실패:', err); }
  }

  async function handleLogout() {
    if (!auth) return;
    try { await signOut(auth); setSessions([]); setProducts([]); }
    catch (err) { console.error('[OnStep] 로그아웃 실패:', err); }
  }

  function openNewSession() {
    const nextNum = sessions.length > 0 ? Math.max(...sessions.map((s) => s.sessionNumber)) + 1 : 1;
    setDraft(newDraft(nextNum));
    goView('editor');
  }

  async function handleUpdateSessionNumber(id: string, num: number) {
    if (!user || !db) return;
    try {
      await updateDoc(doc(db, 'users', userId, 'routines', id), { sessionNumber: num, updatedAt: new Date().toISOString() });
    } catch (err) {
      console.error('[OnStep] 회차 번호 수정 실패:', err);
    }
  }

  function openEdit(session: Session) {
    setDraft({ id: session.id, sessionNumber: session.sessionNumber, sessionTag: session.sessionTag ?? '', startDate: session.startDate, endDate: session.endDate, morningTime: session.morningTime, eveningTime: session.eveningTime, morning: session.morning, evening: session.evening });
    goView('editor');
  }

  // 저장만 — 화면 이동 없음 (슬롯 중간 저장 버튼용)
  async function handleSaveOnly() {
    if (!draft) return;
    if (!user) { alert('Google 로그인 후 저장할 수 있습니다.'); return; }
    if (!db) { alert('.env.local에 Firebase 설정을 먼저 입력해주세요.'); return; }
    setSaving(true);
    const now = new Date().toISOString();
    const data = { sessionNumber: draft.sessionNumber, sessionTag: draft.sessionTag || null, startDate: draft.startDate, endDate: draft.endDate, morningTime: draft.morningTime, eveningTime: draft.eveningTime, morning: draft.morning, evening: draft.evening, updatedAt: now };
    try {
      if (draft.id) {
        await updateDoc(doc(db, 'users', userId, 'routines', draft.id), data);
      } else {
        const docRef = await addDoc(collection(db, 'users', userId, 'routines'), { ...data, createdAt: now });
        setDraft(d => d && { ...d, id: docRef.id });
      }
      // 화면 유지 — 목록으로 이동 안 함
    } catch (err) {
      console.error('세션 저장 실패:', err);
      alert('저장에 실패했습니다. Firebase 설정을 확인해주세요.');
    } finally {
      setSaving(false);
    }
  }

  // 저장 + 목록으로 이동 (하단 저장 버튼, 뒤로가기용)
  async function handleSave() {
    if (!draft) return;
    if (!user) { alert('Google 로그인 후 저장할 수 있습니다.'); return; }
    if (!db) { alert('.env.local에 Firebase 설정을 먼저 입력해주세요.'); return; }
    setSaving(true);
    const now = new Date().toISOString();
    const data = { sessionNumber: draft.sessionNumber, sessionTag: draft.sessionTag || null, startDate: draft.startDate, endDate: draft.endDate, morningTime: draft.morningTime, eveningTime: draft.eveningTime, morning: draft.morning, evening: draft.evening, updatedAt: now };
    try {
      if (draft.id) {
        await updateDoc(doc(db, 'users', userId, 'routines', draft.id), data);
      } else {
        await addDoc(collection(db, 'users', userId, 'routines'), { ...data, createdAt: now });
      }
      setSessionsKey(k => k + 1); // 드롭다운 닫힌 상태로 초기화
      goView('sessions');
      setDraft(null);
    } catch (err) {
      console.error('세션 저장 실패:', err);
      alert('저장에 실패했습니다. Firebase 설정을 확인해주세요.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!draft?.id || !db) return;
    if (!confirm('이 세션을 삭제하시겠어요?')) return;
    try {
      await deleteDoc(doc(db, 'users', userId, 'routines', draft.id));
      goView('sessions');
      setDraft(null);
    } catch (err) {
      console.error('세션 삭제 실패:', err);
    }
  }

  // ── Habit CRUD ──────────────────────────────────────────────────────────────
  async function handleAddHabit(h: Omit<Habit, 'id' | 'createdAt' | 'updatedAt'>) {
    if (!user || !db) { alert('로그인이 필요합니다.'); return; }
    const now = new Date().toISOString();
    try {
      await addDoc(collection(db, 'users', userId, 'habits'), { ...h, createdAt: now, updatedAt: now });
    } catch (err) {
      console.error('[OnStep] 습관 추가 실패 — path:', `users/${userId}/habits`, '| error:', err);
      throw err;
    }
  }

  async function handleUpdateHabit(id: string, h: Partial<Omit<Habit, 'id'>>) {
    if (!db) return;
    await updateDoc(doc(db, 'users', userId, 'habits', id), h);
  }

  async function handleDeleteHabit(id: string) {
    if (!db) return;
    await deleteDoc(doc(db, 'users', userId, 'habits', id));
  }

  async function handleToggleHabitToday(id: string, current: boolean) {
    if (!user || !db) { alert('로그인이 필요합니다.'); return; }
    try {
      await updateDoc(doc(db, 'users', userId, 'habits', id), {
        showInToday: !current,
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error('[OnStep] TODAY 토글 실패:', err);
    }
  }

  // ── CtItem CRUD ─────────────────────────────────────────────────────────────
  function ctCollection(ct: CtType) {
    return ct === 'care' ? 'careItems' : ct === 'makeup' ? 'makeupItems' : 'lookItems';
  }

  async function handleAddCtItem(item: Omit<CtItem, 'id' | 'createdAt' | 'updatedAt'>) {
    if (!user || !db) { alert('로그인이 필요합니다.'); return; }
    const now = new Date().toISOString();
    await addDoc(collection(db, 'users', userId, ctCollection(item.ctType)), { ...item, createdAt: now, updatedAt: now })
      .catch((err) => { console.error('[handleAddCtItem] Firestore 오류:', err); throw err; });
  }

  async function handleUpdateCtItem(ctType: CtType, id: string, item: Partial<Omit<CtItem, 'id'>>) {
    if (!db) return;
    await updateDoc(doc(db, 'users', userId, ctCollection(ctType), id), item);
  }

  async function handleDeleteCtItem(ctType: CtType, id: string) {
    if (!db) return;
    await deleteDoc(doc(db, 'users', userId, ctCollection(ctType), id));
  }

  return (
    <>
      <HubView
        onOpenSessions={() => goView('sessions')}
        onOpenTracker={() => goView('tracker')}
        onOpenCare={() => goView('care')}
        onOpenMakeup={() => goView('makeup')}
        onOpenLookbook={() => goView('lookbook')}
      />
      {(view === 'sessions' || view === 'editor') && (
        <SessionsView key={sessionsKey} sessions={sessions} products={products} loading={loadingSessions} onBack={() => goView('hub')} onNew={openNewSession} onEdit={openEdit} onUpdateNumber={handleUpdateSessionNumber} />
      )}
      {view === 'editor' && draft && (
        <EditorView draft={draft} setDraft={setDraft} products={products} onBack={() => goView('sessions')} onSave={handleSave} onSaveOnly={handleSaveOnly} onDelete={handleDelete} saving={saving} />
      )}
      {view === 'tracker' && (
        <TrackerView
          habits={habits}
          user={user}
          onBack={() => goView('hub')}
          onAddHabit={handleAddHabit}
          onUpdateHabit={handleUpdateHabit}
          onDeleteHabit={handleDeleteHabit}
          onToggleToday={handleToggleHabitToday}
        />
      )}
      {view === 'care' && (
        <CtPanel
          ctType="care" ctItems={careItems} products={products}
          onBack={() => goView('hub')}
          onAdd={handleAddCtItem}
          onUpdate={(id, item) => handleUpdateCtItem('care', id, item)}
          onDelete={(id) => handleDeleteCtItem('care', id)}
        />
      )}
      {view === 'makeup' && (
        <CtPanel
          ctType="makeup" ctItems={makeupItems} products={products}
          onBack={() => goView('hub')}
          onAdd={handleAddCtItem}
          onUpdate={(id, item) => handleUpdateCtItem('makeup', id, item)}
          onDelete={(id) => handleDeleteCtItem('makeup', id)}
        />
      )}
      {view === 'lookbook' && (
        <CtPanel
          ctType="lookbook" ctItems={lookItems} products={products}
          onBack={() => goView('hub')}
          onAdd={handleAddCtItem}
          onUpdate={(id, item) => handleUpdateCtItem('lookbook', id, item)}
          onDelete={(id) => handleDeleteCtItem('lookbook', id)}
        />
      )}
    </>
  );
}
