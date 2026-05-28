// app/setup/page.tsx — SETUP 페이지 (루틴 케어 플랜 편집)
// Stage 4: Hub → Sessions → Session Editor
//
// 💡 이 파일의 구조:
//   1. 타입 정의 + 상수
//   2. 공통 UI (Appbar, BackButton)
//   3. HubView — 메인 허브 화면 (2열 카드 그리드)
//   4. SessionsView — 루틴 세션 목록
//   5. EditorView — 세션 편집 (날짜/시간, DAY, 제품 매핑)
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

// ─── 타입 정의 ───────────────────────────────────────────────────────────────

// 현재 보여줄 화면
type View = 'hub' | 'sessions' | 'editor';

// 한 시간대(아침/저녁)의 제품 묶음 + 사용법
// 예: 아침에 토너 → 세럼 → 크림 쓰고 "각 1펌프씩" 이라는 설명
type DaySlot = {
  productIds: string[]; // 이 시간대에 쓸 제품들의 Firestore ID
  instruction: string;  // 전체 사용법 텍스트
};

// 하루 루틴 (DAY 1, DAY 2, ...)
type RoutineDay = {
  dayNumber: number;  // 1부터 시작
  morning: DaySlot;
  evening: DaySlot;
};

// Firestore에 저장되는 루틴 세션 (1개 = 1회차)
type Session = {
  id: string;
  sessionNumber: number;  // 1회차, 2회차, ...
  startDate: string;      // "YYYY-MM-DD"
  endDate: string;
  morningTime: string;    // "07:30" (24시간 형식)
  eveningTime: string;    // "22:00"
  days: RoutineDay[];
  createdAt: string;
  updatedAt: string;
};

// 편집 중인 세션의 임시 상태 (저장 전)
type EditorDraft = {
  id: string | null;       // null = 새 세션
  sessionNumber: number;
  startDate: string;
  endDate: string;
  morningTime: string;
  eveningTime: string;
  days: RoutineDay[];
};

// ─── 상수 / 헬퍼 함수 ────────────────────────────────────────────────────────

const FALLBACK_USER_ID = 'demo-user';

// 빈 DaySlot 생성
function emptySlot(): DaySlot {
  return { productIds: [], instruction: '' };
}

// 빈 RoutineDay 생성 (day N번)
function emptyDay(n: number): RoutineDay {
  return { dayNumber: n, morning: emptySlot(), evening: emptySlot() };
}

// 새 세션 초기 상태
function newDraft(sessionNum: number): EditorDraft {
  return {
    id: null,
    sessionNumber: sessionNum,
    startDate: '',
    endDate: '',
    morningTime: '07:30',
    eveningTime: '22:00',
    days: [emptyDay(1)], // 기본으로 DAY 1 포함
  };
}

// "YYYY-MM-DD" → "M월 D일" 한국어 포맷
function fmtDate(s: string) {
  if (!s) return '—';
  // 시간대 오차 없이 날짜만 파싱
  const [, m, d] = s.split('-').map(Number);
  return `${m}월 ${d}일`;
}

// ─── 공통 앱바 ───────────────────────────────────────────────────────────────
// design/setup.html의 .appbar, .se-appbar, .panel-appbar를 통합
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
      <div
        style={{ minWidth: 48, display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}
      >
        {right}
      </div>
    </div>
  );
}

// 왼쪽 화살표 뒤로 가기 버튼
function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        padding: 0,
        color: '#0C0C0A',
        display: 'flex',
        alignItems: 'center',
      }}
      aria-label="뒤로"
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M19 12H5M12 5l-7 7 7 7" />
      </svg>
    </button>
  );
}

