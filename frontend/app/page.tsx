// app/page.tsx — TODAY 페이지
// Stage 5: Firebase Auth + Firestore 연동
//
// 💡 이 파일에서 구현하는 기능:
//   1. Firebase Auth — Google 로그인/로그아웃
//   2. 오늘의 활성 세션 로드 (날짜 범위로 필터)
//   3. 오늘 DAY 번호 계산 (세션 내 반복 사이클)
//   4. 아침/저녁 탭 + 제품 스트립 + CHECK 버튼
//   5. 체크 완료 시 → UsageLog 저장 + 제품 잔량 차감
//   6. 페이지 재방문 시 오늘 이미 체크한 기록 복원

'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { format, differenceInDays, parseISO } from 'date-fns';
import { ko } from 'date-fns/locale';
import {
  collection,
  getDocs,
  addDoc,
  updateDoc,
  doc,
  query,
  orderBy,
  where,
} from 'firebase/firestore';
import {
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  type User,
} from 'firebase/auth';
import { db, auth } from '@/lib/firebase';
import type { Product } from '@/types/product';

// ─── 타입 정의 ────────────────────────────────────────────────────────────────
// setup/page.tsx에서 사용하는 Firestore 데이터 구조와 동일하게 맞춤

// 루틴 1단계
type Phase = {
  order: number;
  productIds: string[];
  instruction: string;
  waitMinutes: number;
};

// 한 시간대(아침 or 저녁)의 단계 목록
type DaySlot = {
  phases: Phase[];
};

// 하루(DAY N) 루틴
type RoutineDay = {
  dayNumber: number;      // 1, 2, 3, ...
  morning: DaySlot;
  evening: DaySlot;
};

// Firestore에 저장된 루틴 세션 (1개 = 1회차)
type Session = {
  id: string;
  sessionNumber: number;
  startDate: string;      // "YYYY-MM-DD"
  endDate: string;
  morningTime: string;    // "07:30" (24시간 형식)
  eveningTime: string;
  days: RoutineDay[];
  createdAt: string;
  updatedAt: string;
};

// 오늘 아침/저녁 각각 체크됐는지 여부
type CheckState = { morning: boolean; evening: boolean; };

// ─── 상수 ─────────────────────────────────────────────────────────────────────

// Firebase 미설정 시 사용할 임시 userId
// (Stage 5에서 실제 Google 로그인 UID로 교체됨)
const FALLBACK_USER_ID = 'demo-user';

// ─── 헬퍼 함수 ────────────────────────────────────────────────────────────────

// 오늘이 세션 내 몇 번째 DAY인지 계산
// 예시: 3일짜리 세션에서 4일째 되면 DAY 1로 돌아옴 (순환 방식)
function calcTodayDayNumber(session: Session): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = parseISO(session.startDate);
  start.setHours(0, 0, 0, 0);
  const diff = Math.max(0, differenceInDays(today, start));
  const count = session.days.length;
  if (count === 0) return 1;
  return (diff % count) + 1;
}

// 오늘 날짜가 포함된 활성 세션 찾기
function findActiveSession(sessions: Session[]): Session | null {
  // 정오(12시) 기준으로 비교해서 타임존 이슈 방지
  const now = new Date();
  now.setHours(12, 0, 0, 0);

  for (const s of sessions) {
    const start = parseISO(s.startDate);
    const end = parseISO(s.endDate);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    if (now >= start && now <= end) return s;
  }
  return null;
}

// 구버전 슬롯(productIds+instruction) → phases 구조로 변환
function migrateSlot(raw: unknown): DaySlot {
  const s = raw as Record<string, unknown>;
  if (Array.isArray(s.phases)) return { phases: s.phases as Phase[] };
  return {
    phases: [
      {
        order: 1,
        productIds: (s.productIds as string[]) ?? [],
        instruction: (s.instruction as string) ?? '',
        waitMinutes: 0,
      },
    ],
  };
}

// 오늘(YYYY-MM-DD) 날짜 문자열 반환
function getTodayDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ─── Appbar ──────────────────────────────────────────────────────────────────

