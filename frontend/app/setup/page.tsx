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

import { useState, useEffect, useRef } from 'react';
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
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  orderBy,
  getDocs,
} from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import { imageFileToBase64 } from '@/lib/imageUtils';
import { useAppContext } from '@/lib/AppContext';
import { FALLBACK_USER_ID } from '@/lib/constants';
import type { Product } from '@/types/product';
import type { RoutineItem, SlotDay, Slot, Session } from '@/types/routine';
import type { Habit, RepeatType } from '@/types/habit';
import type { CtItem, CtType } from '@/types/ctitem';
import type { MedRoutine, MedTime } from '@/types/medication';
import { MED_TIME_LABELS } from '@/types/medication';
import type { HealthRoutine, HealthType } from '@/types/healthroutine';
import { HEALTH_TYPE_LABELS, HEALTH_TYPE_ICONS } from '@/types/healthroutine';
import type { HealthCategory } from '@/types/healthcategory';
import { DEFAULT_HEALTH_CATEGORIES } from '@/types/healthcategory';
import type { DietProgram, DietPattern, DietTimelineItem, DietSlot, DietWarning, DietItem } from '@/types/dietplan';
import ExpertTipField, { buildExpertTipHtml } from '@/components/ExpertTipField';
import SearchBar from '@/components/SearchBar';
import SubPageHeader from '@/components/SubPageHeader';
import PageHeader from '@/components/PageHeader';
import { parseRoutineText, parseRoutinePhases, type ParsedResult } from '@/lib/parseRoutine';

// ─── 타입 정의 ───────────────────────────────────────────────────────────────

type View = 'hub' | 'sessions' | 'editor' | 'tracker' | 'care' | 'makeup' | 'lookbook' | 'medication' | 'health' | 'diet';

// Habit, RepeatType, CtItem, CtType, Session → 공유 types에서 import

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
    morningTime: '06:40',
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
      morningTime: (r.morningTime as string) ?? '06:40',
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
    morningTime: (r.morningTime as string) ?? '06:40',
    eveningTime: (r.eveningTime as string) ?? '22:00',
    morning: emptySlot(),
    evening: emptySlot(),
    createdAt: (r.createdAt as string) ?? '',
    updatedAt: (r.updatedAt as string) ?? '',
  };
}

// Appbar / BackButton 제거됨 → SubPageHeader 공통 컴포넌트로 대체