// ─── HUB 뷰 ─────────────────────────────────────────────────────────────────
// design/setup.html의 Hub Header + Hub Grid 구현
// 2열 엇갈리기(masonry) 레이아웃
function HubView({ onOpenSessions }: { onOpenSessions: () => void }) {
  // 허브 카드 데이터
  // Stage 4에서는 ROUTINE SETUP만 클릭 가능, 나머지는 Coming soon
  const cards = {
    left: [
      {
        id: 'routine',
        badge: '#SESSION',
        title: 'ROUTINE SETUP',
        sub: 'DAILY CALIBRATIONS',
        cta: 'View Steps →',
        bg: 'linear-gradient(135deg,#f0ffe0 0%,#c5ff00 100%)',
        emoji: '🌿',
        onClick: onOpenSessions,
      },
      {
        id: 'tracker',
        badge: '#DAILY',
        title: 'ROUTINE TRACKER',
        sub: 'HABIT ALARMS',
        cta: 'Coming soon',
        bg: 'linear-gradient(135deg,#f5ffe0 0%,#dcff80 100%)',
        emoji: '⏰',
        onClick: null,
      },
      {
        id: 'look',
        badge: '#LOOKBOOK',
        title: 'PLANNING',
        sub: 'QUARTERLY VISION',
        cta: 'Coming soon',
        bg: 'linear-gradient(135deg,#fff0f5 0%,#ffc0d0 100%)',
        emoji: '📅',
        onClick: null,
      },
    ],
    right: [
      {
        id: 'ai-import',
        badge: '#AI',
        title: 'AI 가져오기',
        sub: 'TEXT → ROUTINE',
        cta: '텍스트 붙여넣기 →',
        bg: 'linear-gradient(135deg,#f0ffe0 0%,#d8ffaa 100%)',
        emoji: '✨',
        onClick: null,
        href: '/import',
      },
      {
        id: 'makeup',
        badge: '#MAKEUP',
        title: 'STRATEGY',
        sub: 'IDENTITY FRAMEWORK',
        cta: 'Coming soon',
        bg: 'linear-gradient(135deg,#f5f0ff 0%,#d0b0ff 100%)',
        emoji: '💄',
        onClick: null,
        href: undefined,
      },
      {
        id: 'care',
        badge: '#INTENSIVE',
        title: 'SPECIAL CARE',
        sub: 'CRITICAL SYSTEMS',
        cta: 'Coming soon',
        bg: 'linear-gradient(135deg,#f0f8ff 0%,#a0c8ff 100%)',
        emoji: '💊',
        onClick: null,
        href: undefined,
      },
    ],
  };

  // 카드 한 장 컴포넌트
  // href가 있으면 Link로, onClick이 있으면 div+click으로, 둘 다 없으면 비활성 처리
  function HubCard({
    card,
  }: {
    card: (typeof cards.left)[0] | (typeof cards.right)[0];
  }) {
    const isClickable = !!card.onClick || !!(card as { href?: string }).href;
    const href = (card as { href?: string }).href;

    const cardStyle = {
      background: '#FFFFFF',
      border: '1px solid rgba(12,12,10,.07)',
      borderRadius: 16,
      overflow: 'hidden',
      cursor: isClickable ? 'pointer' : 'default',
      opacity: isClickable ? 1 : 0.55,
      boxShadow: '0 1px 2px rgba(0,0,0,.04),0 0 0 1px rgba(0,0,0,.03)',
      transition: 'transform .15s',
      textDecoration: 'none',
      display: 'block',
    };

    // 카드 내부 콘텐츠 (공통)
    const cardContent = (
      <>
        {/* 카드 상단 이미지 영역 */}
        <div
          style={{
            width: '100%',
            aspectRatio: '1/1.5',
            background: card.bg,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 40,
          }}
        >
          {card.emoji}
        </div>

        {/* 카드 정보 */}
        <div style={{ padding: '10px 12px 0' }}>
          <div
            style={{
              display: 'inline-block',
              fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '.1em',
              background: '#C5FF00',
              color: '#0C0C0A',
              padding: '3px 8px',
              borderRadius: 4,
              marginBottom: 7,
              textTransform: 'uppercase',
            }}
          >
            {card.badge}
          </div>
          <div
            style={{
              fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif",
              fontSize: 14,
              fontWeight: 800,
              color: '#0C0C0A',
              lineHeight: 1.2,
              marginBottom: 3,
              letterSpacing: '-.01em',
            }}
          >
            {card.title}
          </div>
          <div
            style={{
              fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '.12em',
              textTransform: 'uppercase',
              color: '#9A9490',
              paddingBottom: 10,
            }}
          >
            {card.sub}
          </div>
        </div>

        {/* CTA 영역 */}
        <div
          style={{
            borderTop: '1px solid rgba(12,12,10,.07)',
            padding: '10px 12px',
            fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif",
            fontSize: 12,
            fontWeight: 600,
            color: '#0C0C0A',
          }}
        >
          {card.cta}
        </div>
      </>
    );

    // href가 있으면 Link 컴포넌트로 감싸기
    if (href) {
      return (
        <Link href={href} style={cardStyle}>
          {cardContent}
        </Link>
      );
    }

    return (
      <div
        onClick={card.onClick ?? undefined}
        style={cardStyle}
      >
        {cardContent}
      </div>
    );
  }

  return (
    <div style={{ background: '#FAFAF8', minHeight: '100%' }}>
      {/* 앱바 */}
      <Appbar
        left={
          <Link
            href="/"
            style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}
          >
            <span
              style={{
                width: 24,
                height: 24,
                borderRadius: 8,
                background: '#0C0C0A',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#C5FF00',
                fontSize: 10,
                fontWeight: 800,
              }}
            >
              OS
            </span>
          </Link>
        }
        center="OnStep"
        right={
          <button
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: '#EEEDE9',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            aria-label="계정"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" style={{ opacity: 0.5 }}>
              <path d="M12 12c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm0 2c-3.33 0-10 1.67-10 5v2h20v-2c0-3.33-6.67-5-10-5z" />
            </svg>
          </button>
        }
      />

      {/* Hub 헤더 (design .hub-header) */}
      <div
        style={{ padding: '28px 16px 20px', borderBottom: '1px solid rgba(12,12,10,.07)' }}
      >
        <div
          style={{
            fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '.16em',
            textTransform: 'uppercase',
            color: '#9A9490',
            marginBottom: 4,
          }}
        >
          CONFIGURATION
        </div>
        {/* "Setup" 대형 타이틀 + 라임 밑줄 (design .hub-header-title::after) */}
        <div>
          <div
            style={{
              fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif",
              fontSize: 60,
              fontWeight: 900,
              color: '#0C0C0A',
              lineHeight: 0.9,
              letterSpacing: '-.02em',
            }}
          >
            Setup
          </div>
          <div
            style={{ width: 40, height: 4, background: '#C5FF00', borderRadius: 2, marginTop: 8 }}
          />
        </div>
        <div
          style={{
            fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif",
            fontSize: 12,
            color: '#9A9490',
            marginTop: 14,
            lineHeight: 1.6,
          }}
        >
          Let&apos;s start today and tomorrow
        </div>
      </div>

      {/* Hub Grid — 2열 엇갈리기 (design .hub-grid-wrap) */}
      <div
        style={{
          padding: '24px 16px 8px',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 12,
          alignItems: 'start',
        }}
      >
        {/* 왼쪽 열 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {cards.left.map((c) => (
            <HubCard key={c.id} card={c} />
          ))}
        </div>
        {/* 오른쪽 열 — 64px 아래로 내려서 엇갈리기 효과 (design .hub-col-right) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 64 }}>
          {cards.right.map((c) => (
            <HubCard key={c.id} card={c} />
          ))}
        </div>
      </div>

      {/* BottomNav 여백 */}
      <div style={{ height: 100 }} />
    </div>
  );
}