function Appbar({
  user,
  onLogin,
  onLogout,
}: {
  user: User | null;
  onLogin: () => void;
  onLogout: () => void;
}) {
  return (
    <div
      style={{
        padding: '0 16px',
        height: 64,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: 'rgba(250,250,248,.92)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        position: 'sticky',
        top: 0,
        zIndex: 10,
        borderBottom: '1px solid rgba(241,245,249,1)',
      }}
    >
      {/* 햄버거 메뉴 */}
      <button
        style={{
          width: 22,
          display: 'flex',
          flexDirection: 'column',
          gap: 5,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
        }}
        aria-label="메뉴"
      >
        <span style={{ display: 'block', height: 1.5, background: '#0C0C0A', borderRadius: 2 }} />
        <span style={{ display: 'block', height: 1.5, background: '#0C0C0A', borderRadius: 2, width: '68%' }} />
        <span style={{ display: 'block', height: 1.5, background: '#0C0C0A', borderRadius: 2 }} />
      </button>

      {/* 로고 */}
      <div
        style={{
          fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
          fontSize: 15,
          fontWeight: 700,
          letterSpacing: '0.01em',
          color: '#0C0C0A',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
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
        OnStep
      </div>

      {/* 유저 아이콘 (로그인 상태에 따라 다르게 표시) */}
      {user ? (
        // 로그인됨 — 프로필 사진 or 기본 아이콘 (클릭 시 로그아웃)
        <button
          onClick={onLogout}
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
            overflow: 'hidden',
            padding: 0,
          }}
          aria-label="로그아웃"
          title={`${user.displayName ?? user.email} — 클릭하여 로그아웃`}
        >
          {user.photoURL ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.photoURL}
              alt="프로필"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" style={{ opacity: 0.5 }}>
              <path d="M12 12c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm0 2c-3.33 0-10 1.67-10 5v2h20v-2c0-3.33-6.67-5-10-5z" />
            </svg>
          )}
        </button>
      ) : (
        // 미로그인 — "로그인" 버튼
        <button
          onClick={onLogin}
          style={{
            height: 32,
            padding: '0 12px',
            borderRadius: 9999,
            background: '#0C0C0A',
            border: 'none',
            cursor: 'pointer',
            color: '#C5FF00',
            fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.04em',
          }}
        >
          로그인
        </button>
      )}
    </div>
  );
}

// ─── 세션 히어로 ──────────────────────────────────────────────────────────────
// today.html .session-hero: 회차 번호 + 날짜 + DAY 진행 도트

function SessionHero({
  today,
  session,
  todayDayNumber,
}: {
  today: Date;
  session: Session | null;
  todayDayNumber: number;
}) {
  const dateStr = format(today, 'M월 d일 (EEE)', { locale: ko });

  return (
    <div style={{ padding: '12px 16px 4px' }}>
      {/* 회차 번호 */}
      <div
        style={{
          fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
          fontSize: 18,
          fontWeight: 800,
          color: '#0C0C0A',
          letterSpacing: '0.02em',
          textTransform: 'uppercase',
          lineHeight: 1.2,
        }}
      >
        {session ? `${session.sessionNumber}회차 SESSION` : '— SESSION'}
      </div>

      {/* 오늘 날짜 */}
      <div
        style={{
          fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
          fontSize: 12,
          fontWeight: 500,
          color: '#9A9490',
          marginTop: 3,
          marginBottom: 10,
        }}
      >
        {dateStr}
      </div>

      {/* DAY 진행 도트 */}
      <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
        {session ? (
          // 루틴 있음 — DAY 수만큼 도트 표시
          // 지나간 날: 라임색 / 오늘: 긴 라임 / 앞으로: 회색
          session.days.map((day) => (
            <span
              key={day.dayNumber}
              style={{
                width: day.dayNumber === todayDayNumber ? 20 : 10,
                height: 10,
                borderRadius: 9999,
                background:
                  day.dayNumber < todayDayNumber
                    ? '#C5FF00'                  // 지나간 날
                    : day.dayNumber === todayDayNumber
                    ? '#C5FF00'                  // 오늘 (wider)
                    : '#D8D6CF',                 // 앞으로
                boxShadow:
                  day.dayNumber === todayDayNumber
                    ? '0 0 0 3px rgba(197,255,0,.25)'
                    : 'none',
                transition: 'all 0.3s',
                flexShrink: 0,
              }}
            />
          ))
        ) : (
          <span style={{ fontSize: 11, fontWeight: 500, color: '#9A9490' }}>
            루틴을 설정하면 진행 현황이 표시됩니다
          </span>
        )}
      </div>
    </div>
  );
}

