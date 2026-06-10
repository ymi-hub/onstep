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

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { format, differenceInDays, parseISO } from 'date-fns';
import { ko } from 'date-fns/locale';
import {
  collection,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  doc,
  query,
  orderBy,
  where,
} from 'firebase/firestore';
import {
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  type User,
} from 'firebase/auth';
import { db, auth } from '@/lib/firebase';
import { imageFileToBase64 } from '@/lib/imageUtils';
import { useAppContext } from '@/lib/AppContext';
import { FALLBACK_USER_ID, FONT } from '@/lib/constants';
import { toDateStr, getTodayDateStr, getEveningDateStr, calcNextDueDate, getDaysUntilDue, dueBadgeLabel, dueBadgeColor } from '@/lib/dateUtils';
import { migrateRawSlot, migrateSession } from '@/lib/migration';
import { formatTimerRemain, playAlarmChime } from '@/hooks/useTimer';
import CatBadge from '@/components/CatBadge';
import ImagePicker from '@/components/ImagePicker';
import WeatherWidget from '@/components/WeatherWidget';
import type { Product } from '@/types/product';
import type { RoutineItem, SlotDay, Slot, Session } from '@/types/routine';
import type { Habit } from '@/types/habit';
import type { CtItem } from '@/types/ctitem';
import { EXPERT_TIP_HIGHLIGHT } from '@/components/ExpertTipField';
import PageHeader from '@/components/PageHeader';
import SectionHeader from '@/components/SectionHeader';

// ─── 로컬 타입 ───────────────────────────────────────────────────────────────
const EMPTY_SLOT_DAY: SlotDay = { id: 0, items: [], tipItems: [], expertTip: '' };

// 오늘 아침/저녁 각각 체크됐는지 여부
type CheckState = { morning: boolean; evening: boolean; };

// OOTD 오늘의 룩 기록 타입
type OOTDLog = {
  id: string;
  date: string;
  theme: string;
  note: string;
  photoUrl: string;
  createdAt: string;
};

const DEFAULT_OOTD_TAGS = ['캐주얼', '오피스룩', '스트릿', '미니멀', '빈티지', '스포티', '포멀', '로맨틱'];

// ─── 상수 ─────────────────────────────────────────────────────────────────────

// Firebase 미설정 시 사용할 임시 userId
// (Stage 5에서 실제 Google 로그인 UID로 교체됨)

// ─── 헬퍼 함수 ────────────────────────────────────────────────────────────────

// 오늘이 세션 내 몇 번째 DAY인지 계산
// 예시: 3일짜리 세션에서 4일째 되면 DAY 1로 돌아옴 (순환 방식)
function calcTodayDayNumber(session: Session): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = parseISO(session.startDate);
  start.setHours(0, 0, 0, 0);
  const diff = Math.max(0, differenceInDays(today, start));
  const count = Math.max(session.morning.days.length, session.evening.days.length, 1);
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

// 구버전 슬롯 → SlotDay[] 변환
// 오늘 수행해야 하는 습관인지 판별
function isHabitToday(h: Habit): boolean {
  const todayWD = new Date().getDay();
  const todayStr = getTodayDateStr();
  if (h.repeatType === 'allday' || h.repeatType === 'daily') return true;
  if (h.repeatType === 'once') return h.date === todayStr;
  if (h.repeatType === 'scheduled') return (h.weekdays ?? []).includes(todayWD);
  return false;
}

// 오늘 수행해야 하는 건강 루틴인지 판별 (repeatType 없으면 매일 표시)
function isHealthToday(h: {
  repeatType?: string; date?: string; weekdays?: number[];
  intervalUnit?: import('@/types/healthroutine').IntervalUnit;
  intervalValue?: number; lastDoneDate?: string; dueSoonDays?: number;
}): boolean {
  const todayWD = new Date().getDay();
  const todayStr = getTodayDateStr();
  if (!h.repeatType || h.repeatType === 'allday' || h.repeatType === 'daily') return true;
  if (h.repeatType === 'once') {
    if (!h.date || !/^\d{4}-\d{2}-\d{2}$/.test(h.date)) return true;
    return h.date === todayStr;
  }
  if (h.repeatType === 'scheduled') return (h.weekdays ?? []).includes(todayWD);
  if (h.repeatType === 'interval') {
    if (!h.intervalUnit || !h.intervalValue) return false;
    const nextDue = calcNextDueDate(h.lastDoneDate, h.intervalUnit, h.intervalValue);
    const days = getDaysUntilDue(nextDue);
    const threshold = h.dueSoonDays ?? 3;
    return days <= threshold; // 오늘 포함 N일 이내면 TODAY에 표시
  }
  return false;
}



// ─── 세션 히어로 ──────────────────────────────────────────────────────────────
// today.html .session-hero: 회차 번호 + 날짜 + DAY 진행 도트

function toOrdinal(n: number): string {
  return `${n}th`;
}

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
    <div style={{ padding: '12px 26px 4px' }}>
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
        {session ? `${toOrdinal(session.sessionNumber)} SESSION` : '— SESSION'}
      </div>

      {/* 오늘 날짜 + 세션 기간 */}
      <div
        style={{
          fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
          fontSize: 12,
          fontWeight: 500,
          color: '#9A9490',
          marginTop: 3,
          marginBottom: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <span>{dateStr}</span>
        {session && (
          <>
            <span style={{ opacity: 0.4 }}>·</span>
            <span>
              {format(parseISO(session.startDate), 'M/d', { locale: ko })}
              {' ~ '}
              {format(parseISO(session.endDate), 'M/d', { locale: ko })}
            </span>
          </>
        )}
      </div>

      {/* DAY 진행 도트 — 세션 날짜 범위 기반 (startDate ~ endDate) */}
      {(() => {
        if (!session) {
          return (
            <span style={{ fontSize: 11, fontWeight: 500, color: '#9A9490' }}>
              루틴을 설정하면 진행 현황이 표시됩니다
            </span>
          );
        }
        const s = parseISO(session.startDate);
        const e = parseISO(session.endDate);
        s.setHours(0, 0, 0, 0);
        e.setHours(0, 0, 0, 0);
        const t = new Date(); t.setHours(0, 0, 0, 0);
        // 세션 전체 일수 (최대 30일)
        const totalDays = Math.max(1, Math.min(differenceInDays(e, s) + 1, 30));
        // 오늘이 세션 시작부터 몇 번째 날인지 (1-based, 범위 클램프)
        const dotPos = Math.max(1, Math.min(differenceInDays(t, s) + 1, totalDays));
        // 도트 수에 따라 크기·간격 자동 조정
        const dotSize  = totalDays <= 7 ? 10 : totalDays <= 14 ? 8 : 6;
        const dotGap   = totalDays <= 7 ? 5  : totalDays <= 14 ? 4 : 3;
        const todayW   = totalDays <= 7 ? 20 : totalDays <= 14 ? 16 : 12;
        return (
          <div style={{ display: 'flex', gap: dotGap, alignItems: 'center' }}>
            {Array.from({ length: totalDays }, (_, i) => i + 1).map((dayNum) => (
              <span
                key={dayNum}
                style={{
                  width: dayNum === dotPos ? todayW : dotSize,
                  height: dotSize,
                  borderRadius: 9999,
                  background:
                    dayNum < dotPos
                      ? 'rgba(254,160,4,.35)'
                      : dayNum === dotPos
                      ? 'rgb(254,160,4)'
                      : '#D8D6CF',
                  boxShadow: dayNum === dotPos ? '0 0 0 3px rgba(254,160,4,.25)' : 'none',
                  transition: 'all 0.3s',
                  flexShrink: 0,
                }}
              />
            ))}
          </div>
        );
      })()}
    </div>
  );
}

// expertTip 텍스트에서 제품명을 찾아 라임 강조 인라인 JSX로 변환
// EXPERT TIP 제품명 하이라이팅 (React.ReactNode 버전 — JSX 렌더용)
// 색상 기준: ExpertTipField.tsx EXPERT_TIP_HIGHLIGHT 공통 상수
function highlightProductNames(text: string, products: Map<string, Product>): React.ReactNode {
  if (!text || products.size === 0) return text;
  const names = Array.from(products.values())
    .map(p => p.name)
    .sort((a, b) => b.length - a.length);
  const escaped = names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!escaped.length) return text;
  const pattern = new RegExp(`(${escaped.join('|')})`, 'g');
  const parts = text.split(pattern);
  const { bg, color, weight } = EXPERT_TIP_HIGHLIGHT;
  return parts.map((part, i) =>
    names.includes(part)
      ? <span key={i} style={{ background: bg, color, borderRadius: 4, padding: '0 3px', fontWeight: Number(weight) }}>{part}</span>
      : part
  );
}

// desc 텍스트에서 "N분" 패턴 추출 (예: "10분 뒤 러빙" → 10)
function parseWaitMinutes(text: string): number | null {
  const m = text.match(/(\d+)\s*분/);
  return m ? parseInt(m[1], 10) : null;
}

// ─── 루틴 플로우 카드 ─────────────────────────────────────────────────────────
// today.html .flow-step-card: 아침/저녁 탭 + 제품 스트립 + 체크 버튼