// ─── SESSIONS 뷰 ─────────────────────────────────────────────────────────────
// 루틴 세션 목록 화면 (design archive-overlay 참고)
// 각 세션을 카드/행으로 표시, 클릭 시 에디터 진입
function SessionsView({
  sessions,
  loading,
  onBack,
  onNew,
  onEdit,
}: {
  sessions: Session[];
  loading: boolean;
  onBack: () => void;
  onNew: () => void;
  onEdit: (s: Session) => void;
}) {
  return (
    // 전체화면 오버레이 — Hub 위에 오른쪽에서 슬라이드 인
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: '#FAFAF8',
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'hidden',
      }}
    >
      {/* 앱바 */}
      <Appbar left={<BackButton onClick={onBack} />} center="ROUTINE SETUP" />

      {/* 본문 스크롤 영역 */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* 헤더 */}
        <div
          style={{
            padding: '20px 16px 16px',
            borderBottom: '1px solid rgba(12,12,10,.07)',
          }}
        >
          <div
            style={{
              fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '.18em',
              textTransform: 'uppercase',
              color: '#9A9490',
              marginBottom: 8,
            }}
          >
            CARE ROUTINES
          </div>
          <div
            style={{
              fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif",
              fontSize: 28,
              fontWeight: 800,
              color: '#0C0C0A',
              lineHeight: 1,
            }}
          >
            {loading ? '...' : sessions.length > 0 ? `${sessions.length} SESSIONS` : 'NO SESSIONS'}
          </div>
        </div>

        {/* 세션 목록 */}
        {loading ? (
          <div
            style={{
              padding: '48px 16px',
              textAlign: 'center',
              color: '#9A9490',
              fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif",
              fontSize: 13,
            }}
          >
            로딩 중...
          </div>
        ) : (
          <div>
            {sessions.map((s) => (
              // 세션 행 (design .history-item)
              <div
                key={s.id}
                onClick={() => onEdit(s)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '14px 16px',
                  borderBottom: '1px solid rgba(12,12,10,.07)',
                  cursor: 'pointer',
                  gap: 0,
                  transition: 'background .12s',
                }}
              >
                {/* 세션 번호 — 큰 회색 숫자 (design .history-num) */}
                <div
                  style={{
                    fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif",
                    fontSize: 52,
                    fontWeight: 800,
                    color: '#D0D0D0',
                    minWidth: 64,
                    lineHeight: 1,
                  }}
                >
                  {s.sessionNumber}
                </div>

                {/* 세션 정보 */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif",
                      fontSize: 12,
                      fontWeight: 600,
                      color: '#0C0C0A',
                    }}
                  >
                    {fmtDate(s.startDate)} ~ {fmtDate(s.endDate)}
                  </div>
                  <div
                    style={{
                      fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif",
                      fontSize: 11,
                      color: '#9A9490',
                      marginTop: 2,
                    }}
                  >
                    {s.days.length}DAY · 아침 {s.morningTime} · 저녁 {s.eveningTime}
                  </div>
                </div>

                {/* 화살표 */}
                <div
                  style={{
                    color: '#9A9490',
                    fontSize: 18,
                    flexShrink: 0,
                    fontWeight: 300,
                  }}
                >
                  ›
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 새 세션 추가 버튼 */}
        <div style={{ padding: '16px' }}>
          <button
            onClick={onNew}
            style={{
              width: '100%',
              padding: 14,
              border: '1.5px dashed rgba(12,12,10,.14)',
              borderRadius: 12,
              background: 'none',
              fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif",
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: '.06em',
              color: '#9A9490',
              cursor: 'pointer',
              transition: 'all .15s',
            }}
          >
            + 새 루틴케어 설정
          </button>
        </div>

        <div style={{ height: 40 }} />
      </div>
    </div>
  );
}