// ─── 루틴 플로우 카드 ─────────────────────────────────────────────────────────
// today.html .flow-step-card: 아침/저녁 탭 + 제품 스트립 + 체크 버튼

function FlowCard({
  todayDay,
  session,
  products,
  tab,
  onTabChange,
  checked,
  onCheck,
  saving,
}: {
  todayDay: RoutineDay;
  session: Session;
  products: Map<string, Product>;
  tab: 'morning' | 'evening';
  onTabChange: (t: 'morning' | 'evening') => void;
  checked: CheckState;
  onCheck: (time: 'morning' | 'evening') => void;
  saving: boolean;
}) {
  const slot = tab === 'morning' ? todayDay.morning : todayDay.evening;
  const isChecked = tab === 'morning' ? checked.morning : checked.evening;

  return (
    <div
      style={{
        margin: '0 16px',
        background: '#FFFFFF',
        border: '1px solid rgba(12,12,10,.07)',
        boxShadow: '0 1px 2px rgba(0,0,0,.04), 0 0 0 1px rgba(0,0,0,.03)',
        borderRadius: 20,
        overflow: 'hidden',
      }}
    >
      {/* 카드 상단: DAY 배지 + 제품 수 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px 4px',
          borderBottom: '1px solid rgba(12,12,10,.07)',
        }}
      >
        {/* DAY N 배지 — 블랙 바탕 + 라임 텍스트 */}
        <span
          style={{
            fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            background: '#0C0C0A',
            color: '#A6D900',
            padding: '3px 10px',
            borderRadius: 9999,
          }}
        >
          Day {todayDay.dayNumber}
        </span>
        <span
          style={{
            fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
            fontSize: 13,
            fontWeight: 400,
            color: '#9A9490',
          }}
        >
          {slot.phases.reduce((n, p) => n + p.productIds.length, 0)}개 제품 · {slot.phases.length}단계
        </span>
      </div>

      {/* 아침 / 저녁 탭 */}
      <div style={{ display: 'flex', padding: '12px 16px 0', gap: 8 }}>
        {(['morning', 'evening'] as const).map((t) => (
          <button
            key={t}
            onClick={() => onTabChange(t)}
            style={{
              flex: 1,
              height: 36,
              borderRadius: 9999,
              border: 'none',
              cursor: 'pointer',
              fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: '0.04em',
              // 선택된 탭: 블랙 배경 + 라임 텍스트 / 미선택: 회색
              background: tab === t ? '#0C0C0A' : '#F4F4F0',
              color: tab === t ? '#C5FF00' : '#9A9490',
              transition: 'all .2s',
              position: 'relative',
            }}
          >
            {t === 'morning' ? '☀ MORNING' : '🌙 EVENING'}
            {/* 이미 체크된 탭에 작은 체크 뱃지 */}
            {(t === 'morning' ? checked.morning : checked.evening) && (
              <span
                style={{
                  position: 'absolute',
                  top: -4,
                  right: -4,
                  width: 14,
                  height: 14,
                  background: '#C5FF00',
                  borderRadius: 9999,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 8,
                  fontWeight: 900,
                  color: '#0C0C0A',
                }}
              >
                ✓
              </span>
            )}
          </button>
        ))}
      </div>

      {/* 단계별 제품 + 사용법 */}
      {slot.phases.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {slot.phases.map((phase) => (
            <div key={phase.order} style={{ borderBottom: '1px solid rgba(12,12,10,.05)' }}>
              {/* 단계 번호 + 사용법 */}
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '10px 16px 4px' }}>
                <span style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 10, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: '#9A9490', flexShrink: 0 }}>
                  STEP {phase.order}
                </span>
                {phase.instruction && (
                  <span style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 12, color: '#4A4846', lineHeight: 1.4 }}>
                    {phase.instruction}
                    {phase.waitMinutes > 0 && (
                      <span style={{ marginLeft: 6, color: '#9A9490', fontWeight: 600 }}>⏱ {phase.waitMinutes}분</span>
                    )}
                  </span>
                )}
              </div>
              {/* 제품 가로 스크롤 */}
              <div style={{ display: 'flex', overflowX: 'auto', scrollbarWidth: 'none', padding: '6px 16px 12px', gap: 10, alignItems: 'flex-start' }}>
                {phase.productIds.map((pid) => {
                  const p = products.get(pid);
                  return (
                    <div key={pid} style={{ flexShrink: 0, width: 72, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, opacity: isChecked ? 0.45 : 1, transition: 'opacity .2s' }}>
                      <div style={{ width: '100%', aspectRatio: '1/1', background: '#EEEDE9', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>
                        {isChecked && (
                          <div style={{ position: 'absolute', inset: 0, background: 'rgba(12,12,10,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, zIndex: 3 }}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                          </div>
                        )}
                        <span style={{ fontSize: 20, opacity: 0.4 }}>🧴</span>
                      </div>
                      <div style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 11, color: '#0C0C0A', textAlign: 'center', lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', width: '100%' }}>
                        {p?.name ?? '?'}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ padding: '28px 20px', textAlign: 'center', fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 13, color: '#9A9490', border: '1.5px dashed rgba(12,12,10,.14)', borderRadius: 20, lineHeight: 1.6, margin: '16px' }}>
          이 시간대에 등록된 제품이 없습니다.<br />SETUP에서 단계를 추가해보세요.
        </div>
      )}

      {/* 카드 하단: Edit 링크 + CHECK 버튼 */}
      <div style={{ padding: '16px 16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Link
          href="/setup"
          style={{
            fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
            fontSize: 12,
            fontWeight: 700,
            color: '#9A9490',
            textDecoration: 'none',
          }}
        >
          Edit →
        </Link>

        {/* CHECK ROUTINE 버튼 */}
        {/* 💡 isChecked: 라임 배경 / 미체크: 블랙 배경 */}
        <button
          onClick={() => !isChecked && !saving && onCheck(tab)}
          disabled={isChecked || saving}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            height: 48,
            width: '100%',
            background: isChecked ? '#C5FF00' : '#0C0C0A',
            color: isChecked ? '#0C0C0A' : '#FFFFFF',
            border: isChecked ? '2px solid #84B000' : 'none',
            fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
            fontSize: 13,
            fontWeight: 800,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            borderRadius: 9999,
            cursor: isChecked ? 'default' : saving ? 'wait' : 'pointer',
            transition: 'all .28s',
            opacity: saving ? 0.7 : 1,
          }}
        >
          {saving ? (
            '저장 중...'
          ) : isChecked ? (
            <>
              ✓ {tab === 'morning' ? 'MORNING' : 'EVENING'} 완료
            </>
          ) : (
            <>
              CHECK {tab === 'morning' ? 'MORNING' : 'EVENING'}
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// ─── 루틴 트래커 (체크리스트 뷰) ─────────────────────────────────────────────
// today.html .allday-section: 아침/저녁 루틴 완료 여부를 리스트 형식으로 보여줌

function RoutineTracker({
  todayDay,
  session,
  checked,
}: {
  todayDay: RoutineDay;
  session: Session;
  checked: CheckState;
}) {
  const items = [
    {
      key: 'morning' as const,
      label: '아침 루틴',
      time: session.morningTime,
      count: todayDay.morning.phases.reduce((n, p) => n + p.productIds.length, 0),
      done: checked.morning,
    },
    {
      key: 'evening' as const,
      label: '저녁 루틴',
      time: session.eveningTime,
      count: todayDay.evening.phases.reduce((n, p) => n + p.productIds.length, 0),
      done: checked.evening,
    },
  ];

  return (
    <div style={{ padding: '28px 16px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* 섹션 헤더 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          marginBottom: 4,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span
            style={{
              fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
              fontSize: 12,
              fontWeight: 600,
              color: '#9A9490',
              letterSpacing: '0.04em',
            }}
          >
            Day {todayDay.dayNumber}
          </span>
          <span
            style={{
              fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
              fontSize: 22,
              fontWeight: 800,
              color: '#0C0C0A',
            }}
          >
            Routine Tracker
          </span>
        </div>
        <Link
          href="/setup"
          style={{
            fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
            fontSize: 13,
            fontWeight: 600,
            color: '#9A9490',
            textDecoration: 'none',
            paddingTop: 2,
          }}
        >
          Edit →
        </Link>
      </div>

      {/* 아침 / 저녁 체크 아이템 */}
      {items.map((item) => (
        <div
          key={item.key}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 16px',
            background: '#FFFFFF',
            border: '1px solid rgba(12,12,10,.07)',
            borderRadius: 12,
            boxShadow: '0 1px 2px rgba(0,0,0,.04), 0 0 0 1px rgba(0,0,0,.03)',
            // 완료된 아이템은 흐리게 처리
            opacity: item.done ? 0.5 : 1,
            transition: 'opacity .2s',
          }}
        >
          {/* 좌: 체크 원 + 텍스트 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {/* 체크 원 — today.html .allday-dot */}
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 9999,
                border: `2px solid ${item.done ? '#C5FF00' : 'rgba(12,12,10,.14)'}`,
                background: item.done ? '#C5FF00' : 'transparent',
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all .2s',
              }}
            >
              {item.done && (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#0A0A0A"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </div>

            <div>
              <div
                style={{
                  fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
                  fontSize: 15,
                  fontWeight: 400,
                  color: item.done ? '#9A9490' : '#0C0C0A',
                }}
              >
                {item.label}
              </div>
              <div
                style={{
                  fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
                  fontSize: 12,
                  color: '#9A9490',
                  marginTop: 2,
                }}
              >
                {item.count}개 제품
              </div>
            </div>
          </div>

          {/* 우: 알람 시각 */}
          <span
            style={{
              fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
              fontSize: 13,
              fontWeight: 600,
              color: '#9A9490',
            }}
          >
            {item.time}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── 루틴 없을 때 빈 상태 카드 ─────────────────────────────────────────────────

function RoutineEmptyCard() {
  return (
    <div
      style={{
        margin: '0 16px',
        background: '#FFFFFF',
        border: '1px solid rgba(12,12,10,.07)',
        boxShadow: '0 1px 2px rgba(0,0,0,.04), 0 0 0 1px rgba(0,0,0,.03)',
        borderRadius: 20,
        overflow: 'hidden',
      }}
    >
      {/* 상단 헤더 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px 4px',
          borderBottom: '1px solid rgba(12,12,10,.07)',
        }}
      >
        <span
          style={{
            fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            background: '#0C0C0A',
            color: '#A6D900',
            padding: '3px 10px',
            borderRadius: 9999,
          }}
        >
          Day 1
        </span>
        <span
          style={{
            fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
            fontSize: 13,
            fontWeight: 400,
            color: '#9A9490',
          }}
        >
          0개 제품
        </span>
      </div>

      {/* 빈 상태 메시지 */}
      <div
        style={{
          padding: '28px 20px',
          textAlign: 'center',
          fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
          fontSize: 13,
          color: '#9A9490',
          border: '1.5px dashed rgba(12,12,10,.14)',
          borderRadius: 20,
          lineHeight: 1.6,
          margin: '16px',
        }}
      >
        오늘 날짜에 해당하는 루틴이 없어요.
        <br />
        SETUP에서 케어 플랜을 등록해보세요.
      </div>

      {/* 하단 버튼 */}
      <div style={{ padding: '0 16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Link
          href="/setup"
          style={{
            fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
            fontSize: 12,
            fontWeight: 700,
            color: '#9A9490',
            textDecoration: 'none',
          }}
        >
          Edit →
        </Link>
        <Link
          href="/setup"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            height: 48,
            background: '#C5FF00',
            color: '#0C0C0A',
            fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
            fontSize: 13,
            fontWeight: 800,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            borderRadius: 12,
            textDecoration: 'none',
            transition: 'opacity .2s',
          }}
        >
          루틴 설정하기
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </Link>
      </div>
    </div>
  );
}

// ─── 빠른 이동 카드 ──────────────────────────────────────────────────────────

function QuickLinks() {
  const links = [
    {
      href: '/box',
      label: 'BOX',
      desc: '제품 관리',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="21 8 21 21 3 21 3 8" />
          <rect x="1" y="3" width="22" height="5" />
          <line x1="10" y1="12" x2="14" y2="12" />
        </svg>
      ),
    },
    {
      href: '/setup',
      label: 'SETUP',
      desc: '루틴 편집',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      ),
    },
    {
      href: '/log',
      label: 'LOG',
      desc: '기록 보기',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M11 4H4a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
      ),
    },
  ] as const;

  return (
    <div style={{ padding: '20px 16px 32px' }}>
      <div
        style={{
          fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: '#0C0C0A',
          marginBottom: 12,
        }}
      >
        #Quick Links
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            style={{
              flex: 1,
              background: '#F4F4F0',
              border: '1px solid rgba(12,12,10,.07)',
              borderRadius: 16,
              padding: '14px 12px',
              textDecoration: 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              transition: 'background .15s',
            }}
          >
            <span style={{ color: '#4A4846' }}>{link.icon}</span>
            <div>
              <div
                style={{
                  fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
                  fontSize: 12,
                  fontWeight: 800,
                  letterSpacing: '0.06em',
                  color: '#0C0C0A',
                }}
              >
                {link.label}
              </div>
              <div
                style={{
                  fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
                  fontSize: 11,
                  color: '#9A9490',
                  marginTop: 2,
                }}
              >
                {link.desc}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

// ─── 메인 페이지 컴포넌트 ─────────────────────────────────────────────────────

export default function TodayPage() {
  const today = new Date();

  // ── 인증 상태 ──
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // ── 데이터 상태 ──
  const [sessions, setSessions] = useState<Session[]>([]);
  const [products, setProducts] = useState<Map<string, Product>>(new Map());
  const [dataLoading, setDataLoading] = useState(false);

  // ── UI 상태 ──
  const [activeTab, setActiveTab] = useState<'morning' | 'evening'>('morning');
  const [checked, setChecked] = useState<CheckState>({ morning: false, evening: false });
  const [saving, setSaving] = useState(false);

  // ── 계산된 값 (파생 상태) ──
  // 오늘 날짜가 포함된 활성 세션
  const activeSession = findActiveSession(sessions);
  // 오늘이 세션의 몇 번째 DAY인지
  const todayDayNumber = activeSession ? calcTodayDayNumber(activeSession) : 1;
  // 오늘 DAY의 루틴 정보
  const todayDay = activeSession?.days.find((d) => d.dayNumber === todayDayNumber) ?? null;
  // 현재 userId (로그인 상태에 따라 실제 UID or 'demo-user')
  const userId = user?.uid ?? FALLBACK_USER_ID;

  // ── Firebase Auth 상태 감지 ──
  // 💡 onAuthStateChanged: 앱 시작 시 / 로그인 후 / 로그아웃 후 자동으로 호출됨
  useEffect(() => {
    if (!auth) {
      // Firebase 미설정 → demo-user 모드로 진행
      setAuthLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setAuthLoading(false);
    });

    // 컴포넌트 언마운트 시 구독 해제
    return () => unsubscribe();
  }, []);

  // ── 데이터 로드 (Auth 상태 확정 후 실행) ──
  useEffect(() => {
    // 로그인된 상태에서만 데이터 로드 (비로그인 시 Firestore 접근 차단)
    if (authLoading || !user) return;
    // 💡 _db에 캡처: async 함수 내부에서도 TypeScript 타입이 Firestore로 좁혀짐
    const _db = db;
    if (!_db) return;

    let cancelled = false;
    setDataLoading(true);

    const load = async () => {
      try {
        // 루틴 세션 로드 (회차 순서대로)
        const routinesSnap = await getDocs(
          query(collection(_db, 'users', userId, 'routines'), orderBy('sessionNumber'))
        );
        const loadedSessions: Session[] = routinesSnap.docs.map((d) => {
          const raw = d.data() as Omit<Session, 'id'>;
          return {
            id: d.id,
            ...raw,
            days: (raw.days ?? []).map((day) => ({
              ...day,
              morning: migrateSlot(day.morning),
              evening: migrateSlot(day.evening),
            })),
          };
        });

        // 제품 로드
        const productsSnap = await getDocs(collection(_db, 'users', userId, 'products'));
        const productMap = new Map<string, Product>();
        productsSnap.docs.forEach((d) =>
          productMap.set(d.id, { id: d.id, ...(d.data() as Omit<Product, 'id'>) })
        );

        if (cancelled) return;

        setSessions(loadedSessions);
        setProducts(productMap);

        // 오늘 이미 체크한 기록 복원
        // 💡 usageLogs에서 오늘 날짜 + 이 세션 ID로 필터링
        const activeNow = findActiveSession(loadedSessions);
        if (activeNow) {
          const todayStr = getTodayDateStr(); // "YYYY-MM-DD"
          const logsSnap = await getDocs(
            query(
              collection(_db, 'users', userId, 'usageLogs'),
              where('routineId', '==', activeNow.id),
              where('dateStr', '==', todayStr)  // 오늘 날짜로 필터
            )
          );

          // timeSlot 필드로 아침/저녁 구분
          const morningDone = logsSnap.docs.some((d) => d.data().timeSlot === 'morning');
          const eveningDone = logsSnap.docs.some((d) => d.data().timeSlot === 'evening');
          if (!cancelled) {
            setChecked({ morning: morningDone, evening: eveningDone });
          }
        }
      } catch (err) {
        console.error('[OnStep] 데이터 로드 실패:', err);
      } finally {
        if (!cancelled) setDataLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [userId, authLoading, user]);

  // ── 루틴 체크 처리 ──
  // 💡 낙관적 업데이트(optimistic update): 서버 응답 기다리지 않고 UI 먼저 변경
  //    실패 시 롤백
  const handleCheck = useCallback(
    async (time: 'morning' | 'evening') => {
      // 💡 _db에 캡처: async 내부에서 null 체크가 유지되도록 함
      const _db = db;
      if (!activeSession || !todayDay || !_db) return;

      const slot = time === 'morning' ? todayDay.morning : todayDay.evening;
      const allProductIds = slot.phases.flatMap((p) => p.productIds);
      if (allProductIds.length === 0) return;

      setSaving(true);
      // UI 먼저 체크 상태로 변경
      setChecked((prev) => ({ ...prev, [time]: true }));

      const todayStr = getTodayDateStr();

      try {
        const logsRef = collection(_db, 'users', userId, 'usageLogs');

        // 각 제품별로 UsageLog 저장 + 잔량 차감
        await Promise.all(
          allProductIds.map(async (productId) => {
            const product = products.get(productId);
            const amount = product?.dosePerUse ?? 0;

            // UsageLog 저장
            // 💡 dateStr 필드: 나중에 오늘 로그 복원 시 쿼리에 사용
            await addDoc(logsRef, {
              routineId: activeSession.id,
              productId,
              amount,
              type: 'use',
              timeSlot: time,                         // 'morning' or 'evening'
              dateStr: todayStr,                      // "YYYY-MM-DD"
              loggedAt: new Date().toISOString(),
              note: `${time === 'morning' ? '아침' : '저녁'} 루틴 완료 — Day ${todayDayNumber}`,
            });

            // 잔량 차감 (사용량이 설정된 제품만)
            if (product && amount > 0) {
              const newRemaining = Math.max(0, product.currentRemaining - amount);
              await updateDoc(doc(_db, 'users', userId, 'products', productId), {
                currentRemaining: newRemaining,
                updatedAt: new Date().toISOString(),
              });

              // 로컬 products Map도 업데이트 (리렌더링 없이 즉시 반영)
              setProducts((prev) => {
                const next = new Map(prev);
                next.set(productId, { ...product, currentRemaining: newRemaining });
                return next;
              });
            }
          })
        );
      } catch (err) {
        console.error('[OnStep] 루틴 체크 저장 실패:', err);
        // 실패 시 체크 상태 롤백
        setChecked((prev) => ({ ...prev, [time]: false }));
      } finally {
        setSaving(false);
      }
    },
    [activeSession, todayDay, todayDayNumber, userId, products]
  );

  // ── Google 로그인 ──
  const handleLogin = async () => {
    if (!auth) {
      alert('Firebase가 설정되지 않았습니다. .env.local을 확인해주세요.');
      return;
    }
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (err) {
      console.error('[OnStep] 로그인 실패:', err);
    }
  };

  // ── 로그아웃 ──
  const handleLogout = async () => {
    if (!auth) return;
    try {
      await signOut(auth);
      // 데이터 초기화
      setSessions([]);
      setProducts(new Map());
      setChecked({ morning: false, evening: false });
    } catch (err) {
      console.error('[OnStep] 로그아웃 실패:', err);
    }
  };

  // ── 렌더링 ──
  return (
    <div style={{ background: '#FAFAF8', minHeight: '100%' }}>
      <Appbar user={user} onLogin={handleLogin} onLogout={handleLogout} />

      <div>
        {/* 페이지 제목 */}
        <div style={{ padding: '16px 16px 0' }}>
          <h1
            style={{
              fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
              fontSize: 28,
              fontWeight: 800,
              color: '#0C0C0A',
              letterSpacing: '-0.01em',
              margin: 0,
            }}
          >
            Today
          </h1>
        </div>

        {/* 세션 히어로 */}
        <SessionHero
          today={today}
          session={activeSession}
          todayDayNumber={todayDayNumber}
        />

        {/* #Flow 섹션 헤더 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            padding: '16px 16px 8px',
          }}
        >
          <span
            style={{
              fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
              fontSize: 22,
              fontWeight: 800,
              color: '#0C0C0A',
            }}
          >
            #Flow
          </span>
          <span
            style={{
              fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
              fontSize: 13,
              fontWeight: 600,
              color: '#9A9490',
            }}
          >
            {activeTab === 'morning' ? '☀ MORNING' : '🌙 EVENING'}
          </span>
        </div>

        {/* 메인 루틴 카드 — 로딩 / 루틴 있음 / 루틴 없음 분기 */}
        {dataLoading || authLoading ? (
          // 로딩 중
          <div
            style={{
              margin: '0 16px',
              padding: 40,
              textAlign: 'center',
              fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
              fontSize: 13,
              color: '#9A9490',
              background: '#FFFFFF',
              borderRadius: 20,
              border: '1px solid rgba(12,12,10,.07)',
            }}
          >
            루틴 불러오는 중...
          </div>
        ) : activeSession && todayDay ? (
          // 오늘 활성 루틴 있음
          <FlowCard
            todayDay={todayDay}
            session={activeSession}
            products={products}
            tab={activeTab}
            onTabChange={setActiveTab}
            checked={checked}
            onCheck={handleCheck}
            saving={saving}
          />
        ) : (
          // 오늘 날짜에 해당하는 루틴 없음
          <RoutineEmptyCard />
        )}

        {/* 루틴 트래커 (체크리스트 뷰) — 루틴 있을 때만 표시 */}
        {!dataLoading && activeSession && todayDay && (
          <RoutineTracker
            todayDay={todayDay}
            session={activeSession}
            checked={checked}
          />
        )}

        {/* 빠른 이동 링크 */}
        <QuickLinks />
      </div>
    </div>
  );
}