// SVG 고양이 뱃지 — 체크 버튼과 동일한 드로잉, 색상만 변경
function FlowCard({
  todayMorning,
  todayEvening,
  todayDayNumber,
  session,
  products,
  tab,
  onTabChange,
  checked,
  onToggle,
  saving,
}: {
  todayMorning: SlotDay;
  todayEvening: SlotDay;
  todayDayNumber: number;
  session: Session;
  products: Map<string, Product>;
  tab: 'morning' | 'evening';
  onTabChange: (t: 'morning' | 'evening') => void;
  checked: CheckState;
  onToggle: (time: 'morning' | 'evening') => void;
  saving: boolean;
}) {
  const slot = tab === 'morning' ? todayMorning : todayEvening;
  const isChecked = tab === 'morning' ? checked.morning : checked.evening;
  const f = "'Plus Jakarta Sans', 'Space Grotesk', sans-serif";

  // 대기 타이머 — AppContext 전역 상태 사용 (페이지 이탈해도 유지)
  const { timerLabel, timerEndMs, timerRemainMs, alarmVisible, alarmLabel, startTimer, stopTimer, dismissAlarm } = useAppContext().timer;

  return (
    <>
      <style>{`
        .care-step-card:hover {
          transform: translateY(-4px);
          border-color: #0C0C0A !important;
          box-shadow: 0 10px 22px rgba(0, 0, 0, 0.08) !important;
        }
      `}</style>
    {/* ── 알람 배너: 타이머 종료 시 화면 최상단 고정 오버레이 ── */}
    {alarmVisible && alarmLabel && (
      <div
        className="alarm-banner-enter alarm-banner-pulse"
        style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
          background: '#000000',
          borderBottom: '3px solid #C5FF00',
          padding: '18px 20px 22px',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          boxShadow: '0 6px 32px rgba(0,0,0,.8)',
        }}
      >
        {/* 닫기 버튼 — 우상단 */}
        <button
          onClick={dismissAlarm}
          style={{ position: 'absolute', top: 14, right: 16, background: 'rgba(255,255,255,.12)', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,.7)', fontSize: 18, padding: '6px 10px', borderRadius: 8, lineHeight: 1 }}
        >
          ✕
        </button>
        {/* 텍스트 영역 */}
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <div style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,.4)', marginBottom: 4 }}>
            대기 완료
          </div>
          <div style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 17, fontWeight: 600, color: '#fff', lineHeight: 1.3 }}>
            {alarmLabel}
          </div>
        </div>
        {/* 대형 벨 아이콘 — 텍스트 하단 */}
        <div style={{ width: 72, height: 72, borderRadius: '50%', background: '#C5FF00', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
          </svg>
        </div>
      </div>
    )}

    <div
      style={{
        margin: '0 26px',
        background: '#FFFFFF',
        border: '1px solid rgba(12,12,10,.07)',
        boxShadow: '0 1px 2px rgba(0,0,0,.04), 0 0 0 1px rgba(0,0,0,.03)',
        borderRadius: 20,
        overflow: 'hidden',
      }}
    >
      {/* ① 최상단: MORNING / NIGHT 탭 */}
      <div style={{ display: 'flex', padding: '24px 26px 10px', gap: 6 }}>
        {(['morning', 'evening'] as const).map((t) => (
          <button
            key={t}
            onClick={() => onTabChange(t)}
            style={{
              flex: 1,
              height: 32,
              padding: '0 26px',
              borderRadius: 9999,
              border: tab === t ? 'none' : '1px solid rgba(12,12,10,.1)',
              cursor: 'pointer',
              fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: '0.04em',
              background: tab === t ? '#0C0C0A' : 'transparent',
              color: tab === t ? '#C5FF00' : '#BCBAB6',
              transition: 'all .18s',
              position: 'relative',
            }}
          >
            {t === 'morning' ? '☀ MORNING' : '🌙 NIGHT'}
            {/* 완료 시 SVG 고양이 뱃지 — 아침(라임) / 저녁(오렌지) */}
            {(t === 'morning' ? checked.morning : checked.evening) && (
              <span style={{ position: 'absolute', top: -8, right: -8, display: 'block', width: 20, height: 20 }}>
                <CatBadge color={t === 'morning' ? '#C5FF00' : '#f7bc45'} size={20} />
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ② 칩 스트립 + EXPERT TIP */}
      {slot.items.length > 0 ? (
        <div style={{ padding: '10px 26px 0' }}>
          <div style={{ display: 'flex', overflowX: 'auto', scrollbarWidth: 'none', gap: 8, alignItems: 'center', paddingBottom: 10, paddingTop: 10 }}>
            {slot.items.map((item, idx) => {
              if (item.type === 'product') {
                const p = products.get(item.id);
                const stepNum = slot.items.slice(0, idx + 1).filter(i => i.type === 'product').length;
                return (
                  <div
                    key={idx}
                    className="care-step-card"
                    style={{
                      flexShrink: 0,
                      boxSizing: 'border-box',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      padding: '20px 20px 0px',
                      width: 240,
                      minWidth: 240,
                      height: 350,
                      background: '#FFFFFF',
                      border: '1px solid rgba(12,12,10,.07)',
                      borderRadius: 16,
                      boxShadow: '0 4px 16px rgba(0, 0, 0, 0.04), 0 0 0 1px rgba(0, 0, 0, 0.02)',
                      opacity: isChecked ? 0.45 : 1,
                      transition: 'all .2s ease-in-out',
                    }}
                  >
                    {/* 이미지 영역 — 200×257, 배경 #F3F3F4 */}
                    <div style={{
                      width: 200,
                      height: 257,
                      background: '#F3F3F4',
                      borderRadius: 10,
                      overflow: 'hidden',
                      position: 'relative',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}>
                      {(p?.imageUrl || p?.storageUrl)
                        ? <img src={p!.imageUrl || p!.storageUrl} alt={p?.name} style={{ width: 200, height: 274, objectFit: 'contain', display: 'block' }} />
                        : <span style={{ fontSize: 56, opacity: 0.3 }}>🧴</span>
                      }
                      {isChecked && (
                        <div style={{ position: 'absolute', inset: 0, background: 'rgba(12,12,10,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3 }}>
                          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                        </div>
                      )}
                    </div>

                    {/* 제품명 */}
                    <div style={{
                      width: 155,
                      fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif",
                      fontStyle: 'normal',
                      fontWeight: 600,
                      fontSize: 20,
                      lineHeight: '18px',
                      display: 'flex',
                      alignItems: 'center',
                      color: '#000000',
                      marginTop: 14,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap' as const,
                    }}>
                      {p?.name ?? '?'}
                    </div>

                    {/* Step 넘버 */}
                    <div style={{
                      width: 200,
                      fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif",
                      fontStyle: 'normal',
                      fontWeight: 400,
                      fontSize: 16,
                      lineHeight: '18px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'flex-end',
                      color: '#000000',
                      marginTop: 8,
                    }}>
                      Step{String(stepNum).padStart(2, '0')}.
                    </div>
                  </div>
                );
              }
              if (item.type === 'desc') {
                const waitMins = parseWaitMinutes(item.text);
                const isActiveTimer = timerLabel === item.text && !!timerEndMs;
                
                if (waitMins) {
                  const guideNum = slot.items.slice(0, idx + 1).filter(i => i.type === 'desc' && parseWaitMinutes(i.text) !== null).length;
                  const guideLabel = `GUIDE ${String(guideNum).padStart(2, '0')}`;
                  
                  return (
                    <div
                      key={idx}
                      className="care-step-card"
                      onClick={() => {
                        if (isActiveTimer) {
                          stopTimer();
                        } else {
                          startTimer(item.text, waitMins);
                        }
                      }}
                      style={{
                        flexShrink: 0,
                        boxSizing: 'border-box',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        padding: '20px 18px 18px',
                        width: 240,
                        minWidth: 240,
                        height: 350,
                        background: 'rgba(12,12,10,0.03)',
                        border: isActiveTimer ? '2px solid #0066FF' : '1px solid rgba(12,12,10,.07)',
                        borderRadius: 16,
                        boxShadow: isActiveTimer ? '0 6px 18px rgba(0,0,0,.08)' : '0 4px 16px rgba(0,0,0,.04), 0 0 0 1px rgba(0,0,0,.02)',
                        transition: 'all .2s ease-in-out',
                        cursor: 'pointer',
                        position: 'relative',
                        opacity: isChecked ? 0.45 : 1,
                      }}
                    >
                      {/* 상단 고정 영역: GUIDE 뱃지 + 설명문구 */}
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', width: '100%' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', marginBottom: 8 }}>
                          <div style={{
                            background: '#C5FF00', color: '#000000',
                            fontFamily: f, fontWeight: 800, fontSize: 10, letterSpacing: '.06em',
                            padding: '3px 8px', borderRadius: 6, lineHeight: 1
                          }}>
                            {isActiveTimer ? "TAB하여 중지" : "TAB하여 실행"}
                          </div>
                        </div>
                        {/* 설명 문구 */}
                        <div style={{
                          fontFamily: f,
                          fontWeight: 700,
                          fontSize: 20,
                          lineHeight: '1.4',
                          color: '#0C0C0A',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                        }}>
                          {item.text}
                        </div>
                      </div>

                      {/* 가운데 영역: 대형 타이머 그래픽 이미지 */}
                      <div style={{
                        position: 'relative',
                        width: 110,
                        height: 110,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        alignSelf: 'center',
                        margin: 'auto 0',
                        transition: 'all 0.3s ease',
                      }}>
                        <svg width="110" height="110" viewBox="0 0 24 24" fill="none" style={{ transform: 'rotate(-90deg)' }}>
                          {/* 회색 배경 링 */}
                          <circle cx="12" cy="12" r="9" stroke="rgba(12,12,10,0.06)" strokeWidth="2" />
                          {/* 진행률 링 */}
                          <circle
                            cx="12"
                            cy="12"
                            r="9"
                            stroke={isActiveTimer ? '#C5FF00' : 'rgba(12,12,10,0.15)'}
                            strokeWidth="2"
                            strokeDasharray="56.5"
                            strokeDashoffset={isActiveTimer ? 56.5 * (1 - (timerRemainMs / (waitMins * 60_000))) : 0}
                            strokeLinecap="round"
                            style={{ transition: 'stroke-dashoffset 0.5s linear' }}
                          />
                        </svg>
                        {/* 중앙 시계바늘 아이콘 */}
                        <div style={{ position: 'absolute', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: isActiveTimer ? 1 : 0.35 }}>
                          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#0C0C0A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="12 6 12 12 16 14" />
                          </svg>
                        </div>
                        {/* 상단 스톱워치 버튼 데코 */}
                        <div style={{ position: 'absolute', top: 2, width: 10, height: 5, background: '#0C0C0A', borderRadius: '2px 2px 0 0', opacity: isActiveTimer ? 1 : 0.35 }} />
                      </div>

                      {/* 하단 영역: 실시간 남은 시간 또는 타이머 가이드 배너 */}
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
                        {isActiveTimer ? (
                          <div style={{
                            fontFamily: f,
                            fontWeight: 800,
                            fontSize: 28,
                            color: '#000000',
                            fontVariantNumeric: 'tabular-nums',
                            letterSpacing: '.02em',
                            lineHeight: 1
                          }}>
                            {formatTimerRemain(timerRemainMs)}
                          </div>
                        ) : (
                          <div style={{
                            fontFamily: f,
                            fontWeight: 700,
                            fontSize: 22,
                            color: '#9A9490',
                            lineHeight: '1.45',
                            textAlign: 'center'
                          }}>
                            {waitMins}분
                          </div>
                        )}
                      </div>
                    </div>
                  );
                }
                // 일반 desc 칩 (타이머 없음)
                return (
                  <div
                    key={idx}
                    style={{
                      flexShrink: 0,
                      alignSelf: 'center',
                      padding: '6px 14px',
                      background: 'rgb(3, 105, 227)',
                      borderRadius: 9999,
                      fontSize: 12,
                      fontWeight: 700,
                      color: '#fff',
                      whiteSpace: 'nowrap',
                      fontFamily: f,
                    }}
                  >
                    {item.text}
                  </div>
                );
              }
              if (item.type === 'tip') return (
                <div key={idx} style={{ flexShrink: 0, alignSelf: 'center', padding: '0 8px', minWidth: 36, height: 22, background: 'rgba(197,255,0,.22)', borderRadius: 12, fontSize: 12, fontWeight: 800, color: '#4E7D00', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', whiteSpace: 'nowrap', opacity: isChecked ? 0.45 : 1, fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif" }}>
                  {item.text || 'TIP'}
                </div>
              );
              if (item.type === 'plus') return (
                <div key={idx} style={{ flexShrink: 0, alignSelf: 'center', width: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'rgba(33,150,243,.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <line x1="5" y1="1" x2="5" y2="9" stroke="#1976D2" strokeWidth="2" strokeLinecap="round"/>
                      <line x1="1" y1="5" x2="9" y2="5" stroke="#1976D2" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                  </div>
                </div>
              );
              return (
                <div key={idx} style={{ flexShrink: 0, alignSelf: 'center', width: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'rgba(249,115,22,.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg width="12" height="10" viewBox="0 0 12 10" fill="none">
                      <path d="M1 5h10M7 1l4 4-4 4" stroke="#F97316" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                </div>
              );
            })}
          </div>

          {/* DAY 배지 + 제품 수 — 오른쪽 정렬, EXPERT TIP 바로 위 */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, paddingTop: 14 }}>
            <span style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 12, fontWeight: 400, color: '#BCBAB6' }}>
              {slot.items.filter(i => i.type === 'product').length}개 제품
            </span>
            <span style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 10, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase' as const, background: '#0C0C0A', color: '#A6D900', padding: '3px 10px', borderRadius: 9999 }}>
              Day {todayDayNumber}
            </span>
          </div>

          {/* 대기 타이머 배너 — desc 칩 탭 시 활성화 */}
          {timerEndMs && timerLabel && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              margin: '10px 0 4px',
              padding: '10px 14px',
              background: '#0C0C0A',
              border: '1.5px solid #C5FF00',
              borderRadius: 12,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  width: 7, height: 7, borderRadius: '50%', background: '#C5FF00',
                  display: 'inline-block',
                  boxShadow: '0 0 0 3px rgba(197,255,0,.3)',
                  flexShrink: 0,
                }} />
                <span style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 12, color: 'rgba(255,255,255,.7)' }}>
                  {timerLabel}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 22, fontWeight: 800, color: '#C5FF00', fontVariantNumeric: 'tabular-nums', letterSpacing: '.06em' }}>
                  {formatTimerRemain(timerRemainMs)}
                </span>
                <button
                  onClick={() => stopTimer()}
                  style={{ background: 'rgba(255,255,255,.08)', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,.45)', fontSize: 13, padding: '3px 7px', borderRadius: 6, lineHeight: 1 }}
                >
                  ✕
                </button>
              </div>
            </div>
          )}

          {/* TIPS */}
          {slot.expertTip && (
            <div style={{ position: 'relative', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', padding: 24, gap: 8, background: '#FAFAFA', border: '1px solid #E4E4E7', borderRadius: 16, marginTop: 8, marginBottom: 12, overflow: 'visible' }}>
              <svg width="29" height="27" viewBox="0 0 29 27" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ position: 'absolute', left: -8, top: -8, zIndex: 2 }}>
                <path d="M6 26.982C4.875 26.982 3.7625 26.707 2.6625 26.157C1.5625 25.607 0.675 24.882 0 23.982C0.65 23.982 1.3125 23.7257 1.9875 23.2132C2.6625 22.7007 3 21.957 3 20.982C3 19.732 3.4375 18.6695 4.3125 17.7945C5.1875 16.9195 6.25 16.482 7.5 16.482C8.75 16.482 9.8125 16.9195 10.6875 17.7945C11.5625 18.6695 12 19.732 12 20.982C12 22.632 11.4125 24.0445 10.2375 25.2195C9.0625 26.3945 7.65 26.982 6 26.982ZM6 23.982C6.825 23.982 7.53125 23.6882 8.11875 23.1007C8.70625 22.5133 9 21.807 9 20.982C9 20.557 8.85625 20.2008 8.56875 19.9132C8.28125 19.6257 7.925 19.482 7.5 19.482C7.075 19.482 6.71875 19.6257 6.43125 19.9132C6.14375 20.2008 6 20.557 6 20.982C6 21.557 5.93125 22.082 5.79375 22.557C5.65625 23.032 5.475 23.482 5.25 23.907C5.375 23.957 5.5 23.982 5.625 23.982C5.75 23.982 5.875 23.982 6 23.982ZM14.625 17.982L10.5 13.857L23.925 0.432C24.2 0.157 24.5437 0.01325 24.9562 0.00075C25.3687 -0.01175 25.725 0.132 26.025 0.432L28.05 2.457C28.35 2.757 28.5 3.107 28.5 3.507C28.5 3.907 28.35 4.257 28.05 4.557L14.625 17.982Z" fill="#0C0C0A"/>
              </svg>
              <div style={{ fontFamily: "'Plus Jakarta Sans',sans-serif", fontWeight: 900, fontSize: 10, lineHeight: '15px', letterSpacing: 1, color: '#A1A1AA', alignSelf: 'stretch', zIndex: 1 }}>TIPS</div>
              <div style={{ fontFamily: "'Nanum Pen Script',cursive", fontWeight: 500, fontSize: 22, lineHeight: '28px', color: '#27272A', alignSelf: 'stretch', zIndex: 1 }}>
                {highlightProductNames(slot.expertTip, products)}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div style={{ margin: '0 0 0 0', padding: '24px 26px', background: '#fff', borderRadius: 20, boxShadow: '0 2px 16px rgba(0,0,0,.07),0 0 0 1px rgba(0,0,0,.04)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 28 }}>🧴</span>
          <div style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 13, fontWeight: 700, color: '#0C0C0A' }}>이 시간대에 등록된 제품이 없습니다</div>
          <div style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 12, color: '#9A9490' }}>SETUP에서 루틴에 제품을 추가해보세요</div>
          <Link href="/setup" style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 12, fontWeight: 600, color: '#9A9490', textDecoration: 'none', marginTop: 2 }}>SETUP 바로가기 →</Link>
        </div>
      )}

      {/* ④ 체크 버튼 — 제품이 없으면 비활성 */}
      <div style={{ padding: '12px 26px 14px' }}>
        {(() => {
          const hasProducts = slot.items.some(i => i.type === 'product');
          return (
            <button
              onClick={() => !saving && hasProducts && onToggle(tab)}
              disabled={saving || !hasProducts}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                height: 40,
                width: '100%',
                background: !hasProducts ? '#F4F4F0' : isChecked ? '#0C0C0A' : '#F4F4F0',
                color: !hasProducts ? '#BCBAB6' : isChecked ? '#C5FF00' : '#4A4846',
                border: !hasProducts ? '1.5px solid rgba(12,12,10,.07)' : isChecked ? '1.5px solid #0C0C0A' : '1.5px solid rgba(12,12,10,.1)',
                fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: '0.04em',
                borderRadius: 10,
                cursor: !hasProducts ? 'not-allowed' : saving ? 'wait' : 'pointer',
                transition: 'all .22s',
                opacity: saving ? 0.6 : !hasProducts ? 0.45 : 1,
              }}
            >
              {saving ? '저장 중...' : isChecked ? (
                /* 완료 — 아침(라임) / 저녁(오렌지) 고양이 */
                <>
                  {tab === 'morning' ? '☀' : '🌙'} 스킨케어 체크 완료
                  <span style={{ display: 'inline-block', verticalAlign: 'middle', marginLeft: 4 }}>
                    <CatBadge color={tab === 'morning' ? '#C5FF00' : '#f7bc45'} size={20} />
                  </span>
                </>
              ) : (
                /* 미완료(비활성 포함) — 회색 고양이 */
                <>
                  {tab === 'morning' ? '☀' : '🌙'} 스킨케어 체크
                  <span style={{ display: 'inline-block', verticalAlign: 'middle', marginLeft: 4, opacity: !hasProducts ? 0.5 : 0.7 }}>
                    <CatBadge color="#9A9490" size={20} />
                  </span>
                </>
              )}
            </button>
          );
        })()}
        {/* List → 오른쪽 정렬 */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
          <Link href="/setup#sessions" style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 11, fontWeight: 700, color: '#BCBAB6', textDecoration: 'none', letterSpacing: '.04em' }}>
            List →
          </Link>
        </div>
      </div>

      {/* 습관은 FlowCard 아래 독립 섹션으로 분리됨 */}
    </div>
    </>
  );
}

// ─── 오늘의 습관 섹션 ────────────────────────────────────────────────────────
// ROUTINE TRACKER에 등록된 습관 중 오늘 날짜에 해당하는 것만 표시
// 루틴 유무와 무관하게 항상 렌더링 (todayHabits.length > 0 일 때)

function TodayHabitSection({
  todayHabits,
  habitChecked,
  onToggle,
}: {
  todayHabits: Habit[];
  habitChecked: Set<string>;
  onToggle: (habitId: string) => void;
}) {
  if (todayHabits.length === 0) return null;

  const f = "'Plus Jakarta Sans','Space Grotesk',sans-serif";
  const doneCount = todayHabits.filter(h => habitChecked.has(h.id)).length;

  return (
    <div>
      {/* 섹션 헤더 */}
      <SectionHeader title="#Habits" action={`${doneCount}/${todayHabits.length}`} />

      {/* 습관 목록 — 오렌지 컬러 바 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: '0 26px' }}>
        {todayHabits.map((h) => {
          const isDone = habitChecked.has(h.id);
          return (
            <div key={h.id} onClick={() => onToggle(h.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 14px', borderRadius: 50, background: 'rgb(254,160,4)', opacity: isDone ? 0.5 : 1, cursor: 'pointer', transition: 'opacity .18s' }}>
              <div style={{ width: 22, height: 22, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.85)', background: isDone ? '#fff' : 'transparent', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background .2s' }}>
                {isDone && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="rgb(254,160,4)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
              </div>
              <span style={{ fontSize: 18, lineHeight: 1, flexShrink: 0 }}>{h.icon || '✦'}</span>
              {h.time && h.repeatType !== 'allday' && (
                <span style={{ fontFamily: f, fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.85)', width: 42, flexShrink: 0, textDecoration: isDone ? 'line-through' : 'none' }}>
                  {h.time}
                </span>
              )}
              <span style={{ fontFamily: f, fontSize: 14, fontWeight: 700, color: '#fff', textDecoration: isDone ? 'line-through' : 'none', flex: 1, minWidth: 0 }}>
                {h.name}
              </span>
            </div>
          );
        })}
        {/* List → */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '2px 4px 4px' }}>
          <Link href="/setup#tracker" style={{ fontFamily: f, fontSize: 12, fontWeight: 700, color: '#BCBAB6', textDecoration: 'none', letterSpacing: '.04em' }}>List →</Link>
        </div>
      </div>
    </div>
  );
}

// ─── 루틴 없을 때 빈 상태 카드 ─────────────────────────────────────────────────

