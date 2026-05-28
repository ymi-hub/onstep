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
import UserMenuButton from '@/components/UserMenuButton';

// ─── 타입 정의 ───────────────────────────────────────────────────────────────

type View = 'hub' | 'sessions' | 'editor';

// Firestore 세션 (MORNING/EVENING 각각 독립 DAY 슬롯)
type Session = {
  id: string;
  sessionNumber: number;
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
function HubView({ onOpenSessions, user, onLogin, onLogout }: {
  onOpenSessions: () => void;
  user: User | null;
  onLogin: () => void;
  onLogout: () => void;
}) {
  const cards = {
    left: [
      { id: 'routine', badge: '#SESSION', title: 'ROUTINE SETUP', sub: 'DAILY CALIBRATIONS', cta: 'View Steps →', bg: 'linear-gradient(135deg,#f0ffe0 0%,#c5ff00 100%)', emoji: '🌿', onClick: onOpenSessions, href: undefined },
      { id: 'tracker', badge: '#DAILY', title: 'ROUTINE TRACKER', sub: 'HABIT ALARMS', cta: 'Coming soon', bg: 'linear-gradient(135deg,#f5ffe0 0%,#dcff80 100%)', emoji: '⏰', onClick: null, href: undefined },
      { id: 'look', badge: '#LOOKBOOK', title: 'PLANNING', sub: 'QUARTERLY VISION', cta: 'Coming soon', bg: 'linear-gradient(135deg,#fff0f5 0%,#ffc0d0 100%)', emoji: '📅', onClick: null, href: undefined },
    ],
    right: [
      { id: 'ai-import', badge: '#AI', title: 'AI 가져오기', sub: 'TEXT → ROUTINE', cta: '텍스트 붙여넣기 →', bg: 'linear-gradient(135deg,#f0ffe0 0%,#d8ffaa 100%)', emoji: '✨', onClick: null, href: '/import' },
      { id: 'makeup', badge: '#MAKEUP', title: 'STRATEGY', sub: 'IDENTITY FRAMEWORK', cta: 'Coming soon', bg: 'linear-gradient(135deg,#f5f0ff 0%,#d0b0ff 100%)', emoji: '💄', onClick: null, href: undefined },
      { id: 'care', badge: '#INTENSIVE', title: 'SPECIAL CARE', sub: 'CRITICAL SYSTEMS', cta: 'Coming soon', bg: 'linear-gradient(135deg,#f0f8ff 0%,#a0c8ff 100%)', emoji: '💊', onClick: null, href: undefined },
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
      <Appbar
        left={
          <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
            <span style={{ width: 24, height: 24, borderRadius: 8, background: '#0C0C0A', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#C5FF00', fontSize: 10, fontWeight: 800 }}>OS</span>
          </Link>
        }
        center="OnStep"
        right={<UserMenuButton user={user} onLogin={onLogin} onLogout={onLogout} />}
      />
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
  sessions, products, loading, onBack, onNew, onEdit,
}: {
  sessions: Session[];
  products: Product[];
  loading: boolean;
  onBack: () => void;
  onNew: () => void;
  onEdit: (s: Session) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const font = "'Plus Jakarta Sans','Space Grotesk',sans-serif";

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

  // 아코디언 토글 (하나만 열림)
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

        {/* 새 세션 버튼 */}
        <div style={{ padding: '12px 16px 8px' }}>
          <button onClick={onNew} style={{ width: '100%', padding: 14, border: '1.5px dashed rgba(12,12,10,.14)', borderRadius: 12, background: 'none', fontFamily: font, fontSize: 12, fontWeight: 700, letterSpacing: '.06em', color: '#9A9490', cursor: 'pointer' }}>
            + 새 루틴케어 설정
          </button>
        </div>

        {loading ? (
          <div style={{ padding: '48px 16px', textAlign: 'center', color: '#9A9490', fontFamily: font, fontSize: 13 }}>로딩 중...</div>
        ) : (
          <div>
            {sessions.map((s) => {
              const isExpanded = expandedId === s.id;
              const isNow = isActiveNow(s);
              const morningCount = slotProds(s.morning).length;
              const eveningCount = slotProds(s.evening).length;

              return (
                <div key={s.id}>
                  {/* 세션 행 */}
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
                        No.{s.sessionNumber} SESSION
                        {isNow && (
                          <span style={{ fontFamily: font, fontSize: 10, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase' as const, background: '#0C0C0A', color: '#C5FF00', padding: '2px 7px', borderRadius: 9999, flexShrink: 0 }}>NOW</span>
                        )}
                      </div>
                      <div style={{ fontFamily: font, fontSize: 13, color: '#777370', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                        {fmtDate(s.startDate)} – {fmtDate(s.endDate)} · {Math.max(s.morning.days.length, s.evening.days.length)}DAY
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

                  {/* 펼침 상세 */}
                  {isExpanded && (
                    <div style={{ padding: '14px 16px 16px', background: '#F4F4F0', borderBottom: '1px solid rgba(12,12,10,.07)' }}>
                      <SlotSection icon="☀️" label="MORNING" slot={s.morning} />
                      <SlotSection icon="🌙" label="NIGHT" slot={s.evening} />
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
  draft, setDraft, products, onBack, onSave, onDelete, saving,
}: {
  draft: EditorDraft;
  setDraft: React.Dispatch<React.SetStateAction<EditorDraft | null>>;
  products: Product[];
  onBack: () => void;
  onSave: () => void;
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
    if (!activeInput || !inputText.trim()) { setActiveInput(null); setInputText(''); return; }
    addItems(activeInput.slot, activeInput.section, [{ type: activeInput.type, text: inputText.trim() } as RoutineItem]);
    setActiveInput(null);
    setInputText('');
  }

  // 더미 (타입 에러 방지용 - 아래에서 실제로는 slot별로 처리)
  function setExpertTipDummy(_slot: 'morning' | 'evening', _text: string) {
    setExpertTip(_slot, _text);
  }
  setExpertTipDummy; // suppress unused warning

  // ── 칩 컴포넌트 ─────────────────────────────────────────────────────────

  function ItemChip({ item, onRemove }: { item: RoutineItem; onRemove: () => void }) {
    const DelBtn = () => (
      <button onClick={onRemove} style={{ position: 'absolute', top: -8, right: -8, width: 18, height: 18, borderRadius: '50%', background: 'rgba(0,0,0,.28)', color: '#fff', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, cursor: 'pointer', zIndex: 1, lineHeight: 1 }} aria-label="제거">×</button>
    );
    if (item.type === 'product') return (
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <div style={{ width: 72, height: 72, background: '#fff', border: '1px solid rgba(12,12,10,.07)', borderRadius: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 6 }}>
          <div style={{ width: 30, height: 30, borderRadius: 7, background: '#EEEDE9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, marginBottom: 5 }}>✦</div>
          <div style={{ fontFamily: f, fontSize: 10, color: '#0C0C0A', textAlign: 'center', lineHeight: 1.3, overflow: 'hidden', maxWidth: 60, wordBreak: 'break-all', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{productName(item.id)}</div>
        </div><DelBtn />
      </div>
    );
    if (item.type === 'desc') return (
      <div style={{ position: 'relative', flexShrink: 0, alignSelf: 'center' }}>
        <div style={{ minWidth: 72, maxWidth: 150, height: 72, background: '#E8E6E0', border: '1px solid rgba(0,0,0,.06)', borderRadius: 10, padding: '8px 10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontFamily: f, fontSize: 12, color: '#0C0C0A', lineHeight: 1.35, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', wordBreak: 'break-word', textAlign: 'center' }}>{item.text}</div>
        </div><DelBtn />
      </div>
    );
    if (item.type === 'tip') return (
      <div style={{ position: 'relative', flexShrink: 0, alignSelf: 'center' }}>
        <div style={{ minWidth: 72, maxWidth: 150, height: 72, background: 'rgba(197,255,0,.1)', border: '1.5px solid rgba(132,176,0,.4)', borderRadius: 10, padding: '8px 10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontFamily: f, fontSize: 12, fontWeight: 700, color: '#4E7D00', lineHeight: 1.35, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', wordBreak: 'break-word', textAlign: 'center' }}>{item.text}</div>
        </div><DelBtn />
      </div>
    );
    if (item.type === 'plus') return (
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <div style={{ width: 72, height: 72, border: '1.5px solid rgba(33,150,243,.4)', borderRadius: 10, background: 'rgba(33,150,243,.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, fontWeight: 300, color: '#1976D2' }}>+</div><DelBtn />
      </div>
    );
    return (
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <div style={{ width: 72, height: 72, border: '1.5px solid rgba(255,152,0,.4)', borderRadius: 10, background: 'rgba(255,152,0,.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, fontWeight: 300, color: '#E65100' }}>→</div><DelBtn />
      </div>
    );
  }

  // ── 칩 스트립 섹션 (메인 or TIP 재사용) ────────────────────────────────
  function ChipStrip({
    slotKey, section, items, label, sublabel, borderColor, bgColor, textColor,
  }: {
    slotKey: 'morning' | 'evening'; section: 'main' | 'tip';
    items: RoutineItem[]; label: string; sublabel?: string;
    borderColor?: string; bgColor?: string; textColor?: string;
  }) {
    const isInputActive = activeInput?.slot === slotKey && activeInput?.section === section;
    const isDesc = isInputActive && activeInput?.type === 'desc';
    const isTip = isInputActive && activeInput?.type === 'tip';
    const dayIdx = activeDayIdx[slotKey];

    return (
      <div style={{ marginTop: 12 }}>
        {/* 레이블 */}
        <div style={{ fontFamily: f, fontSize: 12, fontWeight: 700, color: textColor ?? '#9A9490', letterSpacing: '.04em', paddingBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
          {label}{sublabel && <span style={{ fontSize: 11, fontWeight: 400, color: '#BCBAB6' }}>{sublabel}</span>}
        </div>

        {/* 칩 스트립 */}
        {items.length > 0 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '8px 0 10px', alignItems: 'flex-end' }}>
            {items.map((item, idx) => (
              <ItemChip key={idx} item={item} onRemove={() => removeItem(slotKey, section, idx)} />
            ))}
          </div>
        ) : (
          <div style={{ padding: 12, textAlign: 'center', fontSize: 12, color: '#BCBAB6', border: `1.5px dashed ${borderColor ?? 'rgba(12,12,10,.12)'}`, background: bgColor, borderRadius: 10, marginBottom: 8 }}>
            아이템을 추가하세요
          </div>
        )}

        {/* 인라인 설명 입력 */}
        {isDesc && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 8, alignItems: 'center' }}>
            <input value={inputText} onChange={(e) => setInputText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') confirmInput(); if (e.key === 'Escape') { setActiveInput(null); setInputText(''); } }} placeholder="설명 텍스트 입력..." autoFocus style={{ flex: 1, border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 8, padding: '8px 10px', fontFamily: f, fontSize: 13, color: '#0C0C0A', background: '#fff', outline: 'none', boxSizing: 'border-box' as const }} />
            <button onClick={confirmInput} style={{ padding: '8px 14px', border: 'none', borderRadius: 8, background: '#0C0C0A', color: '#fff', fontFamily: f, fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' as const }}>추가</button>
            <button onClick={() => { setActiveInput(null); setInputText(''); }} style={{ padding: '8px', border: 'none', background: 'transparent', color: '#9A9490', fontSize: 16, cursor: 'pointer' }}>✕</button>
          </div>
        )}
        {isTip && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 8, alignItems: 'center' }}>
            <input value={inputText} onChange={(e) => setInputText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') confirmInput(); if (e.key === 'Escape') { setActiveInput(null); setInputText(''); } }} placeholder="팁 텍스트 입력..." autoFocus style={{ flex: 1, border: '1.5px solid rgba(132,176,0,.3)', borderRadius: 8, padding: '8px 10px', fontFamily: f, fontSize: 13, color: '#4E7D00', background: 'rgba(197,255,0,.04)', outline: 'none', boxSizing: 'border-box' as const }} />
            <button onClick={confirmInput} style={{ padding: '8px 14px', border: 'none', borderRadius: 8, background: '#84B000', color: '#fff', fontFamily: f, fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' as const }}>추가</button>
            <button onClick={() => { setActiveInput(null); setInputText(''); }} style={{ padding: '8px', border: 'none', background: 'transparent', color: '#9A9490', fontSize: 16, cursor: 'pointer' }}>✕</button>
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

        {/* 빈 변수 사용 억제 */}
        {dayIdx >= 0 && null}
      </div>
    );
  }

  // ── 슬롯 섹션 (MORNING / EVENING) ────────────────────────────────────────
  // design: 각 슬롯은 독립 DAY 탭 + 아이템매핑 + TIP + EXPERT TIP
  function SlotSection({ slotKey, icon, label }: { slotKey: 'morning' | 'evening'; icon: string; label: string }) {
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
        <ChipStrip slotKey={slotKey} section="main" items={activeDay.items} label="— 아이템 매핑" sublabel="(BOX 뷰티)" />

        {/* TIP 섹션 */}
        <div style={{ borderTop: '1px solid rgba(0,0,0,.05)', marginTop: 14, paddingTop: 2 }}>
          <ChipStrip
            slotKey={slotKey} section="tip" items={activeDay.tipItems}
            label="— TIP" sublabel="(내용 있을 때만 Today 표시)"
            borderColor="rgba(132,176,0,.3)" bgColor="rgba(197,255,0,.03)" textColor="#9A9490"
          />
        </div>

        {/* EXPERT TIP textarea */}
        <div style={{ marginTop: 14 }}>
          <div style={{ fontFamily: f, fontSize: 10, fontWeight: 700, letterSpacing: '.08em', color: '#4E7D00', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
            EXPERT TIP
          </div>
          <div style={{ background: 'rgba(197,255,0,.04)', border: '1.5px solid rgba(132,176,0,.2)', borderRadius: 10 }}>
            <textarea
              value={activeDay.expertTip}
              onChange={(e) => setExpertTip(slotKey, e.target.value)}
              placeholder="루틴에 관한 전용 팁 설명 입력..."
              rows={2}
              style={{ width: '100%', padding: '10px 12px', border: 'none', outline: 'none', resize: 'none', fontFamily: f, fontSize: 13, color: '#4A4846', background: 'transparent', boxSizing: 'border-box' as const, lineHeight: 1.6 }}
            />
          </div>
        </div>
      </div>
    );
  }

  // ── 렌더 ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ position: 'fixed', top: 0, bottom: 0, left: 'max(0px,calc(50vw - 215px))', right: 'max(0px,calc(50vw - 215px))', zIndex: 200, background: '#FAFAF8', display: 'flex', flexDirection: 'column', overflowY: 'hidden' }}>
      {/* 에디터 앱바 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', height: 56, background: 'rgba(250,250,248,.92)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(12,12,10,.07)', flexShrink: 0 }}>
        <BackButton onClick={onBack} />
        <span style={{ fontFamily: f, fontSize: 14, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: '#0C0C0A' }}>SESSION {draft.sessionNumber}</span>
        <button onClick={onSave} disabled={saving} style={{ fontFamily: f, fontSize: 12, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: '#0C0C0A', background: saving ? '#D8D6CF' : '#C5FF00', border: 'none', cursor: saving ? 'default' : 'pointer', padding: '7px 16px', borderRadius: 9999 }}>{saving ? '저장중...' : '저장'}</button>
      </div>

      {/* 본문 스크롤 */}
      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 80 }}>
        {/* 세션 정보 */}
        <div style={{ padding: '20px 16px 0' }}>
          <div style={labelStyle}>세션 정보</div>
          <div style={{ background: '#F4F4F0', borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={fieldLabelStyle}>기간</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="date" value={draft.startDate} onChange={(e) => setDraft((d) => d && { ...d, startDate: e.target.value })} style={dateInputStyle} />
                <span style={{ color: '#9A9490', fontSize: 12 }}>~</span>
                <input type="date" value={draft.endDate} onChange={(e) => setDraft((d) => d && { ...d, endDate: e.target.value })} style={dateInputStyle} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div><label style={fieldLabelStyle}>아침 시간</label><input type="time" value={draft.morningTime} onChange={(e) => setDraft((d) => d && { ...d, morningTime: e.target.value })} style={dateInputStyle} /></div>
              <div><label style={fieldLabelStyle}>저녁 시간</label><input type="time" value={draft.eveningTime} onChange={(e) => setDraft((d) => d && { ...d, eveningTime: e.target.value })} style={dateInputStyle} /></div>
            </div>
          </div>
        </div>

        {/* 슬롯 섹션 */}
        <div style={{ padding: '0 16px 16px' }}>
          <SlotSection slotKey="morning" icon="☀️" label="MORNING" />
          <SlotSection slotKey="evening" icon="🌙" label="NIGHT" />
        </div>

        {/* 세션 삭제 */}
        {draft.id && (
          <div style={{ padding: '16px 16px 0' }}>
            <button onClick={onDelete} style={{ width: '100%', padding: 14, background: 'none', border: '1.5px solid rgba(186,26,26,.3)', borderRadius: 10, fontFamily: f, fontSize: 13, color: '#BA1A1A', cursor: 'pointer', fontWeight: 700 }}>이 세션 삭제</button>
          </div>
        )}
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
export default function SetupPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [view, setView] = useState<View>('hub');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [draft, setDraft] = useState<EditorDraft | null>(null);
  const [saving, setSaving] = useState(false);

  const userId = user?.uid ?? FALLBACK_USER_ID;

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
    setView('editor');
  }

  function openEdit(session: Session) {
    setDraft({ id: session.id, sessionNumber: session.sessionNumber, startDate: session.startDate, endDate: session.endDate, morningTime: session.morningTime, eveningTime: session.eveningTime, morning: session.morning, evening: session.evening });
    setView('editor');
  }

  async function handleSave() {
    if (!draft) return;
    if (!user) { alert('Google 로그인 후 저장할 수 있습니다.'); return; }
    if (!db) { alert('.env.local에 Firebase 설정을 먼저 입력해주세요.'); return; }
    setSaving(true);
    const now = new Date().toISOString();
    const data = { sessionNumber: draft.sessionNumber, startDate: draft.startDate, endDate: draft.endDate, morningTime: draft.morningTime, eveningTime: draft.eveningTime, morning: draft.morning, evening: draft.evening, updatedAt: now };
    try {
      if (draft.id) {
        await updateDoc(doc(db, 'users', userId, 'routines', draft.id), data);
      } else {
        await addDoc(collection(db, 'users', userId, 'routines'), { ...data, createdAt: now });
      }
      setView('sessions');
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
      setView('sessions');
      setDraft(null);
    } catch (err) {
      console.error('세션 삭제 실패:', err);
    }
  }

  return (
    <>
      <HubView onOpenSessions={() => setView('sessions')} user={user} onLogin={handleLogin} onLogout={handleLogout} />
      {(view === 'sessions' || view === 'editor') && (
        <SessionsView sessions={sessions} products={products} loading={loadingSessions} onBack={() => setView('hub')} onNew={openNewSession} onEdit={openEdit} />
      )}
      {view === 'editor' && draft && (
        <EditorView draft={draft} setDraft={setDraft} products={products} onBack={() => setView('sessions')} onSave={handleSave} onDelete={handleDelete} saving={saving} />
      )}
    </>
  );
}