// ─── HUB 뷰 ─────────────────────────────────────────────────────────────────
// ─── Groq 사용량 카드 ─────────────────────────────────────────────────────────
function GroqUsageSection() {
  const f = "'Plus Jakarta Sans','Space Grotesk',sans-serif";
  const DAILY_LIMIT = 14400;

  const [count, setCount] = useState(0);

  useEffect(() => {
    import('@/lib/groqUsage').then(({ getGroqUsage }) => {
      setCount(getGroqUsage().count);
    });
    const onStorage = () => {
      import('@/lib/groqUsage').then(({ getGroqUsage }) => setCount(getGroqUsage().count));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const pct = Math.min((count / DAILY_LIMIT) * 100, 100);
  const remaining = DAILY_LIMIT - count;

  return (
    <div style={{ background: '#FFFFFF', border: '1px solid #0C0C0A', borderRadius: 0, overflow: 'hidden' }}>
      {/* 상단 — HubCard와 완전히 동일: 그라데이션 + 이모지만 */}
      <div style={{ width: '100%', aspectRatio: '1/1.5', background: 'linear-gradient(135deg,#f0ffe0 0%,#c5ff00 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40 }}>✨</div>

      {/* 뱃지 + 타이틀 + 서브 */}
      <div style={{ padding: '10px 12px 0' }}>
        <div style={{ display: 'inline-block', fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.1em', background: '#C5FF00', color: '#0C0C0A', padding: '3px 8px', borderRadius: 4, marginBottom: 7, textTransform: 'uppercase' as const }}>#AI</div>
        <div style={{ fontFamily: f, fontSize: 14, fontWeight: 800, color: '#0C0C0A', lineHeight: 1.2, marginBottom: 3, letterSpacing: '-.01em' }}>AI 사용량</div>
        <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase' as const, color: '#9A9490' }}>GROQ FREE TIER</div>
      </div>

      {/* 수치 + 프로그레스 바 */}
      <div style={{ padding: '10px 12px 12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
          <span style={{ fontFamily: f, fontSize: 18, fontWeight: 800, color: '#0C0C0A' }}>{count.toLocaleString()}<span style={{ fontSize: 10, fontWeight: 600, color: '#9A9490', marginLeft: 3 }}>/ {DAILY_LIMIT.toLocaleString()}</span></span>
          <span style={{ fontFamily: f, fontSize: 10, fontWeight: 700, color: '#4A7700' }}>{remaining.toLocaleString()} 남음</span>
        </div>
        <div style={{ height: 4, background: 'rgba(12,12,10,.07)', borderRadius: 9999, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: pct > 80 ? '#E94F6B' : '#C5FF00', borderRadius: 9999, transition: 'width .4s ease' }} />
        </div>
      </div>

      {/* CTA 푸터 — 매일 초기화 안내 */}
      <div style={{ borderTop: '1px solid #0C0C0A', padding: '10px 12px', fontFamily: f, fontSize: 12, fontWeight: 600, color: '#9A9490' }}>
        매일 자정 초기화
      </div>
    </div>
  );
}

function HubView({ onOpenSessions, onOpenTracker, onOpenCare, onOpenMedication, onOpenHealth, onOpenDiet }: {
  onOpenSessions: () => void;
  onOpenTracker: () => void;
  onOpenCare: () => void;
  onOpenMedication: () => void;
  onOpenHealth: () => void;
  onOpenDiet: () => void;
}) {
  // 메이크업·룩북은 LOG [아카이브] 탭으로 이동됨
  const cards = {
    left: [
      { id: 'routine',    badge: '#SESSION',    title: '스킨케어 루틴', sub: 'DAILY CALIBRATIONS',  cta: '단계 보기 →',  bg: 'linear-gradient(135deg,#f0ffe0 0%,#c5ff00 100%)', emoji: '🌿', onClick: onOpenSessions,  href: undefined },
      { id: 'tracker',    badge: '#DAILY',      title: '습관 트래커',  sub: 'DAILY TRACKING',       cta: '관리하기 →',   bg: 'linear-gradient(135deg,#f5ffe0 0%,#dcff80 100%)', emoji: '⏰', onClick: onOpenTracker,  href: undefined },
      { id: 'medication', badge: '#MEDICATION', title: '약 루틴',      sub: 'MEDICATION SCHEDULE',  cta: '설정하기 →',   bg: 'linear-gradient(135deg,#fff8f0 0%,#ffe0b0 100%)', emoji: '💊', onClick: onOpenMedication, href: undefined },
      { id: 'health', badge: '#HEALTH',    title: '건강 루틴',     sub: 'DIET · EXERCISE · MEAL', cta: '계획하기 →', bg: 'linear-gradient(135deg,#f0fff4 0%,#a0e0b0 100%)', emoji: '🥗', onClick: onOpenHealth, href: undefined },
    ],
    right: [
      { id: 'care',   badge: '#INTENSIVE', title: '집중 케어',     sub: 'CRITICAL SYSTEMS',     cta: '관리하기 →',  bg: 'linear-gradient(135deg,#f0f8ff 0%,#a0c8ff 100%)', emoji: '🧴', onClick: onOpenCare,   href: undefined },
      { id: 'diet',   badge: '#RESET',     title: '리셋 플랜',     sub: 'SUPPLEMENT PROTOCOL',  cta: '편집하기 →',  bg: 'linear-gradient(135deg,#fdf4ff 0%,#e0a0ff 100%)', emoji: '📋', onClick: onOpenDiet,   href: undefined },
    ],
  };

  type HubCardData = { id: string; badge: string; title: string; sub: string; cta: string; bg: string; emoji: string; onClick: (() => void) | null; href: string | undefined };
  function HubCard({ card }: { card: HubCardData }) {
    const isClickable = !!card.onClick || !!card.href;
    const cardStyle = {
      background: '#FFFFFF', border: '1px solid #0C0C0A', borderRadius: 0,
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
        <div style={{ borderTop: '1px solid #0C0C0A', padding: '10px 12px', fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 12, fontWeight: 600, color: '#0C0C0A' }}>{card.cta}</div>
      </>
    );
    if (card.href) return <Link href={card.href} style={cardStyle}>{cardContent}</Link>;
    return <div onClick={card.onClick ?? undefined} style={cardStyle}>{cardContent}</div>;
  }

  return (
    <div style={{ background: '#FAFAF8', minHeight: '100%' }}>
      {/* 페이지 헤더 — 공통 PageHeader 컴포넌트 */}
      <div style={{ borderBottom: '1px solid rgba(12,12,10,.07)' }}>
        <PageHeader
          label="Setup"
          title="Setup"
          subtitle="루틴 · 습관 · 케어"
        />
      </div>
      {/* 시작 가이드 배너 */}
      <div style={{ margin: '16px 16px 0', padding: '14px 16px', background: '#0C0C0A', borderRadius: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 11, fontWeight: 800, letterSpacing: '.12em', color: '#C5FF00', marginBottom: 3 }}>HOW TO START</div>
          <div style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 12, color: 'rgba(255,255,255,.7)', lineHeight: 1.5 }}>
            <span style={{ color: '#C5FF00', fontWeight: 700 }}>1 BOX</span> 제품 등록 →{' '}
            <span style={{ color: '#C5FF00', fontWeight: 700 }}>2 스킨케어 루틴</span> 플랜 설계 →{' '}
            <span style={{ color: '#C5FF00', fontWeight: 700 }}>3 TODAY</span> 매일 체크
          </div>
        </div>
        <span style={{ fontSize: 28, flexShrink: 0 }}>🌿</span>
      </div>

      <div style={{ padding: '16px 16px 8px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{cards.left.map((c) => <HubCard key={c.id} card={c as HubCardData} />)}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 64 }}>
          {cards.right.map((c) => <HubCard key={c.id} card={c as HubCardData} />)}
          {/* Groq AI 사용량 — 메이크업 카드 하단 */}
          <GroqUsageSection />
        </div>
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
  const [visibleCount, setVisibleCount] = useState(5);

  // 검색 바뀌면 더보기 초기화
  useEffect(() => { setVisibleCount(5); }, [search]);

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

  // TIP 섹션에서 제품만 추출
  function dayTipProds(day: SlotDay): { type: 'product'; id: string }[] {
    return day.tipItems.filter((i): i is { type: 'product'; id: string } => i.type === 'product');
  }

  // EXPERT TIP 텍스트 안에서 BOX 제품명 매칭 → 하이라이팅된 제품명 목록 반환
  function expertTipMentions(day: SlotDay): string[] {
    if (!day.expertTip?.trim()) return [];
    const text = day.expertTip.toLowerCase();
    return [...products]
      .sort((a, b) => b.name.length - a.name.length)
      .filter(p => p.name.trim() && text.includes(p.name.toLowerCase()))
      .map(p => p.name);
  }

  function toggle(id: string) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  // 단일 DAY 열 렌더링
  function DayCol({ day, isRight }: { day: SlotDay; isRight: boolean }) {
    const prods = dayProds(day);
    const tipProds = dayTipProds(day);
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
        {/* 메인 제품 목록 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {prods.map((item, idx) => (
            <div key={idx} style={{ fontFamily: font, fontSize: 11, color: '#0C0C0A', padding: '4px 6px', background: '#FAFAF8', border: '1px solid rgba(12,12,10,.07)', borderRadius: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
              {pName(item.id)}
            </div>
          ))}
        </div>
        {/* TIP 제품 (있을 때만) */}
        {tipProds.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 6 }}>
            <div style={{ fontFamily: font, fontSize: 9, fontWeight: 800, letterSpacing: '.12em', color: '#B8A08A' }}>TIP</div>
            {tipProds.map((item, idx) => (
              <div key={idx} style={{ fontFamily: font, fontSize: 11, color: '#7A6A58', padding: '3px 6px', background: '#FDF8F3', border: '1px solid rgba(184,160,138,.25)', borderRadius: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                {pName(item.id)}
              </div>
            ))}
          </div>
        )}
        {/* EXPERT TIP 하이라이팅 제품 (있을 때만) */}
        {expertTipMentions(day).length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 6 }}>
            <div style={{ fontFamily: font, fontSize: 9, fontWeight: 800, letterSpacing: '.12em', color: '#A1A1AA' }}>TIPS</div>
            {expertTipMentions(day).map((name, idx) => (
              <div key={idx} style={{ fontFamily: font, fontSize: 11, color: '#3A6000', padding: '3px 6px', background: 'rgba(197,255,0,.12)', border: '1px solid rgba(132,176,0,.25)', borderRadius: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                {name}
              </div>
            ))}
          </div>
        )}
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
            {/* TIP 제품 (있을 때만) */}
            {dayTipProds(firstRow[0]).length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 6 }}>
                <div style={{ fontFamily: font, fontSize: 9, fontWeight: 800, letterSpacing: '.12em', color: '#B8A08A' }}>TIP</div>
                {dayTipProds(firstRow[0]).map((item, idx) => (
                  <div key={idx} style={{ fontFamily: font, fontSize: 11, color: '#7A6A58', padding: '3px 6px', background: '#FDF8F3', border: '1px solid rgba(184,160,138,.25)', borderRadius: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                    {pName(item.id)}
                  </div>
                ))}
              </div>
            )}
            {/* EXPERT TIP 하이라이팅 제품 (있을 때만) */}
            {expertTipMentions(firstRow[0]).length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 6 }}>
                <div style={{ fontFamily: font, fontSize: 9, fontWeight: 800, letterSpacing: '.12em', color: '#A1A1AA' }}>TIPS</div>
                {expertTipMentions(firstRow[0]).map((name, idx) => (
                  <div key={idx} style={{ fontFamily: font, fontSize: 11, color: '#3A6000', padding: '3px 6px', background: 'rgba(197,255,0,.12)', border: '1px solid rgba(132,176,0,.25)', borderRadius: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                    {name}
                  </div>
                ))}
              </div>
            )}
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
      <SubPageHeader title="스킨케어 루틴" onClose={onBack} />
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

        {loading ? (
          <div style={{ padding: '48px 16px', textAlign: 'center', color: '#9A9490', fontFamily: font, fontSize: 13 }}>로딩 중...</div>
        ) : (
          <div>
            {filteredSessions.length === 0 && search.trim() ? (
              <div style={{ padding: '36px 16px', textAlign: 'center', fontFamily: font, fontSize: 13, color: '#9A9490' }}>
                &ldquo;{search}&rdquo; 검색 결과 없음
              </div>
            ) : null}
            {filteredSessions.slice(0, visibleCount).map((s, idx) => {
              const isExpanded = expandedId === s.id;
              const isNow = isActiveNow(s);
              const morningCount = slotProds(s.morning).length;
              const eveningCount = slotProds(s.evening).length;

              // 년도 구분 헤더: startDate 기준, 없으면 createdAt 사용
              const year = s.startDate ? s.startDate.slice(0, 4)
                : (s.createdAt || '').slice(0, 4) || '?';
              const prevYear = idx > 0
                ? (filteredSessions[idx - 1].startDate
                    ? filteredSessions[idx - 1].startDate.slice(0, 4)
                    : (filteredSessions[idx - 1].createdAt || '').slice(0, 4) || '?')
                : null;
              const showYearHeader = year !== prevYear;

              return (
                <div key={s.id}>
                  {showYearHeader && (
                    <div style={{
                      padding: idx > 0 ? '16px 16px 8px' : '12px 16px 8px',
                      borderTop: idx > 0 ? '1.5px solid rgba(12,12,10,.07)' : 'none',
                    }}>
                      <span style={{
                        fontFamily: font,
                        fontSize: 11,
                        fontWeight: 800,
                        letterSpacing: '.1em',
                        color: '#0C0C0A',
                        background: '#E4E2DC',
                        padding: '4px 10px',
                        borderRadius: 9999,
                        textTransform: 'uppercase' as const,
                      }}>
                        {year}
                      </span>
                    </div>
                  )}
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
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, transition: 'transform .2s', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}><path d="M3 5.5L8 10.5L13 5.5" stroke="#9A9490" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
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
                        편집
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            {/* 더보기 버튼 */}
            {filteredSessions.length > visibleCount && (
              <button
                onClick={() => setVisibleCount(n => n + 5)}
                style={{
                  width: '100%', padding: '16px 0',
                  border: 'none', borderTop: '1px solid rgba(12,12,10,.07)',
                  background: 'none', cursor: 'pointer',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                }}
              >
                <span style={{ fontFamily: font, fontSize: 13, fontWeight: 700, color: '#0C0C0A', letterSpacing: '.06em' }}>
                  MORE ({visibleCount}/{filteredSessions.length})
                </span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0C0C0A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </button>
            )}
          </div>
        )}
        <div style={{ height: 88 }} />
      </div>

      {/* FAB — 새 루틴 추가 */}
      <button
        onClick={onNew}
        style={{
          position: 'absolute', bottom: 24, right: 18, zIndex: 10,
          width: 52, height: 52, borderRadius: 9999,
          background: '#C5FF00', color: '#0C0C0A',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: 'none', cursor: 'pointer',
          boxShadow: '0 4px 20px rgba(197,255,0,.4)',
          fontSize: 22, fontWeight: 700,
          transition: 'transform .18s',
        }}
        aria-label="루틴 추가"
      >
        ＋
      </button>
    </div>
  );
}

// ─── EDITOR 뷰 ───────────────────────────────────────────────────────────────
// MORNING / EVENING 각각 독립 DAY 탭 + 아이템 매핑 + TIP 섹션 + EXPERT TIP
function EditorView({
  draft, setDraft, products, onBack, onSave, onSaveOnly, onDelete, saving, userId,
}: {
  draft: EditorDraft;
  setDraft: React.Dispatch<React.SetStateAction<EditorDraft | null>>;
  products: Product[];
  onBack: () => void;
  onSave: () => void;
  onSaveOnly: () => void;
  onDelete: () => void;
  saving: boolean;
  userId: string;
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

  // AI 가져오기 패널 상태 (null이면 닫힘)
  const [aiPanel, setAiPanel] = useState<{ slot: 'morning' | 'evening' } | null>(null);

  // 스킨케어 루틴 — 뷰티 도메인 제품만 노출
  const domainProducts = products.filter(p => p.domain === 'beauty');

  const filteredProducts = domainProducts.filter((p) => {
    if (!pickerSearch) return true;
    const q = pickerSearch.toLowerCase();
    return p.name.toLowerCase().includes(q) || (p.brand ?? '').toLowerCase().includes(q);
  });

  // 검색어로 제품 없을 때 → BOX에 즉시 등록 후 피커에 추가 (실시간 동기화)
  async function registerAndAdd(name: string) {
    if (!db || !name.trim()) return;
    const now = new Date().toISOString();
    const ref = await addDoc(collection(db, 'users', userId, 'products'), {
      name: name.trim(), brand: '', domain: 'beauty', subCategory: 'skincare',
      packageCount: 1, unitPerPackage: 0, itemUnit: '', totalAmount: 0,
      dosePerUse: 0, usesPerDay: 1, frequencyType: 'daily', currentRemaining: 0,
      createdAt: now, updatedAt: now,
    });
    setPickerSelected(prev => { const n = new Set(prev); n.add(ref.id); return n; });
    setPickerSearch('');
  }

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
    onAIImport?: () => void;
  }) {
    const { slotKey, section, items, label, sublabel, borderColor, bgColor, textColor, onAIImport } = p;
    const isInputActive = activeInput?.slot === slotKey && activeInput?.section === section;
    const isDesc = isInputActive && activeInput?.type === 'desc';
    const isTip = isInputActive && activeInput?.type === 'tip';
    const isDraggingHere = dragIdx?.slot === slotKey && dragIdx?.section === section;

    return (
      <div style={{ marginTop: 12 }}>
        {/* 라벨 행 — 아이템 매핑(main) 섹션에만 오른쪽에 AI 버튼 표시 */}
        <div style={{ fontFamily: f, fontSize: 12, fontWeight: 700, color: textColor ?? '#9A9490', letterSpacing: '.04em', paddingBottom: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {label}{sublabel && <span style={{ fontSize: 11, fontWeight: 400, color: '#BCBAB6' }}>{sublabel}</span>}
          </div>
          {/* section === 'main'일 때만 AI 버튼 노출 */}
          {section === 'main' && onAIImport && (
            <button
              onClick={onAIImport}
              style={{ padding: '4px 10px', borderRadius: 9999, border: 'none', background: '#0C0C0A', color: '#C5FF00', fontFamily: f, fontSize: 11, fontWeight: 800, cursor: 'pointer', letterSpacing: '.04em', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' as const }}
            >
              ✨ AI
            </button>
          )}
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
          <button onClick={() => openPicker(slotKey, section)} style={{ padding: '7px 10px', background: '#0C0C0A', border: 'none', borderRadius: 8, fontFamily: f, fontSize: 11, fontWeight: 700, color: '#C5FF00', cursor: 'pointer', flexShrink: 0 }}>BOX</button>
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

        {/* 아이템 매핑 섹션 — AI 가져오기 + 수동 입력 혼합 편집 가능 */}
        {ChipStrip({ slotKey, section: 'main', items: activeDay.items, label: '— 아이템 매핑', sublabel: '(BOX 뷰티 · AI/수동)', onAIImport: () => setAiPanel({ slot: slotKey }) })}

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

        {/* 슬롯 하단 저장 버튼 — 화면 이동 없이 저장만 (50% 너비, 우측 정렬) */}
        <div style={{ marginTop: 20, paddingTop: 14, borderTop: '1px solid rgba(12,12,10,.06)', display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={onSaveOnly}
            disabled={saving}
            style={{
              width: '50%', padding: '12px 0',
              background: saving ? '#D8D6CF' : '#C5FF00',
              color: saving ? '#9A9490' : '#0C0C0A',
              border: 'none', borderRadius: 10,
              fontFamily: f, fontSize: 13, fontWeight: 700,
              letterSpacing: '.06em', cursor: saving ? 'default' : 'pointer',
              transition: 'background .15s',
            }}
          >
            {saving ? '저장중...' : '저장'}
          </button>
        </div>
      </div>
    );
  }

  // ── 렌더 ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ position: 'fixed', top: 0, bottom: 0, left: 'max(0px,calc(50vw - 215px))', right: 'max(0px,calc(50vw - 215px))', zIndex: 200, background: '#FAFAF8', display: 'flex', flexDirection: 'column', overflowY: 'hidden' }}>
      {/* 에디터 헤더 — SubPageHeader 공통 스타일 */}
      <SubPageHeader title="ROUTINE EDIT" onClose={onBack} />

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
              <div>
                <label style={fieldLabelStyle}>아침 시간</label>
                <TimePickerField value={draft?.morningTime || ''} onChange={v => setDraft(d => d && { ...d, morningTime: v })} f={f} />
              </div>
              <div>
                <label style={fieldLabelStyle}>저녁 시간</label>
                <TimePickerField value={draft?.eveningTime || ''} onChange={v => setDraft(d => d && { ...d, eveningTime: v })} f={f} />
              </div>
            </div>
          </div>
        </div>

        {/* 아침/저녁 DAY 수 불일치 경고 */}
        {draft.morning.days.length !== draft.evening.days.length && (
          <div style={{ margin: '0 16px 12px', padding: '10px 14px', background: '#FFF8E1', border: '1px solid #FFD54F', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 16 }}>⚠️</span>
            <span style={{ fontFamily: f, fontSize: 12, fontWeight: 600, color: '#7A5F00', lineHeight: 1.4 }}>
              아침({draft.morning.days.length}일)과 저녁({draft.evening.days.length}일) DAY 수가 달라요. 저장하면 짧은 쪽 기준으로 TODAY에 표시될 수 있어요.
            </span>
          </div>
        )}

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
          {saving ? '저장중...' : '저장'}
        </button>
      </div>

      {/* AI 가져오기 패널 */}
      {aiPanel && (
        <AiImportPanel
          products={products}
          panelLabel={aiPanel.slot === 'morning' ? '☀️ 아침 루틴 AI 가져오기' : '🌙 저녁 루틴 AI 가져오기'}
          confirmLabel={aiPanel.slot === 'morning' ? '아침 슬롯에 추가 →' : '저녁 슬롯에 추가 →'}
          onClose={() => setAiPanel(null)}
          onImport={(items) => {
            addItems(aiPanel.slot, 'main', items);
            setAiPanel(null);
          }}
        />
      )}

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
              {domainProducts.length === 0 && !pickerSearch.trim() ? (
                <div style={{ padding: '40px 16px', textAlign: 'center', color: '#9A9490', fontFamily: f, fontSize: 13, lineHeight: 1.6 }}>BOX에 뷰티 제품이 없습니다.<br />BOX 탭에서 먼저 제품을 추가해주세요.</div>
              ) : (
                <>
                  {filteredProducts.map((p) => {
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
                  })}
                  {/* 검색어 있고 결과 없으면 → 이름으로 등록 후 추가 */}
                  {pickerSearch.trim() && filteredProducts.length === 0 && (
                    <div onClick={() => registerAndAdd(pickerSearch)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', cursor: 'pointer', background: 'rgba(197,255,0,.06)', borderBottom: '1px solid rgba(12,12,10,.07)' }}>
                      <div style={{ width: 36, height: 36, borderRadius: 8, background: '#C5FF00', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 300 }}>+</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontFamily: f, fontSize: 14, fontWeight: 700, color: '#0C0C0A' }}>"{pickerSearch.trim()}" 이름으로 등록 후 추가</div>
                        <div style={{ fontFamily: f, fontSize: 11, color: '#9A9490', marginTop: 2 }}>BOX에 자동 저장 · 나중에 상세 정보 수정 가능</div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
            <div style={{ padding: '12px 16px calc(env(safe-area-inset-bottom, 0px) + 32px)', flexShrink: 0, borderTop: '1px solid rgba(12,12,10,.07)' }}>
              <button onClick={confirmPicker} style={{ width: '100%', height: 52, background: '#0C0C0A', color: '#fff', border: 'none', borderRadius: 12, fontFamily: f, fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>완료{pickerSelected.size > 0 ? ` (${pickerSelected.size}개)` : ''}</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── AI 가져오기 패널 ────────────────────────────────────────────────────────
// 범용 바텀시트 — 스킨케어 루틴 에디터 / 집중케어 등 어디서든 재사용
// 텍스트 입력 → Groq 파싱 → 아이템 미리보기 → onImport 콜백으로 주입
function AiImportPanel({
  products,
  onClose,
  onImport,
  panelLabel = 'AI 가져오기',
  confirmLabel = '추가 →',
}: {
  products: Product[];
  onClose: () => void;
  onImport: (items: RoutineItem[]) => void;
  panelLabel?: string;
  confirmLabel?: string;
}) {
  const f = "'Plus Jakarta Sans','Space Grotesk',sans-serif";

  // 단계 시퀀스만 파싱 (슬롯/DAY 구분 없음)
  type PanelPhase = 'input' | 'parsing' | 'result';

  const [panelPhase, setPanelPhase] = useState<PanelPhase>('input');
  const [text, setText] = useState('');
  const [previewItems, setPreviewItems] = useState<RoutineItem[]>([]);
  const [error, setError] = useState('');

  // ParsedPhase[] → RoutineItem[] 변환
  // + 혼합 제품 사이 → plus 칩(+ 노출)
  // - 단계 구분     → minus 칩(→ 노출)
  // 조사/설명 텍스트 → desc 칩
  function phasesToItems(phases: import('@/lib/parseRoutine').ParsedPhase[]): RoutineItem[] {
    const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, '');

    // Levenshtein 거리 — 오타 허용 매핑용
    function lev(a: string, b: string): number {
      const dp = Array.from({ length: a.length + 1 }, (_, i) =>
        Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
      for (let i = 1; i <= a.length; i++)
        for (let j = 1; j <= b.length; j++)
          dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
      return dp[a.length][b.length];
    }

    function matchProduct(name: string): Product | null {
      const n = normalize(name);
      // 1. 정확 일치
      const exact = products.find((p) => normalize(p.name) === n);
      if (exact) return exact;
      // 2. 포함 일치
      const contains = products.find((p) => { const pn = normalize(p.name); return pn.includes(n) || n.includes(pn); });
      if (contains) return contains;
      // 3. 오타 허용 (짧은 이름 1자, 긴 이름 2자 차이 허용)
      const maxDist = n.length <= 4 ? 1 : 2;
      return products.find((p) => lev(normalize(p.name), n) <= maxDist) ?? null;
    }
    const items: RoutineItem[] = [];
    phases.forEach((phase, pIdx) => {
      // 제품 앞 설명 텍스트 → desc 칩
      if (phase.preText?.trim()) items.push({ type: 'desc', text: phase.preText.trim() });
      // 혼합 제품들 사이에 + 칩 삽입
      phase.products.forEach((name, nameIdx) => {
        const matched = matchProduct(name);
        items.push(matched ? { type: 'product', id: matched.id } : { type: 'desc', text: name });
        if (nameIdx < phase.products.length - 1) items.push({ type: 'plus' }); // + 구문
      });
      // 제품 뒤 설명 텍스트 → desc 칩
      if (phase.instruction) items.push({ type: 'desc', text: phase.instruction });
      // 단계 구분 → → 구문
      if (pIdx < phases.length - 1) items.push({ type: 'minus' });
    });
    return items;
  }

  const handleParse = async () => {
    if (!text.trim()) return;
    setPanelPhase('parsing');
    setError('');
    try {
      const phases = await parseRoutinePhases(text, products.map(p => p.name));
      setPreviewItems(phasesToItems(phases));
      setPanelPhase('result');
    } catch (e) {
      setError(e instanceof Error ? e.message : '분석 실패');
      setPanelPhase('input');
    }
  };


  return (
    <>
      {/* 딤 배경 */}
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 320 }} />

      {/* 패널 본체 */}
      <div style={{ position: 'fixed', bottom: 0, left: 'max(0px,calc(50vw - 215px))', right: 'max(0px,calc(50vw - 215px))', zIndex: 330, background: '#FAFAF8', borderRadius: '20px 20px 0 0', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 -4px 40px rgba(0,0,0,.15)' }}>
        {/* 드래그 핸들 */}
        <div style={{ width: 32, height: 3, background: 'rgba(12,12,10,.14)', borderRadius: 2, margin: '10px auto 0', flexShrink: 0 }} />

        {/* 헤더 */}
        <div style={{ padding: '12px 16px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(12,12,10,.07)', flexShrink: 0 }}>
          <div>
            <div style={{ fontFamily: f, fontSize: 15, fontWeight: 800, color: '#0C0C0A' }}>
              ✨ {panelLabel}
            </div>
            {/* AI 가져오기 = 수동 입력과 동일한 칩 구조 → 추가 후 자유롭게 편집·정렬·혼합 가능 */}
            <div style={{ fontFamily: f, fontSize: 11, color: '#9A9490', marginTop: 2 }}>
              추가 후 수동 입력과 동일하게 편집 · 정렬 · 혼합 가능
            </div>
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 8, background: '#E4E2DC', border: 'none', cursor: 'pointer', fontSize: 12, color: '#4A4846', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
        </div>

        {/* 스크롤 본문 */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {panelPhase === 'input' || panelPhase === 'parsing' ? (
            // ── 입력 단계 ──
            <div style={{ padding: '16px 16px 32px' }}>
              {error && (
                <div style={{ marginBottom: 12, padding: '10px 14px', background: '#FFF0F0', border: '1px solid rgba(255,0,0,.15)', borderRadius: 10, fontFamily: f, fontSize: 12, color: '#CC0000', display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                  <span style={{ flexShrink: 0 }}>⚠️</span>{error}
                </div>
              )}
              <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, color: '#9A9490', letterSpacing: '.08em', marginBottom: 8 }}>루틴 텍스트</div>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                disabled={panelPhase === 'parsing'}
                placeholder={`예시:\n아침은\n구해줘앰플+새살세럼 섞어서 얇게 펴바르고-인투토너-델마크림으로 마무리\n\n하루아침은\n버터토너-델마세럼-라이지세럼으로 마무리`}
                rows={7}
                style={{ width: '100%', padding: '12px 14px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 12, fontFamily: f, fontSize: 13, lineHeight: 1.7, color: '#0C0C0A', background: '#F4F4F0', outline: 'none', resize: 'none' as const, boxSizing: 'border-box' as const }}
              />
              <div style={{ marginTop: 4, fontFamily: f, fontSize: 11, color: '#BCBAB6' }}>
                루틴 텍스트를 붙여넣으세요{text.length > 0 ? ` · ${text.length}자` : ''}
              </div>
              <button
                onClick={handleParse}
                disabled={panelPhase === 'parsing' || !text.trim()}
                style={{ marginTop: 14, width: '100%', height: 44, borderRadius: 10, border: 'none', background: panelPhase === 'parsing' || !text.trim() ? 'rgba(12,12,10,.08)' : '#0C0C0A', color: panelPhase === 'parsing' || !text.trim() ? '#9A9490' : '#C5FF00', fontFamily: f, fontSize: 13, fontWeight: 800, cursor: panelPhase === 'parsing' || !text.trim() ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
              >
                {panelPhase === 'parsing' ? (
                  <>
                    <span style={{ width: 12, height: 12, border: '2px solid rgba(255,255,255,.3)', borderTopColor: '#C5FF00', borderRadius: 9999, display: 'inline-block', animation: 'spin .8s linear infinite' }} />
                    분석 중...
                  </>
                ) : '✨ AI 분석하기'}
              </button>
            </div>
          ) : (
            // ── 결과 단계 ──
            <div style={{ padding: '16px 16px 32px' }}>
              {/* 결과 헤더 카드 */}
              <div style={{ background: 'linear-gradient(135deg,#f0ffe0,#e8ffc0)', border: '1px solid rgba(197,255,0,.3)', borderRadius: 12, padding: '12px 14px', marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontFamily: f, fontSize: 13, fontWeight: 800, color: '#0C0C0A' }}>
                    ✨ 분석 완료
                  </div>
                  <div style={{ fontFamily: f, fontSize: 11, color: '#4A7700', marginTop: 2 }}>
                    {previewItems.length}개 아이템 · 추가 후 수동 편집·드래그 가능
                  </div>
                </div>
                <div style={{ fontSize: 20 }}>✨</div>
              </div>

              {/* 추가될 아이템 칩 미리보기 */}
              {previewItems.length > 0 ? (
                <div style={{ background: '#FFFFFF', border: '1px solid rgba(12,12,10,.07)', borderRadius: 12, padding: '12px 14px', marginBottom: 12 }}>
                  <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, color: '#9A9490', letterSpacing: '.06em', marginBottom: 8 }}>추가될 아이템</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 6 }}>
                    {previewItems.map((item, i) => {
                      if (item.type === 'product') {
                        const p = products.find((pr) => pr.id === item.id);
                        return (
                          <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, height: 26, padding: '0 10px', borderRadius: 9999, background: '#F5FDD4', border: '1px solid rgba(197,255,0,.5)', fontFamily: f, fontSize: 12, fontWeight: 700, color: '#3A6000' }}>
                            ✓ {p?.name ?? '?'}
                          </span>
                        );
                      }
                      if (item.type === 'desc') {
                        return (
                          <span key={i} style={{ display: 'inline-flex', alignItems: 'center', height: 26, padding: '0 10px', borderRadius: 9999, background: '#F4F4F0', border: '1px solid rgba(12,12,10,.1)', fontFamily: f, fontSize: 12, color: '#4A4846' }}>
                            {item.text}
                          </span>
                        );
                      }
                      if (item.type === 'plus') {
                        return (
                          <span key={i} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: 9999, background: 'rgba(33,150,243,.1)', border: '1px solid rgba(33,150,243,.3)', fontFamily: f, fontSize: 13, fontWeight: 700, color: '#1976D2' }}>+</span>
                        );
                      }
                      return null;
                    })}
                  </div>
                </div>
              ) : (
                <div style={{ background: '#F4F4F0', borderRadius: 12, padding: '24px 14px', textAlign: 'center', fontFamily: f, fontSize: 13, color: '#9A9490', marginBottom: 12 }}>
                  파싱된 아이템이 없습니다
                </div>
              )}

              {/* 다시 분석 / 슬롯에 추가 버튼 */}
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => { setPanelPhase('input'); setPreviewItems([]); }} style={{ flex: 1, height: 44, borderRadius: 10, border: '1.5px solid rgba(12,12,10,.14)', background: 'transparent', fontFamily: f, fontSize: 13, fontWeight: 700, color: '#0C0C0A', cursor: 'pointer' }}>
                  다시 분석
                </button>
                <button
                  onClick={() => { if (previewItems.length > 0) onImport(previewItems); }}
                  disabled={previewItems.length === 0}
                  style={{ flex: 2, height: 44, borderRadius: 10, border: 'none', background: previewItems.length === 0 ? 'rgba(12,12,10,.08)' : '#0C0C0A', color: previewItems.length === 0 ? '#9A9490' : '#C5FF00', fontFamily: f, fontSize: 13, fontWeight: 800, cursor: previewItems.length === 0 ? 'not-allowed' : 'pointer' }}>
                  {confirmLabel}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ─── 2주 다이어트 프리셋 데이터 ──────────────────────────────────────────────
function make14DayPreset(startDate: string): Omit<DietProgram, 'id' | 'createdAt' | 'updatedAt'> {
  let _id = 1;
  const id = () => String(_id++);

  const slot = (time: string | undefined, label: string, water: number, items: [string, string][]): DietSlot => ({
    id: id(),
    ...(time !== undefined ? { time } : {}),  // undefined 필드 Firestore 오류 방지
    label, water,
    items: items.map(([name, qty]) => ({ id: id(), name, qty: qty || '' })),
    isWarning: false as const,
  });
  const warn = (text: string): DietWarning => ({ id: id(), text, isWarning: true });

  // ── 패턴 1: 1~3일 ──────────────────────────────────────────────────────────
  const p1: DietPattern = {
    id: id(), label: '패턴 1 (1~3일)', dayStart: 1, dayEnd: 3,
    timeline: [
      slot('08:00', '아침 식사시',   350, [['파워칵테일','2'],['액티바이즈','2'],['듀오','40'],['뮤노겐','2']]),
      slot('09:00', '아침 +1시간후', 250, [['리스토레이트','1']]),
      slot(undefined, '아침 공복시', 500, [['피트니스드링크','1'],['액티바이즈','2']]),
      warn('공복 유지 4~5시간 꼭!! 지켜주세요!!'),
      slot('13:00', '점심 식사시',   350, [['파워칵테일','2'],['액티바이즈','2']]),
      slot('14:00', '점심 +1시간후', 250, [['리스토레이트','1']]),
      slot(undefined, '점심 공복시', 500, [['피트니스드링크','1'],['액티바이즈','2']]),
      warn('공복 유지 4~5시간 꼭!! 지켜주세요!!'),
      slot('18:00', '저녁 식사시',   350, [['파워칵테일','2']]),
      slot('19:00', '저녁 +1시간후', 350, [['리스토레이트','2'],['듀오','40']]),
    ],
  };

  // ── 패턴 2: 4~6일 ──────────────────────────────────────────────────────────
  const p2: DietPattern = {
    id: id(), label: '패턴 2 (4~6일)', dayStart: 4, dayEnd: 6,
    timeline: [
      slot('08:00', '아침 식사시',   350, [['파워칵테일','2'],['액티바이즈','2'],['듀오','40']]),
      slot('09:00', '아침 +1시간후', 350, [['웨이','2'],['프로쉐이프 망고','2'],['리스토레이트','1'],['뮤노겐','2']]),
      slot(undefined, '아침 공복시', 500, [['피트니스드링크','1'],['액티바이즈','2']]),
      warn('공복 유지 4~5시간 꼭!! 지켜주세요!!'),
      slot('13:00', '점심 식사시',   350, [['웨이','2'],['프로쉐이프 망고','2'],['리스토레이트','1']]),
      slot(undefined, '점심 공복시', 500, [['피트니스드링크','1'],['액티바이즈','2']]),
      warn('공복 유지 4~5시간 꼭!! 지켜주세요!!'),
      slot('18:00', '저녁 식사시',   350, [['웨이','2'],['프로쉐이프 초코','1'],['뷰티','3']]),
      slot('19:00', '저녁 +1시간후', 250, [['리스토레이트','1'],['듀오','40']]),
    ],
  };

  // ── 패턴 3: 7~14일 ─────────────────────────────────────────────────────────
  const p3: DietPattern = {
    id: id(), label: '패턴 3 (7~14일)', dayStart: 7, dayEnd: 14,
    timeline: [
      slot('08:00', '아침 식사시',   200, [['파워칵테일','1'],['액티바이즈','2'],['듀오','40']]),
      slot('09:00', '아침 +1시간후', 350, [['웨이','2'],['프로쉐이프 망고','2'],['리스토레이트','1'],['뮤노겐','2']]),
      slot('13:00', '점심 식사시',   350, [['한식 위주 식사','1/2'],['샐러드','']]),
      slot(undefined, '점심 공복시', 500, [['피트니스드링크','']]),
      slot('18:00', '저녁 식사시',   350, [['웨이','2'],['프로쉐이프 초코','1'],['뷰티','3']]),
      slot('19:00', '저녁 +1시간후', 250, [['리스토레이트','1'],['듀오','40']]),
    ],
  };

  return {
    name: '2주 리셋 플랜', icon: '📋',
    startDate,
    patterns: [p1, p2, p3],
    active: true, showInToday: false,
  };
}

// ─── DIET PLAN VIEW ──────────────────────────────────────────────────────────
function DietPlanView({
  programs, products, onBack, onAdd, onUpdate, onDelete, onSeedProducts, onRegisterProduct,
}: {
  programs: DietProgram[];
  products: import('@/types/product').Product[];
  onBack: () => void;
  onAdd: (d: Omit<DietProgram, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  onUpdate: (id: string, d: Partial<Omit<DietProgram, 'id'>>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onSeedProducts: () => Promise<void>;
  onRegisterProduct: (name: string) => Promise<string>;
}) {
  const f = "'Plus Jakarta Sans','Space Grotesk',sans-serif";
  const MEAL_COLORS = ['#7C3AED', '#059669', '#EA580C']; // 아침/점심/저녁
  const WARNING_COLOR = '#EF4444';

  // 목록 / 편집 모드
  const [editProgram, setEditProgram] = useState<DietProgram | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);

  // 프리셋 시작일 상태
  const [presetStartDate, setPresetStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [presetLoading, setPresetLoading] = useState(false);

  // 프로그램 기본 정보 상태
  const [pName, setPName] = useState('');
  const [pIcon, setPIcon] = useState('📋');
  const [pStartDate, setPStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [pPatterns, setPPatterns] = useState<DietPattern[]>([]);
  const [activePatternIdx, setActivePatternIdx] = useState(0);

  // 제품 피커 상태
  const [showPicker, setShowPicker] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickerSelected, setPickerSelected] = useState<Set<string>>(new Set());
  const [pickerStep, setPickerStep] = useState<'select' | 'qty'>('select');
  const [pickerQties, setPickerQties] = useState<Record<string, string>>({});
  const healthProds = products.filter(p => p.domain === 'health');
  const baseProds = healthProds.length ? healthProds : products;
  const filteredPickerProds = pickerSearch.trim()
    ? baseProds.filter(p => p.name.toLowerCase().includes(pickerSearch.toLowerCase()) || (p.brand ?? '').toLowerCase().includes(pickerSearch.toLowerCase()))
    : baseProds;

  function closePicker() {
    setShowPicker(false); setPickerSearch(''); setPickerSelected(new Set());
    setPickerStep('select'); setPickerQties({});
  }

  // 1단계 → 2단계
  function goToQtyStep() {
    if (pickerSelected.size === 0) return;
    const init: Record<string, string> = {};
    pickerSelected.forEach(id => { init[id] = ''; });
    setPickerQties(init);
    setPickerStep('qty');
  }

  // 2단계 완료: 수량 포함해서 태그에 추가
  function confirmPickerWithQty() {
    const tags: DietItem[] = [];
    pickerSelected.forEach(id => {
      const p = products.find(pr => pr.id === id);
      if (p) tags.push({ id: Date.now().toString() + id, name: p.name, qty: pickerQties[id] || '' });
    });
    setSlotItemTags(prev => {
      const existing = new Set(prev.map(t => t.name));
      return [...prev, ...tags.filter(t => !existing.has(t.name))];
    });
    closePicker();
  }

  // 검색어로 제품 없을 때 → BOX(health)에 즉시 등록 후 선택 목록에 추가
  async function registerAndAddDiet(name: string) {
    if (!name.trim()) return;
    const newId = await onRegisterProduct(name.trim());
    if (!newId) return;
    setPickerSelected(prev => { const n = new Set(prev); n.add(newId); return n; });
    setPickerSearch('');
  }

  // 슬롯 입력 상태
  const [editSlotId, setEditSlotId] = useState<string | null>(null); // 편집 중인 슬롯 id
  const [slotLabel, setSlotLabel] = useState('');
  const [slotTime, setSlotTime] = useState('');
  const [slotWater, setSlotWater] = useState('');
  const [slotItemTags, setSlotItemTags] = useState<DietItem[]>([]); // 태그 목록
  const [slotItemInput, setSlotItemInput] = useState('');  // 이름
  const [slotItemQty, setSlotItemQty] = useState('');      // 수량

  function openNew() {
    setIsNew(true);
    setPName(''); setPIcon('📋');
    setPStartDate(new Date().toISOString().slice(0, 10));
    const defaultPatterns: DietPattern[] = [
      { id: Date.now().toString(), label: '패턴 1 (1~3일)', dayStart: 1, dayEnd: 3, timeline: [] },
      { id: (Date.now()+1).toString(), label: '패턴 2 (4~6일)', dayStart: 4, dayEnd: 6, timeline: [] },
      { id: (Date.now()+2).toString(), label: '패턴 3 (7~14일)', dayStart: 7, dayEnd: 14, timeline: [] },
    ];
    setPPatterns(defaultPatterns);
    setActivePatternIdx(0);
    setEditProgram({ id: '', name: '', icon: '📋', startDate: '', patterns: defaultPatterns, active: true, showInToday: false, createdAt: '', updatedAt: '' });
  }

  function openEdit(p: DietProgram) {
    setIsNew(false);
    setPName(p.name); setPIcon(p.icon);
    setPStartDate(p.startDate);
    setPPatterns(p.patterns ?? []);
    setActivePatternIdx(0);
    setEditProgram(p);
  }

  // 제품 태그 추가
  function addItemTag() {
    if (!slotItemInput.trim()) return;
    setSlotItemTags(prev => [...prev, { id: Date.now().toString(), name: slotItemInput.trim(), qty: slotItemQty.trim() }]);
    setSlotItemInput(''); setSlotItemQty('');
  }
  function removeItemTag(id: string) {
    setSlotItemTags(prev => prev.filter(t => t.id !== id));
  }

  // 슬롯 편집 시작
  function startEditSlot(slot: DietSlot) {
    setEditSlotId(slot.id);
    setSlotTime(slot.time || '');
    setSlotLabel(slot.label);
    setSlotWater(String(slot.water || ''));
    setSlotItemTags([...slot.items]);
  }
  function cancelEditSlot() {
    setEditSlotId(null);
    setSlotLabel(''); setSlotTime(''); setSlotWater(''); setSlotItemTags([]);
  }

  function addSlot() {
    if (!slotLabel.trim()) { alert('타이밍 이름을 입력해주세요.'); return; }
    const slotData: DietSlot = {
      id: editSlotId || Date.now().toString(),
      ...(slotTime ? { time: slotTime } : {}),
      label: slotLabel.trim(),
      water: parseInt(slotWater) || 0,
      items: slotItemTags,
      isWarning: false as const,
    };
    const updated = [...pPatterns];
    if (editSlotId) {
      updated[activePatternIdx] = {
        ...updated[activePatternIdx],
        timeline: updated[activePatternIdx].timeline.map(t => t.id === editSlotId ? slotData : t),
      };
    } else {
      updated[activePatternIdx] = {
        ...updated[activePatternIdx],
        timeline: [...updated[activePatternIdx].timeline, slotData],
      };
    }
    setPPatterns(updated);
    setEditSlotId(null);
    setSlotLabel(''); setSlotTime(''); setSlotWater(''); setSlotItemTags([]);
  }

  function addWarning() {
    const text = prompt('경고 메시지 입력', '공복 유지 4~5시간 꼭!! 지켜주세요!!');
    if (!text) return;
    const warn: DietWarning = { id: Date.now().toString(), text, isWarning: true };
    const updated = [...pPatterns];
    updated[activePatternIdx] = {
      ...updated[activePatternIdx],
      timeline: [...updated[activePatternIdx].timeline, warn],
    };
    setPPatterns(updated);
  }

  function removeTimelineItem(itemId: string) {
    const updated = [...pPatterns];
    updated[activePatternIdx] = {
      ...updated[activePatternIdx],
      timeline: updated[activePatternIdx].timeline.filter(t => t.id !== itemId),
    };
    setPPatterns(updated);
  }

  async function handleSave() {
    if (!pName.trim()) { alert('플랜 이름을 입력해주세요.'); return; }
    setSaving(true);
    try {
      const data = { name: pName.trim(), icon: pIcon, startDate: pStartDate, patterns: pPatterns, active: true, showInToday: editProgram?.showInToday ?? false };
      if (isNew) await onAdd(data);
      else if (editProgram?.id) await onUpdate(editProgram.id, data);
      setEditProgram(null);
    } catch (err) { console.error(err); alert('저장 실패'); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    if (!confirm('플랜을 삭제할까요?')) return;
    await onDelete(id);
    setEditProgram(null);
  }

  async function toggleShowInToday(p: DietProgram) {
    await onUpdate(p.id, { showInToday: !p.showInToday });
  }

  // 드롭다운 열린 플랜 id
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // 드롭다운에서 볼 패턴 인덱스
  const [viewPatIdx, setViewPatIdx] = useState<Record<string, number>>({});

  // ── 편집 화면 ──
  if (editProgram !== null) {
    const pat = pPatterns[activePatternIdx];
    return (
      <div style={{ position: 'fixed', inset: 0, background: '#FAFAF8', zIndex: 50, display: 'flex', flexDirection: 'column', maxWidth: 430, margin: '0 auto' }}>
        <SubPageHeader title={isNew ? '새 리셋 플랜' : '리셋 플랜 편집'} onClose={() => setEditProgram(null)} />
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
          {/* 기본 정보 */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <input value={pIcon} onChange={e => setPIcon(e.target.value.slice(0,4))} style={{ width: 48, padding: '10px 0', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 10, fontSize: 20, textAlign: 'center', outline: 'none', flexShrink: 0 }} />
            <input value={pName} onChange={e => setPName(e.target.value)} placeholder="플랜 이름 (예: 2주 다이어트)" style={{ flex: 1, padding: '10px 12px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 10, fontFamily: f, fontSize: 13, outline: 'none' }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <span style={{ fontFamily: f, fontSize: 12, fontWeight: 700, color: '#9A9490' }}>시작일</span>
            <input type="date" value={pStartDate} onChange={e => setPStartDate(e.target.value)} style={{ padding: '8px 12px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 10, fontFamily: f, fontSize: 13, outline: 'none' }} />
          </div>

          {/* 패턴 탭 */}
          <div style={{ display: 'flex', gap: 5, marginBottom: 14, overflowX: 'auto' }}>
            {pPatterns.map((pat, i) => (
              <button key={pat.id} onClick={() => setActivePatternIdx(i)}
                style={{ flexShrink: 0, padding: '6px 12px', borderRadius: 9999, border: `1.5px solid ${activePatternIdx===i ? '#0C0C0A' : 'rgba(12,12,10,.14)'}`, background: activePatternIdx===i ? '#0C0C0A' : 'transparent', fontFamily: f, fontSize: 11, fontWeight: 700, color: activePatternIdx===i ? '#C5FF00' : '#4A4846', cursor: 'pointer' }}>
                {pat.label}
              </button>
            ))}
          </div>

          {/* 패턴 날짜 범위 편집 */}
          {pat && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'center' }}>
              <span style={{ fontFamily: f, fontSize: 11, fontWeight: 700, color: '#9A9490' }}>일차</span>
              <input type="number" value={pat.dayStart} onChange={e => { const u=[...pPatterns]; u[activePatternIdx]={...u[activePatternIdx],dayStart:+e.target.value}; setPPatterns(u); }}
                style={{ width: 60, padding: '7px 8px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 8, fontFamily: f, fontSize: 13, outline: 'none', textAlign: 'center' }} />
              <span style={{ fontFamily: f, fontSize: 12, color: '#9A9490' }}>~</span>
              <input type="number" value={pat.dayEnd} onChange={e => { const u=[...pPatterns]; u[activePatternIdx]={...u[activePatternIdx],dayEnd:+e.target.value}; setPPatterns(u); }}
                style={{ width: 60, padding: '7px 8px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 8, fontFamily: f, fontSize: 13, outline: 'none', textAlign: 'center' }} />
              <span style={{ fontFamily: f, fontSize: 11, color: '#9A9490' }}>일</span>
              <input value={pat.label} onChange={e => { const u=[...pPatterns]; u[activePatternIdx]={...u[activePatternIdx],label:e.target.value}; setPPatterns(u); }}
                placeholder="라벨" style={{ flex: 1, padding: '7px 10px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 8, fontFamily: f, fontSize: 12, outline: 'none' }} />
            </div>
          )}

          {/* 타임라인 목록 — 편집 폼 인라인 표시 */}
          {pat?.timeline.map(item => (
            <div key={item.id} style={{ marginBottom: 6 }}>
              {item.isWarning ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10 }}>
                  <span style={{ fontSize: 14 }}>⚠️</span>
                  <span style={{ fontFamily: f, fontSize: 12, fontWeight: 700, color: '#DC2626', flex: 1 }}>{(item as DietWarning).text}</span>
                  <button onClick={() => removeTimelineItem(item.id)} style={{ border: 'none', background: 'none', color: '#DC2626', cursor: 'pointer', fontSize: 14 }}>✕</button>
                </div>
              ) : editSlotId === item.id ? (
                /* ── 인라인 편집 폼 ── */
                <div style={{ background: '#F5FDD4', border: '1.5px solid #C5FF00', borderRadius: 12, padding: '12px' }}>
                  <div style={{ fontFamily: f, fontSize: 10, fontWeight: 800, color: '#4E7D00', letterSpacing: '.06em', marginBottom: 8 }}>✎ 슬롯 편집</div>
                  {/* 시간·타이밍명·물 */}
                  <div style={{ display: 'flex', gap: 6, marginBottom: 7 }}>
                    {/* 시 선택 */}
                    <select value={slotTime ? slotTime.split(':')[0] : ''} onChange={e => {
                      const h = e.target.value;
                      const m = slotTime ? slotTime.split(':')[1] : '00';
                      setSlotTime(h ? `${h}:${m}` : '');
                    }} style={{ width: 62, padding: '8px 4px', border: '1.5px solid rgba(12,12,10,.2)', borderRadius: 9, fontFamily: f, fontSize: 12, background: '#fff', outline: 'none' }}>
                      <option value="">공복</option>
                      {Array.from({length:24},(_,i)=>String(i).padStart(2,'0')).map(h=><option key={h} value={h}>{h}시</option>)}
                    </select>
                    {/* 분 선택 (시 선택 후에만 활성) */}
                    <select value={slotTime ? slotTime.split(':')[1] : '00'} disabled={!slotTime} onChange={e => {
                      const h = slotTime ? slotTime.split(':')[0] : '00';
                      setSlotTime(`${h}:${e.target.value}`);
                    }} style={{ width: 58, padding: '8px 4px', border: '1.5px solid rgba(12,12,10,.2)', borderRadius: 9, fontFamily: f, fontSize: 12, background: slotTime ? '#fff' : '#F4F4F0', outline: 'none', color: slotTime ? '#0C0C0A' : '#BCBAB6' }}>
                      {['00','10','15','20','30','40','45','50'].map(m=><option key={m} value={m}>{m}분</option>)}
                    </select>
                    <input value={slotLabel} onChange={e=>setSlotLabel(e.target.value)}
                      style={{ flex: 1, padding: '8px 10px', border: '1.5px solid rgba(12,12,10,.2)', borderRadius: 9, fontFamily: f, fontSize: 12, outline: 'none', background: '#fff' }} />
                    <input value={slotWater} onChange={e=>setSlotWater(e.target.value)} placeholder="ml"
                      style={{ width: 52, padding: '8px', border: '1.5px solid rgba(12,12,10,.2)', borderRadius: 9, fontFamily: f, fontSize: 12, outline: 'none', background: '#fff', textAlign: 'center' }} />
                  </div>
                  {/* 제품 태그 */}
                  {slotItemTags.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                      {slotItemTags.map(tag => (
                        <div key={tag.id} style={{ display: 'flex', alignItems: 'center', gap: 3, background: '#0C0C0A', borderRadius: 9999, padding: '2px 8px 2px 7px' }}>
                          <span style={{ fontFamily: f, fontSize: 12, fontWeight: 700, color: '#C5FF00' }}>{tag.name}{tag.qty ? `(${tag.qty})` : ''}</span>
                          <button onClick={() => removeItemTag(tag.id)} style={{ border: 'none', background: 'none', color: 'rgba(255,255,255,.5)', cursor: 'pointer', fontSize: 12, padding: 0 }}>×</button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 5, marginBottom: 8 }}>
                    <button onClick={() => setShowPicker(true)} style={{ padding: '7px 10px', background: '#0C0C0A', border: 'none', borderRadius: 8, fontFamily: f, fontSize: 11, fontWeight: 700, color: '#C5FF00', cursor: 'pointer', flexShrink: 0 }}>BOX</button>
                    <input value={slotItemInput} onChange={e=>setSlotItemInput(e.target.value)}
                      onKeyDown={e=>{ if(e.key==='Enter'){e.preventDefault(); addItemTag();} }}
                      placeholder="제품명" style={{ flex: 1, padding: '7px 9px', border: '1.5px solid rgba(12,12,10,.2)', borderRadius: 8, fontFamily: f, fontSize: 11, outline: 'none', background: '#fff' }} />
                    <input value={slotItemQty} onChange={e=>setSlotItemQty(e.target.value)}
                      onKeyDown={e=>{ if(e.key==='Enter'){e.preventDefault(); addItemTag();} }}
                      placeholder="수량" style={{ width: 48, padding: '7px', border: '1.5px solid rgba(12,12,10,.2)', borderRadius: 8, fontFamily: f, fontSize: 11, outline: 'none', background: '#fff', textAlign: 'center' }} />
                    <button onClick={addItemTag} style={{ padding: '7px 10px', background: '#F4F4F0', border: '1px solid rgba(12,12,10,.14)', borderRadius: 8, fontFamily: f, fontSize: 11, fontWeight: 700, color: '#4A4846', cursor: 'pointer', flexShrink: 0 }}>추가</button>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={cancelEditSlot} style={{ flex: 1, padding: '9px', background: '#F4F4F0', border: 'none', borderRadius: 9, fontFamily: f, fontSize: 12, fontWeight: 700, color: '#4A4846', cursor: 'pointer' }}>취소</button>
                    <button onClick={addSlot} style={{ flex: 1, padding: '9px', background: '#2A4A1A', border: 'none', borderRadius: 9, fontFamily: f, fontSize: 12, fontWeight: 800, color: '#C5FF00', cursor: 'pointer' }}>수정</button>
                  </div>
                </div>
              ) : (
                /* ── 일반 슬롯 표시 ── */
                <div style={{ background: '#fff', border: '1px solid rgba(12,12,10,.07)', borderRadius: 12, padding: '10px 12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    {(item as DietSlot).time && <span style={{ fontFamily: f, fontSize: 11, fontWeight: 800, background: '#0C0C0A', color: '#C5FF00', padding: '2px 8px', borderRadius: 6 }}>{(item as DietSlot).time}</span>}
                    <span style={{ fontFamily: f, fontSize: 12, fontWeight: 700, color: '#0C0C0A', flex: 1 }}>{(item as DietSlot).label}</span>
                    <span style={{ fontFamily: f, fontSize: 11, color: '#4A9ED6', fontWeight: 700 }}>💧{(item as DietSlot).water}ml</span>
                    <button onClick={() => startEditSlot(item as DietSlot)} style={{ border: 'none', background: 'none', color: '#9A9490', cursor: 'pointer', fontSize: 14, padding: '2px 6px' }} title="편집">✎</button>
                    <button onClick={() => removeTimelineItem(item.id)} style={{ border: 'none', background: 'none', color: '#9A9490', cursor: 'pointer', fontSize: 13 }}>✕</button>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {(item as DietSlot).items.map(it => (
                      <span key={it.id} style={{ fontFamily: f, fontSize: 12, background: '#F4F4F0', color: '#4A4846', padding: '2px 7px', borderRadius: 5 }}>{it.name}{it.qty ? `(${it.qty})` : ''}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* 슬롯 추가 입력 (편집은 인라인으로 처리) */}
          {!editSlotId && (
          <div style={{ background: '#F9F9F7', borderRadius: 14, padding: '12px', border: '1px solid rgba(12,12,10,.07)', marginTop: 8, marginBottom: 12 }}>
            <div style={{ fontFamily: f, fontSize: 10, fontWeight: 700, color: '#9A9490', letterSpacing: '.06em', marginBottom: 8 }}>타임슬롯 추가</div>
            {/* 시간·타이밍명·물 */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 7 }}>
              {/* 시 선택 */}
              <select value={slotTime ? slotTime.split(':')[0] : ''} onChange={e => {
                const h = e.target.value;
                const m = slotTime ? slotTime.split(':')[1] : '00';
                setSlotTime(h ? `${h}:${m}` : '');
              }} style={{ width: 62, padding: '8px 4px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 9, fontFamily: f, fontSize: 12, background: '#fff', outline: 'none' }}>
                <option value="">공복</option>
                {Array.from({length:24},(_,i)=>String(i).padStart(2,'0')).map(h=><option key={h} value={h}>{h}시</option>)}
              </select>
              {/* 분 선택 */}
              <select value={slotTime ? slotTime.split(':')[1] : '00'} disabled={!slotTime} onChange={e => {
                const h = slotTime ? slotTime.split(':')[0] : '00';
                setSlotTime(`${h}:${e.target.value}`);
              }} style={{ width: 58, padding: '8px 4px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 9, fontFamily: f, fontSize: 12, background: slotTime ? '#fff' : '#F4F4F0', outline: 'none', color: slotTime ? '#0C0C0A' : '#BCBAB6' }}>
                {['00','10','15','20','30','40','45','50'].map(m=><option key={m} value={m}>{m}분</option>)}
              </select>
              <input value={slotLabel} onChange={e=>setSlotLabel(e.target.value)} placeholder="타이밍명 (아침 식사시)" style={{ flex: 1, padding: '8px 10px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 9, fontFamily: f, fontSize: 12, outline: 'none', background: '#fff' }} />
              <input value={slotWater} onChange={e=>setSlotWater(e.target.value)} placeholder="ml" style={{ width: 52, padding: '8px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 9, fontFamily: f, fontSize: 12, outline: 'none', background: '#fff', textAlign: 'center' }} />
            </div>
            {/* 제품 태그 목록 */}
            {slotItemTags.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 7 }}>
                {slotItemTags.map(tag => (
                  <div key={tag.id} style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#0C0C0A', borderRadius: 9999, padding: '3px 10px 3px 8px' }}>
                    <span style={{ fontFamily: f, fontSize: 12, fontWeight: 700, color: '#C5FF00' }}>{tag.name}{tag.qty ? `(${tag.qty})` : ''}</span>
                    <button onClick={() => removeItemTag(tag.id)} style={{ border: 'none', background: 'none', color: 'rgba(255,255,255,.5)', cursor: 'pointer', fontSize: 12, lineHeight: 1, padding: 0 }}>×</button>
                  </div>
                ))}
              </div>
            )}
            {/* 제품 추가 */}
            <div style={{ display: 'flex', gap: 5, marginBottom: 7 }}>
              <button onClick={() => setShowPicker(true)} style={{ padding: '8px 10px', background: '#0C0C0A', border: 'none', borderRadius: 9, fontFamily: f, fontSize: 12, fontWeight: 700, color: '#C5FF00', cursor: 'pointer', flexShrink: 0 }}>BOX</button>
              <input value={slotItemInput} onChange={e=>setSlotItemInput(e.target.value)}
                onKeyDown={e=>{ if(e.key==='Enter'){e.preventDefault(); addItemTag();} }}
                placeholder="제품명" style={{ flex: 1, padding: '8px 10px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 9, fontFamily: f, fontSize: 12, outline: 'none', background: '#fff' }} />
              <input value={slotItemQty} onChange={e=>setSlotItemQty(e.target.value)}
                onKeyDown={e=>{ if(e.key==='Enter'){e.preventDefault(); addItemTag();} }}
                placeholder="수량" style={{ width: 52, padding: '8px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 9, fontFamily: f, fontSize: 12, outline: 'none', background: '#fff', textAlign: 'center' }} />
              <button onClick={addItemTag} style={{ padding: '8px 10px', background: '#F4F4F0', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 9, fontFamily: f, fontSize: 12, fontWeight: 700, color: '#4A4846', cursor: 'pointer', flexShrink: 0 }}>추가</button>
            </div>
            <button onClick={addSlot} style={{ width: '100%', padding: '9px', background: '#0C0C0A', border: 'none', borderRadius: 9, fontFamily: f, fontSize: 12, fontWeight: 800, color: '#C5FF00', cursor: 'pointer', marginBottom: 6 }}>슬롯 추가</button>
            <button onClick={addWarning} style={{ width: '100%', padding: '7px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, fontFamily: f, fontSize: 11, fontWeight: 700, color: '#DC2626', cursor: 'pointer' }}>⚠️ 경고 배너 추가</button>
          </div>
          )}

          {/* 저장/삭제 */}
          <div style={{ display: 'flex', gap: 8, paddingBottom: 24 }}>
            {!isNew && editProgram?.id && <button onClick={() => handleDelete(editProgram.id)} style={{ padding: '12px 16px', background: '#FEE2E2', border: 'none', borderRadius: 12, fontFamily: f, fontSize: 13, fontWeight: 700, color: '#DC2626', cursor: 'pointer' }}>삭제</button>}
            <button onClick={handleSave} disabled={saving} style={{ flex: 1, padding: '12px', background: '#0C0C0A', border: 'none', borderRadius: 12, fontFamily: f, fontSize: 13, fontWeight: 800, color: '#C5FF00', cursor: 'pointer', opacity: saving ? .6 : 1 }}>
              {saving ? '저장 중…' : '저장'}
            </button>
          </div>
        </div>
      {/* 제품 피커 — 2단계: 선택 → 수량 입력 */}
      {showPicker ? (
        <>
          <div onClick={closePicker} style={{ position: 'absolute', inset: 0, background: 'rgba(12,12,10,.4)', zIndex: 20 }} />
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: '#FAFAF8', borderRadius: '20px 20px 0 0', zIndex: 21, display: 'flex', flexDirection: 'column', maxHeight: '75vh' }}>

            {pickerStep === 'select' ? (
              <>
                {/* 헤더 — 선택 단계 */}
                <div style={{ padding: '16px 16px 10px', borderBottom: '1px solid rgba(12,12,10,.07)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <div>
                      <span style={{ fontFamily: f, fontSize: 14, fontWeight: 800, color: '#0C0C0A' }}>BOX 제품 선택</span>
                      <span style={{ fontFamily: f, fontSize: 11, color: '#9A9490', marginLeft: 8 }}>{healthProds.length ? `약·비타민 ${healthProds.length}개` : `전체 ${products.length}개`}</span>
                    </div>
                    <button onClick={closePicker} style={{ width: 28, height: 28, borderRadius: 8, background: '#E4E2DC', border: 'none', cursor: 'pointer', fontSize: 12, color: '#4A4846', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                  </div>
                  <input type="search" value={pickerSearch} onChange={e => setPickerSearch(e.target.value)}
                    placeholder="제품명 · 브랜드 검색..." autoFocus
                    style={{ width: '100%', padding: '10px 12px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 8, fontFamily: f, fontSize: 13, color: '#0C0C0A', background: '#F4F4F0', outline: 'none', boxSizing: 'border-box' as const, marginBottom: 4 }} />
                  <div style={{ fontFamily: f, fontSize: 11, color: '#9A9490' }}>{pickerSelected.size > 0 ? `${pickerSelected.size}개 선택됨` : 'BOX에서 제품을 선택하세요'}</div>
                </div>
                {/* 제품 목록 — 다중 선택 */}
                <div style={{ flex: 1, overflowY: 'auto' }}>
                  {/* 검색어 있고 결과 없으면 → 이름으로 등록 후 추가 */}
                  {pickerSearch.trim() && filteredPickerProds.length === 0 && (
                    <div onClick={() => registerAndAddDiet(pickerSearch)}
                      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', cursor: 'pointer', background: 'rgba(197,255,0,.06)', borderBottom: '1px solid rgba(12,12,10,.07)' }}>
                      <div style={{ width: 36, height: 36, borderRadius: 8, background: '#C5FF00', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 300 }}>+</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontFamily: f, fontSize: 14, fontWeight: 700, color: '#0C0C0A' }}>"{pickerSearch.trim()}" 등록 후 추가</div>
                        <div style={{ fontFamily: f, fontSize: 11, color: '#9A9490', marginTop: 2 }}>BOX 약·비타민에 자동 저장 · 나중에 상세 수정 가능</div>
                      </div>
                    </div>
                  )}
                  {filteredPickerProds.length === 0 && !pickerSearch.trim() ? (
                    <div style={{ padding: '40px 16px', textAlign: 'center', color: '#9A9490', fontFamily: f, fontSize: 13, lineHeight: 1.6 }}>
                      <div style={{ fontSize: 28, marginBottom: 6 }}>💊</div>
                      BOX 약·비타민 도메인에 제품이 없습니다.<br />BOX에서 제품을 먼저 추가해주세요.
                    </div>
                  ) : (
                    filteredPickerProds.map(p => {
                      const isSel = pickerSelected.has(p.id);
                      const imgSrc = p.imageUrl || p.storageUrl;
                      return (
                        <div key={p.id} onClick={() => setPickerSelected(prev => { const n = new Set(prev); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })}
                          style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid rgba(12,12,10,.07)', cursor: 'pointer', background: isSel ? 'rgba(197,255,0,.06)' : 'transparent' }}>
                          <div style={{ width: 36, height: 36, borderRadius: 8, background: '#EEEDE9', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, overflow: 'hidden' }}>
                            {imgSrc
                              // eslint-disable-next-line @next/next/no-img-element
                              ? <img src={imgSrc} alt={p.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                              : '💊'}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontFamily: f, fontSize: 14, fontWeight: 600, color: '#0C0C0A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{p.name}</div>
                            {p.brand && <div style={{ fontFamily: f, fontSize: 12, color: '#9A9490', marginTop: 2 }}>{p.brand}</div>}
                          </div>
                          <div style={{ width: 22, height: 22, borderRadius: '50%', border: `1.5px solid ${isSel ? '#8AB000' : 'rgba(12,12,10,.14)'}`, background: isSel ? '#C5FF00' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#0C0C0A', flexShrink: 0 }}>{isSel ? '✓' : ''}</div>
                        </div>
                      );
                    })
                  )}
                </div>
                {/* 다음 버튼 */}
                <div style={{ padding: '12px 16px calc(env(safe-area-inset-bottom,0px) + 16px)', borderTop: '1px solid rgba(12,12,10,.07)' }}>
                  <button onClick={goToQtyStep} disabled={pickerSelected.size === 0}
                    style={{ width: '100%', height: 52, background: pickerSelected.size === 0 ? '#E4E2DC' : '#0C0C0A', color: pickerSelected.size === 0 ? '#9A9490' : '#fff', border: 'none', borderRadius: 12, fontFamily: f, fontSize: 15, fontWeight: 700, cursor: pickerSelected.size === 0 ? 'default' : 'pointer' }}>
                    수량 입력 → {pickerSelected.size > 0 ? `(${pickerSelected.size}개)` : ''}
                  </button>
                </div>
              </>
            ) : (
              <>
                {/* 헤더 — 수량 입력 단계 */}
                <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid rgba(12,12,10,.07)', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button onClick={() => setPickerStep('select')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#4A4846', padding: 0, lineHeight: 1 }}>←</button>
                  <span style={{ fontFamily: f, fontSize: 14, fontWeight: 800, color: '#0C0C0A', flex: 1 }}>수량 입력</span>
                  <button onClick={closePicker} style={{ width: 28, height: 28, borderRadius: 8, background: '#E4E2DC', border: 'none', cursor: 'pointer', fontSize: 12, color: '#4A4846', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                </div>
                {/* 선택된 제품 수량 입력 목록 */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
                  {Array.from(pickerSelected).map(id => {
                    const p = products.find(pr => pr.id === id);
                    if (!p) return null;
                    return (
                      <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                        <div style={{ flex: 1, fontFamily: f, fontSize: 14, fontWeight: 600, color: '#0C0C0A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{p.name}</div>
                        <input
                          type="text" inputMode="decimal"
                          value={pickerQties[id] ?? ''}
                          onChange={e => setPickerQties(prev => ({ ...prev, [id]: e.target.value }))}
                          placeholder="수량"
                          style={{ width: 72, padding: '8px 10px', border: '1.5px solid rgba(12,12,10,.2)', borderRadius: 9, fontFamily: f, fontSize: 14, outline: 'none', background: '#fff', textAlign: 'center' }}
                        />
                      </div>
                    );
                  })}
                </div>
                {/* 추가 완료 버튼 */}
                <div style={{ padding: '12px 16px calc(env(safe-area-inset-bottom,0px) + 16px)', borderTop: '1px solid rgba(12,12,10,.07)' }}>
                  <button onClick={confirmPickerWithQty}
                    style={{ width: '100%', height: 52, background: '#0C0C0A', color: '#fff', border: 'none', borderRadius: 12, fontFamily: f, fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
                    추가 완료
                  </button>
                </div>
              </>
            )}

          </div>
        </>
      ) : null}
    </div>
  );
  }

  // ── 목록 화면 ──
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#FAFAF8', zIndex: 50, display: 'flex', flexDirection: 'column', maxWidth: 430, margin: '0 auto' }}>
      <SubPageHeader title="📋 리셋 플랜" onClose={onBack} />
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 80px' }}>
        {programs.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: '#9A9490', fontFamily: f, fontSize: 13 }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
            리셋 플랜을 등록해보세요
          </div>
        )}
        {/* 2주 프리셋 불러오기 */}
        {programs.every(p => p.name !== '2주 리셋 플랜') && (
          <div style={{ background: 'linear-gradient(135deg,#fdf4ff,#e0a0ff)', borderRadius: 16, padding: '16px', marginBottom: 12, border: '1px solid rgba(124,58,237,.2)' }}>
            <div style={{ fontFamily: f, fontSize: 13, fontWeight: 800, color: '#4C1D95', marginBottom: 4 }}>📋 2주 리셋 플랜 프리셋</div>
            <div style={{ fontFamily: f, fontSize: 11, color: '#6D28D9', marginBottom: 12, lineHeight: 1.6 }}>
              1~3일 / 4~6일 / 7~14일 3패턴 · 총 10개 타임슬롯 자동 입력
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="date" value={presetStartDate} onChange={e => setPresetStartDate(e.target.value)}
                style={{ flex: 1, padding: '8px 10px', border: '1.5px solid rgba(124,58,237,.3)', borderRadius: 9, fontFamily: f, fontSize: 12, outline: 'none', background: '#fff' }} />
              <button
                disabled={presetLoading}
                onClick={async () => {
                  setPresetLoading(true);
                  try { await onAdd(make14DayPreset(presetStartDate)); }
                  catch (err) { console.error(err); alert('불러오기 실패'); }
                  finally { setPresetLoading(false); }
                }}
                style={{ padding: '9px 16px', background: presetLoading ? '#9B7FD4' : '#7C3AED', border: 'none', borderRadius: 9, fontFamily: f, fontSize: 12, fontWeight: 800, color: '#fff', cursor: presetLoading ? 'default' : 'pointer', flexShrink: 0 }}>
                {presetLoading ? '생성 중…' : '불러오기'}
              </button>
            </div>
          </div>
        )}
        {programs.map(p => {
          const dayN = Math.floor((Date.now() - new Date(p.startDate).getTime()) / 86400000) + 1;
          const curPat = p.patterns?.find(pat => dayN >= pat.dayStart && dayN <= pat.dayEnd);
          const isExpanded = expandedId === p.id;
          const patIdx = viewPatIdx[p.id] ?? 0;
          const viewPat = p.patterns?.[patIdx];
          const beforeStart = dayN < 1;
          const totalDays = p.patterns?.reduce((m, pt) => Math.max(m, pt.dayEnd), 0) ?? 0;

          return (
            <div key={p.id} style={{ background: '#fff', border: '1px solid rgba(12,12,10,.07)', borderRadius: 16, marginBottom: 10, overflow: 'hidden' }}>
              {/* 헤더 행 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 14px 14px 14px' }}>
                {/* 드롭다운 토글 */}
                <button onClick={() => setExpandedId(isExpanded ? null : p.id)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, flexShrink: 0, lineHeight: 1 }}>
                  {p.icon}
                </button>
                <div onClick={() => setExpandedId(isExpanded ? null : p.id)} role="button" style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}>
                  <div style={{ fontFamily: f, fontSize: 14, fontWeight: 700, color: '#0C0C0A' }}>{p.name}</div>
                  <div style={{ fontFamily: f, fontSize: 11, color: '#9A9490', marginTop: 1 }}>
                    {beforeStart
                      ? `D-${Math.abs(dayN - 1)+1}일 전 시작`
                      : dayN > totalDays
                        ? `완료 (${totalDays}일)`
                        : `D+${dayN}일차 · ${curPat?.label ?? ''}`}
                  </div>
                </div>
                {/* 오른쪽 버튼들 */}
                <button onClick={() => toggleShowInToday(p)}
                  style={{ height: 26, padding: '0 10px', borderRadius: 9999, border: 'none', cursor: 'pointer', background: p.showInToday ? '#0C0C0A' : '#F4F4F0', color: p.showInToday ? '#C5FF00' : '#9A9490', fontFamily: f, fontSize: 10, fontWeight: 800, letterSpacing: '.08em', flexShrink: 0 }}>
                  {p.showInToday ? 'Today ON' : 'Today OFF'}
                </button>
                <button onClick={() => openEdit(p)} style={{ padding: '5px 10px', background: '#F4F4F0', border: 'none', borderRadius: 8, fontFamily: f, fontSize: 11, fontWeight: 700, cursor: 'pointer', color: '#4A4846' }}>편집</button>
                <button onClick={() => setExpandedId(isExpanded ? null : p.id)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9A9490', fontSize: 14, transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}>▾</button>
              </div>

              {/* 드롭다운 콘텐츠 */}
              {isExpanded && (
                <div style={{ borderTop: '1px solid rgba(12,12,10,.07)' }}>
                  {/* 패턴 탭 */}
                  <div style={{ display: 'flex', gap: 5, padding: '10px 14px 6px', overflowX: 'auto', scrollbarWidth: 'none' }}>
                    {p.patterns?.map((pat, i) => (
                      <button key={pat.id} onClick={() => setViewPatIdx(prev => ({ ...prev, [p.id]: i }))}
                        style={{ flexShrink: 0, padding: '4px 10px', borderRadius: 9999, border: `1.5px solid ${patIdx === i ? '#0C0C0A' : 'rgba(12,12,10,.14)'}`, background: patIdx === i ? '#0C0C0A' : 'transparent', fontFamily: f, fontSize: 10, fontWeight: 700, color: patIdx === i ? '#C5FF00' : '#4A4846', cursor: 'pointer' }}>
                        {pat.label}
                      </button>
                    ))}
                  </div>
                  {/* 타임라인 */}
                  <div style={{ padding: '6px 14px 14px' }}>
                    {viewPat?.timeline.map(item => (
                      <div key={item.id}>
                        {item.isWarning ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', background: '#FEF2F2', borderRadius: 9, marginBottom: 5 }}>
                            <span style={{ fontSize: 13 }}>⚠️</span>
                            <span style={{ fontFamily: f, fontSize: 11, fontWeight: 700, color: '#DC2626' }}>{(item as DietWarning).text}</span>
                          </div>
                        ) : (
                          <div style={{ padding: '8px 10px', background: '#FAFAF8', borderRadius: 10, marginBottom: 5, border: '1px solid rgba(12,12,10,.06)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
                              {(item as DietSlot).time && <span style={{ fontFamily: f, fontSize: 10, fontWeight: 800, background: '#0C0C0A', color: '#C5FF00', padding: '1px 7px', borderRadius: 5 }}>{(item as DietSlot).time}</span>}
                              <span style={{ fontFamily: f, fontSize: 12, fontWeight: 700, color: '#0C0C0A', flex: 1 }}>{(item as DietSlot).label}</span>
                              <span style={{ fontFamily: f, fontSize: 10, color: '#4A9ED6', fontWeight: 700 }}>💧{(item as DietSlot).water}ml</span>
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                              {(item as DietSlot).items.map(it => (
                                <span key={it.id} style={{ fontFamily: f, fontSize: 12, background: '#EEEDE9', color: '#4A4846', padding: '2px 7px', borderRadius: 5 }}>{it.name}{it.qty ? `(${it.qty})` : ''}</span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        <button onClick={openNew} style={{ width: '100%', padding: '12px', border: '1.5px dashed rgba(12,12,10,.14)', borderRadius: 12, background: 'none', fontFamily: f, fontSize: 13, fontWeight: 700, color: '#9A9490', cursor: 'pointer', marginTop: 8 }}>
          + 새 플랜 추가
        </button>
        {/* 2주 다이어트 제품 BOX 자동 등록 */}
        <button onClick={onSeedProducts}
          style={{ width: '100%', padding: '10px', border: '1px solid rgba(12,12,10,.1)', borderRadius: 12, background: '#F4F4F0', fontFamily: f, fontSize: 12, fontWeight: 700, color: '#4A4846', cursor: 'pointer', marginTop: 6 }}>
          💊 2주 다이어트 제품 BOX 자동 등록
        </button>
      </div>
    </div>
  );
}

// ─── SHARED: 반복 유형 폼 필드 (종일/1회성/매일/일정등록) ─────────────────────
const WD_NAMES_SHARED = ['일', '월', '화', '수', '목', '금', '토'];
// ─── 24시간 스크롤 타임 피커 (iOS 알람 스타일) ──────────────────────────────
function TimeScrollPicker({
  value, onChange, f, rows = 5,
}: {
  value: string;
  onChange: (v: string) => void;
  f: string;
  rows?: number;
}) {
  const ITEM_H = 44;
  const PAD = Math.floor(rows / 2);

  const parsed = value.match(/^(\d{1,2}):(\d{2})$/);
  const initH = parsed ? parseInt(parsed[1]) : 0;
  const initM = parsed ? parseInt(parsed[2]) : 0;

  const hourRef = useRef<HTMLDivElement>(null);
  const minRef  = useRef<HTMLDivElement>(null);

  // 마운트 시 현재 값으로 스크롤 위치 초기화
  useEffect(() => {
    requestAnimationFrame(() => {
      if (hourRef.current) hourRef.current.scrollTop = initH * ITEM_H;
      if (minRef.current)  minRef.current.scrollTop  = initM * ITEM_H;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function fire() {
    const h = Math.min(23, Math.max(0, Math.round((hourRef.current?.scrollTop ?? 0) / ITEM_H)));
    const m = Math.min(59, Math.max(0, Math.round((minRef.current?.scrollTop  ?? 0) / ITEM_H)));
    onChange(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  }

  const colStyle: React.CSSProperties = {
    height: ITEM_H * rows,
    overflowY: 'scroll',
    scrollSnapType: 'y mandatory',
    scrollbarWidth: 'none',
    width: 64,
    flexShrink: 0,
  };
  const pad = <div style={{ height: ITEM_H * PAD }} />;

  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F4F4F0', borderRadius: 16, overflow: 'hidden', width: '100%' }}>
      {/* 선택 영역 바 */}
      <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: ITEM_H, transform: 'translateY(-50%)', background: 'rgba(12,12,10,.08)', borderTop: '1.5px solid rgba(12,12,10,.12)', borderBottom: '1.5px solid rgba(12,12,10,.12)', pointerEvents: 'none', zIndex: 1 }} />
      {/* 상단 그라데이션 */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: ITEM_H * PAD, background: 'linear-gradient(to bottom, #F4F4F0 10%, transparent)', pointerEvents: 'none', zIndex: 2 }} />
      {/* 하단 그라데이션 */}
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: ITEM_H * PAD, background: 'linear-gradient(to top, #F4F4F0 10%, transparent)', pointerEvents: 'none', zIndex: 2 }} />

      <div ref={hourRef} onScroll={fire} className="time-scroll-col" style={colStyle}>
        {pad}
        {Array.from({ length: 24 }, (_, i) => (
          <div key={i} style={{ height: ITEM_H, display: 'flex', alignItems: 'center', justifyContent: 'center', scrollSnapAlign: 'center', fontFamily: f, fontSize: 24, fontWeight: 700, color: '#0C0C0A' }}>
            {String(i).padStart(2, '0')}
          </div>
        ))}
        {pad}
      </div>

      <span style={{ fontFamily: f, fontSize: 24, fontWeight: 800, color: '#0C0C0A', zIndex: 3, flexShrink: 0, padding: '0 6px', lineHeight: 1 }}>:</span>

      <div ref={minRef} onScroll={fire} className="time-scroll-col" style={colStyle}>
        {pad}
        {Array.from({ length: 60 }, (_, i) => (
          <div key={i} style={{ height: ITEM_H, display: 'flex', alignItems: 'center', justifyContent: 'center', scrollSnapAlign: 'center', fontFamily: f, fontSize: 24, fontWeight: 700, color: '#0C0C0A' }}>
            {String(i).padStart(2, '0')}
          </div>
        ))}
        {pad}
      </div>
    </div>
  );
}

// ─── 시간 입력 필드 + 피커 열기 버튼 ────────────────────────────────────────
function TimePickerField({ value, onChange, f }: {
  value: string; onChange: (v: string) => void; f: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, padding: '12px 14px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 12, fontFamily: f, fontSize: 16, fontWeight: 700, color: value ? '#0C0C0A' : '#BCBAB6', background: '#fff', minHeight: 48, display: 'flex', alignItems: 'center' }}>
          {value || '시간 미설정'}
        </div>
        <button type="button" onClick={() => setOpen(p => !p)}
          style={{ width: 48, height: 48, borderRadius: 12, border: 'none', background: open ? '#0C0C0A' : '#F4F4F0', color: open ? '#C5FF00' : '#4A4846', fontFamily: f, fontSize: open ? 11 : 22, fontWeight: 800, cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all .15s' }}>
          {open ? '확인' : '+'}
        </button>
      </div>
      {open && <TimeScrollPicker value={value || '07:00'} onChange={onChange} f={f} rows={5} />}
    </div>
  );
}

function RepeatFormFieldsShared({
  f, rt, setRt, wd, toggleWDFn, date_, setDate_, time_, setTime_, alarm_, setAlarm_,
}: {
  f: string; rt: RepeatType | ''; setRt: (r: RepeatType) => void;
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
          <button type="button" key={r.key} onClick={() => {
            setRt(r.key);
            // 1회성 선택 시 날짜가 비어있으면 오늘 날짜 자동 적용
            if (r.key === 'once' && !date_) {
              const d = new Date();
              const y = d.getFullYear();
              const m = String(d.getMonth() + 1).padStart(2, '0');
              const dd = String(d.getDate()).padStart(2, '0');
              setDate_(`${y}-${m}-${dd}`);
            }
          }} style={{ flex: 1, padding: '9px 4px', border: `1.5px solid ${rt === r.key ? '#0C0C0A' : 'rgba(12,12,10,.14)'}`, borderRadius: 12, fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase' as const, color: rt === r.key ? '#fff' : '#4A4846', background: rt === r.key ? '#0C0C0A' : '#fff', cursor: 'pointer', transition: 'all .15s' }}>{r.label}</button>
        ))}
      </div>
      {rt === 'once' && (
        <input type="date" value={date_} onChange={e => setDate_(e.target.value)} style={{ width: '100%', padding: '12px 14px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 12, fontFamily: f, fontSize: 14, fontWeight: 700, color: '#0C0C0A', background: '#fff', outline: 'none', boxSizing: 'border-box' as const, marginTop: 8 }} />
      )}
      {rt === 'scheduled' && (
        <div style={{ display: 'flex', gap: 5, justifyContent: 'space-between', marginTop: 8 }}>
          {WD_NAMES_SHARED.map((nm, d) => (
            <button type="button" key={d} onClick={() => toggleWDFn(d)} style={{ flex: 1, height: 38, borderRadius: 9999, border: `1.5px solid ${wd.includes(d) ? '#0C0C0A' : 'rgba(12,12,10,.14)'}`, fontFamily: f, fontSize: 12, fontWeight: 700, color: wd.includes(d) ? '#fff' : '#4A4846', background: wd.includes(d) ? '#0C0C0A' : '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all .15s', padding: 0 }}>{nm}</button>
          ))}
        </div>
      )}
      {rt !== 'allday' && rt !== '' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
          <TimePickerField value={time_} onChange={setTime_} f={f} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: f, fontSize: 12, fontWeight: 500, color: '#4A4846', cursor: 'pointer', whiteSpace: 'nowrap' as const }}>
            <input type="checkbox" checked={alarm_} onChange={e => setAlarm_(e.target.checked)} style={{ width: 15, height: 15, accentColor: '#0C0C0A' }} />
            알람 설정
          </label>
        </div>
      )}
    </>
  );
}

// ─── MED VIEW — 약 루틴 관리 ─────────────────────────────────────────────────
function MedView({
  items, onBack, onAdd, onUpdate, onDelete, onToggleToday,
}: {
  items: MedRoutine[];
  onBack: () => void;
  onAdd: (m: Omit<MedRoutine, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  onUpdate: (id: string, m: Partial<Omit<MedRoutine, 'id'>>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onToggleToday: (id: string, current: boolean) => void;
}) {
  const f = "'Plus Jakarta Sans','Space Grotesk',sans-serif";
  const ALL_TIMES: MedTime[] = ['morning', 'lunch', 'evening', 'bedtime'];

  // 인라인 추가 폼 상태
  const [newIcon, setNewIcon] = useState('💊');
  const [newName, setNewName] = useState('');
  const [newDosage, setNewDosage] = useState('1정');
  const [newTimes, setNewTimes] = useState<MedTime[]>([]);
  const [newRepeat, setNewRepeat] = useState<RepeatType | ''>('');
  const [newTime, setNewTime] = useState('08:00');
  const [newAlarm, setNewAlarm] = useState(false);
  const [newDate, setNewDate] = useState('');
  const [newWeekdays, setNewWeekdays] = useState<number[]>([]);
  const [adding, setAdding] = useState(false);
  const [showAddHint, setShowAddHint] = useState(false);

  // 검색
  const [medSearch, setMedSearch] = useState('');
  // showInToday=true 항목은 DAILY MEDS 미리보기에만 표시, 목록에서는 제외
  const listMeds = items.filter(m => !m.showInToday);
  const filteredMeds = medSearch.trim()
    ? listMeds.filter(m => m.name.toLowerCase().includes(medSearch.toLowerCase()))
    : listMeds;

  // 편집 시트 상태
  const [editItem, setEditItem] = useState<MedRoutine | null>(null);
  const [eName, setEName] = useState('');
  const [eIcon, setEIcon] = useState('💊');
  const [eDosage, setEDosage] = useState('1정');
  const [eTimes, setETimes] = useState<MedTime[]>([]);
  const [eNote, setENote] = useState('');
  const [eRepeat, setERepeat] = useState<RepeatType | ''>('');
  const [eTime, setETime] = useState('08:00');
  const [eAlarm, setEAlarm] = useState(false);
  const [eDate, setEDate] = useState('');
  const [eWeekdays, setEWeekdays] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);

  function toggleNewTime(t: MedTime) {
    setNewTimes(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);
  }
  function toggleETime(t: MedTime) {
    setETimes(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);
  }
  function toggleNewWD(d: number) { setNewWeekdays(p => p.includes(d) ? p.filter(x => x !== d) : [...p, d]); }
  function toggleEWD(d: number) { setEWeekdays(p => p.includes(d) ? p.filter(x => x !== d) : [...p, d]); }

  function repeatLabel(m: MedRoutine): string {
    const rt = m.repeatType ?? 'daily';
    if (rt === 'allday') return '종일';
    if (rt === 'daily') return '매일';
    if (rt === 'once') return m.date ? `${m.date.slice(5,7)}/${m.date.slice(8,10)}` : '1회성';
    if (rt === 'scheduled') return (m.weekdays ?? []).map(d => WD_NAMES_SHARED[d]).join('·') || '요일선택';
    return '';
  }

  async function handleAdd() {
    if (!newName.trim()) return;
    if (!newTimes.length) { alert('복용 시간을 하나 이상 선택해주세요.'); return; }
    setAdding(true);
    try {
      await onAdd({
        icon: newIcon || '💊', name: newName.trim(), dosage: newDosage, times: newTimes, active: true,
        showInToday: true,
        repeatType: (newRepeat || 'allday') as RepeatType,
        time: newRepeat && newRepeat !== 'allday' ? newTime : '',
        alarm: newRepeat && newRepeat !== 'allday' ? newAlarm : false,
        ...(newRepeat === 'once' ? { date: newDate } : {}),
        ...(newRepeat === 'scheduled' ? { weekdays: newWeekdays } : {}),
      });
      setNewName(''); setNewIcon('💊'); setNewDosage('1정'); setNewTimes([]);
      setNewRepeat(''); setNewTime('08:00'); setNewAlarm(false); setNewDate(''); setNewWeekdays([]);
    } catch (err) { console.error(err); alert('저장 실패'); }
    finally { setAdding(false); }
  }

  function openEdit(item: MedRoutine) {
    setEditItem(item); setEName(item.name); setEIcon(item.icon || '💊');
    setEDosage(item.dosage); setETimes(item.times); setENote(item.note || '');
    setERepeat(item.repeatType ?? ''); setETime(item.time ?? '08:00');
    setEAlarm(item.alarm ?? false); setEDate(item.date ?? ''); setEWeekdays(item.weekdays ?? []);
  }

  async function handleSaveEdit() {
    if (!editItem || !eName.trim()) return;
    if (!eTimes.length) { alert('복용 시간을 하나 이상 선택해주세요.'); return; }
    setSaving(true);
    try {
      await onUpdate(editItem.id, {
        icon: eIcon || '💊', name: eName.trim(), dosage: eDosage, times: eTimes, note: eNote,
        repeatType: (eRepeat || 'allday') as RepeatType,
        time: eRepeat && eRepeat !== 'allday' ? eTime : '',
        alarm: eRepeat && eRepeat !== 'allday' ? eAlarm : false,
        ...(eRepeat === 'once' ? { date: eDate } : {}),
        ...(eRepeat === 'scheduled' ? { weekdays: eWeekdays } : {}),
        updatedAt: new Date().toISOString(),
      });
      setEditItem(null);
    } catch (err) { console.error(err); alert('저장 실패'); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!editItem) return;
    if (!confirm('이 약을 삭제하시겠어요?')) return;
    await onDelete(editItem.id);
    setEditItem(null);
  }
  async function handleDeleteById(id: string) {
    if (!confirm('이 약을 삭제하시겠어요?')) return;
    await onDelete(id);
  }

  function MedRow({ m, onEdit }: { m: MedRoutine; onEdit: () => void }) {
    const isToday = !!m.showInToday;
    const rl = repeatLabel(m);
    const timeStr = (m.repeatType ?? 'daily') !== 'allday' && m.time ? ` · ${m.time}` : '';
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: '#fff', borderBottom: '1px solid rgba(12,12,10,.07)' }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: '#EEEDE9', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, lineHeight: 1 }}>
          {m.icon || '💊'}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: f, fontSize: 14, fontWeight: 600, color: '#0C0C0A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
            {m.name}
          </div>
          <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, color: '#9A9490', letterSpacing: '.04em', marginTop: 2 }}>
            {m.dosage} · {m.times.map(t => MED_TIME_LABELS[t]).join('·')}
            {rl && <span style={{ marginLeft: 4, color: '#BCBAB6' }}>· {rl}{timeStr}</span>}
          </div>
        </div>
        <button
          onClick={() => onToggleToday(m.id, isToday)}
          style={{
            height: 26, padding: '0 10px', borderRadius: 9999, border: 'none', cursor: 'pointer',
            background: isToday ? '#0C0C0A' : '#F4F4F0',
            color: isToday ? '#C5FF00' : '#9A9490',
            fontFamily: f, fontSize: 10, fontWeight: 800, letterSpacing: '.08em',
            textTransform: 'uppercase' as const, transition: 'all .18s', flexShrink: 0,
          }}
        >
          {isToday ? 'Today ON' : 'Today OFF'}
        </button>
        <button
          onClick={onEdit}
          style={{ width: 28, height: 28, background: 'none', border: 'none', cursor: 'pointer', color: '#9A9490', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', flexShrink: 0 }}
          aria-label="편집"
        >
          ✎
        </button>
        <button
          onClick={() => handleDeleteById(m.id)}
          style={{ width: 28, height: 28, background: 'none', border: 'none', cursor: 'pointer', color: '#DC2626', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', flexShrink: 0 }}
          aria-label="삭제"
        >
          🗑
        </button>
      </div>
    );
  }

  return (
    <div style={{ position: 'fixed', top: 0, bottom: 0, left: 'max(0px,calc(50vw - 215px))', right: 'max(0px,calc(50vw - 215px))', zIndex: 100, background: '#FAFAF8', display: 'flex', flexDirection: 'column', overflowY: 'hidden' }}>
      <SubPageHeader title="MEDICATION" onClose={onBack} />

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* Hero */}
        <div style={{ padding: '28px 16px 20px', borderBottom: '1px solid rgba(12,12,10,.07)', position: 'relative' }}>
          <div style={{ position: 'absolute', top: 18, right: 18, fontSize: 36, opacity: .06, transform: 'rotate(10deg)', lineHeight: 1 }}>💊</div>
          <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.18em', textTransform: 'uppercase' as const, color: '#9A9490', marginBottom: 10 }}>DAILY DOSE</div>
          <div style={{ fontFamily: f, fontSize: 48, fontWeight: 900, color: '#0C0C0A', lineHeight: .95, letterSpacing: '-.02em', textTransform: 'uppercase' as const }}>MEDS</div>
          <div style={{ fontFamily: f, fontSize: 12, color: '#9A9490', marginTop: 12, lineHeight: 1.5 }}>약 복용 관리 · 복용 시간 · 데일리 체크</div>
        </div>

        {/* Add Form */}
        <div style={{ padding: '20px 16px 16px', borderBottom: '1px solid rgba(12,12,10,.07)' }}>
          <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.16em', textTransform: 'uppercase' as const, color: '#9A9490', marginBottom: 12 }}>NEW MEDICATION</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input value={newIcon} onChange={e => setNewIcon(e.target.value.slice(0, 4))} placeholder="💊" style={{ width: 48, padding: '11px 6px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 12, fontSize: 22, textAlign: 'center', background: '#fff', outline: 'none', flexShrink: 0 }} />
              <input value={newName} onChange={e => { setNewName(e.target.value); if (e.target.value.trim()) setShowAddHint(false); }} onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }} placeholder="약 이름 (예: 오메가3, 비타민D)" maxLength={40} style={{ flex: 1, padding: '12px 14px', border: `1.5px solid ${showAddHint ? '#E94F6B' : 'rgba(12,12,10,.14)'}`, borderRadius: 12, fontFamily: f, fontSize: 14, color: '#0C0C0A', background: '#fff', outline: 'none' }} />
            </div>
            <input value={newDosage} onChange={e => setNewDosage(e.target.value)} placeholder="용량 (예: 1정, 2캡슐)" style={{ padding: '12px 14px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 12, fontFamily: f, fontSize: 13, color: '#0C0C0A', background: '#fff', outline: 'none' }} />
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const }}>
              {ALL_TIMES.map(t => (
                <button key={t} onClick={() => toggleNewTime(t)} style={{ padding: '7px 14px', borderRadius: 9999, border: `1.5px solid ${newTimes.includes(t) ? '#0C0C0A' : 'rgba(12,12,10,.14)'}`, background: newTimes.includes(t) ? '#0C0C0A' : '#fff', fontFamily: f, fontSize: 12, fontWeight: 700, color: newTimes.includes(t) ? '#C5FF00' : '#4A4846', cursor: 'pointer', transition: 'all .15s' }}>
                  {MED_TIME_LABELS[t]}
                </button>
              ))}
            </div>
            <RepeatFormFieldsShared
              f={f} rt={newRepeat} setRt={setNewRepeat}
              wd={newWeekdays} toggleWDFn={toggleNewWD}
              date_={newDate} setDate_={setNewDate}
              time_={newTime} setTime_={setNewTime}
              alarm_={newAlarm} setAlarm_={setNewAlarm}
            />
            {showAddHint && (
              <div style={{ fontFamily: f, fontSize: 12, color: '#E94F6B', fontWeight: 600, paddingLeft: 4 }}>약 이름을 입력해주세요.</div>
            )}
            <button onClick={() => { if (!newName.trim()) { setShowAddHint(true); return; } setShowAddHint(false); handleAdd(); }} disabled={adding} style={{ padding: '12px 20px', background: newName.trim() ? '#0C0C0A' : 'rgba(12,12,10,.14)', color: newName.trim() ? '#fff' : '#9A9490', border: 'none', borderRadius: 12, fontFamily: f, fontSize: 12, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase' as const, cursor: 'pointer', transition: 'all .18s' }}>
              + ADD
            </button>
          </div>
        </div>

        {/* 약 복용 목록 */}
        <div style={{ padding: '20px 16px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.16em', textTransform: 'uppercase' as const, color: '#9A9490' }}>전체</span>
            <span style={{ fontFamily: f, fontSize: 11, fontWeight: 800, color: '#0C0C0A' }}>{items.length}개</span>
          </div>
          <SearchBar value={medSearch} onChange={setMedSearch} placeholder="약 이름 검색..." />
          {items.length === 0 ? (
            <div style={{ padding: '36px 16px', textAlign: 'center', fontFamily: f, fontSize: 13, color: '#9A9490', lineHeight: 1.6, border: '1.5px dashed rgba(12,12,10,.14)', borderRadius: 16, background: '#EEEDE9', marginTop: 8 }}>
              아직 등록된 약이 없습니다.<br />위에서 새 약을 추가해주세요.
            </div>
          ) : medSearch.trim() ? (
            filteredMeds.length === 0 ? (
              <div style={{ padding: '36px 16px', textAlign: 'center', fontFamily: f, fontSize: 13, color: '#9A9490', marginTop: 8 }}>
                &ldquo;{medSearch}&rdquo; 검색 결과 없음
              </div>
            ) : (
              <div style={{ background: '#fff', borderRadius: 20, overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,.06),0 0 0 1px rgba(0,0,0,.04)', marginTop: 8 }}>
                {filteredMeds.map(m => <MedRow key={m.id} m={m} onEdit={() => openEdit(m)} />)}
              </div>
            )
          ) : listMeds.length === 0 ? (
            <div style={{ padding: '20px 16px', textAlign: 'center', fontFamily: f, fontSize: 13, color: '#BCBAB6', marginTop: 8 }}>
              모두 Today에 표시 중입니다.
            </div>
          ) : (
            <div style={{ background: '#fff', borderRadius: 20, overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,.06),0 0 0 1px rgba(0,0,0,.04)', marginTop: 8 }}>
              {listMeds.map(m => <MedRow key={m.id} m={m} onEdit={() => openEdit(m)} />)}
            </div>
          )}
        </div>

        {/* DAILY MEDS — showInToday=true 약 미리보기 (Today 카드 스타일) */}
        {items.some(m => m.showInToday) && (() => {
          const todayMeds   = items.filter(m => m.showInToday);
          // 아침(파랑) 04-12 · 점심(오렌지) 12-18 · 저녁(핑크) 18-04
          const periodOfS = (m: { time?: string; times?: string[] }): 'am' | 'pm' | 'ev' => {
            const ts = m.times ?? [];
            if (ts.includes('morning')) return 'am';
            if (ts.includes('lunch')) return 'pm';
            if (ts.some(t => t === 'evening' || t === 'bedtime')) return 'ev';
            if (m.time) { const h = parseInt(m.time.split(':')[0], 10); return h >= 4 && h < 12 ? 'am' : h >= 12 && h < 18 ? 'pm' : 'ev'; }
            return 'ev';
          };
          const amMeds = todayMeds.filter(m => periodOfS(m) === 'am');
          const pmMeds = todayMeds.filter(m => periodOfS(m) === 'pm');
          const evAll  = todayMeds.filter(m => periodOfS(m) === 'ev');
          const now         = new Date();

          const getTime = (m: MedRoutine) => {
            if (m.time) return m.time;
            const first = (m.times ?? [])[0];
            return first === 'morning' ? '09:00' : first === 'lunch' ? '12:00' : first === 'evening' ? '18:00' : '22:00';
          };

          const PreviewRow = ({ m }: { m: MedRoutine }) => (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', borderTop: '1px solid rgba(12,12,10,.05)' }}>
              <div style={{ width: 20, height: 20, borderRadius: 5, border: '1.5px solid rgba(12,12,10,.2)', background: '#fff', flexShrink: 0 }} />
              <span style={{ fontFamily: f, fontSize: 13, fontWeight: 700, color: '#44474A', width: 42, flexShrink: 0 }}>{getTime(m)}</span>
              <span style={{ fontFamily: f, fontSize: 14, color: '#0C0C0A', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{m.name}</span>
              <button
                onClick={() => onToggleToday(m.id, true)}
                style={{ height: 22, padding: '0 8px', borderRadius: 9999, border: 'none', cursor: 'pointer', background: '#0C0C0A', color: '#C5FF00', fontFamily: f, fontSize: 9, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase' as const, flexShrink: 0 }}
              >
                Today ON
              </button>
            </div>
          );

          return (
            <div style={{ padding: '24px 16px 0' }}>
              <div style={{ background: '#fff', borderRadius: 20, overflow: 'hidden', border: '1px solid rgba(12,12,10,.07)', boxShadow: '0 1px 4px rgba(0,0,0,.05)' }}>
                {/* 카드 헤더 */}
                <div style={{ padding: '14px 16px 12px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
                      <span style={{ fontSize: 15 }}>💊</span>
                      <span style={{ fontFamily: "'Courier New',monospace", fontSize: 13, fontWeight: 700, color: '#0C0C0A' }}>Today♡·⁺°———</span>
                    </div>
                    <div style={{ fontFamily: f, fontSize: 13, fontWeight: 600, color: '#0C0C0A' }}>
                      {now.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })}
                    </div>
                    <div style={{ fontFamily: f, fontSize: 11, color: '#9A9490', marginTop: 2 }}>
                      {now.toLocaleDateString('ko-KR', { weekday: 'long' })}
                    </div>
                  </div>
                  <span style={{ background: '#C5FF00', color: '#0C0C0A', fontFamily: f, fontSize: 10, fontWeight: 800, padding: '3px 9px', borderRadius: 9999, marginTop: 4 }}>
                    TODAY {todayMeds.length}개
                  </span>
                </div>

                {/* 아침(파랑) / 점심(오렌지) / 저녁(핑크) 3구간 */}
                {([
                  { label: '아침', col: '#6B7CE8', meds: amMeds },
                  { label: '점심', col: '#E8A86B', meds: pmMeds },
                  { label: '저녁', col: '#E86BAA', meds: evAll },
                ] as const).map(g => g.meds.length > 0 && (
                  <div key={g.label}>
                    <div style={{ padding: '7px 14px 5px', background: '#F8F8F6', borderTop: '1px solid rgba(12,12,10,.05)' }}>
                      <span style={{ fontFamily: "'Courier New',monospace", fontSize: 11, color: g.col }}>·+ +°.{g.label}°·++·° *</span>
                    </div>
                    {g.meds.map(m => <PreviewRow key={m.id} m={m} />)}
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        <div style={{ height: 40 }} />
      </div>

      {/* 편집 시트 */}
      {editItem && (
        <>
          <div onClick={() => setEditItem(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 310 }} />
          <div style={{ position: 'fixed', bottom: 0, left: 'max(0px,calc(50vw - 215px))', right: 'max(0px,calc(50vw - 215px))', zIndex: 311, background: '#FAFAF8', borderRadius: '20px 20px 0 0', padding: '10px 20px calc(env(safe-area-inset-bottom, 0px) + 48px)', maxHeight: '88%', overflowY: 'auto' }}>
            <div style={{ width: 32, height: 3, background: 'rgba(12,12,10,.14)', borderRadius: 2, margin: '0 auto 20px' }} />
            <div style={{ fontFamily: f, fontSize: 20, fontWeight: 800, color: '#0C0C0A', marginBottom: 20 }}>약 편집</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input value={eIcon} onChange={e => setEIcon(e.target.value.slice(0, 4))} placeholder="💊" style={{ width: 48, padding: '11px 6px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 12, fontSize: 22, textAlign: 'center', background: '#fff', outline: 'none', flexShrink: 0 }} />
                <input value={eName} onChange={e => setEName(e.target.value)} placeholder="약 이름" maxLength={40} style={{ flex: 1, padding: '12px 14px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 12, fontFamily: f, fontSize: 14, color: '#0C0C0A', background: '#fff', outline: 'none' }} />
              </div>
              <input value={eDosage} onChange={e => setEDosage(e.target.value)} placeholder="용량 (예: 1정, 2캡슐)" style={{ padding: '12px 14px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 12, fontFamily: f, fontSize: 13, color: '#0C0C0A', background: '#fff', outline: 'none' }} />
              <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, color: '#9A9490', letterSpacing: '.06em' }}>복용 시간 (복수 선택)</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const }}>
                {ALL_TIMES.map(t => (
                  <button key={t} onClick={() => toggleETime(t)} style={{ padding: '7px 14px', borderRadius: 9999, border: `1.5px solid ${eTimes.includes(t) ? '#0C0C0A' : 'rgba(12,12,10,.14)'}`, background: eTimes.includes(t) ? '#0C0C0A' : '#fff', fontFamily: f, fontSize: 12, fontWeight: 700, color: eTimes.includes(t) ? '#C5FF00' : '#4A4846', cursor: 'pointer', transition: 'all .15s' }}>
                    {MED_TIME_LABELS[t]}
                  </button>
                ))}
              </div>
              <RepeatFormFieldsShared
                f={f} rt={eRepeat} setRt={setERepeat}
                wd={eWeekdays} toggleWDFn={toggleEWD}
                date_={eDate} setDate_={setEDate}
                time_={eTime} setTime_={setETime}
                alarm_={eAlarm} setAlarm_={setEAlarm}
              />
              <input value={eNote} onChange={e => setENote(e.target.value)} placeholder="주의사항 (선택)" style={{ padding: '12px 14px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 12, fontFamily: f, fontSize: 13, color: '#0C0C0A', background: '#fff', outline: 'none' }} />
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
              <button onClick={() => setEditItem(null)} style={{ flex: 1, padding: 14, background: '#F4F4F0', border: 'none', borderRadius: 12, fontFamily: f, fontSize: 13, fontWeight: 700, color: '#4A4846', cursor: 'pointer' }}>취소</button>
              <button onClick={handleSaveEdit} disabled={saving} style={{ flex: 1, padding: 14, background: '#0C0C0A', color: '#fff', border: 'none', borderRadius: 12, fontFamily: f, fontSize: 13, fontWeight: 700, cursor: 'pointer', letterSpacing: '.02em', opacity: saving ? .6 : 1 }}>{saving ? '저장 중…' : '저장'}</button>
            </div>
            <button onClick={handleDelete} style={{ marginTop: 10, width: '100%', padding: 14, background: 'none', color: '#BA1A1A', border: '1.5px solid rgba(186,26,26,.3)', borderRadius: 12, fontFamily: f, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>삭제</button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── HEALTH VIEW — 건강·다이어트 루틴 관리 ───────────────────────────────────
function HealthView({
  items, categories, onBack, onAdd, onUpdate, onDelete, onToggleToday,
  onAddCategory, onUpdateCategory, onDeleteCategory, onEnsureDefaultCategories,
}: {
  items: HealthRoutine[];
  categories: HealthCategory[];
  onBack: () => void;
  onAdd: (h: Omit<HealthRoutine, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  onUpdate: (id: string, h: Partial<Omit<HealthRoutine, 'id'>>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onToggleToday: (id: string, current: boolean) => void;
  onAddCategory: (c: Omit<HealthCategory, 'id' | 'createdAt'>) => Promise<void>;
  onUpdateCategory: (id: string, c: Partial<Omit<HealthCategory, 'id'>>) => Promise<void>;
  onDeleteCategory: (id: string) => Promise<void>;
  onEnsureDefaultCategories: () => Promise<void>;
}) {
  const f = "'Plus Jakarta Sans','Space Grotesk',sans-serif";
  const DAYS = ['일', '월', '화', '수', '목', '금', '토'];

  // 인라인 빠른 추가 상태
  const [qIcon, setQIcon] = useState('🏃');
  const [qName, setQName] = useState('');
  const [qCatId, setQCatId] = useState('');
  const [qAdding, setQAdding] = useState(false);
  const [showQHint, setShowQHint] = useState(false);
  const [qRepeat, setQRepeat] = useState<RepeatType | ''>('');
  const [qTime, setQTime] = useState('07:00');
  const [qAlarm, setQAlarm] = useState(false);
  const [qDate, setQDate] = useState('');
  const [qWeekdays, setQWeekdays] = useState<number[]>([]);
  function toggleQWD(d: number) { setQWeekdays(p => p.includes(d) ? p.filter(x => x !== d) : [...p, d]); }

  // 검색 — showInToday=true 항목은 DAILY HEALTH 미리보기에만 표시, 목록에서는 제외
  const [healthSearch, setHealthSearch] = useState('');
  const listItems = items.filter(i => !i.showInToday);
  const filteredHealth = healthSearch.trim()
    ? listItems.filter(i => i.name.toLowerCase().includes(healthSearch.toLowerCase()))
    : listItems;

  // 카테고리 섹션 펼치기
  const [showCatSection, setShowCatSection] = useState(false);
  // 카테고리 드래그 상태
  const [dragCatIdx, setDragCatIdx] = useState<number | null>(null);
  const [dragCatOver, setDragCatOver] = useState<number | null>(null);

  async function moveCat(from: number, to: number) {
    if (from === to) return;
    const arr = [...categories];
    const [moved] = arr.splice(from, 1);
    arr.splice(to, 0, moved);
    await Promise.all(arr.map((cat, i) => onUpdateCategory(cat.id, { order: i })));
  }

  // 상단 탭 (unused after restructure but kept for compat)
  const [mainTab, setMainTab] = useState<'routines' | 'categories'>('routines');
  void mainTab; void setMainTab;

  // 카테고리 편집 상태
  const [catEditId, setCatEditId] = useState<string | null>(null);
  const [catIcon, setCatIcon] = useState('⭐');
  const [catName, setCatName] = useState('');
  const [catSaving, setCatSaving] = useState(false);
  const [showCatForm, setShowCatForm] = useState(false);

  // 첫 진입 시 기본 카테고리 자동 생성
  useEffect(() => {
    void onEnsureDefaultCategories();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openNewCat() {
    setCatEditId(null); setCatIcon('⭐'); setCatName(''); setShowCatForm(true);
  }
  function openEditCat(c: HealthCategory) {
    setCatEditId(c.id); setCatIcon(c.icon); setCatName(c.name); setShowCatForm(true);
  }
  async function saveCat() {
    if (!catName.trim()) { alert('카테고리 이름을 입력해주세요.'); return; }
    setCatSaving(true);
    try {
      const order = catEditId
        ? (categories.find(c => c.id === catEditId)?.order ?? categories.length)
        : categories.length;
      if (catEditId) await onUpdateCategory(catEditId, { icon: catIcon, name: catName.trim() });
      else await onAddCategory({ icon: catIcon, name: catName.trim(), order });
      setShowCatForm(false);
    } catch (e) { console.error(e); alert('저장 실패'); }
    finally { setCatSaving(false); }
  }
  async function deleteCat(id: string) {
    if (!confirm('카테고리를 삭제하면 해당 루틴들도 카테고리가 없어집니다. 삭제할까요?')) return;
    await onDeleteCategory(id);
    setShowCatForm(false);
  }

  // ── 루틴 추가/편집 시트 상태 ──
  const [editId, setEditId] = useState<string | null>(null);
  const [routineIcon, setRoutineIcon] = useState('🏃');
  const [name, setName] = useState('');
  const [catId, setCatId] = useState('');   // 선택된 카테고리 id
  const [schedule, setSchedule] = useState('');
  const [goal, setGoal] = useState('');
  const [repeatDays, setRepeatDays] = useState<number[]>([]);
  const [entries, setEntries] = useState<import('@/types/healthroutine').HealthEntry[]>([]);
  const [hRepeat, setHRepeat] = useState<RepeatType | ''>('');
  const [hTime, setHTime] = useState('07:00');
  const [hAlarm, setHAlarm] = useState(false);
  const [hDate, setHDate] = useState('');
  const [hWeekdays, setHWeekdays] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);

  // ── 항목(entry) 편집 상태 ──
  const [editEntryId, setEditEntryId] = useState<string | null>(null);
  const [entryHour, setEntryHour] = useState('06');
  const [entryMin, setEntryMin] = useState('00');
  const [entryDesc, setEntryDesc] = useState('');

  // 시 + 분 → "HH:MM" (24시간)
  function getEntryTime(): string {
    return `${entryHour.padStart(2, '0')}:${entryMin}`;
  }
  // "HH:MM" → 시·분 분해
  function parseEntryTime(t: string) {
    const [hStr, mStr] = t.split(':');
    setEntryHour(hStr?.padStart(2, '0') || '00');
    setEntryMin(mStr || '00');
  }

  // "HH:MM" 그대로 표시 (24시간제 통일)
  function fmtTime(t: string): string { return t ?? ''; }

  // 카테고리별 그룹 — showInToday=true 항목은 DAILY HEALTH 미리보기에만 표시
  const grouped = categories.map(cat => ({
    cat,
    list: listItems.filter(i => i.type === cat.id),
  })).filter(g => g.list.length > 0);

  function toggleHWD(d: number) { setHWeekdays(p => p.includes(d) ? p.filter(x => x !== d) : [...p, d]); }

  function healthRepeatLabel(item: HealthRoutine): string {
    const rt = item.repeatType ?? 'daily';
    if (rt === 'allday') return '종일';
    if (rt === 'daily') return '매일';
    if (rt === 'once') return item.date ? `${item.date.slice(5,7)}/${item.date.slice(8,10)}` : '1회성';
    if (rt === 'scheduled') return (item.weekdays ?? []).map(d => WD_NAMES_SHARED[d]).join('·') || '요일선택';
    return '';
  }

  function openNew() {
    setEditId(null); setRoutineIcon('⭐'); setName('');
    setCatId(''); setSchedule('');
    setGoal(''); setRepeatDays([]); setEntries([]);
    setHRepeat(''); setHTime('07:00'); setHAlarm(false); setHDate(''); setHWeekdays([]);
    setShowForm(true);
  }
  function openEdit(item: HealthRoutine) {
    setEditId(item.id); setRoutineIcon(item.icon); setName(item.name);
    setCatId(item.type); setSchedule(item.schedule); setGoal(item.goal || '');
    setRepeatDays(item.repeatDays ?? []); setEntries(item.entries ?? []);
    setHRepeat(item.repeatType ?? ''); setHTime(item.time ?? '07:00');
    setHAlarm(item.alarm ?? false); setHDate(item.date ?? ''); setHWeekdays(item.weekdays ?? []);
    setShowForm(true);
  }
  function toggleDay(d: number) {
    setRepeatDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort());
  }

  // 항목 추가/수정
  function addOrUpdateEntry() {
    if (!entryDesc.trim()) { alert('내용을 입력해주세요.'); return; }
    const time = getEntryTime();
    if (editEntryId) {
      setEntries(prev => prev.map(e => e.id === editEntryId ? { ...e, time, desc: entryDesc.trim() } : e));
      setEditEntryId(null);
    } else {
      setEntries(prev => [...prev, { id: Date.now().toString(), time, desc: entryDesc.trim() }]);
    }
    setEntryDesc('');
  }
  function startEditEntry(e: import('@/types/healthroutine').HealthEntry) {
    setEditEntryId(e.id); parseEntryTime(e.time); setEntryDesc(e.desc);
  }
  function deleteEntry(id: string) {
    setEntries(prev => prev.filter(e => e.id !== id));
    if (editEntryId === id) { setEditEntryId(null); setEntryHour('06'); setEntryMin('00'); setEntryDesc(''); }
  }

  async function handleSave() {
    if (!name.trim()) { alert('루틴 이름을 입력해주세요.'); return; }
    setSaving(true);
    try {
      // type 필드에 카테고리 id 저장 (기존 HealthType 호환 유지)
      const data = {
        icon: routineIcon, name: name.trim(), type: catId as HealthType, schedule, goal, repeatDays, entries, active: true,
        repeatType: (hRepeat || 'allday') as RepeatType,
        time: hRepeat && hRepeat !== 'allday' ? hTime : '',
        alarm: hRepeat && hRepeat !== 'allday' ? hAlarm : false,
        ...(hRepeat === 'once' ? { date: hDate } : {}),
        ...(hRepeat === 'scheduled' ? { weekdays: hWeekdays } : {}),
      };
      if (editId) await onUpdate(editId, data);
      else await onAdd(data);
      setShowForm(false);
    } catch (err) { console.error(err); alert('저장 실패'); }
    finally { setSaving(false); }
  }
  async function handleDelete(id: string) {
    if (!confirm('삭제할까요?')) return;
    await onDelete(id);
    setShowForm(false);
  }

  async function handleQuickAdd() {
    if (!qName.trim()) return;
    const cid = qCatId || categories[0]?.id || '';
    const cat = categories.find(c => c.id === cid);
    setQAdding(true);
    try {
      await onAdd({
        icon: qIcon || cat?.icon || '🏃', name: qName.trim(), type: cid as HealthType,
        schedule: '', goal: '', repeatDays: [], entries: [], active: true,
        repeatType: (qRepeat || 'allday') as RepeatType,
        time: qRepeat && qRepeat !== 'allday' ? qTime : '',
        alarm: qRepeat && qRepeat !== 'allday' ? qAlarm : false,
        ...(qRepeat === 'once' ? { date: qDate } : {}),
        ...(qRepeat === 'scheduled' ? { weekdays: qWeekdays } : {}),
      });
      setQName(''); setQIcon('🏃');
      setQRepeat(''); setQTime('07:00'); setQAlarm(false); setQDate(''); setQWeekdays([]);
    } catch (err) { console.error(err); alert('저장 실패'); }
    finally { setQAdding(false); }
  }

  function HealthRow({ item, isLast }: { item: HealthRoutine; isLast: boolean }) {
    return (
      <div style={{ borderBottom: isLast ? 'none' : '1px solid rgba(12,12,10,.07)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px' }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: '#EEEDE9', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, lineHeight: 1 }}>
            {item.icon}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: f, fontSize: 14, fontWeight: 600, color: '#0C0C0A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
              {item.name}
            </div>
            <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, color: '#9A9490', letterSpacing: '.04em', marginTop: 2 }}>
              {healthRepeatLabel(item)}
              {(item.repeatType ?? 'daily') !== 'allday' && item.time ? ` · ${item.time}` : ''}
              {item.goal ? ` · 목표: ${item.goal}` : ''}
            </div>
          </div>
          <button
            onClick={() => onToggleToday(item.id, !!item.showInToday)}
            style={{
              height: 26, padding: '0 10px', borderRadius: 9999, border: 'none', cursor: 'pointer',
              background: item.showInToday ? '#0C0C0A' : '#F4F4F0',
              color: item.showInToday ? '#C5FF00' : '#9A9490',
              fontFamily: f, fontSize: 10, fontWeight: 800, letterSpacing: '.08em',
              textTransform: 'uppercase' as const, transition: 'all .18s', flexShrink: 0,
            }}
          >
            {item.showInToday ? 'Today ON' : 'Today OFF'}
          </button>
          <button
            onClick={() => openEdit(item)}
            style={{ width: 28, height: 28, background: 'none', border: 'none', cursor: 'pointer', color: '#9A9490', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', flexShrink: 0 }}
            aria-label="편집"
          >
            ✎
          </button>
          <button
            onClick={() => handleDelete(item.id)}
            style={{ width: 28, height: 28, background: 'none', border: 'none', cursor: 'pointer', color: '#DC2626', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', flexShrink: 0 }}
            aria-label="삭제"
          >
            🗑
          </button>
        </div>
        {(item.entries ?? []).length > 0 && (
          <div style={{ borderTop: '1px solid rgba(12,12,10,.06)' }}>
            {[...(item.entries ?? [])].sort((a, b) => a.time.localeCompare(b.time)).map((e: import('@/types/healthroutine').HealthEntry) => (
              <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderBottom: '1px solid rgba(12,12,10,.04)' }}>
                <span style={{ fontFamily: f, fontSize: 11, fontWeight: 800, color: '#C5FF00', background: '#0C0C0A', padding: '2px 7px', borderRadius: 6, flexShrink: 0 }}>{e.time}</span>
                <span style={{ fontFamily: f, fontSize: 12, color: '#4A4846', flex: 1 }}>{e.desc}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ position: 'fixed', top: 0, bottom: 0, left: 'max(0px,calc(50vw - 215px))', right: 'max(0px,calc(50vw - 215px))', zIndex: 100, background: '#FAFAF8', display: 'flex', flexDirection: 'column', overflowY: 'hidden' }}>
      <SubPageHeader title="HEALTH" onClose={onBack} />

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* Hero */}
        <div style={{ padding: '28px 16px 20px', borderBottom: '1px solid rgba(12,12,10,.07)', position: 'relative' }}>
          <button
            onClick={() => setShowCatSection(p => !p)}
            style={{ position: 'absolute', top: 16, right: 16, display: 'flex', alignItems: 'center', gap: 4, background: showCatSection ? '#0C0C0A' : '#F4F4F0', border: 'none', borderRadius: 9999, padding: '6px 12px', fontFamily: f, fontSize: 10, fontWeight: 800, letterSpacing: '.08em', color: showCatSection ? '#C5FF00' : '#9A9490', cursor: 'pointer', textTransform: 'uppercase' as const }}
          >
            카테고리 {showCatSection ? '▲' : '▼'}
          </button>
          <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.18em', textTransform: 'uppercase' as const, color: '#9A9490', marginBottom: 10 }}>DAILY WELLNESS</div>
          <div style={{ fontFamily: f, fontSize: 48, fontWeight: 900, color: '#0C0C0A', lineHeight: .95, letterSpacing: '-.02em', textTransform: 'uppercase' as const }}>HEALTH</div>
          <div style={{ fontFamily: f, fontSize: 12, color: '#9A9490', marginTop: 12, lineHeight: 1.5 }}>건강 루틴 관리 · 운동 · 식단 · 데일리 체크</div>
          {/* 카테고리 관리 패널 */}
          {showCatSection && (
            <div style={{ marginTop: 16, background: '#F4F4F0', borderRadius: 16, padding: '12px' }}>
              {categories.length === 0 && (
                <div style={{ textAlign: 'center', padding: '12px', color: '#9A9490', fontFamily: f, fontSize: 13 }}>카테고리를 추가해주세요</div>
              )}
              {categories.map((cat, idx) => (
                <div
                  key={cat.id}
                  draggable
                  onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; setDragCatIdx(idx); }}
                  onDragOver={(e) => { e.preventDefault(); setDragCatOver(idx); }}
                  onDrop={(e) => { e.preventDefault(); if (dragCatIdx != null) { void moveCat(dragCatIdx, idx); } setDragCatIdx(null); setDragCatOver(null); }}
                  onDragEnd={() => { setDragCatIdx(null); setDragCatOver(null); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid rgba(12,12,10,.07)', opacity: dragCatIdx === idx ? 0.4 : 1, outline: dragCatOver === idx ? '2px dashed #C5FF00' : 'none', outlineOffset: 2, borderRadius: 4 }}
                >
                  <span style={{ cursor: 'grab', color: '#C4C2BE', fontSize: 20, userSelect: 'none' as const, flexShrink: 0, paddingRight: 20 }}>⠿</span>
                  <span style={{ fontSize: 18, flexShrink: 0 }}>{cat.icon}</span>
                  <div style={{ fontFamily: f, fontSize: 13, fontWeight: 700, color: '#0C0C0A', flex: 1 }}>{cat.name}</div>
                  <span style={{ fontFamily: f, fontSize: 10, color: '#BCBAB6' }}>{items.filter(i => i.type === cat.id).length}개</span>
                  <button onClick={() => openEditCat(cat)} style={{ padding: '4px 8px', background: '#EEEDE9', border: 'none', borderRadius: 8, fontFamily: f, fontSize: 11, fontWeight: 700, cursor: 'pointer', color: '#4A4846', flexShrink: 0 }}>편집</button>
                </div>
              ))}
              <button onClick={openNewCat} style={{ width: '100%', padding: '10px', border: '1.5px dashed rgba(12,12,10,.2)', borderRadius: 12, background: 'none', fontFamily: f, fontSize: 12, fontWeight: 700, color: '#9A9490', cursor: 'pointer', marginTop: 2 }}>
                + 카테고리 추가
              </button>
            </div>
          )}
        </div>

        {/* 빠른 추가 폼 */}
        <div style={{ padding: '20px 16px 16px', borderBottom: '1px solid rgba(12,12,10,.07)' }}>
          <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.16em', textTransform: 'uppercase' as const, color: '#9A9490', marginBottom: 12 }}>NEW ROUTINE</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input value={qIcon} onChange={e => setQIcon(e.target.value.slice(0, 4))} placeholder="🏃" style={{ width: 48, padding: '11px 6px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 12, fontSize: 22, textAlign: 'center', background: '#fff', outline: 'none', flexShrink: 0 }} />
              <input value={qName} onChange={e => { setQName(e.target.value); if (e.target.value.trim()) setShowQHint(false); }} onKeyDown={e => { if (e.key === 'Enter') handleQuickAdd(); }} placeholder="루틴 이름 (예: 아침 스트레칭)" maxLength={40} style={{ flex: 1, padding: '12px 14px', border: `1.5px solid ${showQHint ? '#E94F6B' : 'rgba(12,12,10,.14)'}`, borderRadius: 12, fontFamily: f, fontSize: 14, color: '#0C0C0A', background: '#fff', outline: 'none' }} />
            </div>
            {categories.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const }}>
                {categories.map(cat => {
                  const activeCat = qCatId;
                  return (
                    <button key={cat.id} onClick={() => setQCatId(cat.id)} style={{ padding: '6px 12px', borderRadius: 9999, border: `1.5px solid ${activeCat === cat.id ? '#0C0C0A' : 'rgba(12,12,10,.14)'}`, background: activeCat === cat.id ? '#0C0C0A' : '#fff', fontFamily: f, fontSize: 11, fontWeight: 700, color: activeCat === cat.id ? '#C5FF00' : '#4A4846', cursor: 'pointer', transition: 'all .15s' }}>
                      {cat.icon} {cat.name}
                    </button>
                  );
                })}
              </div>
            )}
            <RepeatFormFieldsShared
              f={f} rt={qRepeat} setRt={setQRepeat}
              wd={qWeekdays} toggleWDFn={toggleQWD}
              date_={qDate} setDate_={setQDate}
              time_={qTime} setTime_={setQTime}
              alarm_={qAlarm} setAlarm_={setQAlarm}
            />
            {showQHint && (
              <div style={{ fontFamily: f, fontSize: 12, color: '#E94F6B', fontWeight: 600, paddingLeft: 4 }}>루틴 이름을 입력해주세요.</div>
            )}
            <button onClick={() => { if (!qName.trim()) { setShowQHint(true); return; } setShowQHint(false); handleQuickAdd(); }} disabled={qAdding} style={{ padding: '12px 20px', background: qName.trim() ? '#0C0C0A' : 'rgba(12,12,10,.14)', color: qName.trim() ? '#fff' : '#9A9490', border: 'none', borderRadius: 12, fontFamily: f, fontSize: 12, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase' as const, cursor: 'pointer', transition: 'all .18s' }}>
              + ADD
            </button>
          </div>
        </div>

        {/* 루틴 목록 */}
        <div style={{ padding: '20px 16px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.16em', textTransform: 'uppercase' as const, color: '#9A9490' }}>전체</span>
            <span style={{ fontFamily: f, fontSize: 11, fontWeight: 800, color: '#0C0C0A' }}>{items.length}개</span>
          </div>
          <SearchBar value={healthSearch} onChange={setHealthSearch} placeholder="루틴 이름 검색..." />
          {items.length === 0 ? (
            <div style={{ padding: '36px 16px', textAlign: 'center', fontFamily: f, fontSize: 13, color: '#9A9490', lineHeight: 1.6, border: '1.5px dashed rgba(12,12,10,.14)', borderRadius: 16, background: '#EEEDE9', marginTop: 8 }}>
              아직 등록된 루틴이 없습니다.<br />위에서 새 루틴을 추가해주세요.
            </div>
          ) : healthSearch.trim() ? (
            filteredHealth.length === 0 ? (
              <div style={{ padding: '36px 16px', textAlign: 'center', fontFamily: f, fontSize: 13, color: '#9A9490', marginTop: 8 }}>
                &ldquo;{healthSearch}&rdquo; 검색 결과 없음
              </div>
            ) : (
              <div style={{ background: '#fff', borderRadius: 20, overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,.06),0 0 0 1px rgba(0,0,0,.04)', marginTop: 8 }}>
                {filteredHealth.map((item, idx) => <HealthRow key={item.id} item={item} isLast={idx === filteredHealth.length - 1} />)}
              </div>
            )
          ) : listItems.length === 0 ? (
            <div style={{ padding: '20px 16px', textAlign: 'center', fontFamily: f, fontSize: 13, color: '#BCBAB6', marginTop: 8 }}>
              모두 Today에 표시 중입니다.
            </div>
          ) : grouped.length > 0 ? (
            <>
              {grouped.map(({ cat, list }) => (
                <div key={cat.id} style={{ marginBottom: 16, marginTop: 8 }}>
                  <div style={{ fontFamily: f, fontSize: 11, fontWeight: 800, letterSpacing: '.1em', color: '#9A9490', marginBottom: 8 }}>
                    {cat.icon} {cat.name.toUpperCase()}
                  </div>
                  <div style={{ background: '#fff', borderRadius: 20, overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,.06),0 0 0 1px rgba(0,0,0,.04)' }}>
                    {list.map((item, idx) => <HealthRow key={item.id} item={item} isLast={idx === list.length - 1} />)}
                  </div>
                </div>
              ))}
            </>
          ) : (
            <div style={{ background: '#fff', borderRadius: 20, overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,.06),0 0 0 1px rgba(0,0,0,.04)', marginTop: 8 }}>
              {listItems.map((item, idx) => <HealthRow key={item.id} item={item} isLast={idx === listItems.length - 1} />)}
            </div>
          )}
        </div>

        {/* DAILY HEALTH — showInToday=true 루틴 미리보기 */}
        {items.some(i => i.showInToday) && (
          <div style={{ padding: '24px 16px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <span style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.16em', textTransform: 'uppercase' as const, color: '#9A9490' }}>DAILY HEALTH</span>
              <span style={{ background: '#C5FF00', color: '#0C0C0A', fontFamily: f, fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 9999 }}>TODAY</span>
              <span style={{ fontFamily: f, fontSize: 11, color: '#BCBAB6', marginLeft: 'auto' }}>{items.filter(i => i.showInToday).length}개</span>
            </div>
            <div style={{ background: '#fff', borderRadius: 16, overflow: 'hidden', border: '1px solid rgba(12,12,10,.07)', boxShadow: '0 1px 4px rgba(0,0,0,.06)' }}>
              {items.filter(i => i.showInToday).map((item, idx) => (
                <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderTop: idx > 0 ? '1px solid rgba(12,12,10,.07)' : 'none', background: '#FAFAF8' }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: '#EEEDE9', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>
                    {item.icon}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: f, fontSize: 14, fontWeight: 600, color: '#0C0C0A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{item.name}</div>
                    {item.entries?.length ? (
                      <div style={{ fontFamily: f, fontSize: 11, color: '#9A9490', marginTop: 1 }}>{item.entries.length}개 일정</div>
                    ) : null}
                  </div>
                  <button onClick={() => onToggleToday(item.id, true)}
                    style={{ height: 26, padding: '0 10px', borderRadius: 9999, border: 'none', cursor: 'pointer', background: '#0C0C0A', color: '#C5FF00', fontFamily: f, fontSize: 10, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase' as const, flexShrink: 0 }}>
                    Today ON
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ height: 40 }} />
      </div>

      {/* 루틴 등록/편집 시트 */}
      {showForm && (
        <>
          <div onClick={() => setShowForm(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 310 }} />
          <div style={{ position: 'fixed', bottom: 0, left: 'max(0px,calc(50vw - 215px))', right: 'max(0px,calc(50vw - 215px))', zIndex: 311, background: '#FAFAF8', borderRadius: '20px 20px 0 0', padding: '10px 20px calc(env(safe-area-inset-bottom, 0px) + 48px)', maxHeight: '92%', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <div style={{ width: 32, height: 3, background: 'rgba(12,12,10,.14)', borderRadius: 2, margin: '0 auto 20px' }} />
            <div style={{ fontFamily: f, fontSize: 20, fontWeight: 800, color: '#0C0C0A', marginBottom: 20 }}>{editId ? '루틴 수정' : '루틴 추가'}</div>

            <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, color: '#9A9490', letterSpacing: '.06em', marginBottom: 8 }}>카테고리</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const, marginBottom: 14 }}>
              {categories.map(cat => (
                <button key={cat.id} onClick={() => { setCatId(cat.id); setRoutineIcon(cat.icon); }}
                  style={{ padding: '6px 12px', borderRadius: 9999, border: `1.5px solid ${catId === cat.id ? '#0C0C0A' : 'rgba(12,12,10,.14)'}`, background: catId === cat.id ? '#0C0C0A' : 'transparent', fontFamily: f, fontSize: 11, fontWeight: 700, color: catId === cat.id ? '#C5FF00' : '#4A4846', cursor: 'pointer' }}>
                  {cat.icon} {cat.name}
                </button>
              ))}
            </div>

            <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, color: '#9A9490', letterSpacing: '.06em', marginBottom: 8 }}>루틴 이름</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <input value={routineIcon} onChange={e => setRoutineIcon(e.target.value.slice(0, 4))}
                style={{ width: 44, padding: '10px 0', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 10, fontFamily: f, fontSize: 20, textAlign: 'center', outline: 'none', flexShrink: 0 }} />
              <input value={name} onChange={e => setName(e.target.value)} placeholder="루틴 이름"
                style={{ flex: 1, padding: '10px 12px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 10, fontFamily: f, fontSize: 13, outline: 'none' }} />
            </div>
            <input value={goal} onChange={e => setGoal(e.target.value)} placeholder="목표 (선택)"
              style={{ width: '100%', padding: '10px 12px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 10, fontFamily: f, fontSize: 13, marginBottom: 12, outline: 'none', boxSizing: 'border-box' as const }} />

            <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, color: '#9A9490', letterSpacing: '.06em', marginBottom: 8 }}>반복 유형</div>
            <div style={{ marginBottom: 16 }}>
              <RepeatFormFieldsShared
                f={f} rt={hRepeat} setRt={setHRepeat}
                wd={hWeekdays} toggleWDFn={toggleHWD}
                date_={hDate} setDate_={setHDate}
                time_={hTime} setTime_={setHTime}
                alarm_={hAlarm} setAlarm_={setHAlarm}
              />
            </div>

            <div style={{ fontFamily: f, fontSize: 11, fontWeight: 800, letterSpacing: '.08em', color: '#0C0C0A', marginBottom: 8 }}>시간별 항목</div>
            {[...entries].sort((a, b) => a.time.localeCompare(b.time)).map(e => (
              <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: editEntryId === e.id ? '#F5FDD4' : '#F9F9F7', borderRadius: 10, marginBottom: 6, border: `1px solid ${editEntryId === e.id ? '#C5FF00' : 'transparent'}` }}>
                <span style={{ fontFamily: f, fontSize: 11, fontWeight: 800, color: '#C5FF00', background: '#0C0C0A', padding: '2px 7px', borderRadius: 6, flexShrink: 0 }}>{e.time}</span>
                <span style={{ fontFamily: f, fontSize: 12, flex: 1, color: '#4A4846' }}>{e.desc}</span>
                <button onClick={() => startEditEntry(e)} style={{ border: 'none', background: 'none', fontFamily: f, fontSize: 11, fontWeight: 700, color: '#9A9490', cursor: 'pointer', padding: '2px 6px' }}>수정</button>
                <button onClick={() => deleteEntry(e.id)} style={{ border: 'none', background: 'none', fontFamily: f, fontSize: 11, fontWeight: 700, color: '#DC2626', cursor: 'pointer', padding: '2px 6px' }}>✕</button>
              </div>
            ))}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16, padding: '12px', background: '#F9F9F7', borderRadius: 12, border: '1px solid rgba(12,12,10,.07)' }}>
              <TimePickerField
                value={getEntryTime()}
                onChange={t => { const [h, m] = t.split(':'); setEntryHour(h); setEntryMin(m); }}
                f={f}
              />
              <div style={{ display: 'flex', gap: 6 }}>
                <input value={entryDesc} onChange={e => setEntryDesc(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addOrUpdateEntry(); } }}
                  placeholder="내용 (예: 30분 러닝)"
                  style={{ flex: 1, padding: '8px 10px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 10, fontFamily: f, fontSize: 12, outline: 'none', background: '#fff' }} />
                <button onClick={addOrUpdateEntry} style={{ padding: '8px 12px', background: '#0C0C0A', border: 'none', borderRadius: 10, fontFamily: f, fontSize: 12, fontWeight: 800, color: '#C5FF00', cursor: 'pointer', flexShrink: 0 }}>
                  {editEntryId ? '수정' : '추가'}
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setShowForm(false)} style={{ flex: 1, padding: '12px', background: '#F4F4F0', border: 'none', borderRadius: 12, fontFamily: f, fontSize: 13, fontWeight: 700, color: '#4A4846', cursor: 'pointer' }}>취소</button>
              <button onClick={handleSave} disabled={saving} style={{ flex: 1, padding: '12px', background: '#0C0C0A', border: 'none', borderRadius: 12, fontFamily: f, fontSize: 13, fontWeight: 800, color: '#C5FF00', cursor: 'pointer', opacity: saving ? .6 : 1 }}>
                {saving ? '저장 중…' : '저장'}
              </button>
            </div>
            {editId && <button onClick={() => handleDelete(editId)} style={{ marginTop: 10, width: '100%', padding: '12px', background: 'none', border: '1.5px solid rgba(186,26,26,.3)', borderRadius: 12, fontFamily: f, fontSize: 13, fontWeight: 700, color: '#BA1A1A', cursor: 'pointer' }}>삭제</button>}
          </div>
        </>
      )}

      {/* 카테고리 등록/편집 시트 */}
      {showCatForm && (
        <>
          <div onClick={() => setShowCatForm(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 310 }} />
          <div style={{ position: 'fixed', bottom: 0, left: 'max(0px,calc(50vw - 215px))', right: 'max(0px,calc(50vw - 215px))', zIndex: 311, background: '#FAFAF8', borderRadius: '20px 20px 0 0', padding: '10px 20px calc(env(safe-area-inset-bottom, 0px) + 28px)', maxHeight: '80%', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <div style={{ width: 32, height: 3, background: 'rgba(12,12,10,.14)', borderRadius: 2, margin: '0 auto 20px' }} />
            <div style={{ fontFamily: f, fontSize: 20, fontWeight: 800, color: '#0C0C0A', marginBottom: 20 }}>{catEditId ? '카테고리 수정' : '카테고리 추가'}</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              <input value={catIcon} onChange={e => setCatIcon(e.target.value.slice(0, 4))}
                style={{ width: 52, padding: '10px 0', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 10, fontFamily: f, fontSize: 22, textAlign: 'center', outline: 'none', flexShrink: 0 }} />
              <input value={catName} onChange={e => setCatName(e.target.value)} placeholder="카테고리 이름"
                style={{ flex: 1, padding: '10px 12px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 10, fontFamily: f, fontSize: 13, outline: 'none' }} />
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' as const }}>
              {['🥗', '🏃', '🍱', '💤', '⭐', '💪', '🧘', '🚴', '🏊', '🎯', '🥑', '💊', '🥦', '🏋️'].map(em => (
                <button key={em} onClick={() => setCatIcon(em)} style={{ width: 36, height: 36, borderRadius: 9999, border: `1.5px solid ${catIcon === em ? '#0C0C0A' : 'rgba(12,12,10,.1)'}`, background: catIcon === em ? '#F5FDD4' : 'transparent', fontSize: 18, cursor: 'pointer' }}>{em}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {catEditId && <button onClick={() => deleteCat(catEditId)} style={{ padding: '12px 16px', background: '#FEE2E2', border: 'none', borderRadius: 12, fontFamily: f, fontSize: 13, fontWeight: 700, color: '#DC2626', cursor: 'pointer' }}>삭제</button>}
              <button onClick={saveCat} disabled={catSaving} style={{ flex: 1, padding: 14, background: '#0C0C0A', border: 'none', borderRadius: 12, fontFamily: f, fontSize: 13, fontWeight: 800, color: '#C5FF00', cursor: 'pointer', opacity: catSaving ? .6 : 1 }}>
                {catSaving ? '저장 중…' : '저장'}
              </button>
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
  const [showAddHint, setShowAddHint] = useState(false);

  const [habitSearch, setHabitSearch] = useState('');
  const listHabits = habits.filter(h => !h.showInToday);
  const filteredHabits = habitSearch.trim()
    ? listHabits.filter(h => h.name.toLowerCase().includes(habitSearch.toLowerCase()))
    : listHabits;

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
  async function handleDeleteHabitById(id: string) {
    if (!confirm('이 습관을 삭제하시겠어요?')) return;
    await onDeleteHabit(id);
  }

  function toggleWD(wd: number) { setNewWeekdays(p => p.includes(wd) ? p.filter(d => d !== wd) : [...p, wd]); }
  function toggleEWD(wd: number) { setEWeekdays(p => p.includes(wd) ? p.filter(d => d !== wd) : [...p, wd]); }

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
            background: isToday ? '#0C0C0A' : '#F4F4F0',
            color: isToday ? '#C5FF00' : '#9A9490',
            fontFamily: f, fontSize: 10, fontWeight: 800, letterSpacing: '.08em',
            textTransform: 'uppercase' as const,
            transition: 'all .18s', flexShrink: 0,
          }}
        >
          {isToday ? 'Today ON' : 'Today OFF'}
        </button>

        {/* 편집 버튼 */}
        <button
          onClick={onEdit}
          style={{ width: 28, height: 28, background: 'none', border: 'none', cursor: 'pointer', color: '#9A9490', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', flexShrink: 0 }}
          aria-label="편집"
        >
          ✎
        </button>
        <button
          onClick={() => handleDeleteHabitById(h.id)}
          style={{ width: 28, height: 28, background: 'none', border: 'none', cursor: 'pointer', color: '#DC2626', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', flexShrink: 0 }}
          aria-label="삭제"
        >
          🗑
        </button>
      </div>
    );
  }

  return (
    <div style={{ position: 'fixed', top: 0, bottom: 0, left: 'max(0px,calc(50vw - 215px))', right: 'max(0px,calc(50vw - 215px))', zIndex: 100, background: '#FAFAF8', display: 'flex', flexDirection: 'column', overflowY: 'hidden' }}>
      <SubPageHeader title="HABITS" onClose={onBack} />

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
              <input value={newIcon} onChange={e => setNewIcon(e.target.value.slice(0, 4))} placeholder="✦" style={{ width: 48, padding: '11px 6px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 12, fontSize: 22, textAlign: 'center', background: '#fff', outline: 'none', flexShrink: 0 }} />
              <input value={newName} onChange={e => { setNewName(e.target.value); if (e.target.value.trim()) setShowAddHint(false); }} onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }} placeholder="습관 이름 (예: 모닝 워터 한 잔)" maxLength={40} style={{ flex: 1, padding: '12px 14px', border: `1.5px solid ${showAddHint ? '#E94F6B' : 'rgba(12,12,10,.14)'}`, borderRadius: 12, fontFamily: f, fontSize: 14, color: '#0C0C0A', background: '#fff', outline: 'none' }} />
            </div>
            <RepeatFormFieldsShared f={f} rt={newRepeat} setRt={setNewRepeat} wd={newWeekdays} toggleWDFn={toggleWD} date_={newDate} setDate_={setNewDate} time_={newTime} setTime_={setNewTime} alarm_={newAlarm} setAlarm_={setNewAlarm} />
            {showAddHint && (
              <div style={{ fontFamily: f, fontSize: 12, color: '#E94F6B', fontWeight: 600, paddingLeft: 4 }}>습관 이름을 입력해주세요.</div>
            )}
            <button onClick={() => { if (!newName.trim()) { setShowAddHint(true); return; } setShowAddHint(false); handleAdd(); }} disabled={adding} style={{ padding: '12px 20px', background: newName.trim() ? '#0C0C0A' : 'rgba(12,12,10,.14)', color: newName.trim() ? '#fff' : '#9A9490', border: 'none', borderRadius: 12, fontFamily: f, fontSize: 12, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase' as const, cursor: 'pointer', transition: 'all .18s' }}>
              + ADD
            </button>
          </div>
        </div>

        {/* All habits pool */}
        <div style={{ padding: '20px 16px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.16em', textTransform: 'uppercase' as const, color: '#9A9490' }}>전체</span>
            <span style={{ fontFamily: f, fontSize: 11, fontWeight: 800, color: '#0C0C0A' }}>{habits.length}개</span>
          </div>
          <SearchBar value={habitSearch} onChange={setHabitSearch} placeholder="습관 이름 검색..." />
          {habits.length === 0 ? (
            <div style={{ padding: '36px 16px', textAlign: 'center', fontFamily: f, fontSize: 13, color: '#9A9490', lineHeight: 1.6, border: '1.5px dashed rgba(12,12,10,.14)', borderRadius: 16, background: '#EEEDE9', marginTop: 8 }}>
              아직 등록된 습관이 없습니다.<br />위에서 새 습관을 추가해주세요.
            </div>
          ) : habitSearch.trim() ? (
            filteredHabits.length === 0 ? (
              <div style={{ padding: '36px 16px', textAlign: 'center', fontFamily: f, fontSize: 13, color: '#9A9490', marginTop: 8 }}>
                &ldquo;{habitSearch}&rdquo; 검색 결과 없음
              </div>
            ) : (
              <div style={{ background: '#fff', borderRadius: 20, overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,.06),0 0 0 1px rgba(0,0,0,.04)', marginTop: 8 }}>
                {filteredHabits.map(h => <HabitRow key={h.id} h={h} onEdit={() => openEdit(h)} />)}
              </div>
            )
          ) : listHabits.length === 0 ? (
            <div style={{ padding: '20px 16px', textAlign: 'center', fontFamily: f, fontSize: 13, color: '#BCBAB6', marginTop: 8 }}>
              모두 Today에 표시 중입니다.
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
                      background: '#0C0C0A', color: '#C5FF00',
                      fontFamily: f, fontSize: 10, fontWeight: 800, letterSpacing: '.08em',
                      textTransform: 'uppercase' as const,
                      flexShrink: 0,
                    }}
                  >
                    Today ON
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
          <div style={{ position: 'fixed', bottom: 0, left: 'max(0px,calc(50vw - 215px))', right: 'max(0px,calc(50vw - 215px))', zIndex: 311, background: '#FAFAF8', borderRadius: '20px 20px 0 0', padding: '10px 20px calc(env(safe-area-inset-bottom, 0px) + 48px)', maxHeight: '88%', overflowY: 'auto' }}>
            <div style={{ width: 32, height: 3, background: 'rgba(12,12,10,.14)', borderRadius: 2, margin: '0 auto 20px' }} />
            <div style={{ fontFamily: f, fontSize: 20, fontWeight: 800, color: '#0C0C0A', marginBottom: 20 }}>습관 편집</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input value={eIcon} onChange={e => setEIcon(e.target.value.slice(0, 4))} placeholder="✦" style={{ width: 48, padding: '11px 6px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 12, fontSize: 22, textAlign: 'center', background: '#fff', outline: 'none', flexShrink: 0 }} />
                <input value={eName} onChange={e => setEName(e.target.value)} placeholder="습관 이름" maxLength={40} style={{ flex: 1, padding: '12px 14px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 12, fontFamily: f, fontSize: 14, color: '#0C0C0A', background: '#fff', outline: 'none' }} />
              </div>
              <RepeatFormFieldsShared f={f} rt={eRepeat} setRt={setERepeat} wd={eWeekdays} toggleWDFn={toggleEWD} date_={eDate} setDate_={setEDate} time_={eTime} setTime_={setETime} alarm_={eAlarm} setAlarm_={setEAlarm} />
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
              <button onClick={() => setEditHabit(null)} style={{ flex: 1, padding: 14, background: '#F4F4F0', border: 'none', borderRadius: 12, fontFamily: f, fontSize: 13, fontWeight: 700, color: '#4A4846', cursor: 'pointer' }}>취소</button>
              <button onClick={handleSaveEdit} style={{ flex: 1, padding: 14, background: '#0C0C0A', color: '#fff', border: 'none', borderRadius: 12, fontFamily: f, fontSize: 13, fontWeight: 700, cursor: 'pointer', letterSpacing: '.02em' }}>저장</button>
            </div>
            <button onClick={handleDeleteHabit} style={{ marginTop: 10, width: '100%', padding: 14, background: 'none', color: '#BA1A1A', border: '1.5px solid rgba(186,26,26,.3)', borderRadius: 12, fontFamily: f, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>삭제</button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── CT PANEL (집중케어 / 메이크업북 / 룩북) ────────────────────────────────────
function CtPanel({
  ctType, ctItems, products, onBack, onAdd, onUpdate, onDelete, userId,
}: {
  ctType: CtType;
  ctItems: CtItem[];
  products: Product[];
  onBack: () => void;
  userId: string;
  onAdd: (item: Omit<CtItem, 'id' | 'createdAt' | 'updatedAt'>) => Promise<string>;
  onUpdate: (id: string, item: Partial<Omit<CtItem, 'id'>>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const f = "'Plus Jakarta Sans','Space Grotesk',sans-serif";

  const META: Record<CtType, { panel: string; heroType: string; heroTitle: string; heroSub: string; sheetTitle: string; addBtn: string; icon: string }> = {
    care: { panel: '집중케어', heroType: 'INTENSIVE CARE', heroTitle: '집중케어', heroSub: '케어 프로그램 설계 · BOX 뷰티 제품 매핑 · 기간 & 스케줄 설정', sheetTitle: '집중케어 설계', addBtn: '+ 새 집중케어 설계', icon: '🧴' },
    makeup: { panel: '메이크업북', heroType: 'BEAUTY', heroTitle: '메이크업북', heroSub: '테마별 화장법 설계 · BOX 뷰티 제품 매핑 · Today 스케줄 연동', sheetTitle: '메이크업 테마 설계', addBtn: '+ 새 메이크업 테마 설계', icon: '💄' },
    lookbook: { panel: '룩북', heroType: 'FASHION', heroTitle: '룩북', heroSub: 'T.P.O 기반 코디 설계 · BOX 패션·액세서리 매핑 · Today OOTD 연동', sheetTitle: '룩 설계', addBtn: '+ 새 룩 설계', icon: '👗' },
    log: { panel: 'LOG', heroType: 'LOG', heroTitle: 'LOG', heroSub: '메이크업 · 룩북 기록', sheetTitle: 'LOG 등록', addBtn: '+ LOG 등록', icon: '📝' },
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

  // 이미지 (hero)
  const [sImageFile, setSImageFile] = useState<File | null>(null);
  const [sImagePreview, setSImagePreview] = useState('');

  // 참고 링크
  const [sSourceUrl, setSSourceUrl] = useState('');

  // Product picker inside sheet
  const [picker, setPicker] = useState<'main' | 'tip' | null>(null);
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickerSelected, setPickerSelected] = useState<Set<string>>(new Set());

  // 목록 검색
  const [ctSearch, setCtSearch] = useState('');
  const filteredCtItems = (ctSearch.trim()
    ? ctItems.filter(i => i.name.toLowerCase().includes(ctSearch.toLowerCase()))
    : ctItems
  ).slice().sort((a, b) => (b.published ? 1 : 0) - (a.published ? 1 : 0));

  // Inline text input
  const [activeInput, setActiveInput] = useState<{ section: 'main' | 'tip'; type: 'desc' | 'tip' } | null>(null);
  const [inputText, setInputText] = useState('');

  // AI 가져오기 패널
  const [aiCarePanel, setAiCarePanel] = useState(false);

  // 드래그 재정렬 상태
  const [dragCtx, setDragCtx] = useState<{ section: 'main' | 'tip'; idx: number } | null>(null);
  const [dragOverCtx, setDragOverCtx] = useState<{ section: 'main' | 'tip'; idx: number } | null>(null);

  // 도메인 필터: care/makeup → 뷰티, lookbook → 패션·악세서리
  const domainProducts = ctType === 'lookbook'
    ? products.filter(p => p.domain === 'fashion' || p.domain === 'acc')
    : ctType === 'makeup'
      ? products.filter(p => p.domain === 'beauty' && p.subCategory === 'makeup')
      : products.filter(p => p.domain === 'beauty');

  const filteredProducts = domainProducts.filter(p => {
    if (!pickerSearch) return true;
    const q = pickerSearch.toLowerCase();
    return p.name.toLowerCase().includes(q) || (p.brand ?? '').toLowerCase().includes(q);
  });

  // 검색어로 제품 없을 때 → BOX에 즉시 등록 후 피커에 추가 (실시간 동기화)
  async function registerAndAdd(name: string) {
    if (!db || !name.trim()) return;
    const now = new Date().toISOString();
    const domain = ctType === 'lookbook' ? 'fashion' : 'beauty';
    const subCategory = ctType === 'makeup' ? 'makeup' : ctType === 'lookbook' ? undefined : 'skincare';
    const ref = await addDoc(collection(db, 'users', userId, 'products'), {
      name: name.trim(), brand: '', domain, ...(subCategory ? { subCategory } : {}),
      packageCount: 1, unitPerPackage: 0, itemUnit: '', totalAmount: 0,
      dosePerUse: 0, usesPerDay: 1, frequencyType: 'daily', currentRemaining: 0,
      createdAt: now, updatedAt: now,
    });
    setPickerSelected(prev => { const n = new Set(prev); n.add(ref.id); return n; });
    setPickerSearch('');
  }

  function productName(id: string) { return products.find(p => p.id === id)?.name ?? '?'; }

  function openNew() {
    setEditItem(null); setSEmoji(m.icon); setSName(''); setSDesc('');
    setSItems([]); setSTipItems([]); setSExpertTip('');
    setSPeriodStart(''); setSPeriodEnd(''); setSDates([]); setSTpo([]);
    setSPublished(false);
    setSImageFile(null); setSImagePreview('');
    setSSourceUrl('');
    setSheetOpen(true);
  }

  function openEdit(item: CtItem) {
    setEditItem(item); setSEmoji(item.emoji); setSName(item.name); setSDesc(item.desc);
    setSItems(item.items); setSTipItems(item.tipItems); setSExpertTip(item.expertTip ?? '');
    setSPeriodStart(item.periodStart ?? ''); setSPeriodEnd(item.periodEnd ?? '');
    setSDates(item.dates ?? []); setSTpo(item.tpo ?? []);
    setSPublished(item.published);
    setSImageFile(null); setSImagePreview(item.imageUrl ?? '');
    setSSourceUrl(item.sourceUrl ?? '');
    setSheetOpen(true);
  }

  function closeSheet() { setSheetOpen(false); setPicker(null); setActiveInput(null); }

  async function handleSave() {
    if (!sName.trim()) return;
    setSaving(true);
    const now = new Date().toISOString();
    const data: Omit<CtItem, 'id' | 'createdAt' | 'updatedAt'> = {
      ctType,
      emoji: sEmoji || m.icon,
      name: sName.trim(),
      desc: sDesc.trim(),
      items: sItems,
      tipItems: sTipItems,
      expertTip: sExpertTip.trim(),
      published: sPublished,
      ...(sSourceUrl.trim() ? { sourceUrl: sSourceUrl.trim() } : {}),
      // 기존 imageUrl 유지 (새 파일 선택 전까지)
      ...(sImagePreview ? { imageUrl: sImagePreview } : {}),
      ...(ctType === 'care' && sPeriodStart ? { periodStart: sPeriodStart, ...(sPeriodEnd ? { periodEnd: sPeriodEnd } : {}) } : {}),
      ...(ctType !== 'care' ? { dates: sDates } : {}),
      ...(ctType === 'lookbook' ? { tpo: sTpo } : {}),
    };
    try {
      let itemId: string;
      if (editItem) {
        await onUpdate(editItem.id, { ...data, updatedAt: now });
        itemId = editItem.id;
      } else {
        itemId = await onAdd(data);
      }

      // 이미지는 Base64로 data에 포함됐으므로 별도 업로드 불필요

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
    const now = new Date().toISOString();
    const isActivating = !item.published;

    // makeup/lookbook: Today ON 시 오늘 날짜를 dates[]에 자동 추가
    if (isActivating && ctType !== 'care') {
      const today = now.slice(0, 10);
      const currentDates = item.dates ?? [];
      const newDates = currentDates.includes(today)
        ? currentDates
        : [...currentDates, today].sort();
      await onUpdate(item.id, { published: true, dates: newDates, updatedAt: now });
    } else {
      await onUpdate(item.id, { published: !item.published, updatedAt: now });
    }
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
          <button onClick={() => openPicker(section)} style={{ padding: '7px 10px', background: '#0C0C0A', border: 'none', borderRadius: 8, fontFamily: f, fontSize: 11, fontWeight: 700, color: '#C5FF00', cursor: 'pointer', flexShrink: 0 }}>BOX</button>
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
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, paddingBottom: 4, marginBottom: 8 }}>
              {prodItems.map((it, idx) => (
                <div key={idx} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 56 }}>
                  <div style={{ width: 56, height: 56, borderRadius: 10, background: '#EEEDE9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, marginBottom: 4 }}>✦</div>
                  <div style={{ fontFamily: f, fontSize: 10, fontWeight: 600, color: '#0C0C0A', textAlign: 'center', lineHeight: 1.3, wordBreak: 'break-word' as const }}>{productName(it.id)}</div>
                </div>
              ))}
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
          <button onClick={() => togglePublished(item)} style={{ flex: 1, padding: 10, background: item.published ? '#0C0C0A' : 'rgba(12,12,10,.08)', color: item.published ? '#C5FF00' : '#9A9490', border: 'none', borderRadius: 12, fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase' as const, cursor: 'pointer', transition: 'all .15s' }}>
            {item.published ? 'Today ON' : 'Today OFF'}
          </button>
          <button onClick={() => openEdit(item)} style={{ flex: 1, padding: 10, background: '#EEEDE9', color: '#4A4846', border: '1px solid rgba(12,12,10,.07)', borderRadius: 12, fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' as const, cursor: 'pointer' }}>편집</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: 'fixed', top: 0, bottom: 0, left: 'max(0px,calc(50vw - 215px))', right: 'max(0px,calc(50vw - 215px))', zIndex: 100, background: '#FAFAF8', display: 'flex', flexDirection: 'column', overflowY: 'hidden' }}>
      <SubPageHeader title={m.panel.toUpperCase()} onClose={onBack} />

      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ padding: '28px 20px 20px', borderBottom: '1px solid rgba(12,12,10,.07)' }}>
          <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase' as const, color: '#9A9490', marginBottom: 8 }}>{m.heroType}</div>
          <div style={{ fontFamily: f, fontSize: 32, fontWeight: 900, color: '#0C0C0A', lineHeight: 1, letterSpacing: '-.02em' }}>{m.heroTitle}</div>
          <div style={{ fontFamily: f, fontSize: 12, color: '#9A9490', marginTop: 8, lineHeight: 1.5 }}>{m.heroSub}</div>
        </div>

        {/* 검색 바 — 아이템 없어도 항상 표시 */}
        <SearchBar value={ctSearch} onChange={setCtSearch} placeholder={`${m.heroTitle} 이름 검색...`} />

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
          <div style={{ position: 'fixed', bottom: 0, left: 'max(0px,calc(50vw - 215px))', right: 'max(0px,calc(50vw - 215px))', zIndex: 130, background: '#FAFAF8', borderRadius: '20px 20px 0 0', maxHeight: '94%', overflowY: 'auto', paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 40px)', boxShadow: '0 -4px 40px rgba(0,0,0,.12)' }}>
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
                <input value={sEmoji} onChange={e => setSEmoji(e.target.value.slice(0, 4))} placeholder={m.icon} style={{ width: 48, padding: '11px 6px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 12, fontSize: 22, textAlign: 'center', background: '#fff', outline: 'none', flexShrink: 0 }} />
                <input value={sName} onChange={e => setSName(e.target.value)} placeholder="이름" style={{ flex: 1, padding: '12px 14px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 12, fontFamily: f, fontSize: 14, color: '#0C0C0A', background: '#fff', outline: 'none' }} />
              </div>
              <textarea value={sDesc} onChange={e => setSDesc(e.target.value)} placeholder="간단한 설명 (선택)..." rows={2} style={{ marginTop: 8, width: '100%', padding: '10px 14px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 12, fontFamily: f, fontSize: 13, color: '#0C0C0A', background: '#fff', outline: 'none', resize: 'none', boxSizing: 'border-box' as const, lineHeight: 1.5 }} />

              {/* 참고 링크 — 간단한 설명 바로 아래 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 12, padding: '10px 14px', background: '#fff', marginTop: 8 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9A9490" strokeWidth="2.5" style={{ flexShrink: 0 }}>
                  <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/>
                  <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>
                </svg>
                <input
                  type="url"
                  value={sSourceUrl}
                  onChange={e => setSSourceUrl(e.target.value)}
                  placeholder="참고 링크 (Instagram, YouTube...)"
                  style={{ flex: 1, border: 'none', outline: 'none', fontFamily: f, fontSize: 13, color: '#0C0C0A', background: 'transparent' }}
                />
                {sSourceUrl && (
                  <button type="button" onClick={() => setSSourceUrl('')} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#BCBAB6', fontSize: 14, padding: 0, lineHeight: 1 }}>✕</button>
                )}
              </div>
              {sSourceUrl && (() => {
                let domain = sSourceUrl;
                try { domain = new URL(sSourceUrl).hostname; } catch {}
                return <div style={{ fontFamily: f, fontSize: 11, color: '#9A9490', marginTop: 4, paddingLeft: 2 }}>{domain}</div>;
              })()}
            </div>

            {/* 이미지 — 전체 ct타입 공통 (care: 4:3 / makeup: 1:1 / lookbook: 3:4) */}
            {(
              <div style={{ padding: '16px 20px 0' }}>
                <span style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.16em', textTransform: 'uppercase' as const, color: '#9A9490', marginBottom: 8, display: 'block' }}>
                  {ctType === 'care' ? '케어 이미지' : ctType === 'makeup' ? '메이크업 이미지' : '룩 이미지'}
                </span>
                <label style={{ display: 'block', cursor: 'pointer' }}>
                  <input
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={async e => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      try {
                        const base64 = await imageFileToBase64(file);
                        setSImageFile(file); setSImagePreview(base64);
                      } catch (err) {
                        console.error('[OnStep] imageFileToBase64 실패, FileReader 폴백:', err);
                        if (file.size > 500 * 1024) {
                          alert('이미지 파일이 너무 큽니다. 500KB 이하 파일을 선택해주세요.');
                          return;
                        }
                        setSImageFile(file);
                        const reader = new FileReader();
                        reader.onload = ev => { const r = ev.target?.result; if (typeof r === 'string') setSImagePreview(r); };
                        reader.onerror = () => { alert('이미지를 불러오지 못했습니다. 다른 파일을 선택해주세요.'); };
                        reader.readAsDataURL(file);
                      }
                      e.target.value = '';
                    }}
                  />
                  <div style={{
                    width: '100%',
                    aspectRatio: ctType === 'care' ? '4/3' : ctType === 'makeup' ? '1/1' : '3/4',
                    borderRadius: 16,
                    background: sImagePreview ? 'transparent' : '#EDECE9',
                    border: sImagePreview ? 'none' : '1.5px dashed rgba(12,12,10,.18)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexDirection: 'column' as const,
                    gap: 8,
                    overflow: 'hidden',
                    position: 'relative' as const,
                  }}>
                    {sImagePreview ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={sImagePreview} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                    ) : (
                      <>
                        <span style={{ fontSize: 32, opacity: 0.25 }}>📷</span>
                        <span style={{ fontFamily: f, fontSize: 12, color: '#9A9490' }}>탭하여 이미지 추가</span>
                      </>
                    )}
                    {sImagePreview && (
                      <div style={{ position: 'absolute', bottom: 10, right: 10, background: 'rgba(0,0,0,.5)', borderRadius: 8, padding: '4px 10px', fontFamily: f, fontSize: 11, fontWeight: 700, color: '#fff' }}>
                        변경
                      </div>
                    )}
                  </div>
                </label>
                {sImagePreview && (
                  <button
                    type="button"
                    onClick={() => { setSImageFile(null); setSImagePreview(''); }}
                    style={{ marginTop: 6, width: '100%', padding: '8px', border: '1.5px solid rgba(186,26,26,.25)', borderRadius: 10, background: 'none', fontFamily: f, fontSize: 12, color: '#BA1A1A', cursor: 'pointer', fontWeight: 700 }}
                  >
                    이미지 제거
                  </button>
                )}
              </div>
            )}  {/* end image section */}

            {/* Item mapping */}
            <div style={{ padding: '0 20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, marginBottom: 8 }}>
                <span style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.16em', textTransform: 'uppercase' as const, color: '#9A9490' }}>
                  — 아이템 매핑 <span style={{ fontSize: 11, fontWeight: 400, color: '#BCBAB6' }}>{ctType === 'lookbook' ? '(BOX 패션 · 악세서리 · AI/수동)' : '(BOX 뷰티 · AI/수동)'}</span>
                </span>
                {ctType !== 'lookbook' && (
                  <button
                    onClick={() => setAiCarePanel(true)}
                    style={{ padding: '4px 10px', borderRadius: 9999, border: 'none', background: '#0C0C0A', color: '#C5FF00', fontFamily: f, fontSize: 11, fontWeight: 800, cursor: 'pointer', letterSpacing: '.04em', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' as const }}
                  >
                    ✨ AI
                  </button>
                )}
              </div>
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
                  const today = new Date().toISOString().slice(0, 10);
                  // ON으로 켤 때 케어: 시작일이 비어있으면 오늘 날짜 자동 입력
                  if (next && ctType === 'care' && !sPeriodStart) {
                    setSPeriodStart(today);
                  }
                  // ON으로 켤 때 makeup/lookbook: 오늘 날짜를 dates[]에 자동 추가
                  if (next && ctType !== 'care') {
                    setSDates(prev => prev.includes(today) ? prev : [...prev, today].sort());
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
              <button onClick={handleSave} disabled={saving || !sName.trim()} style={{ flex: 1, height: 52, background: sName.trim() ? '#0C0C0A' : 'rgba(12,12,10,.14)', color: sName.trim() ? '#fff' : '#9A9490', border: 'none', borderRadius: 12, fontFamily: f, fontSize: 15, fontWeight: 700, cursor: sName.trim() ? 'pointer' : 'default', transition: 'opacity .2s', letterSpacing: '.02em' }}>{saving ? '저장중...' : editItem ? '수정' : '저장'}</button>
            </div>
            {editItem && (
              <div style={{ padding: '0 20px' }}>
                <button onClick={handleDeleteItem} style={{ width: '100%', padding: 14, background: 'none', border: '1.5px solid rgba(186,26,26,.3)', borderRadius: 12, fontFamily: f, fontSize: 13, color: '#BA1A1A', cursor: 'pointer', fontWeight: 700 }}>삭제</button>
              </div>
            )}
          </div>

          {/* AI 가져오기 패널 */}
          {aiCarePanel && (
            <AiImportPanel
              products={domainProducts}
              panelLabel="집중케어 AI 가져오기"
              confirmLabel="아이템 매핑에 추가 →"
              onClose={() => setAiCarePanel(false)}
              onImport={(items) => {
                setSItems(p => [...p, ...items]);
                setAiCarePanel(false);
              }}
            />
          )}

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
                  {domainProducts.length === 0 && !pickerSearch.trim() ? (
                    <div style={{ padding: '40px 16px', textAlign: 'center', color: '#9A9490', fontFamily: f, fontSize: 13, lineHeight: 1.6 }}>
                      BOX에 {ctType === 'lookbook' ? '패션·악세서리' : ctType === 'makeup' ? '메이크업' : '뷰티'} 제품이 없습니다.<br />
                      아래에서 이름으로 바로 등록할 수 있습니다.
                    </div>
                  ) : (
                    <>
                      {filteredProducts.map(p => {
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
                      {/* 검색어 있고 결과 없으면 → 이름으로 등록 후 추가 */}
                      {pickerSearch.trim() && filteredProducts.length === 0 && (
                        <div onClick={() => registerAndAdd(pickerSearch)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', cursor: 'pointer', background: 'rgba(197,255,0,.06)', borderBottom: '1px solid rgba(12,12,10,.07)' }}>
                          <div style={{ width: 36, height: 36, borderRadius: 8, background: '#C5FF00', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 300 }}>+</div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontFamily: f, fontSize: 14, fontWeight: 700, color: '#0C0C0A' }}>"{pickerSearch.trim()}" 이름으로 등록 후 추가</div>
                            <div style={{ fontFamily: f, fontSize: 11, color: '#9A9490', marginTop: 2 }}>BOX에 자동 저장 · 나중에 상세 정보 수정 가능</div>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
                <div style={{ padding: '12px 16px calc(env(safe-area-inset-bottom, 0px) + 32px)', flexShrink: 0, borderTop: '1px solid rgba(12,12,10,.07)' }}>
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
const VALID_VIEWS: View[] = ['hub', 'sessions', 'editor', 'tracker', 'care', 'makeup', 'lookbook', 'medication', 'health'];

export default function SetupPage() {
  // ── 공유 컨텍스트 ──
  const { user, userId, authLoading, products, sessions, habits, careItems, makeupItems, lookItems, medRoutines, healthRoutines, healthCategories, dietPrograms } = useAppContext();

  const [view, setView] = useState<View>('hub');
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [draft, setDraft] = useState<EditorDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [sessionsKey, setSessionsKey] = useState(0);

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

  // sessions/products/habits/ct → AppContext에서 공유
  useEffect(() => {
    if (!authLoading) setLoadingSessions(false);
  }, [authLoading]);

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
    try { await signOut(auth); }
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

  async function handleToggleHealthToday(id: string, current: boolean) {
    if (!user || !db) { alert('로그인이 필요합니다.'); return; }
    try {
      await updateDoc(doc(db, 'users', userId, 'healthRoutines', id), {
        showInToday: !current,
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error('[OnStep] 건강루틴 TODAY 토글 실패:', err);
    }
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

  async function handleToggleMedToday(id: string, current: boolean) {
    if (!user || !db) { alert('로그인이 필요합니다.'); return; }
    try {
      await updateDoc(doc(db, 'users', userId, 'medRoutines', id), {
        showInToday: !current,
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error('[OnStep] 약루틴 TODAY 토글 실패:', err);
    }
  }

  // ── MedRoutine CRUD ─────────────────────────────────────────────────────────
  async function handleAddMed(m: Omit<MedRoutine, 'id' | 'createdAt' | 'updatedAt'>) {
    if (!user || !db) { alert('로그인이 필요합니다.'); return; }
    const now = new Date().toISOString();
    await addDoc(collection(db, 'users', userId, 'medRoutines'), { ...m, createdAt: now, updatedAt: now });
  }
  async function handleUpdateMed(id: string, m: Partial<Omit<MedRoutine, 'id'>>) {
    if (!db) return;
    await updateDoc(doc(db, 'users', userId, 'medRoutines', id), { ...m, updatedAt: new Date().toISOString() });
  }
  async function handleDeleteMed(id: string) {
    if (!db) return;
    await deleteDoc(doc(db, 'users', userId, 'medRoutines', id));
  }

  // ── HealthRoutine CRUD ───────────────────────────────────────────────────────
  async function handleAddHealth(h: Omit<HealthRoutine, 'id' | 'createdAt' | 'updatedAt'>) {
    if (!user || !db) { alert('로그인이 필요합니다.'); return; }
    const now = new Date().toISOString();
    await addDoc(collection(db, 'users', userId, 'healthRoutines'), { ...h, createdAt: now, updatedAt: now });
  }
  async function handleUpdateHealth(id: string, h: Partial<Omit<HealthRoutine, 'id'>>) {
    if (!db) return;
    await updateDoc(doc(db, 'users', userId, 'healthRoutines', id), { ...h, updatedAt: new Date().toISOString() });
  }
  async function handleDeleteHealth(id: string) {
    if (!db) return;
    await deleteDoc(doc(db, 'users', userId, 'healthRoutines', id));
  }

  // ── DietProgram CRUD ─────────────────────────────────────────────────────────
  async function handleAddDiet(d: Omit<DietProgram, 'id' | 'createdAt' | 'updatedAt'>) {
    if (!user || !db) { alert('로그인이 필요합니다.'); return; }
    const now = new Date().toISOString();
    // JSON 왕복으로 undefined 필드 제거 (Firestore는 undefined 거부)
    const clean = JSON.parse(JSON.stringify({ ...d, createdAt: now, updatedAt: now }));
    await addDoc(collection(db, 'users', userId, 'dietPrograms'), clean);
  }
  async function handleUpdateDiet(id: string, d: Partial<Omit<DietProgram, 'id'>>) {
    if (!db) return;
    await updateDoc(doc(db, 'users', userId, 'dietPrograms', id), { ...d, updatedAt: new Date().toISOString() });
  }
  async function handleDeleteDiet(id: string) {
    if (!db) return;
    await deleteDoc(doc(db, 'users', userId, 'dietPrograms', id));
  }

  // 리셋 플랜 피커에서 없는 제품 즉시 BOX(health) 등록 → 새 ID 반환
  async function handleRegisterDietProduct(name: string): Promise<string> {
    if (!user || !db) return '';
    const now = new Date().toISOString();
    const ref = await addDoc(collection(db, 'users', userId, 'products'), {
      name: name.trim(), brand: '', domain: 'health', subCategory: '영양제',
      category: '영양제', packageCount: 1, unitPerPackage: 1, itemUnit: '정',
      totalAmount: 1, dosePerUse: 1, usesPerDay: 1,
      frequencyType: 'daily', frequencyValue: 7,
      currentRemaining: 1, active: true, createdAt: now, updatedAt: now,
    });
    return ref.id;
  }

  // 2주 다이어트 제품 BOX health 도메인에 자동 등록
  async function seedDietProducts() {
    if (!user || !db) { alert('로그인이 필요합니다.'); return; }
    const DIET_PRODUCTS = [
      '파워칵테일','액티바이즈','듀오','뮤노겐','리스토레이트',
      '피트니스드링크','웨이','프로쉐이프 망고','프로쉐이프 초코','뷰티',
    ];
    const existing = new Set(products.filter(p => p.domain === 'health').map(p => p.name));
    const toAdd = DIET_PRODUCTS.filter(name => !existing.has(name));
    if (toAdd.length === 0) { alert('이미 모두 등록되어 있습니다.'); return; }
    const now = new Date().toISOString();
    await Promise.all(toAdd.map(name =>
      addDoc(collection(db!, 'users', userId, 'products'), {
        name, brand: '', domain: 'health', subCategory: '영양제',
        category: '영양제', packageCount: 1, unitPerPackage: 1, itemUnit: '정',
        totalAmount: 1, dosePerUse: 1, usesPerDay: 1,
        frequencyType: 'daily', frequencyValue: 7,
        currentRemaining: 1, active: true, createdAt: now, updatedAt: now,
      })
    ));
    alert(`${toAdd.length}개 제품을 BOX 약·비타민에 등록했습니다.`);
  }

  // ── HealthCategory CRUD ──────────────────────────────────────────────────────
  async function handleAddHealthCategory(c: Omit<HealthCategory, 'id' | 'createdAt'>) {
    if (!user || !db) { alert('로그인이 필요합니다.'); return; }
    await addDoc(collection(db, 'users', userId, 'healthCategories'), { ...c, createdAt: new Date().toISOString() });
  }
  async function handleUpdateHealthCategory(id: string, c: Partial<Omit<HealthCategory, 'id'>>) {
    if (!db) return;
    await updateDoc(doc(db, 'users', userId, 'healthCategories', id), c);
  }
  async function handleDeleteHealthCategory(id: string) {
    if (!db) return;
    await deleteDoc(doc(db, 'users', userId, 'healthCategories', id));
  }
  // 기본 카테고리 5개 자동 생성 (첫 진입 or 빈 경우)
  async function ensureDefaultCategories() {
    if (!user || !db) return;
    // React state 대신 Firestore 직접 확인 → 동시 호출 시 중복 생성 방지
    const existing = await getDocs(collection(db, 'users', userId, 'healthCategories'));
    if (existing.size > 0) return;
    const now = new Date().toISOString();
    await Promise.all(
      DEFAULT_HEALTH_CATEGORIES.map(c =>
        addDoc(collection(db!, 'users', userId, 'healthCategories'), { ...c, createdAt: now })
      )
    );
  }

  // ── CtItem CRUD ─────────────────────────────────────────────────────────────
  function ctCollection(ct: CtType) {
    return ct === 'care' ? 'careItems' : ct === 'makeup' ? 'makeupItems' : 'lookItems';
  }

  async function handleAddCtItem(item: Omit<CtItem, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
    if (!user || !db) { alert('로그인이 필요합니다.'); return ''; }
    const now = new Date().toISOString();
    const docRef = await addDoc(collection(db, 'users', userId, ctCollection(item.ctType)), { ...item, createdAt: now, updatedAt: now })
      .catch((err) => { console.error('[handleAddCtItem] Firestore 오류:', err); throw err; });
    return docRef.id;
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
        onOpenMedication={() => goView('medication')}
        onOpenHealth={() => goView('health')}
        onOpenDiet={() => goView('diet')}
      />
      {(view === 'sessions' || view === 'editor') && (
        <SessionsView key={sessionsKey} sessions={sessions} products={products} loading={loadingSessions} onBack={() => goView('hub')} onNew={openNewSession} onEdit={openEdit} onUpdateNumber={handleUpdateSessionNumber} />
      )}
      {view === 'editor' && draft && (
        <EditorView draft={draft} setDraft={setDraft} products={products} onBack={() => goView('sessions')} onSave={handleSave} onSaveOnly={handleSaveOnly} onDelete={handleDelete} saving={saving} userId={userId} />
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
          ctType="care" ctItems={careItems} products={products} userId={userId}
          onBack={() => goView('hub')}
          onAdd={handleAddCtItem}
          onUpdate={(id, item) => handleUpdateCtItem('care', id, item)}
          onDelete={(id) => handleDeleteCtItem('care', id)}
        />
      )}
      {/* 메이크업·룩북은 LOG [아카이브] 탭으로 이동 */}
      {view === 'diet' && (
        <DietPlanView
          programs={dietPrograms}
          products={products}
          onBack={() => goView('hub')}
          onAdd={handleAddDiet}
          onUpdate={handleUpdateDiet}
          onDelete={handleDeleteDiet}
          onSeedProducts={seedDietProducts}
          onRegisterProduct={handleRegisterDietProduct}
        />
      )}
      {view === 'medication' && (
        <MedView
          items={medRoutines}
          onBack={() => goView('hub')}
          onAdd={handleAddMed}
          onUpdate={handleUpdateMed}
          onDelete={handleDeleteMed}
          onToggleToday={handleToggleMedToday}
        />
      )}
      {view === 'health' && (
        <HealthView
          items={healthRoutines}
          categories={healthCategories}
          onBack={() => goView('hub')}
          onAdd={handleAddHealth}
          onUpdate={handleUpdateHealth}
          onDelete={handleDeleteHealth}
          onToggleToday={handleToggleHealthToday}
          onAddCategory={handleAddHealthCategory}
          onUpdateCategory={handleUpdateHealthCategory}
          onDeleteCategory={handleDeleteHealthCategory}
          onEnsureDefaultCategories={ensureDefaultCategories}
        />
      )}
    </>
  );
}