function RoutineEmptyCard() {
  const f = "'Plus Jakarta Sans', 'Space Grotesk', sans-serif";
  const steps = [
    { num: '1', icon: '📦', label: 'BOX', desc: '사용하는 제품을 등록해요', href: '/box', cta: 'BOX 열기 →' },
    { num: '2', icon: '📋', label: 'SETUP', desc: '루틴 플랜을 설계해요', href: '/setup', cta: 'SETUP 열기 →' },
    { num: '3', icon: '✅', label: 'TODAY', desc: '매일 체크하고 기록해요', href: null, cta: null },
  ];
  return (
    <div style={{ margin: '0 26px' }}>
      {/* 안내 헤더 */}
      <div style={{ padding: '20px 4px 16px', textAlign: 'center' }}>
        <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.16em', color: '#9A9490', marginBottom: 6 }}>GETTING STARTED</div>
        <div style={{ fontFamily: f, fontSize: 20, fontWeight: 800, color: '#0C0C0A', lineHeight: 1.3 }}>시작하는 방법</div>
        <div style={{ fontFamily: f, fontSize: 12, color: '#9A9490', marginTop: 6 }}>아래 순서대로 진행하면 오늘의 루틴이 완성돼요</div>
      </div>

      {/* 3단계 카드 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 8 }}>
        {steps.map((s, i) => (
          <div key={i} style={{ background: '#fff', borderRadius: 16, padding: '16px', border: '1px solid rgba(12,12,10,.07)', boxShadow: '0 1px 4px rgba(0,0,0,.04)', display: 'flex', alignItems: 'center', gap: 14 }}>
            {/* 번호 배지 */}
            <div style={{ width: 36, height: 36, borderRadius: '50%', background: i === 2 ? '#F4F4F0' : '#0C0C0A', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <span style={{ fontFamily: f, fontSize: 14, fontWeight: 800, color: i === 2 ? '#BCBAB6' : '#C5FF00' }}>{s.num}</span>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                <span style={{ fontSize: 14 }}>{s.icon}</span>
                <span style={{ fontFamily: f, fontSize: 13, fontWeight: 800, color: i === 2 ? '#BCBAB6' : '#0C0C0A', letterSpacing: '.06em' }}>{s.label}</span>
              </div>
              <div style={{ fontFamily: f, fontSize: 12, color: '#9A9490' }}>{s.desc}</div>
            </div>
            {s.href && (
              <Link href={s.href} style={{ flexShrink: 0, height: 34, padding: '0 14px', background: '#C5FF00', borderRadius: 9999, display: 'flex', alignItems: 'center', fontFamily: f, fontSize: 11, fontWeight: 800, color: '#0C0C0A', textDecoration: 'none', whiteSpace: 'nowrap' }}>
                {s.cta}
              </Link>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── 로그인 필요 카드 ────────────────────────────────────────────────────────

function LoginRequiredCard({ onLogin }: { onLogin: () => void }) {
  return (
    <div
      style={{
        margin: '0 26px',
        background: '#FFFFFF',
        border: '1px solid rgba(12,12,10,.07)',
        boxShadow: '0 1px 2px rgba(0,0,0,.04), 0 0 0 1px rgba(0,0,0,.03)',
        borderRadius: 20,
        padding: '32px 26px',
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 36, marginBottom: 12 }}>🔒</div>
      <p
        style={{
          fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
          fontSize: 15,
          fontWeight: 700,
          color: '#0C0C0A',
          margin: '0 0 6px',
        }}
      >
        로그인이 필요해요
      </p>
      <p
        style={{
          fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
          fontSize: 13,
          color: '#9A9490',
          margin: '0 0 20px',
        }}
      >
        루틴을 확인하려면 Google 계정으로 로그인하세요
      </p>
      <button
        onClick={onLogin}
        style={{
          background: '#0C0C0A',
          color: '#C5FF00',
          border: 'none',
          borderRadius: 12,
          padding: '10px 26px',
          fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
          fontSize: 13,
          fontWeight: 700,
          cursor: 'pointer',
        }}
      >
        Google로 로그인
      </button>
    </div>
  );
}


// ─── OOTD 섹션 ───────────────────────────────────────────────────────────────
// today.html .ootd-main-photo / .ootd-thumb-row / .record-look-row 구조 기반

function OOTDSection({
  ootdLog,
  onRecord,
  onViewLog,
  user,
  activeLookItems,
  products,
}: {
  ootdLog: OOTDLog | null;
  onRecord: () => void;
  onViewLog: () => void;
  user: User | null;
  activeLookItems: CtItem[];
  products: Map<string, Product>;
}) {
  const f = "'Plus Jakarta Sans', 'Space Grotesk', sans-serif";
  // 오늘 노출할 첫 번째 룩 (복수 등록됐을 때는 첫 번째만 hero로)
  const heroLook = activeLookItems[0] ?? null;
  const heroProdIds = heroLook
    ? heroLook.items.filter((r): r is { type: 'product'; id: string } => r.type === 'product').map(r => r.id)
    : [];

  return (
    <div>
      <SectionHeader title="#OOTD" />

      <div style={{ padding: '0 26px' }}>

        {/* 룩북 미등록 빈 상태 안내 — 로그인된 상태에서만 표시 (비로그인 시 아래 카드로 대체) */}
        {!heroLook && user && (
          <div style={{ padding: '20px 26px', background: '#fff', borderRadius: 20, boxShadow: '0 2px 16px rgba(0,0,0,.07),0 0 0 1px rgba(0,0,0,.04)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, marginBottom: 12 }}>
            <span style={{ fontSize: 28 }}>👗</span>
            <div style={{ fontFamily: f, fontSize: 13, fontWeight: 700, color: '#0C0C0A' }}>오늘의 룩을 등록해보세요</div>
            <div style={{ fontFamily: f, fontSize: 12, color: '#9A9490' }}>Setup에서 Today ON으로 설정하면 여기에 표시됩니다</div>
            <Link href="/log?tab=라이브러리&filter=lookbook" style={{ fontFamily: f, fontSize: 13, fontWeight: 600, color: '#9A9490', textDecoration: 'none', marginTop: 4 }}>List →</Link>
          </div>
        )}

        {/* ── MOTD와 동일한 흰 카드 — 제목 + 제품 ── */}
        {heroLook && (
          <div style={{ background: '#fff', borderRadius: 20, overflow: 'hidden', boxShadow: '0 2px 16px rgba(0,0,0,.07),0 0 0 1px rgba(0,0,0,.04)', marginBottom: 12 }}>

            {/* 이미지 있을 때: 3:4 portrait hero — 클릭 시 LOG 라이브러리 해당 아이템으로 이동 */}
            {heroLook.imageUrl ? (
              <Link href={`/log?tab=라이브러리&filter=lookbook&id=${heroLook.id}`} style={{ display: 'block', textDecoration: 'none' }}>
                <div style={{ position: 'relative', width: '100%' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={heroLook.imageUrl} alt={heroLook.name} style={{ width: '100%', height: 'auto', display: 'block' }} />
                  <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '60px 26px 18px', background: 'linear-gradient(to top,rgba(0,0,0,.56) 0%,transparent 55%)', pointerEvents: 'none' }}>
                    <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase' as const, color: 'rgba(255,255,255,.7)', marginBottom: 5 }}>TODAY&apos;S LOOK</div>
                    <div style={{ fontFamily: f, fontSize: 17, fontWeight: 700, color: '#fff', lineHeight: 1.25 }}>{heroLook.name}</div>
                    {heroLook.desc && <div style={{ fontFamily: f, fontSize: 12, color: 'rgba(255,255,255,.6)', marginTop: 3 }}>{heroLook.desc}</div>}
                  </div>
                </div>
              </Link>
            ) : (
              /* 이미지 없을 때: 텍스트 제목 */
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 26px 0' }}>
                <span style={{ fontSize: 22, flexShrink: 0 }}>{heroLook.emoji || '👗'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: f, fontSize: 15, fontWeight: 800, color: '#0C0C0A', letterSpacing: '-.01em' }}>{heroLook.name}</div>
                  {heroLook.desc && <div style={{ fontFamily: f, fontSize: 12, color: '#9A9490', marginTop: 2 }}>{heroLook.desc}</div>}
                </div>
              </div>
            )}

            {/* 제품 가로 스크롤 — 항상 동일 구분선·여백으로 첫 제품 위치 고정 */}
            {heroProdIds.length > 0 && (
              <div className="hide-scrollbar" style={{ display: 'flex', overflowX: 'auto', scrollbarWidth: 'none' as const, gap: 8, padding: '12px 0', scrollSnapType: 'x mandatory' as const, scrollPaddingLeft: 16, borderTop: '1px solid rgba(12,12,10,.08)' }}>
                <div style={{ flexShrink: 0, width: 16 }} />
                {heroProdIds.map(pid => {
                  const p = products.get(pid);
                  const imgUrl = p?.imageUrl || p?.storageUrl;
                  return (
                    <div key={pid} style={{ flexShrink: 0, width: 120, scrollSnapAlign: 'start' as const }}>
                      <div style={{ width: 120, height: 160, background: '#F3F3F4', borderRadius: 4, border: '1px solid #E4E4E7', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                        {imgUrl
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={imgUrl} alt={p?.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                          : <span style={{ fontSize: 32, opacity: 0.3 }}>👗</span>
                        }
                      </div>
                    </div>
                  );
                })}
                <div style={{ flexShrink: 0, width: 16 }} />
              </div>
            )}

            {/* 참고 링크 — 카드 하단 */}
            <SourceLink url={heroLook.sourceUrl} />

            {/* 카드 하단: List → LOG 라이브러리 */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '10px 26px 12px', borderTop: '1px solid rgba(12,12,10,.06)' }}>
              <Link href="/log?tab=라이브러리" style={{ fontFamily: f, fontSize: 12, fontWeight: 700, color: '#BCBAB6', textDecoration: 'none', letterSpacing: '.04em' }}>List →</Link>
            </div>
          </div>
        )}

        {/* ── RECORD LOOK / Logged 카드 ── */}
        {!user ? null : ootdLog ? (
          <div onClick={onViewLog} style={{ border: '1.5px solid #4caf78', borderRadius: 9999, minHeight: 52, padding: '14px 26px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', background: '#fff', transition: 'background .2s' }}>
            <div style={{ width: 36, height: 36, borderRadius: 9999, background: '#E8E6E0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0, overflow: 'hidden' }}>
              {ootdLog.photoUrl
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={ootdLog.photoUrl} style={{ width: '100%', height: '100%', objectFit: 'contain' }} alt="" />
                : '👗'}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: f, fontSize: 14, fontWeight: 600, color: '#0C0C0A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {ootdLog.theme || '오늘의 룩'}{ootdLog.note ? ` · ${ootdLog.note}` : ''}
              </div>
              <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, color: '#4caf78', marginTop: 3 }}>✓ 기록 완료</div>
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9A9490" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </div>
        ) : (
          <div onClick={onRecord} style={{ border: '1.5px dashed rgba(12,12,10,.14)', borderRadius: 9999, minHeight: 52, padding: '14px 26px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', background: '#fff', transition: 'background .2s' }}>
            <div style={{ width: 36, height: 36, background: '#E8E6E0', borderRadius: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>📷</div>
            <span style={{ fontFamily: f, fontSize: 14, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase' as const, color: '#9A9490', flex: 1 }}>RECORD LOOK</span>
            <div style={{ width: 30, height: 30, background: '#C5FF00', borderRadius: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, lineHeight: 1, color: '#0C0C0A', flexShrink: 0, fontWeight: 300 }}>+</div>
          </div>
        )}

      </div>
    </div>
  );
}

// ─── 공통 소스 링크 (design today.html .care-source-link 구조) ───────────────
// 인스타그램, 유튜브 등 참고 링크를 카드 하단에 표시 — 새 탭으로 열기

function SourceLink({ url }: { url?: string }) {
  if (!url?.trim()) return null;
  const f = "'Plus Jakarta Sans', 'Space Grotesk', sans-serif";
  let domain = url;
  try { domain = new URL(url).hostname; } catch {}
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 26px', borderTop: '1px solid rgba(12,12,10,.07)', textDecoration: 'none', fontFamily: f, fontSize: 11, fontWeight: 700, color: '#4A4846', letterSpacing: '.04em', background: 'rgba(0,0,0,.02)' }}
    >
      {/* 링크 아이콘 */}
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ flexShrink: 0 }}>
        <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/>
        <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>
      </svg>
      SOURCE
      {/* 도메인 이름 */}
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 400, color: '#9A9490' }}>
        {domain}
      </span>
      {/* 외부 링크 아이콘 */}
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ flexShrink: 0 }}>
        <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
        <polyline points="15 3 21 3 21 9"/>
        <line x1="10" y1="14" x2="21" y2="3"/>
      </svg>
    </a>
  );
}

// ─── 집중케어 섹션 ───────────────────────────────────────────────────────────

function CareSection({ items, products }: { items: CtItem[]; products: Map<string, Product> }) {
  if (items.length === 0) return null;
  const f = "'Plus Jakarta Sans', 'Space Grotesk', sans-serif";

  // 대기 타이머 — AppContext 전역 상태 사용 (페이지 이탈해도 유지)
  const { timerLabel, timerEndMs, timerRemainMs, alarmVisible, alarmLabel, startTimer, stopTimer, dismissAlarm } = useAppContext().timer;

  // 업그레이드된 칩/카드 렌더러
  function renderChip(item: RoutineItem, idx: number, allItems: RoutineItem[]) {
    if (item.type === 'product') {
      const p = products.get(item.id);
      const stepNum = allItems.slice(0, idx + 1).filter(i => i.type === 'product').length;
      const stepLabel = `STEP ${String(stepNum).padStart(2, '0')}`;
      return (
        <div
          key={idx}
          className="care-step-card"
          style={{
            flexShrink: 0,
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'stretch',
            padding: '12px',
            width: 170,
            minWidth: 170,
            height: 260,
            background: '#FFFFFF',
            border: '1px solid rgba(0,0,0,.08)',
            borderRadius: 14,
            boxShadow: '0 4px 12px rgba(0,0,0,.03)',
            transition: 'all .2s ease-in-out',
            cursor: 'pointer',
          }}
        >
          {/* 이미지 영역 */}
          <div style={{
            height: 150,
            background: '#F8F8FA',
            borderRadius: 10,
            overflow: 'hidden',
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}>
            {(p?.imageUrl || p?.storageUrl)
              ? <img src={p!.imageUrl || p!.storageUrl} alt={p?.name} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', padding: 8 }} />
              : <span style={{ fontSize: 36, opacity: 0.3 }}>🧴</span>
            }
            {/* Step 뱃지 (좌상단 플로팅) */}
            <div style={{
              position: 'absolute', top: 8, left: 8,
              background: '#0C0C0A', color: '#C5FF00',
              fontFamily: f, fontWeight: 800, fontSize: 9, letterSpacing: '.06em',
              padding: '3px 8px', borderRadius: 6, lineHeight: 1
            }}>
              {stepLabel}
            </div>
          </div>
          {/* 제품 정보 영역 */}
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, justifyContent: 'space-between' }}>
            <div style={{
              fontFamily: f,
              fontWeight: 700,
              fontSize: 16, // 기존 13에서 16px로 상향
              lineHeight: '1.35',
              color: '#000000',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
            }}>
              {p?.name ?? '?'}
            </div>
            {p?.brand && (
              <div style={{
                fontFamily: f,
                fontWeight: 500,
                fontSize: 10,
                color: '#9A9490',
                textTransform: 'uppercase',
                letterSpacing: '.02em',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {p.brand}
              </div>
            )}
          </div>
        </div>
      );
    }
    
    if (item.type === 'desc') {
      const waitMins = parseWaitMinutes(item.text); // "N분" 파싱 (없으면 null)
      const isTimerCard = waitMins !== null;
      
      if (isTimerCard) {
        const isActiveTimer = timerLabel === item.text && !!timerEndMs;
        
        return (
          <div
            key={idx}
            className="care-step-card"
            onClick={() => {
              if (isActiveTimer) {
                stopTimer();
              } else {
                startTimer(item.text, waitMins);
              }
            }}
            style={{
              flexShrink: 0,
              boxSizing: 'border-box',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              padding: '16px 14px 14px',
              width: 170,
              minWidth: 170,
              height: 260,
              background: 'rgba(12,12,10,0.03)',
              border: isActiveTimer ? '2px solid #0066FF' : '1px solid rgba(12,12,10,.07)',
              borderRadius: 16,
              boxShadow: isActiveTimer ? '0 6px 18px rgba(0,0,0,.08)' : '0 4px 16px rgba(0,0,0,.04), 0 0 0 1px rgba(0,0,0,.02)',
              transition: 'all .2s ease-in-out',
              cursor: 'pointer',
              position: 'relative',
            }}
          >
            {/* 상단 고정 영역: GUIDE 뱃지 + 설명문구 */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', width: '100%' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', marginBottom: 6 }}>
                <div style={{
                  background: '#C5FF00', color: '#000000',
                  fontFamily: f, fontWeight: 800, fontSize: 9, letterSpacing: '.06em',
                  padding: '3px 8px', borderRadius: 6, lineHeight: 1
                }}>
                  {isActiveTimer ? "TAB하여 중지" : "TAB하여 실행"}
                </div>
              </div>
              {/* 상단 고정 설명문구 */}
              <div style={{
                fontFamily: f,
                fontWeight: 700,
                fontSize: 18,
                lineHeight: '1.45',
                color: '#0C0C0A',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
              }}>
                {item.text}
              </div>
            </div>

            {/* 가운데 영역: 대형 타이머 그래픽 이미지 */}
            <div style={{
              position: 'relative',
              width: 84,
              height: 84,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              alignSelf: 'center',
              margin: 'auto 0',
              transition: 'all 0.3s ease',
            }}>
              <svg width="84" height="84" viewBox="0 0 24 24" fill="none" style={{ transform: 'rotate(-90deg)' }}>
                {/* 회색 배경 링 */}
                <circle cx="12" cy="12" r="9" stroke="rgba(12,12,10,0.06)" strokeWidth="2" />
                {/* 진행률 링 */}
                <circle
                  cx="12"
                  cy="12"
                  r="9"
                  stroke={isActiveTimer ? '#C5FF00' : 'rgba(12,12,10,0.15)'}
                  strokeWidth="2"
                  strokeDasharray="56.5"
                  strokeDashoffset={isActiveTimer ? 56.5 * (1 - (timerRemainMs / (waitMins * 60_000))) : 0}
                  strokeLinecap="round"
                  style={{ transition: 'stroke-dashoffset 0.5s linear' }}
                />
              </svg>
              {/* 중앙 시계바늘 아이콘 */}
              <div style={{ position: 'absolute', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: isActiveTimer ? 1 : 0.35 }}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#0C0C0A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="12 6 12 12 16 14" />
                </svg>
              </div>
              {/* 상단 스톱워치 버튼 데코 */}
              <div style={{ position: 'absolute', top: 2, width: 8, height: 4, background: '#0C0C0A', borderRadius: '2px 2px 0 0', opacity: isActiveTimer ? 1 : 0.35 }} />
            </div>

            {/* 하단 영역: 실시간 남은 시간 또는 타이머 가이드 배너 */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
              {isActiveTimer ? (
                <div style={{
                  fontFamily: f,
                  fontWeight: 800,
                  fontSize: 24,
                  color: '#000000',
                  fontVariantNumeric: 'tabular-nums',
                  letterSpacing: '.02em',
                  lineHeight: 1
                }}>
                  {formatTimerRemain(timerRemainMs)}
                </div>
              ) : (
                <div style={{
                  fontFamily: f,
                  fontWeight: 700,
                  fontSize: 18,
                  color: '#9A9490',
                  lineHeight: '1.45',
                  textAlign: 'center'
                }}>
                  {waitMins}분
                </div>
              )}
            </div>
          </div>
        );
      } else {
        // 일반 가이드 설명 (타이머가 없는 것) -> 콤팩트한 연결 칩으로 렌더링
        return (
          <div
            key={idx}
            style={{
              flexShrink: 0,
              padding: '6px 14px',
              background: 'rgb(3, 105, 227)',
              borderRadius: 9999,
              fontSize: 12,
              fontWeight: 700,
              color: '#fff',
              fontFamily: f,
              whiteSpace: 'nowrap',
            }}
          >
            {item.text}
          </div>
        );
      }
    }
    
    if (item.type === 'tip') {
      return (
        <div
          key={idx}
          style={{
            flexShrink: 0,
            padding: '6px 14px',
            background: 'rgba(197,255,0,0.08)',
            border: '1px solid rgba(197,255,0,0.25)',
            borderRadius: 9999,
            fontSize: 12,
            fontWeight: 800,
            color: '#4E7D00',
            fontFamily: f,
            whiteSpace: 'nowrap',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          💡 {item.text || 'TIP'}
        </div>
      );
    }

    if (item.type === 'plus' || item.type === 'minus') {
      const isPlus = item.type === 'plus';
      return (
        <div
          key={idx}
          style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', width: 24 }}
        >
          <div style={{
            width: 22,
            height: 22,
            borderRadius: '50%',
            background: isPlus ? 'rgba(33,150,243,.12)' : 'rgba(249,115,22,.12)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            {isPlus ? (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <line x1="5" y1="1" x2="5" y2="9" stroke="#1976D2" strokeWidth="2" strokeLinecap="round"/>
                <line x1="1" y1="5" x2="9" y2="5" stroke="#1976D2" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            ) : (
              <svg width="12" height="10" viewBox="0 0 12 10" fill="none">
                <path d="M1 5h10M7 1l4 4-4 4" stroke="#F97316" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </div>
        </div>
      );
    }

    return null;
  }

  return (
    <>
      {/* ── 알람 배너: 타이머 종료 시 화면 최상단 고정 오버레이 ── */}
      {alarmVisible && alarmLabel && (
        <div
          className="alarm-banner-enter alarm-banner-pulse"
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
            background: '#000000',
            borderBottom: '3px solid #C5FF00',
            padding: '18px 20px 22px',
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            boxShadow: '0 6px 32px rgba(0,0,0,.8)',
          }}
        >
          {/* 닫기 버튼 — 우상단 */}
          <button
            onClick={dismissAlarm}
            style={{ position: 'absolute', top: 14, right: 16, background: 'rgba(255,255,255,.12)', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,.7)', fontSize: 18, padding: '6px 10px', borderRadius: 8, lineHeight: 1 }}
          >
            ✕
          </button>
          {/* 텍스트 영역 */}
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,.4)', marginBottom: 4 }}>
              대기 완료
            </div>
            <div style={{ fontFamily: f, fontSize: 17, fontWeight: 600, color: '#fff', lineHeight: 1.3 }}>
              {alarmLabel}
            </div>
          </div>
          {/* 대형 벨 아이콘 — 텍스트 하단 */}
          <div style={{ width: 72, height: 72, borderRadius: '50%', background: '#C5FF00', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
          </div>
        </div>
      )}

      <div>
        <SectionHeader title="#Intensive Care" />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '0 26px' }}>
        <style>{`
          .care-step-card:hover {
            transform: translateY(-4px);
            border-color: #0C0C0A !important;
            box-shadow: 0 10px 22px rgba(0, 0, 0, 0.08) !important;
          }
        `}</style>

        {items.map((item) => (
          <div
            key={item.id}
            style={{
              background: '#fff',
              borderRadius: 24,
              overflow: 'hidden',
              boxShadow: '0 4px 24px rgba(0,0,0,.06), 0 0 0 1px rgba(0,0,0,.03)',
              border: '1px solid rgba(0,0,0,.02)',
            }}
          >
            {/* 헤더 영역 */}
            {item.imageUrl ? (
              <div style={{ position: 'relative', width: '100%' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={item.imageUrl} alt={item.name} style={{ width: '100%', height: 'auto', display: 'block' }} />
                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '70%', background: 'linear-gradient(to top, rgba(0,0,0,.8) 0%, transparent 100%)', pointerEvents: 'none' }} />
                {/* 배지 & 타이틀 */}
                <div style={{ position: 'absolute', bottom: 16, left: 20, right: 20, zIndex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' as const, marginBottom: 8 }}>
                    <div style={{
                      display: 'inline-block',
                      background: '#C5FF00', color: '#000',
                      fontFamily: f, fontWeight: 900, fontSize: 9, letterSpacing: '.12em',
                      padding: '4px 8px', borderRadius: 4, lineHeight: 1
                    }}>
                      INTENSIVE PROGRAM
                    </div>
                  </div>
                  <div style={{ fontFamily: f, fontSize: 22, fontWeight: 800, color: '#fff', letterSpacing: '-.02em', lineHeight: 1.2, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const }}>
                    {item.category && (
                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        background: 'rgba(255,255,255,0.25)', color: '#fff',
                        fontFamily: f, fontWeight: 800, fontSize: 10, letterSpacing: '.06em',
                        padding: '3px 7px', borderRadius: 4, lineHeight: 1.1, backdropFilter: 'blur(4px)',
                        flexShrink: 0
                      }}>
                        {item.category}
                      </span>
                    )}
                    <span>{item.emoji} {item.name}</span>
                  </div>
                  {item.desc && (
                    <div style={{ fontFamily: f, fontSize: 13, color: 'rgba(255,255,255,0.8)', marginTop: 4, fontWeight: 500 }}>
                      {item.desc}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div style={{
                background: 'linear-gradient(135deg, #1A1C20 0%, #0F1113 100%)',
                padding: '24px 20px',
                position: 'relative',
                overflow: 'hidden'
              }}>
                <div style={{
                  position: 'absolute', top: '-20%', right: '-10%', width: '120px', height: '120px',
                  background: 'rgba(197, 255, 0, 0.12)', borderRadius: '50%', filter: 'blur(30px)'
                }} />
                <div style={{ position: 'relative', zIndex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' as const, marginBottom: 8 }}>
                    <div style={{
                      display: 'inline-block',
                      background: '#C5FF00', color: '#000',
                      fontFamily: f, fontWeight: 900, fontSize: 9, letterSpacing: '.12em',
                      padding: '4px 8px', borderRadius: 4, lineHeight: 1
                    }}>
                      INTENSIVE PROGRAM
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {item.category && (
                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        background: 'rgba(197, 255, 0, 0.15)', color: '#C5FF00',
                        fontFamily: f, fontWeight: 800, fontSize: 10, letterSpacing: '.06em',
                        padding: '3px 7px', borderRadius: 4, lineHeight: 1.1,
                        flexShrink: 0
                      }}>
                        {item.category}
                      </span>
                    )}
                    <span style={{ fontSize: 24 }}>{item.emoji}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: f, fontSize: 20, fontWeight: 800, color: '#FFFFFF', letterSpacing: '-.01em' }}>
                        {item.name}
                      </div>
                      {item.desc && (
                        <div style={{ fontFamily: f, fontSize: 13, color: '#9CA3AF', marginTop: 4, fontWeight: 500 }}>
                          {item.desc}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
            {/* 메인 루틴 카드 가로 스크롤 */}
            {item.items.length > 0 && (() => {
              const hasThisTimer = item.items.some(r => r.type === 'desc' && r.text === timerLabel);
              return (
                <div style={{ padding: '20px', borderBottom: '1px solid rgba(12,12,10,.04)' }}>
                  <div style={{
                    fontFamily: f, fontSize: 10, fontWeight: 800, letterSpacing: '.12em', color: '#9CA3AF',
                    textTransform: 'uppercase', marginBottom: 12
                  }}>
                    Routine Steps
                  </div>
                  <div style={{ display: 'flex', overflowX: 'auto', scrollbarWidth: 'none', gap: 8, alignItems: 'center', paddingTop: 10, paddingBottom: 10 }}>
                    {item.items.map((r, i) => renderChip(r, i, item.items))}
                  </div>

                  {/* 대기 타이머 배너 */}
                  {timerEndMs && timerLabel && hasThisTimer && (
                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      marginTop: 14,
                      padding: '10px 14px',
                      background: '#0C0C0A',
                      border: '1.5px solid #C5FF00',
                      borderRadius: 12,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{
                          width: 7, height: 7, borderRadius: '50%', background: '#C5FF00',
                          display: 'inline-block',
                          boxShadow: '0 0 0 3px rgba(197,255,0,.3)',
                          flexShrink: 0,
                        }} />
                        <span style={{ fontFamily: f, fontSize: 12, color: 'rgba(255,255,255,.7)' }}>
                          {timerLabel}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontFamily: f, fontSize: 22, fontWeight: 800, color: '#C5FF00', fontVariantNumeric: 'tabular-nums', letterSpacing: '.06em' }}>
                          {formatTimerRemain(timerRemainMs)}
                        </span>
                        <button
                          onClick={() => stopTimer()}
                          style={{ background: 'rgba(255,255,255,.08)', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,.45)', fontSize: 13, padding: '3px 7px', borderRadius: 6, lineHeight: 1 }}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* TIP 루틴 세로 스택형 Rich List */}
            {(item.tipItems?.length ?? 0) > 0 && (
              <div style={{ padding: '20px', borderBottom: '1px dashed rgba(12,12,10,.05)', background: '#FAFBF9' }}>
                <div style={{
                  fontFamily: f, fontSize: 10, fontWeight: 800, letterSpacing: '.12em', color: '#4E7D00',
                  textTransform: 'uppercase', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6
                }}>
                  <span style={{ fontSize: 13 }}>💡</span> Tips & Special Care
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {(item.tipItems ?? []).map((r, idx) => {
                    if (r.type === 'product') {
                      const p = products.get(r.id);
                      const imgUrl = p?.imageUrl || p?.storageUrl;
                      return (
                        <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: '#FFFFFF', borderRadius: 14, border: '1px solid rgba(33,133,253,0.12)', boxShadow: '0 2px 8px rgba(0,0,0,0.01)' }}>
                          <div style={{ width: 40, height: 40, borderRadius: 8, background: '#F3F4F6', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            {imgUrl ? <img src={imgUrl} alt={p?.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: 18 }}>🧴</span>}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontFamily: f, fontSize: 9, fontWeight: 800, color: '#2185fd', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 2 }}>MAPPED PRODUCT</div>
                            <div style={{ fontFamily: f, fontSize: 13, fontWeight: 700, color: '#1A1C1E', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p?.name ?? '?'}</div>
                          </div>
                        </div>
                      );
                    }
                    if (r.type === 'tip') {
                      return (
                        <div key={idx} style={{ display: 'flex', gap: 10, padding: '14px 16px', background: 'rgba(197,255,0,0.05)', borderRadius: 14, border: '1px solid rgba(197,255,0,0.25)', boxShadow: '0 2px 8px rgba(0,0,0,0.01)' }}>
                          <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>💡</span>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontFamily: f, fontSize: 9, fontWeight: 800, color: '#4E7D00', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 2 }}>SPECIAL TIP</div>
                            <div style={{ fontFamily: f, fontSize: 13, fontWeight: 600, color: '#2C3A1A', lineHeight: 1.45 }}>{r.text}</div>
                          </div>
                        </div>
                      );
                    }
                    if (r.type === 'desc') {
                      return (
                        <div key={idx} style={{ display: 'flex', gap: 10, padding: '14px 16px', background: '#FFFFFF', borderRadius: 14, border: '1px solid rgba(0,0,0,0.05)', boxShadow: '0 2px 8px rgba(0,0,0,0.01)' }}>
                          <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>📋</span>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontFamily: f, fontSize: 9, fontWeight: 800, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 2 }}>NOTICE / DETAILS</div>
                            <div style={{ fontFamily: f, fontSize: 13, fontWeight: 500, color: '#374151', lineHeight: 1.45 }}>{r.text}</div>
                          </div>
                        </div>
                      );
                    }
                    return null;
                  })}
                </div>
              </div>
            )}

            {/* EXPERT TIP */}
            {item.expertTip && (
              <div style={{ padding: '20px 20px 24px' }}>
                <div style={{
                  position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                  padding: '20px 24px', gap: 6, background: '#FAFAFA', border: '1px solid #E4E4E7',
                  borderRadius: 16, overflow: 'visible'
                }}>
                  <svg width="29" height="27" viewBox="0 0 29 27" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ position: 'absolute', left: -8, top: -8, zIndex: 2 }}>
                    <path d="M6 26.982C4.875 26.982 3.7625 26.707 2.6625 26.157C1.5625 25.607 0.675 24.882 0 23.982C0.65 23.982 1.3125 23.7257 1.9875 23.2132C2.6625 22.7007 3 21.957 3 20.982C3 19.732 3.4375 18.6695 4.3125 17.7945C5.1875 16.9195 6.25 16.482 7.5 16.482C8.75 16.482 9.8125 16.9195 10.6875 17.7945C11.5625 18.6695 12 19.732 12 20.982C12 22.632 11.4125 24.0445 10.2375 25.2195C9.0625 26.3945 7.65 26.982 6 26.982ZM6 23.982C6.825 23.982 7.53125 23.6882 8.11875 23.1007C8.70625 22.5133 9 21.807 9 20.982C9 20.557 8.85625 20.2008 8.56875 19.9132C8.28125 19.6257 7.925 19.482 7.5 19.482C7.075 19.482 6.71875 19.6257 6.43125 19.9132C6.14375 20.2008 6 20.557 6 20.982C6 21.557 5.93125 22.082 5.79375 22.557C5.65625 23.032 5.475 23.482 5.25 23.907C5.375 23.957 5.5 23.982 5.625 23.982C5.75 23.982 5.875 23.982 6 23.982ZM14.625 17.982L10.5 13.857L23.925 0.432C24.2 0.157 24.5437 0.01325 24.9562 0.00075C25.3687 -0.01175 25.725 0.132 26.025 0.432L28.05 2.457C28.35 2.757 28.5 3.107 28.5 3.507C28.5 3.907 28.35 4.257 28.05 4.557L14.625 17.982Z" fill="#0C0C0A"/>
                  </svg>
                  <div style={{ fontFamily: f, fontWeight: 900, fontSize: 10, letterSpacing: 1.2, color: '#A1A1AA', textTransform: 'uppercase' }}>Expert Advice</div>
                  <div style={{ fontFamily: "'Nanum Pen Script',cursive", fontWeight: 500, fontSize: 22, lineHeight: '28px', color: '#27272A', alignSelf: 'stretch', zIndex: 1 }}>
                    {highlightProductNames(item.expertTip, products)}
                  </div>
                </div>
              </div>
            )}

            {/* 참고 링크 */}
            {item.sourceUrl && <SourceLink url={item.sourceUrl} />}

            {/* 카드 하단 메뉴 */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid rgba(12,12,10,.05)', padding: '12px 20px', background: '#FAFBFB' }}>
              <Link href="/setup#care" style={{ fontFamily: f, fontSize: 11, fontWeight: 700, color: '#9CA3AF', textDecoration: 'none', letterSpacing: '.06em', textTransform: 'uppercase' }}>
                Edit Program →
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
    </>
  );
}

// ─── MOTD 섹션 (#MOTD) ──────────────────────────────────────────────────────
// design/today.html #motd-editorial-section 구조 기반
// Hero: 1:1 square + "EDITORIAL CHOICE" 배지 / Products: ed-prod-grid (카테고리+이름)

function MakeupSection({ items, products }: { items: CtItem[]; products: Map<string, Product> }) {
  const f = "'Plus Jakarta Sans', 'Space Grotesk', sans-serif";
  return (
    <div>
      <SectionHeader title="#MOTD" />
      {items.length === 0 && (
        <div style={{ margin: '0 26px', padding: '20px 26px', background: '#fff', borderRadius: 20, boxShadow: '0 2px 16px rgba(0,0,0,.07),0 0 0 1px rgba(0,0,0,.04)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 28 }}>💄</span>
          <div style={{ fontFamily: f, fontSize: 13, fontWeight: 700, color: '#0C0C0A' }}>오늘의 메이크업을 등록해보세요</div>
          <div style={{ fontFamily: f, fontSize: 12, color: '#9A9490' }}>Setup에서 Today ON으로 설정하면 여기에 표시됩니다</div>
          <Link href="/log?tab=라이브러리&filter=makeup" style={{ fontFamily: f, fontSize: 13, fontWeight: 600, color: '#9A9490', textDecoration: 'none', marginTop: 4 }}>List →</Link>
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '0 26px' }}>
        {items.map((item) => {
          const prodIds = item.items
            .filter((r): r is { type: 'product'; id: string } => r.type === 'product')
            .map((r) => r.id);
          return (
            <div key={item.id} style={{ background: '#fff', borderRadius: 20, overflow: 'hidden', boxShadow: '0 2px 16px rgba(0,0,0,.07),0 0 0 1px rgba(0,0,0,.04)' }}>

              {/* Hero — 이미지 있을 때만 1:1 square (today.html .editorial-hero 참고) */}
              {item.imageUrl ? (
                <Link href={`/log?tab=라이브러리&filter=makeup&id=${item.id}`} style={{ display: 'block', textDecoration: 'none' }}>
                  <div style={{ position: 'relative', width: '100%' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={item.imageUrl} alt={item.name} style={{ width: '100%', height: 'auto', display: 'block' }} />
                    {/* "EDITORIAL CHOICE" 배지 (우상단) */}
                    <div style={{ position: 'absolute', top: 14, right: 14, background: 'rgba(0,0,0,.55)', backdropFilter: 'blur(6px)', borderRadius: 6, padding: '4px 10px', fontFamily: f, fontSize: 10, fontWeight: 700, letterSpacing: '.12em', color: '#fff', textTransform: 'uppercase' as const }}>
                      EDITORIAL CHOICE
                    </div>
                    {/* 하단 그라데이션 + 이름 */}
                    <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '40px 14px 14px', background: 'linear-gradient(to top, rgba(0,0,0,.6) 0%, transparent 60%)', pointerEvents: 'none' }}>
                      <div style={{ fontFamily: f, fontSize: 18, fontWeight: 800, color: '#fff', letterSpacing: '-.02em', lineHeight: 1.2 }}>{item.name}</div>
                      {item.desc && <div style={{ fontFamily: f, fontSize: 12, color: 'rgba(255,255,255,.7)', marginTop: 3 }}>{item.desc}</div>}
                    </div>
                  </div>
                </Link>
              ) : (
                /* 이미지 없을 때 — 텍스트 제목 */
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 26px 0' }}>
                  <span style={{ fontSize: 22, flexShrink: 0 }}>{item.emoji || '💄'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: f, fontSize: 15, fontWeight: 800, color: '#0C0C0A', letterSpacing: '-.01em' }}>{item.name}</div>
                    {item.desc && <div style={{ fontFamily: f, fontSize: 12, color: '#9A9490', marginTop: 2 }}>{item.desc}</div>}
                  </div>
                </div>
              )}

              {/* 제품 가로 스크롤 — 항상 동일 구분선·여백으로 첫 제품 위치 고정 */}
              {prodIds.length > 0 && (
                <div className="hide-scrollbar" style={{ display: 'flex', overflowX: 'auto', scrollbarWidth: 'none' as const, gap: 8, padding: '12px 0', scrollSnapType: 'x mandatory' as const, scrollPaddingLeft: 16, borderTop: '1px solid rgba(12,12,10,.08)' }}>
                  <div style={{ flexShrink: 0, width: 16 }} />
                  {prodIds.map((pid) => {
                    const p = products.get(pid);
                    const imgUrl = p?.imageUrl || p?.storageUrl;
                    return (
                      <div key={pid} style={{ flexShrink: 0, width: 120, scrollSnapAlign: 'start' as const }}>
                        <div style={{ width: 120, height: 160, background: '#F3F3F4', borderRadius: 4, border: '1px solid #E4E4E7', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                          {imgUrl
                            // eslint-disable-next-line @next/next/no-img-element
                            ? <img src={imgUrl} alt={p?.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                            : <span style={{ fontSize: 24, opacity: 0.3 }}>💄</span>
                          }
                        </div>
                      </div>
                    );
                  })}
                  <div style={{ flexShrink: 0, width: 16 }} />
                </div>
              )}

              {/* TIPS */}
              {item.expertTip && (
                <div style={{ padding: '8px 26px 20px' }}>
                  <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', padding: 24, gap: 8, background: '#FAFAFA', border: '1px solid #E4E4E7', borderRadius: 16, overflow: 'visible' }}>
                    <svg width="29" height="27" viewBox="0 0 29 27" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ position: 'absolute', left: -8, top: -8, zIndex: 2 }}>
                      <path d="M6 26.982C4.875 26.982 3.7625 26.707 2.6625 26.157C1.5625 25.607 0.675 24.882 0 23.982C0.65 23.982 1.3125 23.7257 1.9875 23.2132C2.6625 22.7007 3 21.957 3 20.982C3 19.732 3.4375 18.6695 4.3125 17.7945C5.1875 16.9195 6.25 16.482 7.5 16.482C8.75 16.482 9.8125 16.9195 10.6875 17.7945C11.5625 18.6695 12 19.732 12 20.982C12 22.632 11.4125 24.0445 10.2375 25.2195C9.0625 26.3945 7.65 26.982 6 26.982ZM6 23.982C6.825 23.982 7.53125 23.6882 8.11875 23.1007C8.70625 22.5133 9 21.807 9 20.982C9 20.557 8.85625 20.2008 8.56875 19.9132C8.28125 19.6257 7.925 19.482 7.5 19.482C7.075 19.482 6.71875 19.6257 6.43125 19.9132C6.14375 20.2008 6 20.557 6 20.982C6 21.557 5.93125 22.082 5.79375 22.557C5.65625 23.032 5.475 23.482 5.25 23.907C5.375 23.957 5.5 23.982 5.625 23.982C5.75 23.982 5.875 23.982 6 23.982ZM14.625 17.982L10.5 13.857L23.925 0.432C24.2 0.157 24.5437 0.01325 24.9562 0.00075C25.3687 -0.01175 25.725 0.132 26.025 0.432L28.05 2.457C28.35 2.757 28.5 3.107 28.5 3.507C28.5 3.907 28.35 4.257 28.05 4.557L14.625 17.982Z" fill="#0C0C0A"/>
                    </svg>
                    <div style={{ fontFamily: "'Plus Jakarta Sans',sans-serif", fontWeight: 900, fontSize: 10, lineHeight: '15px', letterSpacing: 1, color: '#A1A1AA', alignSelf: 'stretch', zIndex: 1 }}>TIPS</div>
                    <div style={{ fontFamily: "'Nanum Pen Script',cursive", fontWeight: 500, fontSize: 22, lineHeight: '28px', color: '#27272A', alignSelf: 'stretch', zIndex: 1 }}>
                      {highlightProductNames(item.expertTip, products)}
                    </div>
                  </div>
                </div>
              )}

              {/* 참고 링크 */}
              <SourceLink url={item.sourceUrl} />

              {/* 카드 하단: List → LOG 라이브러리 (OOTD 동일 패턴) */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '10px 26px 12px', borderTop: '1px solid rgba(12,12,10,.06)' }}>
                <Link href="/log?tab=라이브러리&filter=makeup" style={{ fontFamily: f, fontSize: 12, fontWeight: 700, color: '#BCBAB6', textDecoration: 'none', letterSpacing: '.04em' }}>List →</Link>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── OOTD 기록 바텀 시트 ──────────────────────────────────────────────────────

function OOTDRecordSheet({
  open,
  onClose,
  ootdLog,
  theme,
  onThemeChange,
  note,
  onNoteChange,
  photoPreview,
  onPhotoApply,
  onSave,
  onDelete,
  saving,
  tags,
  onTagsChange,
}: {
  open: boolean;
  onClose: () => void;
  ootdLog: OOTDLog | null;
  theme: string;
  onThemeChange: (v: string) => void;
  note: string;
  onNoteChange: (v: string) => void;
  photoPreview: string;
  onPhotoApply: (file: File, base64: string) => void;
  onSave: () => void;
  onDelete: () => void;
  saving: boolean;
  tags: string[];
  onTagsChange: (tags: string[]) => void;
}) {
  const f = "'Plus Jakarta Sans', 'Space Grotesk', sans-serif";

  // 태그 편집 시트 상태
  const [tagEditOpen, setTagEditOpen] = useState(false);
  const [newTagInput, setNewTagInput] = useState('');

  // 드래그 앤 드롭 상태
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // 터치 드래그용 ref
  const touchDragIdxRef = useRef<number | null>(null);
  const touchStartYRef = useRef(0);

  function moveTag(from: number, to: number) {
    const next = [...tags];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onTagsChange(next);
  }

  // 터치 드래그 핸들러
  function handleTouchStart(e: React.TouchEvent, idx: number) {
    touchDragIdxRef.current = idx;
    touchStartYRef.current = e.touches[0].clientY;
    setDragIdx(idx);
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (touchDragIdxRef.current === null) return;
    e.preventDefault();
    const y = e.touches[0].clientY;
    const items = document.querySelectorAll('[data-ootd-tag-idx]');
    let overIdx: number | null = null;
    items.forEach((el) => {
      const rect = el.getBoundingClientRect();
      const idxAttr = el.getAttribute('data-ootd-tag-idx');
      if (idxAttr !== null && y >= rect.top && y <= rect.bottom) {
        overIdx = parseInt(idxAttr, 10);
      }
    });
    if (overIdx !== null) setDragOverIdx(overIdx);
  }

  function handleTouchEnd() {
    if (touchDragIdxRef.current !== null && dragOverIdx !== null && touchDragIdxRef.current !== dragOverIdx) {
      moveTag(touchDragIdxRef.current, dragOverIdx);
    }
    touchDragIdxRef.current = null;
    setDragIdx(null);
    setDragOverIdx(null);
  }

  return (
    <>
      {/* 백드롭 */}
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 100, opacity: open ? 1 : 0, pointerEvents: open ? 'auto' : 'none', transition: 'opacity .3s' }}
      />

      {/* 시트 — 앱 컨테이너(430px) 폭에 맞춤 */}
      <div
        style={{ position: 'fixed', bottom: 0, left: '50%', transform: open ? 'translateX(-50%) translateY(0)' : 'translateX(-50%) translateY(100%)', width: '100%', maxWidth: 430, background: '#fff', borderRadius: '24px 24px 0 0', padding: '24px 20px calc(env(safe-area-inset-bottom, 0px) + 40px)', zIndex: 101, transition: 'transform .35s cubic-bezier(.4,0,.2,1)', maxHeight: '85vh', overflowY: 'auto' }}
      >
        {/* 핸들 */}
        <div style={{ width: 32, height: 4, background: '#E5E7EB', borderRadius: 9999, margin: '0 auto 20px' }} />

        {/* 제목 */}
        <div style={{ fontFamily: f, fontSize: 22, fontWeight: 800, color: '#0C1014', marginBottom: 16 }}>
          오늘의 룩 기록
        </div>

        {/* 태그 선택 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ fontFamily: f, fontSize: 13, fontWeight: 600, color: '#9A9490' }}>태그</div>
          <button
            type="button"
            onClick={() => setTagEditOpen(true)}
            style={{ fontFamily: f, fontSize: 10, fontWeight: 800, color: '#C5FF00', background: '#0C0C0A', border: '2px solid #0066FF', borderRadius: 9999, padding: '5px 12px', cursor: 'pointer', letterSpacing: '.08em' }}
          >
            태그 편집
          </button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
          {tags.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onThemeChange(theme === t ? '' : t)}
              style={{ padding: '5px 14px', borderRadius: 9999, border: `1.5px solid ${theme === t ? '#0A0A0A' : 'rgba(12,12,10,.14)'}`, background: theme === t ? '#0A0A0A' : 'transparent', color: theme === t ? '#C5FF00' : '#0C0C0A', fontFamily: f, fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'all .15s' }}
            >
              {t}
            </button>
          ))}
          {tags.length === 0 && (
            <div style={{ fontFamily: f, fontSize: 12, color: '#BCBAB6' }}>태그 없음 — 편집에서 추가해주세요</div>
          )}
        </div>

        {/* 이미지 */}
        <div style={{ fontFamily: f, fontSize: 13, fontWeight: 600, color: '#9A9490', marginBottom: 8 }}>
          이미지
        </div>
        <div style={{ marginBottom: 12 }}>
          <ImagePicker
            preview={photoPreview}
            onChange={onPhotoApply}
            height={260}
            placeholderLabel="OOTD 이미지"
            isOpen={open}
          />
        </div>

        {/* 메모 */}
        <div style={{ fontFamily: f, fontSize: 13, fontWeight: 600, color: '#9A9490', marginBottom: 8 }}>
          메모 <span style={{ fontWeight: 400 }}>선택</span>
        </div>
        <textarea
          value={note}
          onChange={(e) => onNoteChange(e.target.value)}
          placeholder="오늘의 룩 메모…"
          style={{ width: '100%', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 12, padding: '11px 14px', fontFamily: f, fontSize: 14, color: '#0C1014', resize: 'none', height: 64, outline: 'none', boxSizing: 'border-box', marginBottom: 16 }}
        />

        {/* 삭제 버튼 (수정 모드) */}
        {ootdLog && (
          <button
            type="button"
            onClick={onDelete}
            style={{ width: '100%', height: 44, background: 'none', border: '1.5px solid #fee2e2', color: '#ef4444', borderRadius: 12, fontFamily: f, fontSize: 13, fontWeight: 700, cursor: 'pointer', marginBottom: 10 }}
          >
            기록 삭제
          </button>
        )}

        {/* 취소 / 저장 버튼 */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={onClose}
            style={{ flex: 1, height: 52, background: '#F4F4F0', color: '#0C0C0A', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 12, fontFamily: f, fontSize: 15, fontWeight: 600, cursor: 'pointer' }}
          >
            취소
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            style={{ flex: 1, height: 52, background: '#0A0A0A', color: '#fff', border: 'none', borderRadius: 12, fontFamily: f, fontSize: 15, fontWeight: 700, cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.7 : 1 }}
          >
            {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>

      {/* 태그 편집 서브 시트 */}
      {tagEditOpen && (
        <>
          <div onClick={() => setTagEditOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 102 }} />
          <div style={{ position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: 430, zIndex: 103, background: '#FAFAF8', borderRadius: '20px 20px 0 0', padding: '10px 20px calc(env(safe-area-inset-bottom, 0px) + 24px)', maxHeight: '75%', overflowY: 'auto', boxShadow: '0 -4px 40px rgba(0,0,0,.12)' }}>
            <div style={{ width: 32, height: 3, background: 'rgba(12,12,10,.14)', borderRadius: 2, margin: '0 auto 20px' }} />

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <span style={{ fontFamily: f, fontSize: 18, fontWeight: 800, color: '#0C0C0A' }}>태그 관리</span>
              <button onClick={() => setTagEditOpen(false)} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#9A9490' }}>✕</button>
            </div>

            {/* 현재 태그 목록 (드래그 앤 드롭) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
              {tags.map((tag, idx) => {
                const isDragging = dragIdx === idx;
                const isDragOver = dragOverIdx === idx;
                return (
                  <div
                    key={tag}
                    data-ootd-tag-idx={idx}
                    onDragOver={e => { e.preventDefault(); if (dragOverIdx !== idx) setDragOverIdx(idx); }}
                    onDrop={e => {
                      e.preventDefault();
                      if (dragIdx !== null && dragIdx !== idx) moveTag(dragIdx, idx);
                      setDragIdx(null); setDragOverIdx(null);
                    }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      opacity: isDragging ? 0.4 : 1,
                      outline: isDragOver ? '2px dashed #C5FF00' : 'none',
                      outlineOffset: 2,
                      borderRadius: 14,
                      transition: 'opacity .15s, outline .1s',
                      userSelect: dragIdx !== null ? 'none' : 'auto',
                    }}
                  >
                    {/* 삭제 버튼 */}
                    <button
                      type="button"
                      onClick={() => onTagsChange(tags.filter((_, i) => i !== idx))}
                      style={{ width: 22, height: 22, minWidth: 22, borderRadius: '50%', background: '#E94F6B', color: '#fff', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 800, cursor: 'pointer', flexShrink: 0, padding: 0, lineHeight: '22px' }}
                    >
                      -
                    </button>
                    {/* 태그 라벨 */}
                    <div style={{ flex: 1, padding: '12px 16px', background: '#fff', borderRadius: 14, border: '1px solid rgba(12,12,10,.06)', boxShadow: '0 1px 2px rgba(0,0,0,.04)', fontFamily: f, fontSize: 14, fontWeight: 600, color: '#0C0C0A' }}>
                      {tag}
                    </div>
                    {/* 드래그 핸들 */}
                    <div
                      draggable
                      onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; setDragIdx(idx); }}
                      onDragEnd={() => { setDragIdx(null); setDragOverIdx(null); }}
                      onTouchStart={e => handleTouchStart(e, idx)}
                      onTouchMove={handleTouchMove}
                      onTouchEnd={handleTouchEnd}
                      onTouchCancel={handleTouchEnd}
                      style={{ fontSize: 18, color: '#BCBAB6', cursor: 'grab', padding: '4px 6px', flexShrink: 0, touchAction: 'none', userSelect: 'none' }}
                    >
                      ☰
                    </div>
                  </div>
                );
              })}
              {tags.length === 0 && (
                <div style={{ textAlign: 'center', padding: '16px 0', fontSize: 13, color: '#9A9490', fontFamily: f }}>등록된 태그가 없습니다.</div>
              )}
            </div>

            {/* 새 태그 입력 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input
                type="text"
                value={newTagInput}
                onChange={e => setNewTagInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    const cleaned = newTagInput.trim();
                    if (!cleaned || tags.includes(cleaned)) return;
                    onTagsChange([...tags, cleaned]);
                    setNewTagInput('');
                  }
                }}
                placeholder="새 태그 입력... (Enter 또는 추가 버튼)"
                maxLength={12}
                style={{ width: '100%', padding: '12px 14px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 12, fontFamily: f, fontSize: 14, color: '#0C0C0A', background: '#fff', outline: 'none', boxSizing: 'border-box' }}
              />
              <button
                type="button"
                onClick={() => {
                  const cleaned = newTagInput.trim();
                  if (!cleaned) return;
                  if (tags.includes(cleaned)) { alert('이미 존재하는 태그입니다.'); return; }
                  onTagsChange([...tags, cleaned]);
                  setNewTagInput('');
                }}
                style={{ width: '100%', padding: '14px', background: '#4F7DEC', color: '#fff', border: 'none', borderRadius: 16, fontFamily: f, fontSize: 14, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, boxShadow: '0 4px 12px rgba(79,125,236,.2)' }}
              >
                + 태그 추가
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}

// ─── 메인 페이지 컴포넌트 ─────────────────────────────────────────────────────

export default function TodayPage() {
  const today = new Date();
  const router = useRouter();

  // 온보딩 미완료 시 /onboarding으로 이동
  useEffect(() => {
    if (typeof window !== 'undefined' && !localStorage.getItem('onstep_onboarded')) {
      router.replace('/onboarding');
    }
  }, [router]);

  // ── 공유 컨텍스트 (auth + 공유 구독 — layout에서 1회 실행, 탭 전환 시 즉시) ──
  const { user, userId: ctxUserId, authLoading, dataReady, products: ctxProducts, sessions, habits: ctxHabits, careItems: ctxCareItems, makeupItems: ctxMakeupItems, lookItems: ctxLookItems, medRoutines, healthRoutines, dietPrograms } = useAppContext();
  const products = new Map(ctxProducts.map((p) => [p.id, p]));

  // ── 데이터 상태 ──
  const [dataLoading, setDataLoading] = useState(!dataReady);

  // ── UI 상태 ──
  // 04:00~17:59 → MORNING, 18:00~03:59 → NIGHT
  const [activeTab, setActiveTab] = useState<'morning' | 'evening'>(() => {
    const h = new Date().getHours();
    return h >= 4 && h < 18 ? 'morning' : 'evening';
  });
  const [checked, setChecked] = useState<CheckState>({ morning: false, evening: false });
  const [saving, setSaving] = useState(false);

  const habits = ctxHabits;

  // ── 습관 상태 ──
  const [habitChecked, setHabitChecked] = useState<Set<string>>(new Set());
  const [habitLogs, setHabitLogs] = useState<{ id: string; habitId: string }[]>([]);
  const [healthChecked, setHealthChecked] = useState<Set<string>>(new Set());
  const [healthLogs, setHealthLogs] = useState<{ id: string; routineId: string }[]>([]);
  const [medChecked, setMedChecked] = useState<Set<string>>(new Set());
  const [medLogs, setMedLogs] = useState<{ id: string; routineId: string }[]>([]);
  const [dietChecked, setDietChecked] = useState<Set<string>>(new Set()); // "programId:slotId"
  const [dietLogs, setDietLogs] = useState<{ id: string; programId: string; slotId: string }[]>([]);

  // ── 날짜 변경 감지 (자정 리셋) + 스킨케어 탭 자동 전환 ──
  // todayKey: 자정에 업데이트 → 모든 루틴(습관/약/건강/OOTD/스킨케어 모닝) 리셋
  // nightKey: 04:00에 업데이트 → 스킨케어 나이트만 리셋 (18:00~04:00 나이트 구간 종료)
  // activeTab: 04:00 → 'morning', 18:00 → 'evening' 자동 전환
  const [todayKey, setTodayKey] = useState(() => getTodayDateStr());
  const [nightKey, setNightKey] = useState(() => getEveningDateStr());
  useEffect(() => {
    function calcTab() {
      const h = new Date().getHours();
      return h >= 4 && h < 18 ? 'morning' as const : 'evening' as const;
    }
    function bumpDate() {
      setTodayKey(getTodayDateStr());
      setNightKey(getEveningDateStr());
    }
    function bumpNight() {
      // 04:00 — 나이트 루틴 구간 종료, 탭을 모닝으로 전환
      setNightKey(getEveningDateStr());
      setActiveTab('morning');
    }
    function bumpEvening() {
      // 18:00 — 모닝 루틴 구간 종료, 탭을 나이트로 전환
      setActiveTab('evening');
    }
    function handleVisibility() {
      if (document.visibilityState === 'visible') {
        setTodayKey(getTodayDateStr());
        setNightKey(getEveningDateStr());
        setActiveTab(calcTab()); // 포그라운드 복귀 시 현재 시간 기준으로 탭 재계산
      }
    }
    document.addEventListener('visibilitychange', handleVisibility);

    // 자정 타이머 — 모든 루틴 리셋
    let midnightTimer: ReturnType<typeof setTimeout>;
    function scheduleMidnight() {
      const now = new Date();
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      const msLeft = midnight.getTime() - now.getTime();
      midnightTimer = setTimeout(() => { bumpDate(); scheduleMidnight(); }, msLeft);
    }
    scheduleMidnight();

    // 04:00 타이머 — 나이트 스킨케어 리셋 + 모닝 탭 전환
    let nightTimer: ReturnType<typeof setTimeout>;
    function schedule4AM() {
      const now = new Date();
      let next4 = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 4, 0, 0, 0);
      if (now >= next4) next4.setDate(next4.getDate() + 1);
      const msLeft = next4.getTime() - now.getTime();
      nightTimer = setTimeout(() => { bumpNight(); schedule4AM(); }, msLeft);
    }
    schedule4AM();

    // 18:00 타이머 — 모닝 구간 종료, 이브닝 탭 전환
    let eveningTimer: ReturnType<typeof setTimeout>;
    function schedule18() {
      const now = new Date();
      let next18 = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 18, 0, 0, 0);
      if (now >= next18) next18.setDate(next18.getDate() + 1);
      const msLeft = next18.getTime() - now.getTime();
      eveningTimer = setTimeout(() => { bumpEvening(); schedule18(); }, msLeft);
    }
    schedule18();

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      clearTimeout(midnightTimer);
      clearTimeout(nightTimer);
      clearTimeout(eveningTimer);
    };
  }, []);

  // ── OOTD 상태 ──
  const [ootdLog, setOotdLog] = useState<OOTDLog | null>(null);
  const [ootdSheetOpen, setOotdSheetOpen] = useState(false);
  const [ootdTheme, setOotdTheme] = useState('');
  const [ootdNote, setOotdNote] = useState('');
  const [ootdPhotoFile, setOotdPhotoFile] = useState<File | null>(null);
  const [ootdPhotoPreview, setOotdPhotoPreview] = useState('');
  const [ootdSaving, setOotdSaving] = useState(false);

  // ── OOTD 태그 목록 (localStorage에 저장, 없으면 기본값) ──
  const [ootdTags, setOotdTags] = useState<string[]>(() => {
    if (typeof window === 'undefined') return DEFAULT_OOTD_TAGS;
    try {
      const saved = localStorage.getItem('onstep_ootd_tags');
      return saved ? JSON.parse(saved) : DEFAULT_OOTD_TAGS;
    } catch { return DEFAULT_OOTD_TAGS; }
  });

  function saveOotdTags(tags: string[]) {
    setOotdTags(tags);
    localStorage.setItem('onstep_ootd_tags', JSON.stringify(tags));
  }

  // ── CT 섹션 (공유 컨텍스트에서) ──
  const careItems = ctxCareItems;
  const makeupItems = ctxMakeupItems;
  const lookItems = ctxLookItems;

  // ── 계산된 값 (파생 상태) ──
  // 오늘 날짜가 포함된 활성 세션
  const activeSession = findActiveSession(sessions);
  // 오늘 수행해야 하는 습관
  // showInToday가 true인 습관만 TODAY에 표시 (HABITS 화면에서 수동 선택)
  const todayHabits = habits.filter(h => h.showInToday === true);
  // 오늘이 세션의 몇 번째 DAY인지 (1-based)
  const todayDayNumber = activeSession ? calcTodayDayNumber(activeSession) : 1;
  // 오늘 활성 CT 아이템 필터링
  const todayStr0 = getTodayDateStr();
  const activeCareItems = careItems.filter(item => item.published);
  const activeMakeupItems = makeupItems.filter((item) => {
    if (!item.published) return false;
    if (item.dates && item.dates.length > 0) {
      return item.dates.includes(todayStr0);
    }
    return true;
  });
  // 룩북: makeup과 동일하게 날짜 필터링 (dates[] 배열에 오늘 날짜 포함 여부 확인)
  const activeLookItems = lookItems.filter((item) => {
    if (!item.published) return false;
    if (item.dates && item.dates.length > 0) {
      return item.dates.includes(todayStr0);
    }
    return true;
  });
  // 오늘 DAY의 아침/저녁 슬롯 (0-based index)
  const todayDayIdx = todayDayNumber - 1;
  const todayMorning = activeSession?.morning.days[todayDayIdx] ?? activeSession?.morning.days[0] ?? null;
  const todayEvening = activeSession?.evening.days[todayDayIdx] ?? activeSession?.evening.days[0] ?? null;
  const userId = ctxUserId;

  // ── Firebase Auth 상태 감지 ──
  // sessions/products/habits/ct → AppContext에서 공유 (탭 전환 시 즉시)

  // dataLoading: sessions 첫 스냅샷 도착 시 완료 (authLoading만으론 불충분 — onSnapshot 미도착 방지)
  useEffect(() => {
    if (dataReady) setDataLoading(false);
  }, [dataReady]);

  // ── 실시간 구독 3a: 모닝 체크 기록 (자정에 리셋) ──
  const activeSessionId = activeSession?.id;
  useEffect(() => {
    if (authLoading || !user || !db || !activeSessionId) return;
    const _db = db;
    const morningDateStr = getTodayDateStr();
    const q = query(
      collection(_db, 'users', userId, 'usageLogs'),
      where('routineId', '==', activeSessionId),
      where('dateStr', '==', morningDateStr),
      where('timeSlot', '==', 'morning')
    );
    const unsub = onSnapshot(q, (snap) => {
      setChecked((prev) => ({ ...prev, morning: !snap.empty }));
    }, (err) => console.error('[OnStep] 모닝 체크 기록 로드 실패:', err));
    return () => unsub();
  }, [userId, authLoading, user, activeSessionId, todayKey]); // todayKey: 자정 리셋

  // ── 실시간 구독 3b: 나이트 체크 기록 (04:00에 리셋) ──
  // loggedAt으로 이중 검증: 구 버전 코드가 자정 넘어 저장한 잘못된 dateStr 데이터 필터링
  useEffect(() => {
    if (authLoading || !user || !db || !activeSessionId) return;
    const _db = db;
    const eveningDateStr = getEveningDateStr(); // 04:00 이전엔 어제, 이후엔 오늘
    const q = query(
      collection(_db, 'users', userId, 'usageLogs'),
      where('routineId', '==', activeSessionId),
      where('dateStr', '==', eveningDateStr),
      where('timeSlot', '==', 'evening')
    );
    const unsub = onSnapshot(q, (snap) => {
      // loggedAt 시간대 검증: 18:00~03:59만 유효한 나이트 로그
      const hasValid = snap.docs.some((d) => {
        const loggedAt = new Date(d.data().loggedAt as string);
        const h = loggedAt.getHours();
        if (h >= 4 && h < 18) return false; // 모닝 구간(04~17:59)에 저장된 건 제외
        // 나이트 구간: h < 4 → 전날, h >= 18 → 당일
        const logDay = h < 4
          ? toDateStr(new Date(loggedAt.getFullYear(), loggedAt.getMonth(), loggedAt.getDate() - 1))
          : toDateStr(loggedAt);
        return logDay === eveningDateStr;
      });
      setChecked((prev) => ({ ...prev, evening: hasValid }));
    }, (err) => console.error('[OnStep] 나이트 체크 기록 로드 실패:', err));
    return () => unsub();
  }, [userId, authLoading, user, activeSessionId, nightKey]); // nightKey: 04:00 리셋

  // ── 실시간 구독 4: 오늘 OOTD 기록 (자정 리셋) ──
  useEffect(() => {
    if (authLoading || !user || !db) return;
    const _db = db;
    const todayStr = getTodayDateStr();
    const q = query(
      collection(_db, 'users', userId, 'ootdLogs'),
      where('date', '==', todayStr)
    );
    const unsub = onSnapshot(q, (snap) => {
      if (!snap.empty) {
        const d = snap.docs[0];
        setOotdLog({ id: d.id, ...(d.data() as Omit<OOTDLog, 'id'>) });
      } else {
        setOotdLog(null);
      }
    }, (err) => console.error('[OnStep] OOTD 로드 실패:', err));
    return () => unsub();
  }, [userId, authLoading, user, todayKey]); // todayKey: 자정 리셋

  // ── 실시간 구독 6: 오늘 습관 완료 기록 ──
  // todayKey가 바뀌면(자정 경과) 새 날짜로 재구독 → 체크 상태 자동 리셋
  useEffect(() => {
    if (authLoading || !user || !db) return;
    const _db = db;
    const todayStr = getTodayDateStr();
    const q = query(
      collection(_db, 'users', userId, 'habitLogs'),
      where('dateStr', '==', todayStr)
    );
    const unsub = onSnapshot(q, (snap) => {
      const checked = new Set<string>();
      const logs: { id: string; habitId: string }[] = [];
      snap.docs.forEach((d) => {
        const data = d.data() as { habitId: string };
        checked.add(data.habitId);
        logs.push({ id: d.id, habitId: data.habitId });
      });
      setHabitChecked(checked);
      setHabitLogs(logs);
    }, (err) => console.error('[OnStep] 습관 기록 로드 실패:', err));
    return () => unsub();
  }, [userId, authLoading, user, todayKey]); // todayKey: 날짜 변경 시 재구독

  // 건강 루틴 체크 구독 (habitLogs와 동일 패턴)
  useEffect(() => {
    if (authLoading || !user || !db) return;
    const _db = db;
    const todayStr = getTodayDateStr();
    const q = query(
      collection(_db, 'users', userId, 'healthLogs'),
      where('dateStr', '==', todayStr)
    );
    const unsub = onSnapshot(q, (snap) => {
      const checked = new Set<string>();
      const logs: { id: string; routineId: string }[] = [];
      snap.docs.forEach((d) => {
        const data = d.data() as { routineId: string };
        checked.add(data.routineId);
        logs.push({ id: d.id, routineId: data.routineId });
      });
      setHealthChecked(checked);
      setHealthLogs(logs);
    }, (err) => console.error('[OnStep] 건강루틴 기록 로드 실패:', err));
    return () => unsub();
  }, [userId, authLoading, user, todayKey]);

  // 약 루틴 체크 구독
  useEffect(() => {
    if (authLoading || !user || !db) return;
    const _db = db;
    const todayStr = getTodayDateStr();
    const q = query(collection(_db, 'users', userId, 'medLogs'), where('dateStr', '==', todayStr));
    const unsub = onSnapshot(q, (snap) => {
      const checked = new Set<string>();
      const logs: { id: string; routineId: string }[] = [];
      snap.docs.forEach((d) => {
        const data = d.data() as { routineId: string };
        checked.add(data.routineId);
        logs.push({ id: d.id, routineId: data.routineId });
      });
      setMedChecked(checked);
      setMedLogs(logs);
    }, (err) => console.error('[OnStep] 약루틴 기록 로드 실패:', err));
    return () => unsub();
  }, [userId, authLoading, user, todayKey]);

  // ── 루틴 체크 처리 ──
  // 💡 낙관적 업데이트(optimistic update): 서버 응답 기다리지 않고 UI 먼저 변경
  //    실패 시 롤백
  const handleCheck = useCallback(
    async (time: 'morning' | 'evening') => {
      // 💡 _db에 캡처: async 내부에서 null 체크가 유지되도록 함
      const _db = db;
      if (!activeSession || !todayMorning || !_db || !user) return;

      const slot = time === 'morning' ? todayMorning : (todayEvening ?? EMPTY_SLOT_DAY);
      const allProductIds = slot.items
        .filter((item): item is { type: 'product'; id: string } => item.type === 'product')
        .map((item) => item.id);

      setSaving(true);
      // UI 먼저 체크 상태로 변경
      setChecked((prev) => ({ ...prev, [time]: true }));

      // 모닝: 오늘 날짜 / 나이트: 04:00 이전이면 어제 날짜 (저녁 구간이 날짜를 넘김)
      const dateStr = time === 'morning' ? getTodayDateStr() : getEveningDateStr();

      try {
        const logsRef = collection(_db, 'users', userId, 'usageLogs');

        if (allProductIds.length === 0) {
          // 매핑된 제품 없는 슬롯: 완료 기록만 남김 (잔량 차감 없음)
          await addDoc(logsRef, {
            routineId: activeSession.id,
            productId: null,
            amount: 0,
            type: 'use',
            timeSlot: time,
            dateStr,
            loggedAt: new Date().toISOString(),
            note: `${time === 'morning' ? '아침' : '저녁'} 루틴 완료 — Day ${todayDayNumber}`,
          });
        } else {
          // 각 제품별로 UsageLog 저장 + 잔량 차감
          await Promise.all(
            allProductIds.map(async (productId) => {
              const product = products.get(productId);
              const amount = product?.dosePerUse ?? 0;

              // dateStr: 모닝은 오늘, 나이트는 04:00 이전이면 어제 (저녁 구간 날짜)
              await addDoc(logsRef, {
                routineId: activeSession.id,
                productId,
                amount,
                type: 'use',
                timeSlot: time,
                dateStr,
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

                // onSnapshot이 자동으로 반영하므로 로컬 업데이트 불필요
              }
            })
          );
        }
      } catch (err) {
        console.error('[OnStep] 루틴 체크 저장 실패:', err);
        // 실패 시 체크 상태 롤백
        setChecked((prev) => ({ ...prev, [time]: false }));
      } finally {
        setSaving(false);
      }
    },
    [activeSession, todayMorning, todayEvening, todayDayNumber, userId, products]
  );

  // ── 루틴 체크 해제 (두 번째 클릭) ──
  const handleUncheck = useCallback(
    async (time: 'morning' | 'evening') => {
      const _db = db;
      if (!activeSession || !_db || !user) return;

      setSaving(true);
      setChecked((prev) => ({ ...prev, [time]: false }));

      const dateStr = time === 'morning' ? getTodayDateStr() : getEveningDateStr();

      try {
        const q = query(
          collection(_db, 'users', userId, 'usageLogs'),
          where('routineId', '==', activeSession.id),
          where('dateStr', '==', dateStr),
          where('timeSlot', '==', time)
        );
        const snap = await getDocs(q);

        await Promise.all(
          snap.docs.map(async (logDoc) => {
            const data = logDoc.data() as { productId: string; amount: number };

            await deleteDoc(logDoc.ref);

            if (data.amount > 0) {
              const product = products.get(data.productId);
              if (product) {
                const newRemaining = product.currentRemaining + data.amount;
                await updateDoc(doc(_db, 'users', userId, 'products', data.productId), {
                  currentRemaining: newRemaining,
                  updatedAt: new Date().toISOString(),
                });
                // onSnapshot이 자동으로 반영하므로 로컬 업데이트 불필요
              }
            }
          })
        );
      } catch (err) {
        console.error('[OnStep] 루틴 체크 해제 실패:', err);
        setChecked((prev) => ({ ...prev, [time]: true }));
      } finally {
        setSaving(false);
      }
    },
    [activeSession, userId, user, products]
  );

  // ── 루틴 토글 (1번 클릭 = 완료, 2번 클릭 = 해제) ──
  const handleToggle = useCallback(
    (time: 'morning' | 'evening') => {
      if (saving) return;
      const isDone = time === 'morning' ? checked.morning : checked.evening;
      if (isDone) {
        handleUncheck(time);
      } else {
        handleCheck(time);
      }
    },
    [saving, checked, handleCheck, handleUncheck]
  );

  // ── 습관 토글 (완료/해제) ──
  const handleToggleHabit = useCallback(
    async (habitId: string) => {
      const _db = db;
      if (!_db || !user) return;
      const todayStr = getTodayDateStr();
      // 낙관적 업데이트: Firestore 응답 전에 즉시 UI 반영
      setHabitChecked(prev => { const s = new Set(prev); if (s.has(habitId)) s.delete(habitId); else s.add(habitId); return s; });
      try {
        if (habitChecked.has(habitId)) {
          const log = habitLogs.find((l) => l.habitId === habitId);
          if (log) await deleteDoc(doc(_db, 'users', userId, 'habitLogs', log.id));
        } else {
          await addDoc(collection(_db, 'users', userId, 'habitLogs'), {
            habitId,
            dateStr: todayStr,
            completedAt: new Date().toISOString(),
          });
        }
      } catch (err) {
        console.error('[OnStep] 습관 토글 실패:', err);
        // 실패 시 롤백: onSnapshot이 재확인 처리
      }
    },
    [user, userId, habitChecked, habitLogs]
  );

  // 다이어트 슬롯 체크 구독
  useEffect(() => {
    if (authLoading || !user || !db) return;
    const _db = db;
    const todayStr = getTodayDateStr();
    const q = query(collection(_db, 'users', userId, 'dietLogs'), where('dateStr', '==', todayStr));
    const unsub = onSnapshot(q, (snap) => {
      const checked = new Set<string>();
      const logs: { id: string; programId: string; slotId: string }[] = [];
      snap.docs.forEach((d) => {
        const data = d.data() as { programId: string; slotId: string };
        checked.add(`${data.programId}:${data.slotId}`);
        logs.push({ id: d.id, programId: data.programId, slotId: data.slotId });
      });
      setDietChecked(checked);
      setDietLogs(logs);
    });
    return () => unsub();
  }, [userId, authLoading, user, todayKey]);

  // ── 1회성 건강 루틴 만료 시 자동 삭제 ──
  // todayKey 변경(자정) 시 date < today 인 repeatType==='once' 항목 삭제
  useEffect(() => {
    if (authLoading || !user || !db) return;
    const _db = db;
    const todayStr = getTodayDateStr();
    const expired = healthRoutines.filter(
      (h) => h.repeatType === 'once' && h.date && h.date < todayStr
    );
    if (expired.length === 0) return;
    expired.forEach(async (h) => {
      try {
        await deleteDoc(doc(_db, 'users', userId, 'healthRoutines', h.id));
      } catch (err) {
        console.error('[OnStep] 1회성 건강루틴 만료 삭제 실패:', err);
      }
    });
  }, [todayKey, userId, authLoading, user, healthRoutines]);

  // ── 건강 루틴 토글 (완료/해제) ──
  const handleToggleHealth = useCallback(
    async (routineId: string) => {
      const _db = db;
      if (!_db || !user) return;
      const todayStr = getTodayDateStr();
      const isChecking = !healthChecked.has(routineId);
      setHealthChecked(prev => { const s = new Set(prev); if (s.has(routineId)) s.delete(routineId); else s.add(routineId); return s; });
      try {
        if (!isChecking) {
          // 체크 해제
          const log = healthLogs.find((l) => l.routineId === routineId);
          if (log) await deleteDoc(doc(_db, 'users', userId, 'healthLogs', log.id));
        } else {
          // 체크 완료
          await addDoc(collection(_db, 'users', userId, 'healthLogs'), {
            routineId,
            dateStr: todayStr,
            completedAt: new Date().toISOString(),
          });
          // interval 루틴이면 lastDoneDate를 오늘로 업데이트
          const routine = healthRoutines.find(h => h.id === routineId);
          if (routine?.repeatType === 'interval') {
            await updateDoc(doc(_db, 'users', userId, 'healthRoutines', routineId), {
              lastDoneDate: todayStr,
            });
          }
        }
      } catch (err) {
        console.error('[OnStep] 건강루틴 토글 실패:', err);
      }
    },
    [user, userId, healthChecked, healthLogs, healthRoutines]
  );

  // ── 약 루틴 토글 ──
  const handleToggleMed = useCallback(
    async (routineId: string) => {
      const _db = db;
      if (!_db || !user) return;
      const todayStr = getTodayDateStr();
      setMedChecked(prev => { const s = new Set(prev); if (s.has(routineId)) s.delete(routineId); else s.add(routineId); return s; });
      try {
        if (medChecked.has(routineId)) {
          const log = medLogs.find((l) => l.routineId === routineId);
          if (log) await deleteDoc(doc(_db, 'users', userId, 'medLogs', log.id));
        } else {
          await addDoc(collection(_db, 'users', userId, 'medLogs'), {
            routineId, dateStr: todayStr, completedAt: new Date().toISOString(),
          });
        }
      } catch (err) {
        console.error('[OnStep] 약루틴 토글 실패:', err);
      }
    },
    [user, userId, medChecked, medLogs]
  );

  // ── 다이어트 슬롯 토글 ──
  const handleToggleDiet = useCallback(
    async (programId: string, slotId: string) => {
      const _db = db;
      if (!_db || !user) return;
      const key = `${programId}:${slotId}`;
      const todayStr = getTodayDateStr();
      try {
        if (dietChecked.has(key)) {
          const log = dietLogs.find(l => l.programId === programId && l.slotId === slotId);
          if (log) await deleteDoc(doc(_db, 'users', userId, 'dietLogs', log.id));
        } else {
          await addDoc(collection(_db, 'users', userId, 'dietLogs'), { programId, slotId, dateStr: todayStr, completedAt: new Date().toISOString() });
        }
      } catch (err) { console.error('[OnStep] 다이어트 슬롯 토글 실패:', err); }
    },
    [user, userId, dietChecked, dietLogs]
  );

  // ── Google 로그인 ──
  const handleLogin = async () => {
    if (!auth) {
      alert('Firebase가 설정되지 않았습니다. .env.local을 확인해주세요.');
      return;
    }
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, provider);
    } catch (err) {
      console.error('[OnStep] 로그인 실패:', err);
    }
  };

  // ── OOTD 시트 열기 (수정 시 기존 값 미리 채움) ──
  const handleOpenOOTDSheet = () => {
    if (ootdLog) {
      setOotdTheme(ootdLog.theme);
      setOotdNote(ootdLog.note);
      setOotdPhotoPreview(ootdLog.photoUrl);
      setOotdPhotoFile(null);
    } else {
      setOotdTheme('');
      setOotdNote('');
      setOotdPhotoPreview('');
      setOotdPhotoFile(null);
    }
    setOotdSheetOpen(true);
  };

  // ── OOTD 사진 적용 (파일 선택 + 붙여넣기 공통) — ImagePicker가 base64 변환까지 처리 ──
  const handleOOTDPhotoApply = useCallback((file: File, base64: string) => {
    setOotdPhotoFile(file);
    setOotdPhotoPreview(base64);
  }, []);

  // ── OOTD 저장 (Base64 → Firestore 직접 저장, Storage 미사용) ──
  const handleSaveOOTD = async () => {
    const _db = db;
    if (!_db || !user) { alert('로그인이 필요합니다.'); return; }
    setOotdSaving(true);
    try {
      // ImagePicker가 이미 base64로 변환한 preview 사용
      const photoUrl = ootdPhotoPreview || (ootdLog?.photoUrl ?? '');

      const todayStr = getTodayDateStr();
      if (ootdLog) {
        await updateDoc(doc(_db, 'users', userId, 'ootdLogs', ootdLog.id), {
          theme: ootdTheme,
          note: ootdNote,
          photoUrl,
          updatedAt: new Date().toISOString(),
        });
      } else {
        await addDoc(collection(_db, 'users', userId, 'ootdLogs'), {
          date: todayStr,
          theme: ootdTheme,
          note: ootdNote,
          photoUrl,
          createdAt: new Date().toISOString(),
        });
      }
      setOotdSheetOpen(false);
    } catch (err) {
      console.error('[OnStep] OOTD 저장 실패:', err);
      alert(`저장에 실패했습니다.\n${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setOotdSaving(false);
    }
  };

  // ── OOTD 삭제 ──
  const handleDeleteOOTD = async () => {
    const _db = db;
    if (!_db || !user || !ootdLog) return;
    try {
      await deleteDoc(doc(_db, 'users', userId, 'ootdLogs', ootdLog.id));
      setOotdSheetOpen(false);
    } catch (err) {
      console.error('[OnStep] OOTD 삭제 실패:', err);
    }
  };

  // ── 렌더링 ──
  return (
    <div style={{ background: '#FAFAF8', minHeight: '100%' }}>
      <div>
        {/* 페이지 헤더 — 공통 PageHeader 컴포넌트 */}
        <PageHeader label="Today" title="Today" />

        {/* 날씨 위젯 */}
        <WeatherWidget />

        {/* 세션 히어로 */}
        <SessionHero
          today={today}
          session={activeSession}
          todayDayNumber={todayDayNumber}
        />

        {/* #Flow 섹션 헤더 */}
        <SectionHeader title="#Flow" />

        {/* 메인 루틴 카드 — 비로그인 / 로딩 / 루틴 있음 / 루틴 없음 분기 */}
        {!user && !authLoading ? (
          // 로그인 안 된 상태 — dataLoading이 영원히 true가 되는 걸 방지하기 위해 먼저 체크
          <LoginRequiredCard onLogin={handleLogin} />
        ) : dataLoading || authLoading ? (
          // 로딩 중 — shimmer 스켈레톤
          <div
            style={{
              margin: '0 26px',
              padding: '20px',
              background: '#FFFFFF',
              borderRadius: 20,
              border: '1px solid rgba(12,12,10,.07)',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            {[['40%', 11], ['65%', 18], ['85%', 13], ['50%', 13]].map(([w, h], i) => (
              <div key={i} className="shimmer" style={{ width: w as string, height: h as number }} />
            ))}
          </div>
        ) : activeSession && todayMorning ? (
          // 오늘 활성 루틴 있음 (나이트 데이터 없어도 시간 기준으로 탭 노출)
          <FlowCard
            todayMorning={todayMorning}
            todayEvening={todayEvening ?? EMPTY_SLOT_DAY}
            todayDayNumber={todayDayNumber}
            session={activeSession}
            products={products}
            tab={activeTab}
            onTabChange={setActiveTab}
            checked={checked}
            onToggle={handleToggle}
            saving={saving}
          />
        ) : (
          // 오늘 날짜에 해당하는 루틴 없음
          <RoutineEmptyCard />
        )}

        {/* 오늘의 습관 — 루틴 유무와 무관하게 항상 표시 (showInToday=true 전체) */}
        <TodayHabitSection
          todayHabits={todayHabits}
          habitChecked={habitChecked}
          onToggle={handleToggleHabit}
        />

        {/* 약 루틴 섹션 — 아침(04-12) / 오후(12-18) / 저녁(18-04) 3구간 */}
        {(() => {
          const fMed = "'Plus Jakarta Sans','Space Grotesk',sans-serif";
          // showInToday=true 또는 active=true 인 약 루틴 모두 표시
          const activeMeds = medRoutines.filter(m => m.showInToday || m.active);
          if (activeMeds.length === 0) return null;

          // 구간별 대표 시각
          const slotTime = (m: typeof activeMeds[0], slot: 'am' | 'pm' | 'ev'): string => {
            if (m.time && m.time.trim()) return m.time;
            if (slot === 'am') return '09:00';
            if (slot === 'pm') return '13:00';
            return (m.times ?? []).includes('bedtime') ? '22:00' : '19:00';
          };

          // 구간 분류 (times 배열 우선, 없으면 time 필드 시간대 fallback)
          const periodOf = (m: typeof activeMeds[0]): 'am' | 'pm' | 'ev' => {
            if (m.time && m.time.trim()) { const h = parseInt(m.time.split(':')[0], 10); return h >= 4 && h < 12 ? 'am' : h >= 12 && h < 18 ? 'pm' : 'ev'; }
            const ts = m.times ?? [];
            if (ts.includes('morning')) return 'am';
            if (ts.includes('lunch')) return 'pm';
            if (ts.some((t: string) => t === 'evening' || t === 'bedtime')) return 'ev';
            return 'ev';
          };

          // 시간창 필터 없이 구간별 전체 표시
          const medLoggedIds = new Set(medLogs.map(l => l.routineId));
          const visAm = activeMeds.filter(m => periodOf(m) === 'am');
          const visPm = activeMeds.filter(m => periodOf(m) === 'pm');
          const visEv = activeMeds.filter(m => periodOf(m) === 'ev');
          const assignedIds = new Set([...visAm, ...visPm, ...visEv].map(m => m.id));
          const orphanChecked = activeMeds.filter(m => medLoggedIds.has(m.id) && !assignedIds.has(m.id));

          if (visAm.length === 0 && visPm.length === 0 && visEv.length === 0 && orphanChecked.length === 0) return null;

          const allVisMeds = [...visAm, ...visPm, ...visEv];
          // 슬롯별 색상: 아침(파랑) · 점심(오렌지) · 저녁(핑크)
          const slotColor = (s: 'am' | 'pm' | 'ev') => s === 'am' ? '#4285F4' : s === 'pm' ? '#E8A86B' : '#E86BAA';
          const MedBar = ({ m, slot }: { m: typeof activeMeds[0]; slot: 'am' | 'pm' | 'ev' }) => {
            const isDone = medChecked.has(m.id);
            const col = slotColor(slot);
            return (
              <div onClick={() => handleToggleMed(m.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 14px', borderRadius: 50, background: 'transparent', border: `1px solid ${col}`, opacity: isDone ? 0.5 : 1, cursor: 'pointer', transition: 'opacity .18s' }}>
                <div style={{ width: 22, height: 22, borderRadius: '50%', border: `2px solid ${col}`, background: isDone ? col : 'transparent', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all .2s' }}>
                  {isDone && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                </div>
                <span style={{ fontFamily: fMed, fontSize: 13, fontWeight: 700, color: col, width: 42, flexShrink: 0, textDecoration: isDone ? 'line-through' : 'none' }}>{slotTime(m, slot)}</span>
                <span style={{ fontFamily: fMed, fontSize: 14, fontWeight: 700, color: col, textDecoration: isDone ? 'line-through' : 'none', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{m.name}</span>
              </div>
            );
          };

          return (
            <>
              <SectionHeader title="#Medication" />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: '0 26px' }}>
                {visAm.length > 0 && <div style={{ fontFamily: fMed, fontSize: 10, fontWeight: 800, color: '#4285F4', letterSpacing: '.1em', padding: '2px 2px 2px 4px' }}>아침</div>}
                {visAm.map(m => <MedBar key={m.id} m={m} slot="am" />)}
                {visPm.length > 0 && <div style={{ fontFamily: fMed, fontSize: 10, fontWeight: 800, color: '#E8A86B', letterSpacing: '.1em', padding: '6px 2px 2px 4px' }}>오후</div>}
                {visPm.map(m => <MedBar key={m.id} m={m} slot="pm" />)}
                {visEv.length > 0 && <div style={{ fontFamily: fMed, fontSize: 10, fontWeight: 800, color: '#E86BAA', letterSpacing: '.1em', padding: '6px 2px 2px 4px' }}>저녁</div>}
                {visEv.map(m => <MedBar key={m.id} m={m} slot="ev" />)}
                {orphanChecked.map(m => <MedBar key={m.id} m={m} slot="ev" />)}
                <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '2px 4px 4px' }}>
                  <Link href="/setup#medication" style={{ fontFamily: fMed, fontSize: 12, fontWeight: 700, color: '#BCBAB6', textDecoration: 'none', letterSpacing: '.04em' }}>List →</Link>
                </div>
              </div>
            </>
          );
        })()}

        {/* 다이어트 플랜 섹션 — showInToday=true, 오늘 일차에 맞는 패턴 */}
        {dietPrograms.filter(p => p.showInToday).map(p => {
          const dayN = Math.floor((Date.now() - new Date(p.startDate).getTime()) / 86400000) + 1;
          const sortedPats = [...(p.patterns ?? [])].sort((a, b) => a.dayStart - b.dayStart);
          const pat = sortedPats.find(pt => dayN >= pt.dayStart && dayN <= pt.dayEnd)
            ?? (dayN < 1 ? sortedPats[0] : sortedPats[sortedPats.length - 1]);
          if (!pat) return null;
          const beforeStart = dayN < 1;
          const daysLeft = beforeStart ? Math.abs(dayN - 1) + 1 : null;
          const fDiet = "'Plus Jakarta Sans','Space Grotesk',sans-serif";

          // ── 시간대 기반 가시성 계산 ─────────────────────────────────────────
          const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
          const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
          const nowPeriod = nowMin < 720 ? 'am' : nowMin < 1080 ? 'pm' : 'ev';
          const slotPeriod = (t: string) => { const m = toMin(t); return m < 720 ? 'am' : m < 1080 ? 'pm' : 'ev'; };

          function isVisible(item: import('@/types/dietplan').DietTimelineItem, idx: number): boolean {
            const slot = item as import('@/types/dietplan').DietSlot;
            // 시간 있는 슬롯: 슬롯 시간 ±1시간 구간에 노출
            if (!item.isWarning && slot.time) {
              const t = toMin(slot.time);
              return nowMin >= t - 60 && nowMin < t + 60;
            }
            // 공복시·경고: 앞뒤 timed 슬롯 ±1시간 창 기준
            // 표시 라벨은 (prevTime ~ nextTime), 가시화는 (prevTime-1hr) ~ (nextTime-1hr)
            const prevT = [...pat.timeline].slice(0, idx).reverse()
              .find(it => !it.isWarning && (it as import('@/types/dietplan').DietSlot).time);
            const nextT = pat.timeline.slice(idx + 1)
              .find(it => !it.isWarning && (it as import('@/types/dietplan').DietSlot).time);
            const start = prevT ? toMin((prevT as import('@/types/dietplan').DietSlot).time!) - 60 : 0;
            const end = nextT ? toMin((nextT as import('@/types/dietplan').DietSlot).time!) - 60 : 24 * 60;
            return nowMin >= start && nowMin < end;
          }

          let visibleItems = pat.timeline.filter((item, idx) => isVisible(item, idx));

          // 공백 구간 — 다음 예정 슬롯 fallback
          let isFallback = false;
          if (visibleItems.length === 0) {
            const nextSlot = pat.timeline.find(it => {
              const s = it as import('@/types/dietplan').DietSlot;
              return !it.isWarning && s.time && toMin(s.time) > nowMin;
            });
            if (nextSlot) { visibleItems = [nextSlot]; isFallback = true; }
            else return null;
          }

          const nowPeriodLabel = nowPeriod === 'am' ? '오전' : nowPeriod === 'pm' ? '오후' : '저녁';
          const periodLabel = isFallback ? '다음 일정' : nowPeriodLabel;

          return (
            <div key={p.id}>
              <SectionHeader
                title={`#${p.name}`}
                action={
                  <span style={{ background: '#0C0C0A', color: '#C5FF00', fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 9999, letterSpacing: '.04em' }}>
                    {beforeStart ? `D-${daysLeft}일 후 시작 · ${pat.label}` : `D+${dayN} · ${periodLabel} · ${pat.label}`}
                  </span>
                }
              />
              <div style={{ margin: '0 26px', background: '#FFFFFF', border: '1px solid rgba(12,12,10,.07)', borderRadius: 20, overflow: 'hidden', boxShadow: '0 1px 2px rgba(0,0,0,.04)' }}>
                {visibleItems.map((item, idx) => {
                  if (item.isWarning) {
                    return (
                      <div key={item.id} style={{ padding: '10px 26px', background: '#FEF2F2', borderTop: idx > 0 ? '1px solid rgba(12,12,10,.07)' : 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 16 }}>⚠️</span>
                        <span style={{ fontFamily: fDiet, fontSize: 12, fontWeight: 700, color: '#DC2626' }}>{item.text}</span>
                      </div>
                    );
                  }
                  const slot = item as import('@/types/dietplan').DietSlot;
                  const key = `${p.id}:${slot.id}`;
                  const isDone = dietChecked.has(key);
                  return (
                    <div key={slot.id} onClick={() => handleToggleDiet(p.id, slot.id)}
                      style={{ padding: '12px 26px', borderTop: idx > 0 ? '1px solid rgba(12,12,10,.07)' : 'none', cursor: 'pointer', background: isDone ? 'rgba(197,255,0,.08)' : 'transparent', transition: 'background .18s' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                        <div style={{ width: 22, height: 22, borderRadius: 6, border: `2px solid ${isDone ? '#8AB000' : 'rgba(12,12,10,.2)'}`, background: isDone ? '#C5FF00' : '#fff', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
                          {isDone && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#0C0C0A" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          {(() => {
                            // 공복 슬롯: 앞뒤 timed 슬롯으로 자동 시간대 계산
                            let autoRange = '';
                            if (!slot.time) {
                              const origIdx = pat.timeline.indexOf(item);
                              const prevT = [...pat.timeline].slice(0, origIdx).reverse()
                                .find(it => !it.isWarning && (it as import('@/types/dietplan').DietSlot).time);
                              const nextT = pat.timeline.slice(origIdx + 1)
                                .find(it => !it.isWarning && (it as import('@/types/dietplan').DietSlot).time);
                              const s = prevT ? (prevT as import('@/types/dietplan').DietSlot).time! : null;
                              const e = nextT ? (nextT as import('@/types/dietplan').DietSlot).time! : null;
                              if (s && e) autoRange = ` (${s} ~ ${e})`;
                              else if (s) autoRange = ` (${s} ~)`;
                              else if (e) autoRange = ` (~ ${e})`;
                            }
                            return (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
                                {slot.time && <span style={{ fontFamily: fDiet, fontSize: 11, fontWeight: 800, background: isDone ? 'rgba(12,12,10,.08)' : '#0C0C0A', color: isDone ? '#BCBAB6' : '#C5FF00', padding: '2px 8px', borderRadius: 9999 }}>{slot.time}</span>}
                                <span style={{ fontFamily: fDiet, fontSize: 14, fontWeight: 600, color: isDone ? '#9A9490' : '#0C0C0A', textDecoration: isDone ? 'line-through' : 'none' }}>
                                  {slot.label}{autoRange}
                                </span>
                                {slot.water > 0 && <span style={{ fontFamily: fDiet, fontSize: 11, fontWeight: 700, color: '#4A9ED6', marginLeft: 'auto' }}>💧{slot.water}ml</span>}
                              </div>
                            );
                          })()}
                          {slot.items.length > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                              {slot.items.map(it => (
                                <span key={it.id} style={{ fontFamily: fDiet, fontSize: 12, background: isDone ? '#F4F4F0' : '#EEEDE9', color: isDone ? '#BCBAB6' : '#4A4846', padding: '2px 7px', borderRadius: 5 }}>
                                  {it.name}{it.qty ? `(${it.qty})` : ''}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* 건강 루틴 섹션 — showInToday=true + 오늘 날짜 해당 + ±1시간 창 */}
        {(() => {
          const fH = "'Plus Jakarta Sans','Space Grotesk',sans-serif";
          const _hNowMin = today.getHours() * 60 + today.getMinutes();
          const _hToMin = (t: string) => { const [hh, mm] = t.split(':').map(Number); return hh * 60 + mm; };
          const _hInWin = (t: string) => { const tm = _hToMin(t); return _hNowMin >= tm - 60 && _hNowMin <= tm + 60; };
          // 시간 있으면 ±1시간 창, 없으면 종일 노출
          const isHealthVisible = (h: { time?: string; entries?: { time: string }[] }) => {
            const timedEntries = (h.entries ?? []).filter(e => e.time && e.time.includes(':'));
            if (timedEntries.length > 0) return timedEntries.some(e => _hInWin(e.time));
            if (h.time && h.time.includes(':')) return _hInWin(h.time);
            return true;
          };
          const visHealth = healthRoutines.filter(h => h.showInToday && isHealthToday(h));
          if (visHealth.length === 0) return null;
          // 대표 시간: entries 중 가장 이른 시간, 없으면 h.time, 없으면 ''
          const primaryTime = (h: { time?: string; entries?: { time: string }[] }) => {
            const timed = (h.entries ?? []).map(e => e.time).filter(t => t && t.includes(':'));
            if (timed.length > 0) return timed.sort()[0];
            return h.time && h.time.includes(':') ? h.time : '';
          };
          return (
          <div>
            <SectionHeader title="#Health" action={`${visHealth.length}개`} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: '0 26px' }}>
              {visHealth.map((h) => {
                const isDone = healthChecked.has(h.id);
                const pt = primaryTime(h);
                // interval 루틴 D-N 배지
                const dBadge = (() => {
                  if (h.repeatType !== 'interval' || !h.intervalUnit || !h.intervalValue) return null;
                  const nd = calcNextDueDate(h.lastDoneDate, h.intervalUnit, h.intervalValue);
                  const d = getDaysUntilDue(nd);
                  return { label: dueBadgeLabel(d), ...dueBadgeColor(d) };
                })();
                return (
                  <div key={h.id} onClick={() => handleToggleHealth(h.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 14px', borderRadius: 50, background: 'rgb(8,191,16)', opacity: isDone ? 0.5 : 1, cursor: 'pointer', transition: 'opacity .18s' }}>
                    {/* 동그라미 체크 */}
                    <div style={{ width: 22, height: 22, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.85)', background: isDone ? '#fff' : 'transparent', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all .2s' }}>
                      {isDone && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="rgb(8,191,16)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                    </div>
                    {/* 아이콘 */}
                    <span style={{ fontSize: 18, lineHeight: 1, flexShrink: 0 }}>{h.icon || '🥗'}</span>
                    {/* 시간 또는 D-N 배지 */}
                    {dBadge ? (
                      <span style={{ fontFamily: fH, fontSize: 10, fontWeight: 800, background: dBadge.bg, color: dBadge.color, padding: '2px 7px', borderRadius: 9999, flexShrink: 0 }}>{dBadge.label}</span>
                    ) : pt ? (
                      <span style={{ fontFamily: fH, fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.85)', width: 42, flexShrink: 0, textDecoration: isDone ? 'line-through' : 'none' }}>{pt}</span>
                    ) : null}
                    {/* 이름 */}
                    <span style={{ fontFamily: fH, fontSize: 14, fontWeight: 700, color: '#fff', textDecoration: isDone ? 'line-through' : 'none', flex: 1, minWidth: 0 }}>
                      {h.name}
                    </span>
                  </div>
                );
              })}
              <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '2px 4px 4px' }}>
                <Link href="/setup#health" style={{ fontFamily: fH, fontSize: 12, fontWeight: 700, color: '#BCBAB6', textDecoration: 'none', letterSpacing: '.04em' }}>List →</Link>
              </div>
            </div>
          </div>
          );
        })()}

        {/* 비로그인 시 Habits · Medication · Health · OOTD 기능 소개 */}
        {!user && !authLoading && (() => {
          const fT = "'Plus Jakarta Sans','Space Grotesk',sans-serif";
          const TeaserCard = ({ icon, title, desc, col }: { icon: string; title: string; desc: string; col: string }) => (
            <div style={{ margin: '0 26px', padding: '14px 26px', background: '#fff', borderRadius: 16, border: `1.5px solid ${col}22`, display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, background: `${col}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>{icon}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: fT, fontSize: 13, fontWeight: 800, color: '#0C0C0A', letterSpacing: '.04em' }}>{title}</div>
                <div style={{ fontFamily: fT, fontSize: 11, color: '#9A9490', marginTop: 2 }}>{desc}</div>
              </div>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: col, flexShrink: 0 }} />
            </div>
          );
          return (
            <>
              <SectionHeader title="#Habits" />
              <TeaserCard icon="🗓" title="습관 트래커" desc="매일 반복할 습관을 등록하고 체크하세요" col="#F5A623" />
              <SectionHeader title="#Medication" />
              <TeaserCard icon="💊" title="약 루틴" desc="복용 약과 시간을 등록해 타이밍을 놓치지 마세요" col="#6B7CE8" />
              <SectionHeader title="#Health" />
              <TeaserCard icon="🏃" title="건강 루틴" desc="운동, 수분, 수면 등 건강 루틴을 관리하세요" col="#4CAF50" />
            </>
          );
        })()}

        {/* 집중케어 섹션 — 오늘 기간에 해당하는 published 아이템 */}
        <CareSection items={activeCareItems} products={products} />

        {/* 메이크업 섹션 — 오늘 날짜에 해당하는 published 아이템 */}
        <MakeupSection items={activeMakeupItems} products={products} />

        {/* OOTD 섹션 */}
        <OOTDSection
          ootdLog={ootdLog}
          onRecord={handleOpenOOTDSheet}
          onViewLog={() => router.push('/log?tab=아카이브&filter=ootd')}
          user={user}
          activeLookItems={activeLookItems}
          products={products}
        />

      </div>

      {/* OOTD 기록 바텀 시트 */}
      <OOTDRecordSheet
        open={ootdSheetOpen}
        onClose={() => setOotdSheetOpen(false)}
        ootdLog={ootdLog}
        theme={ootdTheme}
        onThemeChange={setOotdTheme}
        note={ootdNote}
        onNoteChange={setOotdNote}
        photoPreview={ootdPhotoPreview}
        onPhotoApply={handleOOTDPhotoApply}
        onSave={handleSaveOOTD}
        onDelete={handleDeleteOOTD}
        saving={ootdSaving}
        tags={ootdTags}
        onTagsChange={saveOotdTags}
      />
    </div>
  );
}