// ─── EDITOR 뷰 ───────────────────────────────────────────────────────────────
// 세션 상세 편집 화면 (design .se-panel)
// DAY 탭 + 아침/저녁 제품 매핑 + 사용법 입력
function EditorView({
  draft,
  setDraft,
  products,
  onBack,
  onSave,
  onDelete,
  saving,
}: {
  draft: EditorDraft;
  setDraft: React.Dispatch<React.SetStateAction<EditorDraft | null>>;
  products: Product[];
  onBack: () => void;
  onSave: () => void;
  onDelete: () => void;
  saving: boolean;
}) {
  // 현재 선택된 DAY 탭 인덱스
  const [activeDayIdx, setActiveDayIdx] = useState(0);

  // 제품 선택 시트: null이면 닫힘, 'morning' 또는 'evening'이면 열림
  const [pickerSlot, setPickerSlot] = useState<'morning' | 'evening' | null>(null);

  // 제품 검색어
  const [pickerSearch, setPickerSearch] = useState('');

  // 현재 활성 DAY 데이터
  const activeDay = draft.days[activeDayIdx];

  // 제품 검색 필터 (이름 또는 브랜드)
  const filteredProducts = products.filter((p) => {
    if (!pickerSearch) return true;
    const q = pickerSearch.toLowerCase();
    return (
      p.name.toLowerCase().includes(q) || (p.brand ?? '').toLowerCase().includes(q)
    );
  });

  // 현재 picker에서 선택된 제품 ID 목록
  const pickerSelectedIds = pickerSlot ? activeDay[pickerSlot].productIds : [];

  // DAY 추가
  function addDay() {
    const nextNum = draft.days.length + 1;
    setDraft((d) => d && { ...d, days: [...d.days, emptyDay(nextNum)] });
    setActiveDayIdx(draft.days.length); // 새로 추가된 DAY로 이동
  }

  // DAY 삭제 (최소 1개 유지)
  function removeDay(idx: number) {
    if (draft.days.length <= 1) return;
    setDraft((d) => {
      if (!d) return d;
      // 해당 인덱스 제거 후 dayNumber 재정렬
      const days = d.days
        .filter((_, i) => i !== idx)
        .map((day, i) => ({ ...day, dayNumber: i + 1 }));
      return { ...d, days };
    });
    // 삭제 후 탭 인덱스 보정 (범위 벗어나지 않도록)
    setActiveDayIdx((i) => Math.min(i, draft.days.length - 2));
  }

  // 특정 시간대의 필드 업데이트
  // slot: 'morning' | 'evening'
  // field: 'productIds' | 'instruction'
  function updateSlot(slot: 'morning' | 'evening', field: keyof DaySlot, value: unknown) {
    setDraft((d) => {
      if (!d) return d;
      const days = d.days.map((day, i) => {
        if (i !== activeDayIdx) return day;
        return { ...day, [slot]: { ...day[slot], [field]: value } };
      });
      return { ...d, days };
    });
  }

  // 제품 선택 토글 (picker에서 클릭)
  function toggleProduct(productId: string) {
    if (!pickerSlot) return;
    const current = activeDay[pickerSlot].productIds;
    const updated = current.includes(productId)
      ? current.filter((id) => id !== productId)   // 이미 있으면 제거
      : [...current, productId];                     // 없으면 추가
    updateSlot(pickerSlot, 'productIds', updated);
  }

  // 제품 제거 (메인 화면에서 × 버튼)
  function removeProduct(slot: 'morning' | 'evening', productId: string) {
    const current = activeDay[slot].productIds;
    updateSlot(slot, 'productIds', current.filter((id) => id !== productId));
  }

  // ID로 제품 정보 찾기
  function findProduct(id: string) {
    return products.find((p) => p.id === id);
  }

  // ── 제품 칩 (72×72 카드) ─────────────────────────────────────────────────
  // design/setup.html .rs-chip--prod 스타일
  function ProductChip({
    product,
    onRemove,
  }: {
    product: Product;
    onRemove: () => void;
  }) {
    return (
      <div style={{ position: 'relative', flexShrink: 0 }}>
        {/* 카드 본체 */}
        <div
          style={{
            width: 72,
            height: 72,
            background: '#fff',
            border: '1px solid rgba(12,12,10,.07)',
            borderRadius: 10,
            boxShadow: '0 1px 2px rgba(0,0,0,.04)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 6,
          }}
        >
          {/* 이미지 플레이스홀더 */}
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: 7,
              background: '#EEEDE9',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 13,
              marginBottom: 5,
              flexShrink: 0,
            }}
          >
            ✦
          </div>
          {/* 제품명 (2줄까지) */}
          <div
            style={{
              fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif",
              fontSize: 10,
              color: '#0C0C0A',
              textAlign: 'center',
              lineHeight: 1.3,
              overflow: 'hidden',
              maxWidth: 60,
              wordBreak: 'break-all',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
            }}
          >
            {product.name}
          </div>
        </div>

        {/* × 삭제 버튼 (우상단) */}
        <button
          onClick={onRemove}
          style={{
            position: 'absolute',
            top: -8,
            right: -8,
            width: 18,
            height: 18,
            borderRadius: '50%',
            background: 'rgba(0,0,0,.28)',
            color: '#fff',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 10,
            cursor: 'pointer',
            zIndex: 1,
            lineHeight: 1,
          }}
          aria-label="제거"
        >
          ×
        </button>
      </div>
    );
  }

  // ── 시간대 섹션 (Morning / Evening) ──────────────────────────────────────
  function SlotSection({
    slot,
    label,
    icon,
  }: {
    slot: 'morning' | 'evening';
    label: string;
    icon: string;
  }) {
    const slotData = activeDay[slot];
    return (
      <div style={{ paddingTop: 20 }}>
        {/* 섹션 헤더 (시간대 이름 + 시간 표시) */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 12,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif",
              fontSize: 13,
              fontWeight: 700,
              color: '#0C0C0A',
            }}
          >
            <span>{icon}</span>
            {label}
          </div>
          {/* 시간 표시 */}
          <div
            style={{
              fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif",
              fontSize: 12,
              fontWeight: 700,
              color: '#9A9490',
            }}
          >
            {slot === 'morning' ? draft.morningTime : draft.eveningTime}
          </div>
        </div>

        {/* 제품 칩 + + 버튼 (design .rs-chip-list) */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            alignItems: 'flex-end',
            marginBottom: 12,
          }}
        >
          {/* 선택된 제품들 */}
          {slotData.productIds.map((pid) => {
            const prod = findProduct(pid);
            if (!prod) return null;
            return (
              <ProductChip
                key={pid}
                product={prod}
                onRemove={() => removeProduct(slot, pid)}
              />
            );
          })}

          {/* 제품 추가 버튼 (design .rs-chip--plus) */}
          <button
            onClick={() => {
              setPickerSlot(slot);
              setPickerSearch('');
            }}
            style={{
              width: 72,
              height: 72,
              border: '1.5px dashed rgba(33,150,243,.4)',
              borderRadius: 10,
              background: 'rgba(33,150,243,.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 28,
              fontWeight: 300,
              color: '#1976D2',
              cursor: 'pointer',
              flexShrink: 0,
            }}
            aria-label="제품 추가"
          >
            +
          </button>
        </div>

        {/* 사용법 입력 */}
        <div>
          <div
            style={{
              fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '.12em',
              textTransform: 'uppercase',
              color: '#9A9490',
              marginBottom: 6,
            }}
          >
            사용법 메모
          </div>
          <textarea
            value={slotData.instruction}
            onChange={(e) => updateSlot(slot, 'instruction', e.target.value)}
            placeholder="예: 얇게 한 겹 도포, 10분 뒤 흡수..."
            rows={2}
            style={{
              width: '100%',
              border: '1.5px solid rgba(12,12,10,.14)',
              borderRadius: 8,
              padding: '9px 12px',
              fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif",
              fontSize: 13,
              color: '#0C0C0A',
              background: '#F4F4F0',
              outline: 'none',
              resize: 'none',
              lineHeight: 1.55,
              boxSizing: 'border-box',
              transition: 'border-color .18s',
            }}
          />
        </div>
      </div>
    );
  }

  return (
    // Sessions 위에 오른쪽에서 슬라이드 인
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        background: '#FAFAF8',
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'hidden',
      }}
    >
      {/* 에디터 앱바: 뒤로가기 + 세션 번호 + 저장 버튼 */}
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
        <BackButton onClick={onBack} />
        <span
          style={{
            fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif",
            fontSize: 14,
            fontWeight: 700,
            letterSpacing: '.04em',
            textTransform: 'uppercase',
            color: '#0C0C0A',
          }}
        >
          SESSION {draft.sessionNumber}
        </span>
        {/* 저장 버튼 — 라임색 pill (design .se-save-btn 변형) */}
        <button
          onClick={onSave}
          disabled={saving}
          style={{
            fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif",
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '.08em',
            textTransform: 'uppercase',
            color: '#0C0C0A',
            background: saving ? '#D8D6CF' : '#C5FF00',
            border: 'none',
            cursor: saving ? 'default' : 'pointer',
            padding: '7px 16px',
            borderRadius: 9999,
            transition: 'opacity .18s',
          }}
        >
          {saving ? '저장중...' : '저장'}
        </button>
      </div>

      {/* 본문 스크롤 영역 */}
      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 80 }}>

        {/* ── 세션 정보 (기간 + 알람) ── */}
        <div style={{ padding: '20px 16px 0' }}>
          <div
            style={{
              fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '.16em',
              textTransform: 'uppercase',
              color: '#9A9490',
              marginBottom: 10,
            }}
          >
            세션 정보
          </div>

          {/* 회색 카드 배경 (design .se-date-card) */}
          <div
            style={{
              background: '#F4F4F0',
              borderRadius: 12,
              padding: 14,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            {/* 기간: 시작일 ~ 종료일 */}
            <div>
              <label style={fieldLabelStyle}>기간</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="date"
                  value={draft.startDate}
                  onChange={(e) =>
                    setDraft((d) => d && { ...d, startDate: e.target.value })
                  }
                  style={dateInputStyle}
                />
                <span style={{ color: '#9A9490', fontSize: 12, flexShrink: 0 }}>~</span>
                <input
                  type="date"
                  value={draft.endDate}
                  onChange={(e) =>
                    setDraft((d) => d && { ...d, endDate: e.target.value })
                  }
                  style={dateInputStyle}
                />
              </div>
            </div>

            {/* 아침/저녁 시간 (2열) */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={fieldLabelStyle}>아침 시간</label>
                <input
                  type="time"
                  value={draft.morningTime}
                  onChange={(e) =>
                    setDraft((d) => d && { ...d, morningTime: e.target.value })
                  }
                  style={dateInputStyle}
                />
              </div>
              <div>
                <label style={fieldLabelStyle}>저녁 시간</label>
                <input
                  type="time"
                  value={draft.eveningTime}
                  onChange={(e) =>
                    setDraft((d) => d && { ...d, eveningTime: e.target.value })
                  }
                  style={dateInputStyle}
                />
              </div>
            </div>
          </div>
        </div>

        {/* ── DAY 탭 영역 (design .step-tabs) ── */}
        <div style={{ marginTop: 24 }}>
          {/* 탭 헤더 스크롤 */}
          <div
            style={{
              display: 'flex',
              borderBottom: '1px solid rgba(12,12,10,.07)',
              overflowX: 'auto',
              scrollbarWidth: 'none',
              background: 'rgba(250,250,248,.94)',
              backdropFilter: 'blur(16px)',
              position: 'sticky',
              top: 0,
              zIndex: 5,
            }}
          >
            {draft.days.map((day, i) => (
              <button
                key={day.dayNumber}
                onClick={() => setActiveDayIdx(i)}
                style={{
                  padding: '10px 20px',
                  border: 'none',
                  borderBottom: `2px solid ${activeDayIdx === i ? '#C5FF00' : 'transparent'}`,
                  background: 'none',
                  fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif",
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: '.06em',
                  color: activeDayIdx === i ? '#0C0C0A' : '#9A9490',
                  cursor: 'pointer',
                  transition: 'all .18s',
                  whiteSpace: 'nowrap',
                  marginBottom: -1,
                }}
              >
                DAY {day.dayNumber}
              </button>
            ))}
            {/* + DAY 추가 버튼 */}
            <button
              onClick={addDay}
              style={{
                padding: '10px 16px',
                border: 'none',
                background: 'none',
                fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif",
                fontSize: 12,
                fontWeight: 700,
                color: '#9A9490',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              + DAY
            </button>
          </div>

          {/* 활성 DAY의 아침/저녁 편집 */}
          {activeDay && (
            <div style={{ padding: '0 16px' }}>
              <SlotSection slot="morning" label="MORNING" icon="☀️" />

              {/* 구분선 */}
              <div
                style={{
                  height: 1,
                  background: 'rgba(12,12,10,.07)',
                  margin: '20px 0 0',
                }}
              />

              <SlotSection slot="evening" label="EVENING" icon="🌙" />

              {/* DAY 삭제 버튼 (2개 이상일 때만 표시) */}
              {draft.days.length > 1 && (
                <div style={{ marginTop: 24 }}>
                  <button
                    onClick={() => removeDay(activeDayIdx)}
                    style={{
                      width: '100%',
                      padding: 12,
                      background: 'none',
                      border: '1.5px solid rgba(12,12,10,.14)',
                      borderRadius: 8,
                      fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif",
                      fontSize: 12,
                      color: '#BA1A1A',
                      cursor: 'pointer',
                    }}
                  >
                    DAY {activeDay.dayNumber} 삭제
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── 세션 삭제 (기존 세션일 때만) ── */}
        {draft.id && (
          <div style={{ padding: '32px 16px 0' }}>
            <button
              onClick={onDelete}
              style={{
                width: '100%',
                padding: 14,
                background: '#FEE2E2',
                border: 'none',
                borderRadius: 12,
                fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif",
                fontSize: 12,
                fontWeight: 700,
                color: '#DC2626',
                cursor: 'pointer',
              }}
            >
              이 세션 삭제
            </button>
          </div>
        )}
      </div>

      {/* ── 제품 선택 바텀 시트 (BOX에서 제품 선택) ── */}
      {/* design .modal-overlay + .modal 구조 */}
      {pickerSlot && (
        <>
          {/* 딤 배경 — 클릭 시 닫기 */}
          <div
            onClick={() => setPickerSlot(null)}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,.45)',
              zIndex: 300,
            }}
          />

          {/* 바텀 시트 본체 */}
          <div
            style={{
              position: 'fixed',
              bottom: 0,
              left: 0,
              right: 0,
              zIndex: 310,
              background: '#FAFAF8',
              borderRadius: '20px 20px 0 0',
              maxHeight: '80vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 -4px 40px rgba(0,0,0,.12)',
            }}
          >
            {/* 핸들 + 헤더 */}
            <div style={{ padding: '12px 16px 0', flexShrink: 0 }}>
              <div
                style={{
                  width: 32,
                  height: 3,
                  background: 'rgba(12,12,10,.14)',
                  borderRadius: 2,
                  margin: '0 auto 16px',
                }}
              />
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 12,
                }}
              >
                <div
                  style={{
                    fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif",
                    fontSize: 16,
                    fontWeight: 800,
                    color: '#0C0C0A',
                  }}
                >
                  {pickerSlot === 'morning' ? '☀️ 아침' : '🌙 저녁'} 제품 선택
                </div>
                <button
                  onClick={() => setPickerSlot(null)}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 8,
                    background: '#E4E2DC',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: 12,
                    color: '#4A4846',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  ✕
                </button>
              </div>

              {/* 검색 입력 */}
              <input
                type="search"
                value={pickerSearch}
                onChange={(e) => setPickerSearch(e.target.value)}
                placeholder="제품명 · 브랜드 검색..."
                autoFocus
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  border: '1.5px solid rgba(12,12,10,.14)',
                  borderRadius: 8,
                  fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif",
                  fontSize: 13,
                  color: '#0C0C0A',
                  background: '#F4F4F0',
                  outline: 'none',
                  boxSizing: 'border-box',
                  marginBottom: 4,
                }}
              />
              <div
                style={{
                  fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif",
                  fontSize: 11,
                  color: '#9A9490',
                  marginBottom: 8,
                }}
              >
                {pickerSelectedIds.length > 0
                  ? `${pickerSelectedIds.length}개 선택됨`
                  : 'BOX에서 제품을 선택하세요'}
              </div>
            </div>

            {/* 제품 목록 */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {products.length === 0 ? (
                // BOX에 제품이 없을 때 안내
                <div
                  style={{
                    padding: '40px 16px',
                    textAlign: 'center',
                    color: '#9A9490',
                    fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif",
                    fontSize: 13,
                    lineHeight: 1.6,
                  }}
                >
                  BOX에 제품이 없습니다.
                  <br />
                  BOX 탭에서 먼저 제품을 추가해주세요.
                </div>
              ) : filteredProducts.length === 0 ? (
                // 검색 결과 없을 때
                <div
                  style={{
                    padding: '40px 16px',
                    textAlign: 'center',
                    color: '#9A9490',
                    fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif",
                    fontSize: 13,
                  }}
                >
                  검색 결과 없음
                </div>
              ) : (
                // 제품 목록 (design .bp-item)
                filteredProducts.map((p) => {
                  const isSelected = pickerSelectedIds.includes(p.id);
                  return (
                    <div
                      key={p.id}
                      onClick={() => toggleProduct(p.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '12px 16px',
                        borderBottom: '1px solid rgba(12,12,10,.07)',
                        cursor: 'pointer',
                        background: isSelected ? '#F4FFE0' : 'transparent',
                        transition: 'background .12s',
                      }}
                    >
                      {/* 이미지 플레이스홀더 */}
                      <div
                        style={{
                          width: 48,
                          height: 48,
                          borderRadius: 8,
                          background: '#EEEDE9',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 20,
                          flexShrink: 0,
                        }}
                      >
                        ✦
                      </div>

                      {/* 제품 정보 */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif",
                            fontSize: 13,
                            fontWeight: 600,
                            color: '#0C0C0A',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {p.name}
                        </div>
                        {p.brand && (
                          <div
                            style={{
                              fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif",
                              fontSize: 12,
                              color: '#9A9490',
                              marginTop: 2,
                            }}
                          >
                            {p.brand}
                          </div>
                        )}
                        {p.category && (
                          <div
                            style={{
                              fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif",
                              fontSize: 11,
                              fontWeight: 700,
                              letterSpacing: '.1em',
                              textTransform: 'uppercase',
                              color: '#4A4846',
                              marginTop: 3,
                            }}
                          >
                            {p.category}
                          </div>
                        )}
                      </div>

                      {/* 선택 체크 원형 (design .bp-item-check) */}
                      <div
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: '50%',
                          border: `1.5px solid ${isSelected ? '#8AB000' : 'rgba(12,12,10,.14)'}`,
                          background: isSelected ? '#C5FF00' : 'transparent',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 12,
                          fontWeight: 700,
                          color: '#0C0C0A',
                          flexShrink: 0,
                          transition: 'all .15s',
                        }}
                      >
                        {isSelected ? '✓' : ''}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* 완료 버튼 */}
            <div
              style={{
                padding: '12px 16px 32px',
                flexShrink: 0,
                borderTop: '1px solid rgba(12,12,10,.07)',
              }}
            >
              <button
                onClick={() => setPickerSlot(null)}
                style={{
                  width: '100%',
                  height: 52,
                  background: '#0C0C0A',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 12,
                  fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif",
                  fontSize: 15,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                완료{pickerSelectedIds.length > 0 ? ` (${pickerSelectedIds.length}개)` : ''}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── 공통 스타일 헬퍼 ─────────────────────────────────────────────────────────

const fieldLabelStyle: React.CSSProperties = {
  fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif",
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '.12em',
  textTransform: 'uppercase',
  color: '#9A9490',
  marginBottom: 5,
  display: 'block',
};

const dateInputStyle: React.CSSProperties = {
  flex: 1,
  width: '100%',
  padding: '10px 12px',
  border: '1.5px solid rgba(12,12,10,.14)',
  borderRadius: 8,
  fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif",
  fontSize: 14,
  fontWeight: 600,
  color: '#0C0C0A',
  background: '#fff',
  outline: 'none',
  boxSizing: 'border-box',
  transition: 'border-color .15s',
};

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────────
// 뷰 상태 + Firestore CRUD를 관리하는 최상위 컴포넌트
export default function SetupPage() {
  // ── 인증 상태 ──
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // 현재 화면
  const [view, setView] = useState<View>('hub');

  // Firestore에서 불러온 세션 목록
  const [sessions, setSessions] = useState<Session[]>([]);

  // Firestore에서 불러온 제품 목록 (picker용)
  const [products, setProducts] = useState<Product[]>([]);

  // 로딩 상태
  const [loadingSessions, setLoadingSessions] = useState(true);

  // 현재 편집 중인 세션 임시 데이터
  const [draft, setDraft] = useState<EditorDraft | null>(null);

  // 저장 중 플래그
  const [saving, setSaving] = useState(false);

  // 현재 userId
  const userId = user?.uid ?? FALLBACK_USER_ID;

  // ── Firebase Auth 감지 ──
  useEffect(() => {
    if (!auth) { setAuthLoading(false); return; }
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
    });
    return () => unsub();
  }, []);

  // ── Firestore 구독: 루틴 세션 ─────────────────────────────────────────────
  useEffect(() => {
    if (authLoading) return;
    if (!db) {
      setLoadingSessions(false);
      return;
    }
    const q = query(
      collection(db, 'users', userId, 'routines'),
      orderBy('sessionNumber', 'asc')
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setSessions(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Session, 'id'>) }))
        );
        setLoadingSessions(false);
      },
      () => setLoadingSessions(false)
    );
    return () => unsub();
  }, [userId, authLoading]);

  // ── Firestore 구독: 제품 목록 (편집기에서 제품 picker에 사용) ────────────
  useEffect(() => {
    if (authLoading || !db) return;
    const q = query(
      collection(db, 'users', userId, 'products'),
      orderBy('createdAt', 'desc')
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setProducts(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Product, 'id'>) }))
        );
      },
      () => {}
    );
    return () => unsub();
  }, [userId, authLoading]);

  // ── 새 세션 시작 ──────────────────────────────────────────────────────────
  function openNewSession() {
    // 기존 세션 중 가장 큰 sessionNumber + 1로 새 번호 결정
    const nextNum =
      sessions.length > 0 ? Math.max(...sessions.map((s) => s.sessionNumber)) + 1 : 1;
    setDraft(newDraft(nextNum));
    setView('editor');
  }

  // ── 기존 세션 편집 ────────────────────────────────────────────────────────
  function openEdit(session: Session) {
    setDraft({
      id: session.id,
      sessionNumber: session.sessionNumber,
      startDate: session.startDate,
      endDate: session.endDate,
      morningTime: session.morningTime,
      eveningTime: session.eveningTime,
      days: session.days,
    });
    setView('editor');
  }

  // ── 세션 저장 (신규 or 수정) ─────────────────────────────────────────────
  async function handleSave() {
    if (!draft) return;
    if (!db) {
      alert('.env.local에 Firebase 설정을 먼저 입력해주세요.');
      return;
    }

    setSaving(true);
    const now = new Date().toISOString();
    const data = {
      sessionNumber: draft.sessionNumber,
      startDate: draft.startDate,
      endDate: draft.endDate,
      morningTime: draft.morningTime,
      eveningTime: draft.eveningTime,
      days: draft.days,
      updatedAt: now,
    };

    try {
      if (draft.id) {
        // 기존 세션 업데이트
        await updateDoc(doc(db, 'users', userId, 'routines', draft.id), data);
      } else {
        // 신규 세션 생성
        await addDoc(collection(db, 'users', userId, 'routines'), {
          ...data,
          createdAt: now,
        });
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

  // ── 세션 삭제 ─────────────────────────────────────────────────────────────
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

  // ── 뷰 렌더링 ────────────────────────────────────────────────────────────
  return (
    <>
      {/* Hub는 항상 렌더링 (BottomNav와 함께) */}
      <HubView onOpenSessions={() => setView('sessions')} />

      {/* Sessions 뷰: 'sessions' 또는 'editor'일 때 오버레이 */}
      {(view === 'sessions' || view === 'editor') && (
        <SessionsView
          sessions={sessions}
          loading={loadingSessions}
          onBack={() => setView('hub')}
          onNew={openNewSession}
          onEdit={openEdit}
        />
      )}

      {/* Editor 뷰: 'editor'일 때만 오버레이 (Sessions 위에 겹침) */}
      {view === 'editor' && draft && (
        <EditorView
          draft={draft}
          setDraft={setDraft}
          products={products}
          onBack={() => setView('sessions')}
          onSave={handleSave}
          onDelete={handleDelete}
          saving={saving}
        />
      )}
    </>
  );
}
