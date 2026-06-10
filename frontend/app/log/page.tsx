/* eslint-disable */
// app/log/page.tsx — LOG 페이지
// Stage 6: 월별 캘린더 + 날짜별 루틴 수행 기록
//
// 💡 이 파일에서 구현하는 기능:
//   1. Firebase Auth — Google 로그인/로그아웃 (today 페이지와 동일한 패턴)
//   2. 월별 캘린더 뷰 — 루틴 수행한 날에 도트 표시
//   3. 날짜 클릭 → 그날 아침/저녁 사용 제품 상세 카드
//   4. 최근 7일 요약 스트립

'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  getDay,
  isSameDay,
  isSameMonth,
  subMonths,
  addMonths,
  parseISO,
  isToday,
} from 'date-fns';
import { ko } from 'date-fns/locale';
import {
  collection,
  onSnapshot,
  query,
  where,
  orderBy,
  updateDoc,
  addDoc,
  deleteDoc,
  doc,
} from 'firebase/firestore';
import {
  onAuthStateChanged,
  type User,
} from 'firebase/auth';
import { db, auth } from '@/lib/firebase';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { imageFileToBase64 } from '@/lib/imageUtils';
import type { RoutineItem } from '@/types/routine';
import type { CtType } from '@/types/ctitem';
import type { LifetipItem } from '@/types/lifetip';
import { getLifetipEmoji } from '@/types/lifetip';
import { useAppContext } from '@/lib/AppContext';
import { FALLBACK_USER_ID } from '@/lib/constants';
import { toDateStr } from '@/lib/dateUtils';
import type { Product } from '@/types/product';
import type { CtItem } from '@/types/ctitem';
import PageHeader from '@/components/PageHeader';
import CatBadge from '@/components/CatBadge';
import ImagePicker from '@/components/ImagePicker';
import MoreButton from '@/components/MoreButton';

// ─── 타입 ─────────────────────────────────────────────────────────────────────

// 수집 탭 — 레퍼런스 링크
type Reference = {
  id: string;
  url: string;
  title: string;
  imageUrl: string;
  description: string;
  platform: 'instagram' | 'youtube' | 'pinterest' | 'other';
  tags: string[];         // '메이크업' | '스킨케어' | '코디' | '루틴'
  createdAt: string;      // ISO datetime
};


// 수집 탭 빠른선택 태그 기본값 (localStorage에 없을 때 사용)
const DEFAULT_PRESET_TAGS = ['메이크업', '스킨케어', '코디', '루틴'];

// 오늘의 룩 기록
type OOTDLog = {
  id: string;
  date: string;      // "YYYY-MM-DD"
  theme: string;
  note: string;
  photoUrl: string;
  productIds?: string[];
  createdAt: string;
};

// Firestore usageLogs에서 읽어온 개별 로그 항목
type LogEntry = {
  id: string;
  routineId?: string;
  productId: string;
  amount?: number;
  type: 'use' | 'manual_adjust' | 'skip';
  timeSlot: 'morning' | 'evening';
  dateStr: string;   // "YYYY-MM-DD"
  loggedAt: string;  // ISO datetime
  note?: string;
};

// 날짜별로 그룹핑된 로그
type DayLog = {
  dateStr: string;
  hasMorning: boolean;
  hasEvening: boolean;
  entries: LogEntry[];
};

// CtItem → 공유 types/ctitem.ts에서 import

// ─── 상수 ─────────────────────────────────────────────────────────────────────


// 요일 헤더 (일 ~ 토)
const WEEK_DAYS = ['일', '월', '화', '수', '목', '금', '토'];

// ─── 유틸 ─────────────────────────────────────────────────────────────────────

// ─── 월별 캘린더 ─────────────────────────────────────────────────────────────
//
// 💡 캘린더 동작 방식:
//   - 해당 월의 1일이 몇 요일인지 계산 → 앞에 빈 칸 채우기
//   - 각 날짜 셀에 라임 도트를 표시 (아침 / 저녁 구분)
//   - 선택된 날짜는 블랙 원으로 하이라이트

// 라임 고양이 스탬프 — UwU 눈 + ω 입
function StampBadge({ size = 22, rotate = -10, full = false }: { size?: number; rotate?: number; full?: boolean }) {
  const bg = full ? '#C5FF00' : '#E8FFB0';
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" fill="none" style={{ transform: `rotate(${rotate}deg)`, flexShrink: 0, display: 'block' }}>
      <polygon points="9,16 5,3 17,12" fill={bg} stroke="#0C0C0A" strokeWidth="1.3"/>
      <polygon points="27,16 31,3 19,12" fill={bg} stroke="#0C0C0A" strokeWidth="1.3"/>
      <polygon points="10,15 7,6 15,11" fill="#FFB3C6" opacity="0.7"/>
      <polygon points="26,15 29,6 21,11" fill="#FFB3C6" opacity="0.7"/>
      <circle cx="18" cy="22" r="13" fill={bg} stroke="#0C0C0A" strokeWidth="1.5"/>
      <path d="M10 20 Q13 25 16 20" stroke="#0C0C0A" strokeWidth="2.2" strokeLinecap="round" fill="none"/>
      <path d="M20 20 Q23 25 26 20" stroke="#0C0C0A" strokeWidth="2.2" strokeLinecap="round" fill="none"/>
      <ellipse cx="10" cy="25" rx="3.2" ry="2" fill="#FF8FA3" opacity="0.45"/>
      <ellipse cx="26" cy="25" rx="3.2" ry="2" fill="#FF8FA3" opacity="0.45"/>
      <path d="M13.5 28 Q15.5 31.5 18 29.5 Q20.5 31.5 22.5 28" stroke="#0C0C0A" strokeWidth="1.6" strokeLinecap="round" fill="none"/>
    </svg>
  );
}

// 빨간 원형 도장 뱃지 — CtItem TODAY 뱃지와 동일한 스타일
function TodayStampBadge({ size = 88, rotate = -9, label = 'TODAY', f = "'Plus Jakarta Sans','Space Grotesk',sans-serif" }: { size?: number; rotate?: number; label?: string; f?: string }) {
  const logoSz = Math.round(size * 0.38);
  const borderW = Math.max(1.5, Math.round(size * 0.034));
  const fs = Math.max(6, Math.round(size * 0.09));
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      border: `${borderW}px solid rgba(190,30,30,.75)`,
      background: 'rgba(255,255,255,.82)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      mixBlendMode: 'multiply' as const, flexShrink: 0, position: 'relative',
      transform: `rotate(${rotate}deg)`,
    }}>
      <div style={{ position: 'absolute', inset: Math.round(size * 0.055), borderRadius: '50%', border: '1px solid rgba(190,30,30,.28)', pointerEvents: 'none' }} />
      <img src="/logo.png" alt="" style={{ width: logoSz, height: logoSz, objectFit: 'contain', filter: 'sepia(1) saturate(8) hue-rotate(-20deg) contrast(1.2)', opacity: .8, marginBottom: 1, position: 'relative', zIndex: 1 }} />
      <div style={{ fontFamily: f, fontSize: fs, fontWeight: 900, letterSpacing: '.28em', color: 'rgba(190,30,30,.85)', textTransform: 'uppercase' as const, marginTop: -1, position: 'relative', zIndex: 1, whiteSpace: 'nowrap' as const }}>{label}</div>
    </div>
  );
}

function MonthCalendar({
  currentMonth,
  dayLogs,
  selectedDate,
  onSelectDate,
  onPrevMonth,
  onNextMonth,
  medDayMap,
  healthDayMap,
  dietDayMap,
  hasMed,
  hasHealth,
  hasDiet,
  onToggleMorning,
  onToggleEvening,
  sessionStartMap,
}: {
  currentMonth: Date;
  dayLogs: Map<string, DayLog>;
  selectedDate: string | null;
  onSelectDate: (dateStr: string) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  medDayMap: Map<string, Set<string>>;
  healthDayMap: Map<string, Set<string>>;
  dietDayMap: Map<string, Set<string>>;
  hasMed: boolean;
  hasHealth: boolean;
  hasDiet: boolean;
  onToggleMorning?: () => void;
  onToggleEvening?: () => void;
  sessionStartMap?: Map<string, string>; // date → session label (e.g. "관리3회")
}) {
  const [isOpen, setIsOpen] = useState(false);

  const days = eachDayOfInterval({
    start: startOfMonth(currentMonth),
    end: endOfMonth(currentMonth),
  });
  const startBlank = getDay(days[0]);
  const fullDays = Array.from(dayLogs.values()).filter(l => l.hasMorning && l.hasEvening).length;
  // 태그 활성화: 현재 월이면 오늘 로그 기준, 과거 월이면 월 전체 기준
  const isCurMonth = isSameMonth(currentMonth, new Date());
  const todayDs = format(new Date(), 'yyyy-MM-dd');
  const todayLog = dayLogs.get(todayDs);
  const hasMorning = isCurMonth ? !!todayLog?.hasMorning : Array.from(dayLogs.values()).some(l => l.hasMorning);
  const hasEvening = isCurMonth ? !!todayLog?.hasEvening : Array.from(dayLogs.values()).some(l => l.hasEvening);
  const fTag = "'Plus Jakarta Sans','Space Grotesk',sans-serif";
  const Tag = ({ label, active }: { label: string; active: boolean }) => (
    <span style={{
      fontFamily: fTag, fontSize: 11, fontWeight: 800,
      padding: '3px 9px', borderRadius: 9999,
      background: active ? '#0C0C0A' : 'transparent',
      color: active ? '#C5FF00' : '#BCBAB6',
      border: active ? '1.5px solid transparent' : '1.5px dashed #BCBAB6',
      letterSpacing: '.04em', whiteSpace: 'nowrap' as const,
    }}>{label}</span>
  );

  return (
    <div style={{ margin: '0 26px 16px', border: '1px solid #0C0C0A', borderRadius: 16, overflow: 'hidden', background: '#fff' }}>
      {/* 월 헤더 — 클릭으로 접기/펼치기 */}
      <div
        onClick={() => setIsOpen(o => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 26px',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const }}>
          <span style={{ fontFamily: fTag, fontSize: 15, fontWeight: 800, color: '#0C0C0A', letterSpacing: '-0.01em' }}>
            {isSameMonth(currentMonth, new Date())
              ? format(new Date(), 'yyyy년 M월 d일(EEE) · 오늘의 기록', { locale: ko })
              : format(currentMonth, 'yyyy년 M월', { locale: ko })}
          </span>
        </div>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, transition: 'transform .2s', transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}>
          <path d="M3 5.5L8 10.5L13 5.5" stroke="#9A9490" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>

      {/* 펼쳐진 캘린더 */}
      {isOpen && (
      <div style={{ padding: '0 26px 16px', borderTop: '1px solid #0C0C0A' }}>
      {/* 월 네비게이션 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          margin: '12px 0 16px',
        }}
      >
        <button
          onClick={onPrevMonth}
          style={{
            width: 36,
            height: 36,
            borderRadius: 9999,
            border: '1px solid rgba(12,12,10,.14)',
            background: 'transparent',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          aria-label="이전 달"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0C0C0A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        <span
          style={{
            fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
            fontSize: 16,
            fontWeight: 800,
            color: '#0C0C0A',
            letterSpacing: '-0.01em',
          }}
        >
          {format(currentMonth, 'yyyy년 M월', { locale: ko })}
        </span>

        <button
          onClick={onNextMonth}
          style={{
            width: 36,
            height: 36,
            borderRadius: 9999,
            border: '1px solid rgba(12,12,10,.14)',
            background: 'transparent',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          aria-label="다음 달"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0C0C0A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      {/* 요일 헤더 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          marginBottom: 4,
        }}
      >
        {WEEK_DAYS.map((w) => (
          <div
            key={w}
            style={{
              textAlign: 'center',
              fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.06em',
              color: '#9A9490',
              padding: '4px 0',
            }}
          >
            {w}
          </div>
        ))}
      </div>

      {/* 날짜 그리드 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
        {/* 1일 전 빈 셀 */}
        {Array.from({ length: startBlank }).map((_, i) => (
          <div key={`blank-${i}`} />
        ))}

        {/* 실제 날짜 셀 */}
        {days.map((day) => {
          const ds = toDateStr(day);
          const log = dayLogs.get(ds);
          const isSelected = selectedDate === ds;
          const today = isToday(day);
          const bothDone = !!(log?.hasMorning && log?.hasEvening);
          const medDone = hasMed && (medDayMap.get(ds)?.size ?? 0) > 0;
          const healthDone = hasHealth && (healthDayMap.get(ds)?.size ?? 0) > 0;
          const dietDone = hasDiet && (dietDayMap.get(ds)?.size ?? 0) > 0;
          const sessionLabel = sessionStartMap?.get(ds);

          return (
            <button
              key={ds}
              onClick={() => onSelectDate(isSelected ? '' : ds)}
              style={{
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 2,
                padding: '6px 2px',
                background: isSelected && !today ? '#0C0C0A' : 'transparent',
                border: isSelected && today ? '1.5px solid #0C0C0A' : today && !isSelected ? '1.5px solid rgba(12,12,10,.2)' : '1.5px solid transparent',
                borderRadius: 10,
                cursor: 'pointer',
                transition: 'background .15s',
                overflow: 'visible',
              }}
            >
              {/* 스킨케어 세션 시작일 — 날짜 아래, 고양이/이모지 위 오버레이 */}
              {sessionLabel && (
                <span style={{
                  position: 'absolute',
                  top: 29,
                  left: '50%',
                  transform: 'translateX(-50%) rotate(-6deg)',
                  pointerEvents: 'none',
                  zIndex: 4,
                  opacity: 0.7,
                  background: 'rgba(255,255,255,.97)',
                  border: '1.5px solid rgba(190,30,30,.72)',
                  borderRadius: 4,
                  padding: '1.5px 5px',
                  fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif",
                  fontSize: 7.5,
                  fontWeight: 900,
                  color: 'rgba(145,15,15,.9)',
                  letterSpacing: '-.01em',
                  whiteSpace: 'nowrap' as const,
                  lineHeight: 1.2,
                  boxShadow: '0 1px 3px rgba(190,30,30,.2)',
                }}>
                  {sessionLabel}
                </span>
              )}

              {/* 날짜 숫자 */}
              <span
                style={{
                  fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
                  fontSize: 13,
                  fontWeight: isSelected || today ? 800 : 400,
                  color: isSelected && !today ? '#FFFFFF' : today ? '#0C0C0A' : '#4A4846',
                  position: 'relative',
                }}
              >
                {format(day, 'd')}
              </span>

              {/* 아침(라임)·저녁(오렌지) 고양이 */}
              <div style={{ display: 'flex', gap: 1, alignItems: 'center', position: 'relative' }}>
                <span style={{ opacity: log?.hasMorning ? 1 : 0.18 }}>
                  <CatBadge color={log?.hasMorning ? '#C5FF00' : '#0C0C0A'} size={12} />
                </span>
                <span style={{ opacity: log?.hasEvening ? 1 : 0.18 }}>
                  <CatBadge color={log?.hasEvening ? '#f7bc45' : '#0C0C0A'} size={12} />
                </span>
              </div>

              {/* 약·건강·식단 이모지 — 완료시 컬러, 미완료시 흐리게 */}
              {(hasMed || hasHealth || hasDiet) && (
                <div style={{ display: 'flex', gap: 1, alignItems: 'center', position: 'relative' }}>
                  {hasMed && <span style={{ fontSize: 8, lineHeight: 1, opacity: medDone ? 1 : 0.2, filter: medDone ? 'none' : 'grayscale(1)' }}>💊</span>}
                  {hasHealth && <span style={{ fontSize: 8, lineHeight: 1, opacity: healthDone ? 1 : 0.2, filter: healthDone ? 'none' : 'grayscale(1)' }}>🏃</span>}
                  {hasDiet && <span style={{ fontSize: 8, lineHeight: 1, opacity: dietDone ? 1 : 0.2, filter: dietDone ? 'none' : 'grayscale(1)' }}>📋</span>}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* 범례 */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 14,
          marginTop: 12,
          padding: '10px 0 0',
          borderTop: '1px solid #0C0C0A',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <CatBadge color="#C5FF00" size={16} />
          <span style={{ fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif", fontSize: 11, color: '#9A9490', fontWeight: 600 }}>아침 완료</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <CatBadge color="#f7bc45" size={16} />
          <span style={{ fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif", fontSize: 11, color: '#9A9490', fontWeight: 600 }}>저녁 완료</span>
        </div>
        {hasMed && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ fontSize: 12 }}>💊</span>
            <span style={{ fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif", fontSize: 11, color: '#9A9490', fontWeight: 600 }}>약 복용</span>
          </div>
        )}
        {hasHealth && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ fontSize: 12 }}>🏃</span>
            <span style={{ fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif", fontSize: 11, color: '#9A9490', fontWeight: 600 }}>건강 루틴</span>
          </div>
        )}
        {hasDiet && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ fontSize: 12, opacity: 0.7, filter: 'grayscale(1)' }}>📋</span>
            <span style={{ fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif", fontSize: 11, color: '#9A9490', fontWeight: 600 }}>리셋 플랜</span>
          </div>
        )}
      </div>
      </div>
      )}
    </div>
  );
}

// ─── 날짜 상세 카드 ───────────────────────────────────────────────────────────
//
// 선택한 날짜의 로그를 아침 / 저녁으로 나눠 표시
// 각 시간대에서 사용한 제품 이름과 사용량을 보여줌

function DayDetail({
  dateStr,
  dayLog,
  products,
  sessions,
  makeupItems,
  lookItems,
  onClose,
  medRoutines,
  healthRoutines,
  dietPrograms,
  medChecked,
  healthChecked,
  dietChecked,
  onToggleMorning,
  onToggleEvening,
}: {
  dateStr: string;
  dayLog: DayLog | undefined;
  products: Map<string, Product>;
  sessions: import('@/types/routine').Session[];
  makeupItems: CtItem[];
  lookItems: CtItem[];
  onClose: () => void;
  medRoutines: import('@/types/medication').MedRoutine[];
  healthRoutines: import('@/types/healthroutine').HealthRoutine[];
  dietPrograms: import('@/types/dietplan').DietProgram[];
  medChecked: Set<string>;
  healthChecked: Set<string>;
  dietChecked: Set<string>;
  onToggleMorning?: () => void;
  onToggleEvening?: () => void;
}) {
  const dateLabel = format(parseISO(dateStr), 'M월 d일 (EEE)', { locale: ko });

  const morningEntries = dayLog?.entries.filter((e) => e.timeSlot === 'morning') ?? [];
  const eveningEntries = dayLog?.entries.filter((e) => e.timeSlot === 'evening') ?? [];

  const uniqueByProduct = (entries: LogEntry[]) => {
    const seen = new Set<string>();
    return entries.filter((e) => {
      if (seen.has(e.productId)) return false;
      seen.add(e.productId);
      return true;
    });
  };

  const morningUniq = uniqueByProduct(morningEntries);
  const eveningUniq = uniqueByProduct(eveningEntries);

  // EXPERT TIP 하이라이팅 제품 추출
  // routineId → session → 해당 날짜 dayIdx → expertTip 텍스트 → 제품명 매칭
  const routineId = dayLog?.entries[0]?.routineId;
  const session = routineId ? sessions.find(s => s.id === routineId) : null;

  function getExpertTipProducts(slotKey: 'morning' | 'evening'): Product[] {
    if (!session) return [];
    const slot = session[slotKey];
    // 날짜 기반 DAY 인덱스 계산
    const date = parseISO(dateStr);
    date.setHours(0, 0, 0, 0);
    const start = parseISO(session.startDate);
    start.setHours(0, 0, 0, 0);
    const diff = Math.max(0, Math.floor((date.getTime() - start.getTime()) / 86400000));
    const count = slot.days.length || 1;
    const dayIdx = diff % count;
    const day = slot.days[dayIdx] ?? slot.days[0];
    if (!day?.expertTip?.trim()) return [];
    const text = day.expertTip.toLowerCase();
    const allProducts = Array.from(products.values());
    return allProducts
      .sort((a, b) => b.name.length - a.name.length)
      .filter(p => p.name.trim() && text.includes(p.name.toLowerCase()));
  }

  const morningExpertProds = getExpertTipProducts('morning');
  const eveningExpertProds = getExpertTipProducts('evening');

  // 시간대 섹션 렌더러
  const renderSlot = (
    label: string,
    icon: string,
    entries: LogEntry[],
    hasLog: boolean,
    expertProds: Product[],
  ) => (
    <div
      style={{
        background: '#FFFFFF',
        border: '1px solid #0C0C0A',
        borderRadius: 16,
        overflow: 'hidden',
        flex: 1,
      }}
    >
      {/* 시간대 헤더 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '12px 14px',
          borderBottom: '1px solid #0C0C0A',
          background: hasLog ? '#F5FDD4' : '#F4F4F0',
        }}
      >
        <span style={{ fontSize: 14 }}>{icon}</span>
        <span
          style={{
            fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
            fontSize: 12,
            fontWeight: 800,
            letterSpacing: '0.06em',
            color: hasLog ? '#0C0C0A' : '#9A9490',
          }}
        >
          {label}
        </span>
        {hasLog && (
          <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }}>
            <CatBadge color={label === 'MORNING' ? '#C5FF00' : '#f7bc45'} size={18} />
          </span>
        )}
      </div>

      {/* 제품 목록 */}
      <div style={{ padding: '10px 14px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {entries.length === 0 ? (
          <div style={{ fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif", fontSize: 12, color: '#9A9490', textAlign: 'center', padding: '10px 0' }}>
            {hasLog ? '기록 없음' : '미완료'}
          </div>
        ) : (
          entries.map((entry) => {
            const product = products.get(entry.productId);
            return (
              <div key={entry.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 28, height: 28, borderRadius: 9999, background: '#EEEDE9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flexShrink: 0 }}>🧴</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif", fontSize: 13, fontWeight: 600, color: '#0C0C0A', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                    {product?.name ?? '알 수 없는 제품'}
                  </div>
                  {entry.amount != null && entry.amount > 0 && (
                    <div style={{ fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif", fontSize: 11, color: '#9A9490', marginTop: 1 }}>
                      {entry.amount}{product?.itemUnit ? ` ${product.itemUnit}` : ''} 사용
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}

        {/* EXPERT TIP 하이라이팅 제품 */}
        {expertProds.length > 0 && (
          <>
            <div style={{ height: 1, background: 'rgba(12,12,10,.07)', margin: '4px 0' }} />
            <div style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 9, fontWeight: 800, letterSpacing: '.12em', color: '#A1A1AA', marginBottom: 2 }}>TIPS</div>
            {expertProds.map((p) => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 28, height: 28, borderRadius: 9999, background: 'rgba(197,255,0,.18)', border: '1px solid rgba(132,176,0,.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flexShrink: 0 }}>✨</div>
                <div style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 13, fontWeight: 600, color: '#3A6000', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                  {p.name}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );

  return (
    <div
      style={{
        margin: '0 26px',
        background: '#FFFFFF',
        border: '1px solid #0C0C0A',
        borderRadius: 20,
        overflow: 'hidden',
        boxShadow: '0 1px 2px rgba(0,0,0,.04)',
      }}
    >
      {/* 날짜 헤더 */}
      {(() => {
        const startSession = sessions.find(s => s.startDate === dateStr);
        const startLabel = startSession ? (startSession.sessionTag ?? `${startSession.sessionNumber}회`) : null;
        const fh = "'Plus Jakarta Sans','Space Grotesk',sans-serif";
        return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 26px',
          borderBottom: '1px solid #0C0C0A',
          background: '#F4F4F0',
          position: 'relative',
          overflow: 'visible',
        }}
      >
        {/* 세션 시작일 TODAY 도장 뱃지 */}
        {startLabel && (
          <div style={{ position: 'absolute', top: -14, right: 52, zIndex: 5, pointerEvents: 'none' }}>
            <TodayStampBadge size={56} rotate={-10} label={startLabel} f={fh} />
          </div>
        )}
        <div>
          <div
            style={{
              fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
              fontSize: 16,
              fontWeight: 800,
              color: '#0C0C0A',
            }}
          >
            {dateLabel}
          </div>
          {/* 완료 현황 요약 */}
          <div
            style={{
              fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
              fontSize: 12,
              color: '#9A9490',
              marginTop: 2,
            }}
          >
            {dayLog ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                {dayLog.hasMorning && <><CatBadge color="#C5FF00" size={13} /><span>아침</span></>}
                {dayLog.hasMorning && dayLog.hasEvening && <span> · </span>}
                {dayLog.hasEvening && <><CatBadge color="#f7bc45" size={13} /><span>저녁</span></>}
              </span>
            ) : '기록 없음'}
          </div>

          {/* 수동 완료 토글 버튼 */}
          {(onToggleMorning || onToggleEvening) && (
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              {onToggleMorning && (
                <button
                  onClick={onToggleMorning}
                  style={{
                    height: 28, padding: '0 12px', borderRadius: 9999,
                    border: `1.5px solid ${dayLog?.hasMorning ? '#C5FF00' : 'rgba(12,12,10,.2)'}`,
                    background: dayLog?.hasMorning ? '#C5FF00' : 'transparent',
                    fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif",
                    fontSize: 11, fontWeight: 700,
                    color: dayLog?.hasMorning ? '#2D5200' : '#9A9490',
                    cursor: 'pointer',
                  }}
                >
                  {dayLog?.hasMorning ? '☀ 아침 취소' : '+ 아침 완료'}
                </button>
              )}
              {onToggleEvening && (
                <button
                  onClick={onToggleEvening}
                  style={{
                    height: 28, padding: '0 12px', borderRadius: 9999,
                    border: `1.5px solid ${dayLog?.hasEvening ? '#f7bc45' : 'rgba(12,12,10,.2)'}`,
                    background: dayLog?.hasEvening ? '#f7bc45' : 'transparent',
                    fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif",
                    fontSize: 11, fontWeight: 700,
                    color: dayLog?.hasEvening ? '#7A4F00' : '#9A9490',
                    cursor: 'pointer',
                  }}
                >
                  {dayLog?.hasEvening ? '🌙 저녁 취소' : '+ 저녁 완료'}
                </button>
              )}
            </div>
          )}
        </div>

        {/* 닫기 버튼 */}
        <button
          onClick={onClose}
          style={{
            width: 28,
            height: 28,
            borderRadius: 9999,
            background: 'rgba(12,12,10,.07)',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 14,
            color: '#9A9490',
          }}
          aria-label="닫기"
        >
          ×
        </button>
      </div>
        );
      })()}

      {/* 아침 / 저녁 카드 (나란히 배치) */}
      <div style={{ display: 'flex', gap: 8, padding: 12 }}>
        {renderSlot('MORNING', '☀', morningUniq, dayLog?.hasMorning ?? false, morningExpertProds)}
        {renderSlot('NIGHT', '🌙', eveningUniq, dayLog?.hasEvening ?? false, eveningExpertProds)}
      </div>

      {/* 오늘 날짜 + 미완료 → TODAY 바로가기 */}
      {(() => {
        const todayStr = format(new Date(), 'yyyy-MM-dd');
        const isToday = dateStr === todayStr;
        const incomplete = isToday && (!dayLog?.hasMorning || !dayLog?.hasEvening);
        if (!incomplete) return null;
        const f = "'Plus Jakarta Sans','Space Grotesk',sans-serif";
        return (
          <div style={{ margin: '0 12px 12px', padding: '12px 14px', background: '#F5FDD4', border: '1px solid #C5FF00', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: f, fontSize: 12, fontWeight: 700, color: '#0C0C0A' }}>
                {!dayLog?.hasMorning && !dayLog?.hasEvening ? '아침·저녁 루틴이 미완료예요' :
                 !dayLog?.hasMorning ? '아침 루틴이 미완료예요' : '저녁 루틴이 미완료예요'}
              </div>
            </div>
            <Link href="/" style={{ flexShrink: 0, height: 32, padding: '0 14px', background: '#0C0C0A', borderRadius: 9999, display: 'flex', alignItems: 'center', fontFamily: f, fontSize: 11, fontWeight: 800, color: '#C5FF00', textDecoration: 'none', whiteSpace: 'nowrap' as const }}>
              TODAY →
            </Link>
          </div>
        );
      })()}

      {/* 약 루틴 (Medication) */}
      {(() => {
        const f = "'Plus Jakarta Sans','Space Grotesk',sans-serif";
        const activeMeds = medRoutines.filter(m => m.active);
        if (activeMeds.length === 0) return null;
        const getTime = (m: import('@/types/medication').MedRoutine) => {
          if (m.time) return m.time;
          const first = (m.times ?? [])[0];
          return first === 'morning' ? '09:00' : first === 'lunch' ? '12:00' : first === 'evening' ? '18:00' : '22:00';
        };
        // 아침(파랑) 04-12 · 점심(오렌지) 12-18 · 저녁(핑크) 18-04
        // times 배열 우선, 없으면 time 필드 시간대로 결정
        const periodOf = (m: { time?: string; times?: string[] }): 'am' | 'pm' | 'ev' => {
          if (m.time && m.time.trim()) { const h = parseInt(m.time.split(':')[0], 10); return h >= 4 && h < 12 ? 'am' : h >= 12 && h < 18 ? 'pm' : 'ev'; }
          const ts = m.times ?? [];
          if (ts.includes('morning')) return 'am';
          if (ts.includes('lunch')) return 'pm';
          if (ts.some((t: string) => t === 'evening' || t === 'bedtime')) return 'ev';
          return 'ev';
        };
        const amMeds = activeMeds.filter(m => periodOf(m) === 'am');
        const pmMeds = activeMeds.filter(m => periodOf(m) === 'pm');
        const evAll  = activeMeds.filter(m => periodOf(m) === 'ev');
        const MedRow = ({ m, col }: { m: import('@/types/medication').MedRoutine; col: string }) => {
          const done = medChecked.has(m.id);
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '4px 0' }}>
              <div style={{ width: 14, height: 14, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {done ? <CatBadge color="#C5FF00" size={14} /> : <span style={{ fontSize: 9, color: 'rgba(12,12,10,.3)' }}>○</span>}
              </div>
              <span style={{ fontFamily: f, fontSize: 11, fontWeight: 700, color: done ? col : '#44474A', width: 36, flexShrink: 0 }}>{getTime(m)}</span>
              <span style={{ fontFamily: f, fontSize: 12, fontWeight: 600, color: done ? '#9A9490' : '#0C0C0A', textDecoration: done ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{m.name}</span>
            </div>
          );
        };
        const MedGroup = ({ label, col, meds }: { label: string; col: string; meds: import('@/types/medication').MedRoutine[] }) =>
          meds.length === 0 ? null : (
            <div style={{ marginBottom: 6 }}>
              <div style={{ fontFamily: "'Courier New',monospace", fontSize: 9, color: col, letterSpacing: '.04em', marginBottom: 3 }}>·+ +°.{label}°·++·° *</div>
              {meds.map(m => <MedRow key={m.id} m={m} col={col} />)}
            </div>
          );
        return (
          <div style={{ padding: '10px 14px', borderTop: '1px solid rgba(12,12,10,.06)' }}>
            <div style={{ fontFamily: f, fontSize: 10, fontWeight: 700, color: '#9A9490', letterSpacing: '.08em', marginBottom: 6 }}>💊 약 루틴</div>
            <MedGroup label="아침" col="#6B7CE8" meds={amMeds} />
            <MedGroup label="오후" col="#E8A86B" meds={pmMeds} />
            <MedGroup label="저녁" col="#E86BAA" meds={evAll} />
          </div>
        );
      })()}

      {/* 건강 루틴 (Health) */}
      {(() => {
        const f = "'Plus Jakarta Sans','Space Grotesk',sans-serif";
        const activeRoutines = healthRoutines.filter(h => h.active && h.showInToday);
        if (activeRoutines.length === 0) return null;
        return (
          <div style={{ padding: '10px 14px', borderTop: '1px solid rgba(12,12,10,.06)' }}>
            <div style={{ fontFamily: f, fontSize: 10, fontWeight: 700, color: '#9A9490', letterSpacing: '.08em', marginBottom: 6 }}>🏃 건강루틴</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {activeRoutines.map(h => {
                const done = healthChecked.has(h.id);
                const timed = (h.entries ?? []).map((e: { time: string }) => e.time).filter((t: string) => t && t.includes(':'));
                const pt = timed.length > 0 ? (timed as string[]).sort()[0] : (h.time && h.time.includes(':') ? h.time : '');
                return (
                  <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '4px 0' }}>
                    <div style={{ width: 14, height: 14, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {done ? <CatBadge color="#C5FF00" size={14} /> : <span style={{ fontSize: 9, color: 'rgba(12,12,10,.3)' }}>○</span>}
                    </div>
                    {pt && <span style={{ fontFamily: f, fontSize: 11, fontWeight: 700, color: done ? '#C5C6CA' : '#44474A', width: 36, flexShrink: 0 }}>{pt}</span>}
                    <span style={{ fontFamily: f, fontSize: 12, fontWeight: 600, color: done ? '#9A9490' : '#0C0C0A', textDecoration: done ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{h.name}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* 식단 플랜 (Diet) */}
      {(() => {
        const f = "'Plus Jakarta Sans','Space Grotesk',sans-serif";
        const activePrograms = dietPrograms.filter(p => p.showInToday);
        if (activePrograms.length === 0) return null;
        // dietChecked: programId Set — 해당 날짜에 하나라도 완료한 프로그램 ID 집합
        return (
          <div style={{ padding: '10px 14px', borderTop: '1px solid rgba(12,12,10,.06)' }}>
            <div style={{ fontFamily: f, fontSize: 10, fontWeight: 700, color: '#9A9490', letterSpacing: '.08em', marginBottom: 6 }}>🥗 식단플랜</div>
            {activePrograms.map(p => {
              const dayN = Math.floor((new Date(dateStr).getTime() - new Date(p.startDate).getTime()) / 86400000) + 1;
              const sortedPats = [...(p.patterns ?? [])].sort((a, b) => a.dayStart - b.dayStart);
              const pat = sortedPats.find(pt => dayN >= pt.dayStart && dayN <= pt.dayEnd) ?? sortedPats[sortedPats.length - 1];
              if (!pat) return null;
              type DS = import('@/types/dietplan').DietSlot;
              const slots: DS[] = pat.timeline.filter((it): it is DS => !it.isWarning);
              // 날짜 단위로는 program 완료 여부만 알 수 있음 (월별 구독은 programId 단위)
              const programDone = dietChecked.has(p.id);
              return (
                <div key={p.id} style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    {programDone && <CatBadge color="#C5FF00" size={14} />}
                    <span style={{ fontFamily: f, fontSize: 11, fontWeight: 700, color: '#0C0C0A' }}>{p.name}</span>
                    <span style={{ fontFamily: f, fontWeight: 400, color: '#9A9490', fontSize: 10 }}>D+{dayN} · {pat.label}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {slots.map(slot => (
                      <div key={slot.id} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '3px 0' }}>
                        {slot.time && <span style={{ fontFamily: f, fontSize: 10, fontWeight: 800, background: '#0C0C0A', color: '#C5FF00', padding: '1px 6px', borderRadius: 4, flexShrink: 0 }}>{slot.time}</span>}
                        <span style={{ fontFamily: f, fontSize: 12, fontWeight: 600, color: '#0C0C0A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{slot.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* 그날의 MOTD / OOTD — 컨텐츠 이미지 */}
      {(() => {
        const f = "'Plus Jakarta Sans','Space Grotesk',sans-serif";
        const dayMotd = makeupItems.filter(i => (i.dates ?? []).includes(dateStr));
        const dayOotd = lookItems.filter(i => (i.dates ?? []).includes(dateStr));
        if (!dayMotd.length && !dayOotd.length) return null;
        return (
          <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* 메이크업 */}
            {dayMotd.length > 0 && (
              <div>
                <div style={{ fontFamily: f, fontSize: 10, fontWeight: 700, color: '#9A9490', letterSpacing: '.08em', marginBottom: 8 }}>MOTD</div>
                <div style={{ display: 'flex', gap: 8, overflowX: 'auto', scrollbarWidth: 'none' }}>
                  {dayMotd.map(item => (
                    <div key={item.id} style={{ flexShrink: 0, width: 80, display: 'flex', flexDirection: 'column', gap: 5 }}>
                      <div style={{ width: 80, height: 80, borderRadius: 10, overflow: 'hidden', background: 'linear-gradient(135deg,#f5f0ff,#d0b0ff)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {item.imageUrl
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={item.imageUrl} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                          : <span style={{ fontSize: 32 }}>{item.emoji || '💄'}</span>
                        }
                      </div>
                      <span style={{ fontFamily: f, fontSize: 10, fontWeight: 600, color: '#0C0C0A', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{item.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* 코디 — 3:4 세로형 */}
            {dayOotd.length > 0 && (
              <div>
                <div style={{ fontFamily: f, fontSize: 10, fontWeight: 700, color: '#9A9490', letterSpacing: '.08em', marginBottom: 8 }}>OOTD</div>
                <div style={{ display: 'flex', gap: 8, overflowX: 'auto', scrollbarWidth: 'none' }}>
                  {dayOotd.map(item => (
                    <div key={item.id} style={{ flexShrink: 0, width: 80, display: 'flex', flexDirection: 'column', gap: 5 }}>
                      <div style={{ width: 80, height: 106, borderRadius: 10, overflow: 'hidden', background: 'linear-gradient(135deg,#fff0f5,#ffc0d0)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {item.imageUrl
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={item.imageUrl} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                          : <span style={{ fontSize: 36 }}>{item.emoji || '👗'}</span>
                        }
                      </div>
                      <span style={{ fontFamily: f, fontSize: 10, fontWeight: 600, color: '#0C0C0A', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{item.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

// ─── 최근 7일 요약 스트립 ──────────────────────────────────────────────────────
//
// 이번 주 / 직전 주 수행 현황을 한눈에 보여주는 가로 스크롤 스트립

function RecentStrip({
  dayLogs,
  selectedDate,
  onSelectDate,
}: {
  dayLogs: Map<string, DayLog>;
  selectedDate: string | null;
  onSelectDate: (dateStr: string) => void;
}) {
  // 오늘 포함 최근 7일 날짜 배열 (최신이 오른쪽)
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return d;
  });

  return (
    <div style={{ padding: '0 26px', overflow: 'hidden' }}>
      <div
        style={{
          fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: '#9A9490',
          marginBottom: 10,
        }}
      >
        최근 7일
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        {days.map((day) => {
          const ds = toDateStr(day);
          const log = dayLogs.get(ds);
          const isSelected = selectedDate === ds;
          const today = isToday(day);
          const bothDone = log?.hasMorning && log?.hasEvening;
          const halfDone = log && (log.hasMorning || log.hasEvening) && !bothDone;

          return (
            <button
              key={ds}
              onClick={() => onSelectDate(isSelected ? '' : ds)}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 5,
                padding: '8px 4px',
                borderRadius: 12,
                border: isSelected && today
                  ? '1.5px solid #0C0C0A'
                  : isSelected
                  ? '2px solid rgba(0,0,0,0.5)'
                  : today
                  ? '1.5px solid rgba(12,12,10,.2)'
                  : '1.5px solid transparent',
                background: isSelected && today ? 'transparent' : isSelected ? 'rgba(0,0,0,0.5)' : bothDone ? '#F5FDD4' : 'transparent',
                cursor: 'pointer',
                transition: 'all .15s',
              }}
            >
              {/* 요일 */}
              <span
                style={{
                  fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
                  fontSize: 10,
                  fontWeight: 700,
                  color: isSelected && today ? '#0C0C0A' : isSelected ? '#C5FF00' : '#9A9490',
                }}
              >
                {format(day, 'EEE', { locale: ko }).slice(0, 1)}
              </span>

              {/* 날짜 숫자 */}
              <span
                style={{
                  fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
                  fontSize: 15,
                  fontWeight: today || isSelected ? 800 : 400,
                  color: isSelected && !today ? '#FFFFFF' : today ? '#0C0C0A' : '#4A4846',
                  position: 'relative', zIndex: 1,
                }}
              >
                {format(day, 'd')}
              </span>

              {/* 오늘: 하나라도 완료면 캐릭터 / 나머지: 아침(라임)·저녁(블랙) 닷 */}
              {/* 아침(라임)·저녁(오렌지) SVG 고양이 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'center' }}>
                <span style={{ opacity: log?.hasMorning ? 1 : 0.8 }}><CatBadge color={log?.hasMorning ? '#C5FF00' : 'rgba(12,12,10,.12)'} size={18} /></span>
                <span style={{ opacity: log?.hasEvening ? 1 : 0.8 }}><CatBadge color={log?.hasEvening ? '#f7bc45' : 'rgba(12,12,10,.12)'} size={18} /></span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Library 카드 ─────────────────────────────────────────────────────────────
// design/log.html .lib-card 구조 기반 + Today 즉시 적용 버튼

function fmtDate(s: string) {
  if (!s) return '';
  const [, m, d] = s.split('-').map(Number);
  return `${m}월 ${d}일`;
}

const TPO_OPTIONS = ['데일리', '오피스', '데이트', '파티', '캐주얼', '포멀', '스포티', '여행'];

function LogLibraryCard({
  item, products, onEdit,
}: {
  item: CtItem;
  products: Map<string, Product>;
  onEdit?: () => void;
}) {
  const f = "'Plus Jakarta Sans', 'Space Grotesk', sans-serif";
  const isMakeup = item.ctType === 'makeup';
  const badge = isMakeup ? '#MAKEUP' : '#LOOKBOOK';
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const isOnToday = item.published && (item.dates ?? []).includes(todayStr);
  const prodItems = item.items.filter((r): r is { type: 'product'; id: string } => r.type === 'product');

  // 통계
  const dates = (item.dates ?? []).sort().reverse();
  const totalCount = dates.length;
  const lastDate = dates[0] ? format(new Date(dates[0]), 'yyyy.MM.dd') : null;
  const recentDates = dates.slice(0, 5);

  return (
    <div style={{ marginBottom: 12, border: '1px solid #000000', background: '#FFFFFF' }}>

      {/* ① 이미지 — full bleed (패딩 없음) */}
      <div style={{ position: 'relative', width: '100%', background: '#F3F3F4', overflow: 'visible' }}>
        {/* 라임 배지 */}
        <div style={{
          position: 'absolute', right: 7, top: 10,
          width: 113, height: 32,
          background: '#C6F432', border: '1px solid #18181B',
          transform: 'rotate(-3deg)',
          display: 'flex', alignItems: 'center', padding: '0 12px',
          zIndex: 3,
        }}>
          <span style={{ fontFamily: f, fontSize: 14, fontWeight: 700, color: '#525252', transform: 'rotate(-3deg)' }}>{badge}</span>
        </div>

        {item.imageUrl
          ? // eslint-disable-next-line @next/next/no-img-element
            <img src={item.imageUrl} alt={item.name} style={{ width: '100%', height: 'auto', display: 'block' }} />
          : <div style={{ width: '100%', aspectRatio: '4/3', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: 220, opacity: 0.5, lineHeight: 1 }}>{item.emoji || (isMakeup ? '💄' : '👗')}</span>
            </div>
        }

        {isOnToday && (
          <div style={{ position: 'absolute', bottom: -45, right: -20, transform: 'rotate(-9deg)', zIndex: 4, width: 88, height: 88, borderRadius: '50%', border: '3px solid rgba(190,30,30,.75)', background: 'rgba(255,255,255,.7)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', mixBlendMode: 'multiply' as const, flexShrink: 0 }}>
            <div style={{ position: 'absolute', inset: 5, borderRadius: '50%', border: '1px solid rgba(190,30,30,.3)', pointerEvents: 'none' }} />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="today" style={{ width: 34, height: 34, objectFit: 'contain', filter: 'sepia(1) saturate(8) hue-rotate(-20deg) contrast(1.2)', opacity: .8, marginBottom: 1, position: 'relative', zIndex: 1 }} />
            <div style={{ fontFamily: f, fontSize: 8, fontWeight: 900, letterSpacing: '.32em', color: 'rgba(190,30,30,.85)', textTransform: 'uppercase' as const, marginTop: -2, position: 'relative', zIndex: 1 }}>TODAY</div>
          </div>
        )}
      </div>

      {/* ② 텍스트 콘텐츠 */}
      <div style={{
        boxSizing: 'border-box',
        display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
        padding: '12px 26px 0px',
        width: '100%',
        isolation: 'isolate',
        flexShrink: 0,
      }}>
        {/* 제목 */}
        <div style={{ fontFamily: f, fontSize: 20, fontWeight: 600, color: '#000', lineHeight: '18px', width: '100%', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const }}>{item.name}</div>
        {/* daily — 우측 정렬 */}
        {item.daily && <div style={{ width: '100%', textAlign: 'right', fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.1em', color: '#BCBAB6', marginTop: 6 }}>{item.daily}</div>}
        {/* 서브 */}
        <div style={{ fontFamily: f, fontSize: 16, fontWeight: 400, color: '#000', lineHeight: '18px', marginTop: 4, marginBottom: 12, width: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{item.tpo?.join(' · ') || (isMakeup ? 'makeup' : 'lookbook')}</div>
        {item.sourceUrl?.trim() && (() => {
          let domain = item.sourceUrl;
          try { domain = new URL(item.sourceUrl).hostname; } catch {}
          return (
            <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer"
              style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 20, padding: '8px 12px', border: '1px solid rgba(12,12,10,.15)', borderRadius: 8, textDecoration: 'none', fontFamily: f, fontSize: 11, fontWeight: 700, color: '#4A4846', letterSpacing: '.04em', background: 'rgba(0,0,0,.03)', width: '100%', boxSizing: 'border-box' as const }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ flexShrink: 0 }}>
                <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/>
                <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>
              </svg>
              SOURCE
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 400, color: '#9A9490' }}>{domain}</span>
            </a>
          );
        })()}
        {!item.sourceUrl?.trim() && <div style={{ height: 20 }} />}
      </div>

      {/* 제품 영역 — borderTop 구분선 */}
      {prodItems.length > 0 && (
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '12px 8px 8px', width: '100%', scrollbarWidth: 'none' as const, borderTop: '1px solid #000000', boxSizing: 'border-box' as const }}>
          {prodItems.map((it, idx) => {
            const p = products.get(it.id);
            const imgSrc = p?.imageUrl || p?.storageUrl;
            return (
              <div key={idx} style={{ flexShrink: 0, width: 120, display: 'flex', flexDirection: 'column', gap: 5 }}>
                <div style={{ width: 120, height: 160, borderRadius: 0, background: '#F3F3F4', border: '1px solid #000000', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {imgSrc ? <img src={imgSrc} alt={p?.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <span style={{ fontSize: 24, opacity: 0.2 }}>🧴</span>}
                </div>
                <span style={{ fontFamily: f, fontSize: 11, fontWeight: 600, color: '#525252', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{p?.name ?? ''}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* 통계 영역 */}
      <div style={{ padding: '14px 26px 8px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* 총 적용 횟수 + 마지막 적용일 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
            <span style={{ fontFamily: f, fontSize: 28, fontWeight: 800, color: '#0C0C0A', lineHeight: 1 }}>{totalCount}</span>
            <span style={{ fontFamily: f, fontSize: 11, fontWeight: 700, color: '#9A9490', letterSpacing: '.06em' }}>회 적용</span>
          </div>
          {lastDate && (
            <>
              <div style={{ width: 1, height: 16, background: 'rgba(12,12,10,.12)' }} />
              <span style={{ fontFamily: f, fontSize: 11, fontWeight: 600, color: '#9A9490' }}>마지막 {lastDate}</span>
            </>
          )}
        </div>
        {/* 최근 날짜 태그 */}
        {recentDates.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {recentDates.map(d => (
              <span key={d} style={{ fontFamily: f, fontSize: 11, fontWeight: 600, color: d === todayStr ? '#0C0C0A' : '#6B6966', background: d === todayStr ? '#C5FF00' : '#F3F3F1', padding: '3px 10px', borderRadius: 9999 }}>
                {format(new Date(d), 'MM.dd')}
              </span>
            ))}
            {totalCount > 5 && <span style={{ fontFamily: f, fontSize: 11, color: '#BCBAB6', padding: '3px 4px' }}>+{totalCount - 5}회</span>}
          </div>
        )}
        {totalCount === 0 && (
          <span style={{ fontFamily: f, fontSize: 12, color: '#BCBAB6' }}>아직 적용 기록이 없습니다</span>
        )}
      </div>
      {onEdit && (
        <button onClick={onEdit} style={{ width: '100%', padding: '12px 0', background: '#F3F3F1', color: '#0C0C0A', border: 'none', borderTop: '1px solid #000000', borderRadius: 0, fontFamily: f, fontSize: 12, fontWeight: 700, letterSpacing: '.06em', cursor: 'pointer' }}>편집</button>
      )}
    </div>
  );
}

// ─── 이미지 리사이즈 유틸 (box/page.tsx와 동일 패턴) ──────────────────────────
function resizeImage(file: File, maxPx = 800, quality = 0.82): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const { naturalWidth: w, naturalHeight: h } = img;
      if (w <= maxPx && h <= maxPx) { resolve(file); return; }
      const scale = maxPx / Math.max(w, h);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        blob => {
          if (!blob) { reject(new Error('toBlob 실패')); return; }
          resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }));
        },
        'image/jpeg', quality,
      );
    };
    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('이미지 로드 실패')); };
    img.src = objectUrl;
  });
}

// ─── 아이템 등록 바텀시트 ─────────────────────────────────────────────────────
// design/log.html #add-sheet 구조 기반

function AddItemSheet({
  ctType, userId, products, onClose, onSaved,
}: {
  ctType: CtType;
  userId: string;
  products: Map<string, Product>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const f = "'Plus Jakarta Sans', 'Space Grotesk', sans-serif";
  const [emoji, setEmoji] = useState(ctType === 'makeup' ? '💄' : '👗');
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [tpo, setTpo] = useState<string[]>([]);
  const [imgFile, setImgFile] = useState<File | null>(null);
  const [imgPreview, setImgPreview] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [selectedProds, setSelectedProds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const domainProducts = ctType === 'makeup'
    ? Array.from(products.values()).filter(p => p.domain === 'beauty' && p.subCategory === 'makeup')
    : Array.from(products.values()).filter(p => p.domain === 'fashion' || p.domain === 'acc');

  const filteredProds = pickerSearch.trim()
    ? domainProducts.filter(p => p.name.toLowerCase().includes(pickerSearch.toLowerCase()))
    : domainProducts;

  // 검색어로 제품 없을 때 → BOX에 즉시 등록 후 피커에 추가
  async function registerAndAddProduct(prodName: string) {
    if (!db || !prodName.trim()) return;
    const now = new Date().toISOString();
    const domain = ctType === 'makeup' ? 'beauty' : 'fashion';
    const subCategory = ctType === 'makeup' ? 'makeup' : undefined;
    const ref = await addDoc(collection(db, 'users', userId, 'products'), {
      name: prodName.trim(), brand: '', domain, ...(subCategory ? { subCategory } : {}),
      packageCount: 1, unitPerPackage: 0, itemUnit: '', totalAmount: 0,
      dosePerUse: 0, usesPerDay: 1, frequencyType: 'daily', currentRemaining: 0,
      createdAt: now, updatedAt: now,
    });
    setSelectedProds(prev => { const n = new Set(prev); n.add(ref.id); return n; });
    setPickerSearch('');
  }

  async function handleSave() {
    if (!name.trim() || !db) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const colName = ctType === 'makeup' ? 'makeupItems' : 'lookItems';
      const items: RoutineItem[] = Array.from(selectedProds).map(id => ({ type: 'product', id }));

      // Base64 이미지를 포함해서 바로 저장 (Firebase Storage 불필요)
      await addDoc(collection(db, 'users', userId, colName), {
        ctType, emoji: emoji || (ctType === 'makeup' ? '💄' : '👗'),
        name: name.trim(), desc: desc.trim(),
        items, tipItems: [], expertTip: '',
        ...(imgPreview ? { imageUrl: imgPreview } : {}),
        ...(ctType === 'lookbook' && tpo.length > 0 ? { tpo } : {}),
        published: false, dates: [],
        createdAt: now, updatedAt: now,
      });

      onSaved();
    } catch (err) {
      console.error('[OnStep] 저장 실패:', err);
      alert('저장에 실패했습니다. 로그인 상태를 확인해주세요.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 200 }} />
      <div style={{ position: 'fixed', bottom: 0, left: 'max(0px,calc(50vw - 215px))', right: 'max(0px,calc(50vw - 215px))', zIndex: 210, background: '#fff', borderRadius: '24px 24px 0 0', maxHeight: '90vh', overflowY: 'auto', paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 32px)', scrollbarWidth: 'none' as const }}>
        <div style={{ padding: '20px 20px 0' }}>
          <div style={{ width: 32, height: 3, background: 'rgba(12,12,10,.14)', borderRadius: 2, margin: '0 auto 20px' }} />
          <div style={{ fontFamily: f, fontSize: 20, fontWeight: 800, color: '#0C0C0A', marginBottom: 4 }}>
            {ctType === 'makeup' ? '메이크업 추가' : '룩 추가'}
          </div>
          <div style={{ fontFamily: f, fontSize: 12, color: '#9A9490', marginBottom: 20 }}>등록 후 Library에서 Today 즉시 적용 가능</div>

          {/* 이미지 */}
          <div style={{ marginBottom: 16 }}>
            <ImagePicker
              preview={imgPreview}
              onChange={(file, base64) => { setImgFile(file); setImgPreview(base64); }}
              onClear={() => { setImgFile(null); setImgPreview(''); }}
              height={180}
              placeholderLabel="BASELINE 이미지"
              naturalSize
            />
          </div>

          {/* 이모지 + 이름 */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <input value={emoji} onChange={e => setEmoji(e.target.value)} maxLength={2} style={{ width: 52, padding: '10px 6px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 10, fontSize: 22, textAlign: 'center', background: '#fff', outline: 'none', flexShrink: 0 }} />
            <input value={name} onChange={e => setName(e.target.value)} placeholder="이름 *" style={{ flex: 1, padding: '12px 14px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 10, fontFamily: f, fontSize: 14, color: '#0C0C0A', background: '#fff', outline: 'none' }} />
          </div>

          {/* 설명 */}
          <textarea value={desc} onChange={e => setDesc(e.target.value)} placeholder="간단한 설명 (선택)" rows={2} style={{ width: '100%', padding: '10px 14px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 10, fontFamily: f, fontSize: 13, color: '#0C0C0A', background: '#fff', outline: 'none', resize: 'none', boxSizing: 'border-box' as const, marginBottom: 16, lineHeight: 1.5 }} />

          {/* TPO (룩북만) */}
          {ctType === 'lookbook' && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.1em', color: '#9A9490', marginBottom: 8 }}>T.P.O</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {TPO_OPTIONS.map(tp => (
                  <button key={tp} onClick={() => setTpo(p => p.includes(tp) ? p.filter(x => x !== tp) : [...p, tp])} style={{ padding: '6px 12px', borderRadius: 9999, border: `1.5px solid ${tpo.includes(tp) ? '#0C0C0A' : 'rgba(12,12,10,.14)'}`, background: tpo.includes(tp) ? '#0C0C0A' : 'transparent', color: tpo.includes(tp) ? '#fff' : '#4A4846', fontFamily: f, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{tp}</button>
                ))}
              </div>
            </div>
          )}

          {/* BOX 제품 연결 */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.1em', color: '#9A9490', marginBottom: 8 }}>BOX 제품 연결</div>
            <button onClick={() => setPickerOpen(true)} style={{ width: '100%', padding: '12px', border: '1.5px dashed rgba(12,12,10,.14)', borderRadius: 10, background: 'transparent', fontFamily: f, fontSize: 12, fontWeight: 700, color: '#9A9490', cursor: 'pointer' }}>
              {selectedProds.size > 0 ? `${selectedProds.size}개 선택됨 · 변경` : '+ BOX에서 불러오기'}
            </button>
            {selectedProds.size > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                {Array.from(selectedProds).map(id => {
                  const p = products.get(id);
                  return <span key={id} style={{ fontFamily: f, fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 9999, background: '#EEEDE9', color: '#0C0C0A' }}>{p?.name ?? id}</span>;
                })}
              </div>
            )}
          </div>

          {/* 버튼 */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={{ flex: 1, height: 52, background: '#EEEDE9', color: '#0C0C0A', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 12, fontFamily: f, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>취소</button>
            <button onClick={handleSave} disabled={saving || !name.trim()} style={{ flex: 1, height: 52, background: name.trim() ? '#0C0C0A' : 'rgba(12,12,10,.14)', color: name.trim() ? '#fff' : '#9A9490', border: 'none', borderRadius: 12, fontFamily: f, fontSize: 15, fontWeight: 700, cursor: name.trim() ? 'pointer' : 'default' }}>
              {saving ? '저장 중...' : '저장'}
            </button>
          </div>
        </div>
      </div>

      {/* BOX 제품 피커 */}
      {pickerOpen && (
        <>
          <div onClick={() => setPickerOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.25)', zIndex: 220 }} />
          <div style={{ position: 'fixed', bottom: 0, left: 'max(0px,calc(50vw - 215px))', right: 'max(0px,calc(50vw - 215px))', zIndex: 230, background: '#FAFAF8', borderRadius: '20px 20px 0 0', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '12px 26px 8px', flexShrink: 0 }}>
              <div style={{ width: 32, height: 3, background: 'rgba(12,12,10,.14)', borderRadius: 2, margin: '0 auto 12px' }} />
              <input type="search" value={pickerSearch} onChange={e => setPickerSearch(e.target.value)} placeholder="제품 검색..." autoFocus style={{ width: '100%', padding: '10px 12px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 8, fontFamily: f, fontSize: 13, color: '#0C0C0A', background: '#F4F4F0', outline: 'none', boxSizing: 'border-box' as const }} />
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {filteredProds.map(p => {
                const sel = selectedProds.has(p.id);
                const imgSrc = p.imageUrl || p.storageUrl;
                return (
                  <div key={p.id} onClick={() => setSelectedProds(prev => { const n = new Set(prev); sel ? n.delete(p.id) : n.add(p.id); return n; })} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 26px', borderBottom: '1px solid rgba(12,12,10,.07)', cursor: 'pointer', background: sel ? 'rgba(197,255,0,.06)' : 'transparent' }}>
                    <div style={{ width: 36, height: 36, borderRadius: 8, background: '#EEEDE9', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {imgSrc ? <img src={imgSrc} alt={p.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <span style={{ fontSize: 16 }}>{ctType === 'makeup' ? '💄' : '👗'}</span>}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: f, fontSize: 14, fontWeight: 600, color: '#0C0C0A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{p.name}</div>
                      {p.brand && <div style={{ fontFamily: f, fontSize: 12, color: '#9A9490', marginTop: 2 }}>{p.brand}</div>}
                    </div>
                    <div style={{ width: 22, height: 22, borderRadius: '50%', border: `1.5px solid ${sel ? '#8AB000' : 'rgba(12,12,10,.14)'}`, background: sel ? '#C5FF00' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#0C0C0A', flexShrink: 0 }}>{sel ? '✓' : ''}</div>
                  </div>
                );
              })}
              {/* 검색어 있고 결과 없으면 → 이름으로 BOX 등록 후 추가 */}
              {pickerSearch.trim() && filteredProds.length === 0 && (
                <div onClick={() => registerAndAddProduct(pickerSearch)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 26px', cursor: 'pointer', background: 'rgba(197,255,0,.06)', borderBottom: '1px solid rgba(12,12,10,.07)' }}>
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: '#C5FF00', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 300 }}>+</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: f, fontSize: 14, fontWeight: 700, color: '#0C0C0A' }}>"{pickerSearch.trim()}" 이름으로 등록 후 추가</div>
                    <div style={{ fontFamily: f, fontSize: 11, color: '#9A9490', marginTop: 2 }}>BOX에 자동 저장 · 나중에 상세 정보 수정 가능</div>
                  </div>
                </div>
              )}
              {!pickerSearch.trim() && filteredProds.length === 0 && (
                <div style={{ padding: '32px 26px', textAlign: 'center', fontFamily: f, fontSize: 13, color: '#9A9490', lineHeight: 1.6 }}>
                  {ctType === 'makeup' ? 'BOX에 메이크업 제품이 없어요' : 'BOX에 패션·악세서리 제품이 없어요'}<br />
                  이름을 검색하면 바로 등록할 수 있어요
                </div>
              )}
            </div>
            <div style={{ padding: '12px 26px calc(env(safe-area-inset-bottom,0px) + 20px)', borderTop: '1px solid rgba(12,12,10,.07)', flexShrink: 0 }}>
              <button onClick={() => setPickerOpen(false)} style={{ width: '100%', height: 52, background: '#0C0C0A', color: '#fff', border: 'none', borderRadius: 12, fontFamily: f, fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>완료 ({selectedProds.size}개)</button>
            </div>
          </div>
        </>
      )}
    </>
  );
}

// ─── LOG CtPanel (setup의 Makeup/Lookbook과 동일한 구조) ──────────────────────

function LogCtPanel({
  filter, items, products, userId, onAdd, onUpdate, onDelete,
  hideAddButton, addTrigger, editTrigger, hiddenMode,
}: {
  filter: 'makeup' | 'lookbook';
  items: CtItem[];
  products: Product[];
  userId: string;
  onAdd: (data: Omit<CtItem, 'id' | 'createdAt' | 'updatedAt'>) => Promise<string>;
  onUpdate: (id: string, data: Partial<Omit<CtItem, 'id'>>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  hideAddButton?: boolean;
  addTrigger?: number;
  editTrigger?: { id: string; ts: number };
  hiddenMode?: boolean;
}) {
  const f = "'Plus Jakarta Sans','Space Grotesk',sans-serif";
  const ctType: CtType = filter;
  const colLabel = filter === 'makeup' ? '메이크업' : '룩북';
  const icon = filter === 'makeup' ? '💄' : '👗';

  // 시트 상태
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editItem, setEditItem] = useState<CtItem | null>(null);
  const [sEmoji, setSEmoji] = useState('');
  const [sName, setSName] = useState('');
  const [sDesc, setSDesc] = useState('');
  const [sDaily, setSDaily] = useState('');
  const [sItems, setSItems] = useState<RoutineItem[]>([]);
  const [sTipItems, setSTipItems] = useState<RoutineItem[]>([]);
  const [sDates, setSDates] = useState<string[]>([]);
  const [sTpo, setSTpo] = useState<string[]>([]);
  const [sPublished, setSPublished] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sImageFile, setSImageFile] = useState<File | null>(null);
  const [sImagePreview, setSImagePreview] = useState('');
  const [sSourceUrl, setSSourceUrl] = useState('');

  // picker
  const [picker, setPicker] = useState<'main' | 'tip' | null>(null);
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickerSelected, setPickerSelected] = useState<Set<string>>(new Set());

  const TPO_OPTIONS = ['데일리', '오피스', '데이트', '파티', '스포티', '캐주얼', '포멀', '여행'];

  const domainProducts = filter === 'makeup'
    ? products.filter(p => p.domain === 'beauty' && p.subCategory === 'makeup')
    : products.filter(p => p.domain === 'fashion' || p.domain === 'acc');

  const filteredPicker = pickerSearch.trim()
    ? domainProducts.filter(p => p.name.toLowerCase().includes(pickerSearch.toLowerCase()) || (p.brand ?? '').toLowerCase().includes(pickerSearch.toLowerCase()))
    : domainProducts;

  function productName(id: string) { return products.find(p => p.id === id)?.name ?? '?'; }

  function openNew() {
    setEditItem(null); setSEmoji(icon); setSName(''); setSDesc(''); setSDaily('');
    setSItems([]); setSTipItems([]); setSDates([]); setSTpo([]);
    setSPublished(false); setSImageFile(null); setSImagePreview(''); setSSourceUrl('');
    setSheetOpen(true);
  }

  // 외부 FAB → addTrigger 증가 시 자동으로 시트 열기
  useEffect(() => {
    if (addTrigger && addTrigger > 0) openNew();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addTrigger]);

  // 외부 편집 트리거 → 해당 아이템 편집 시트 열기
  useEffect(() => {
    if (!editTrigger) return;
    const target = items.find(i => i.id === editTrigger.id);
    if (target) openEdit(target);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editTrigger]);

  function openEdit(item: CtItem) {
    setEditItem(item); setSEmoji(item.emoji); setSName(item.name); setSDesc(item.desc); setSDaily(item.daily ?? '');
    setSItems(item.items); setSTipItems(item.tipItems); setSDates(item.dates ?? []);
    setSTpo(item.tpo ?? []); setSPublished(item.published);
    setSImageFile(null); setSImagePreview(item.imageUrl ?? ''); setSSourceUrl(item.sourceUrl ?? '');
    setSheetOpen(true);
  }

  function closeSheet() { setSheetOpen(false); setPicker(null); }

  async function handleSave() {
    if (!sName.trim()) return;
    setSaving(true);
    const now = new Date().toISOString();
    const colName = filter === 'makeup' ? 'makeupItems' : 'lookItems';
    // Base64 이미지 포함해서 저장 (Firebase Storage 불필요)
    const data: Omit<CtItem, 'id' | 'createdAt' | 'updatedAt'> = {
      ctType,
      emoji: sEmoji || icon,
      name: sName.trim(), desc: sDesc.trim(),
      items: sItems, tipItems: sTipItems, expertTip: '',
      published: sPublished, dates: sDates,
      ...(sSourceUrl.trim() ? { sourceUrl: sSourceUrl.trim() } : {}),
      ...(sImagePreview ? { imageUrl: sImagePreview } : {}),
      ...(sDaily.trim() ? { daily: sDaily.trim() } : {}),
      ...(filter === 'lookbook' ? { tpo: sTpo } : {}),
    };
    try {
      if (editItem) {
        await onUpdate(editItem.id, { ...data, updatedAt: now });
      } else {
        await onAdd(data);
      }
      closeSheet();
    } catch (err) {
      console.error('[LogCtPanel] 저장 실패:', err);
      alert('저장에 실패했습니다. 로그인 상태를 확인해주세요.');
    } finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!editItem || !confirm('삭제하시겠어요?')) return;
    await onDelete(editItem.id);
    closeSheet();
  }

  async function togglePublished(item: CtItem) {
    const today = format(new Date(), 'yyyy-MM-dd');
    const next = !item.published;
    const newDates = next
      ? [...new Set([...(item.dates ?? []), today])].sort()
      : (item.dates ?? []).filter(d => d !== today);
    await onUpdate(item.id, { published: next, dates: newDates, updatedAt: new Date().toISOString() });
  }

  async function confirmPicker() {
    if (!picker) return;
    const newItems: RoutineItem[] = Array.from(pickerSelected).map(id => ({ type: 'product', id }));
    if (picker === 'main') setSItems(p => [...p, ...newItems]);
    else setSTipItems(p => [...p, ...newItems]);
    setPicker(null);
  }

  // HubCard 스타일 카드 — setup HubView와 동일한 구조
  const BG = filter === 'makeup'
    ? 'linear-gradient(135deg,#f5f0ff 0%,#d0b0ff 100%)'
    : 'linear-gradient(135deg,#fff0f5 0%,#ffc0d0 100%)';
  const BADGE = filter === 'makeup' ? '#MAKEUP' : '#LOOKBOOK';
  const BADGE_COLOR = filter === 'makeup' ? '#C5FF00' : '#FF8C42';

  function HubStyleCard({ item, featured }: { item: CtItem; featured?: boolean }) {
    const today = format(new Date(), 'yyyy-MM-dd');
    const isOnToday = item.published && (item.dates ?? []).includes(today);
    const prodItems = item.items.filter((i): i is { type: 'product'; id: string } => i.type === 'product');
    const sub = item.tpo?.length ? item.tpo.slice(0, 2).join(' · ') : item.desc ? item.desc.slice(0, 28) : '';

    // featured: 히어로 340px / square: 130px
    const heroH = featured ? 340 : 130;

    /* ── featured(Card 1): 이미지 + 배지/제목 + 제품 스크롤 + CTA ── */
    if (featured) return (
      <div style={{ background: '#FAFAF8', overflow: 'hidden' }}>
        <div style={{ width: '100%', height: 340, background: item.imageUrl ? 'transparent' : BG, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 48, overflow: 'visible', position: 'relative' }}>
          {item.imageUrl ? <img src={item.imageUrl} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} /> : item.emoji || (filter === 'makeup' ? '💄' : '👗')}
          {isOnToday && (
            <div style={{ position: 'absolute', bottom: -46, right: -18, transform: 'rotate(-9deg)', zIndex: 4, width: 72, height: 72, borderRadius: '50%', border: '2.5px solid rgba(190,30,30,.75)', background: 'rgba(255,255,255,.7)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', mixBlendMode: 'multiply' as const, flexShrink: 0 }}>
              <div style={{ position: 'absolute', inset: 4, borderRadius: '50%', border: '1px solid rgba(190,30,30,.3)', pointerEvents: 'none' }} />
              <img src="/logo.png" alt="today" style={{ width: 28, height: 28, objectFit: 'contain', filter: 'sepia(1) saturate(8) hue-rotate(-20deg) contrast(1.2)', opacity: .8, marginBottom: 1, position: 'relative', zIndex: 1 }} />
              <div style={{ fontFamily: f, fontSize: 7, fontWeight: 900, letterSpacing: '.28em', color: 'rgba(190,30,30,.85)', textTransform: 'uppercase' as const, marginTop: -2, position: 'relative', zIndex: 1 }}>TODAY</div>
            </div>
          )}
        </div>
        <div style={{ padding: '12px 12px 4px' }}>
          <div style={{ display: 'inline-block', fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.1em', background: BADGE_COLOR, color: '#0C0C0A', padding: '3px 8px', borderRadius: 4, marginBottom: 6, textTransform: 'uppercase' as const }}>{BADGE}</div>
          <div style={{ fontFamily: f, fontSize: 16, fontWeight: 800, color: '#0C0C0A', lineHeight: 1.2, letterSpacing: '-.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{item.name}</div>
          {sub && <div style={{ fontFamily: f, fontSize: 11, color: '#9A9490', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{sub}</div>}
        </div>
        {prodItems.length > 0 && (
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '10px 12px 12px', scrollbarWidth: 'none' as const }}>
            {prodItems.map((it, idx) => {
              const p = products.find(pr => pr.id === it.id);
              const imgSrc = p?.imageUrl || p?.storageUrl;
              return (
                <div key={idx} style={{ flexShrink: 0, width: 100, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ width: 100, height: 100, borderRadius: 12, background: '#fff', border: '1px solid rgba(12,12,10,.1)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 4px rgba(0,0,0,.06)' }}>
                    {imgSrc ? <img src={imgSrc} alt={p?.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <span style={{ fontSize: 28, opacity: 0.2 }}>🧴</span>}
                  </div>
                  <span style={{ fontFamily: f, fontSize: 11, fontWeight: 600, color: '#0C0C0A', textAlign: 'center', width: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{p?.name ?? ''}</span>
                </div>
              );
            })}
          </div>
        )}
        <div style={{ padding: '0 12px 12px', display: 'flex', gap: 6 }}>
          <button onClick={() => togglePublished(item)} style={{ flex: 1, padding: '8px 0', background: item.published ? '#0C0C0A' : 'rgba(12,12,10,.06)', color: item.published ? '#C5FF00' : '#9A9490', border: 'none', borderRadius: 8, fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase' as const, cursor: 'pointer', transition: 'all .15s' }}>
            {item.published ? 'Today ON' : 'Today OFF'}
          </button>
          <button onClick={() => openEdit(item)} style={{ padding: '8px 10px', background: '#EEEDE9', color: '#4A4846', border: 'none', borderRadius: 8, fontFamily: f, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>편집</button>
        </div>
      </div>
    );

    /* ── square(Card 2+): 이미지 + 이름 오버레이 + 소형 제품 + 편집버튼 ── */
    return (
      <div style={{ background: '#FAFAF8', overflow: 'hidden' }}>
        {/* 이미지 — 이름 오버레이 포함 */}
        <div style={{ width: '100%', height: 180, background: item.imageUrl ? 'transparent' : BG, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, overflow: 'visible', position: 'relative' }}>
          {item.imageUrl ? <img src={item.imageUrl} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} /> : item.emoji || (filter === 'makeup' ? '💄' : '👗')}
          {/* 하단 그라데이션 + 이름 오버레이 */}
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '24px 8px 8px', background: 'linear-gradient(to top, rgba(0,0,0,.6) 0%, transparent 100%)' }}>
            <div style={{ fontFamily: f, fontSize: 12, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{item.name}</div>
          </div>
          {isOnToday && (
            <div style={{ position: 'absolute', bottom: -44, right: -22, transform: 'rotate(-9deg)', zIndex: 4, width: 60, height: 60, borderRadius: '50%', border: '2px solid rgba(190,30,30,.75)', background: 'rgba(255,255,255,.7)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', mixBlendMode: 'multiply' as const, flexShrink: 0 }}>
              <div style={{ position: 'absolute', inset: 4, borderRadius: '50%', border: '1px solid rgba(190,30,30,.25)', pointerEvents: 'none' }} />
              <img src="/logo.png" alt="today" style={{ width: 22, height: 22, objectFit: 'contain', filter: 'sepia(1) saturate(8) hue-rotate(-20deg) contrast(1.2)', opacity: .8, marginBottom: 1, position: 'relative', zIndex: 1 }} />
              <div style={{ fontFamily: f, fontSize: 6, fontWeight: 900, letterSpacing: '.24em', color: 'rgba(190,30,30,.85)', textTransform: 'uppercase' as const, marginTop: -1, position: 'relative', zIndex: 1 }}>TODAY</div>
            </div>
          )}
        </div>
        {/* 소형 제품 썸네일 */}
        {prodItems.length > 0 && (
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', padding: '8px', scrollbarWidth: 'none' as const }}>
            {prodItems.map((it, idx) => {
              const p = products.find(pr => pr.id === it.id);
              const imgSrc = p?.imageUrl || p?.storageUrl;
              return (
                <div key={idx} style={{ flexShrink: 0, width: 52, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ width: 52, height: 52, borderRadius: 8, background: '#fff', border: '1px solid rgba(12,12,10,.1)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 3px rgba(0,0,0,.06)' }}>
                    {imgSrc ? <img src={imgSrc} alt={p?.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <span style={{ fontSize: 16, opacity: 0.2 }}>🧴</span>}
                  </div>
                  <span style={{ fontFamily: f, fontSize: 9, fontWeight: 600, color: '#4A4846', textAlign: 'center', width: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{p?.name ?? ''}</span>
                </div>
              );
            })}
          </div>
        )}
        {/* 편집 버튼 */}
        <div style={{ padding: '0 8px 8px', display: 'flex', gap: 4 }}>
          <button onClick={() => togglePublished(item)} style={{ flex: 1, padding: '8px 0', background: item.published ? '#0C0C0A' : 'rgba(12,12,10,.06)', color: item.published ? '#C5FF00' : '#9A9490', border: 'none', borderRadius: 6, fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase' as const, cursor: 'pointer', transition: 'all .15s' }}>
            {item.published ? 'Today ON' : 'Today OFF'}
          </button>
          <button onClick={() => openEdit(item)} style={{ padding: '8px 10px', background: '#EEEDE9', color: '#4A4846', border: 'none', borderRadius: 6, fontFamily: f, fontSize: 11, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>편집</button>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* 카드 목록 — hiddenMode일 때 숨김 (편집 시트만 사용) */}
      <div style={{ padding: '0 26px', display: hiddenMode ? 'none' : undefined }}>
        {!hideAddButton && (
          <button onClick={openNew} style={{ width: '100%', padding: '12px', border: '1.5px dashed rgba(12,12,10,.14)', borderRadius: 12, background: 'none', fontFamily: f, fontSize: 12, fontWeight: 700, letterSpacing: '.06em', color: '#9A9490', cursor: 'pointer', marginBottom: 12 }}>
            + 새 {colLabel} 등록
          </button>
        )}
        {items.length === 0 ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12, alignItems: 'start' }}>
            <div style={{ background: '#FFFFFF', border: '1px solid #000000', overflow: 'hidden' }}>
              <div style={{ width: '100%', height: 240, background: BG, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                <span style={{ fontSize: 40, opacity: 0.3 }}>{icon}</span>
              </div>
              <div style={{ padding: '10px 12px 0' }}>
                <div style={{ display: 'inline-block', fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.1em', background: `${BADGE_COLOR}40`, color: '#9A9490', padding: '3px 8px', borderRadius: 4, marginBottom: 7, textTransform: 'uppercase' as const }}>{BADGE}</div>
                <div style={{ fontFamily: f, fontSize: 14, fontWeight: 800, color: '#C4C2BE', lineHeight: 1.2, marginBottom: 3 }}>아이템 없음</div>
                <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' as const, color: '#C4C2BE', paddingBottom: 10 }}>위 버튼으로 추가</div>
              </div>
              <div style={{ borderTop: '1px solid #0C0C0A', padding: '10px 12px', display: 'flex', gap: 6 }}>
                <div style={{ flex: 1, padding: '8px 0', background: 'rgba(12,12,10,.04)', borderRadius: 8, fontFamily: f, fontSize: 11, fontWeight: 700, color: '#C4C2BE', textAlign: 'center', letterSpacing: '.06em', textTransform: 'uppercase' as const }}>Today OFF</div>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Card 1: Large Featured — 풀 너비 */}
            <HubStyleCard item={items[0]} featured />
            {/* Card 2+: Square — 2열 그리드 */}
            {items.length > 1 && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, alignItems: 'start', background: '#E0E0DC' }}>
                {items.slice(1).map(item => <HubStyleCard key={item.id} item={item} />)}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 편집 시트 */}
      {sheetOpen && (
        <>
          <div onClick={closeSheet} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 200 }} />
          <div style={{ position: 'fixed', bottom: 0, left: 'max(0px,calc(50vw - 215px))', right: 'max(0px,calc(50vw - 215px))', zIndex: 210, background: '#FAFAF8', borderRadius: '20px 20px 0 0', maxHeight: '94%', overflowY: 'auto', paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 40px)', scrollbarWidth: 'none' as const }}>
            <div style={{ position: 'sticky', top: 0, background: 'rgba(250,250,248,.96)', backdropFilter: 'blur(12px)', zIndex: 1, paddingBottom: 14, borderBottom: '1px solid rgba(12,12,10,.07)' }}>
              <div style={{ width: 32, height: 3, background: 'rgba(12,12,10,.14)', borderRadius: 2, margin: '14px auto 0' }} />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px 0' }}>
                <div style={{ fontFamily: f, fontSize: 20, fontWeight: 800, color: '#0C0C0A' }}>{editItem ? `편집: ${editItem.name}` : `새 ${colLabel} 등록`}</div>
                <button onClick={closeSheet} style={{ width: 36, height: 36, borderRadius: 10, background: '#E4E2DC', border: 'none', cursor: 'pointer', fontSize: 15, color: '#4A4846', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
              </div>
            </div>

            {/* 이모지 + 이름 */}
            <div style={{ padding: '16px 20px 0' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                <input value={sEmoji} onChange={e => setSEmoji(e.target.value)} placeholder={icon} maxLength={2} style={{ width: 48, padding: '11px 6px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 12, fontSize: 22, textAlign: 'center', background: '#fff', outline: 'none', flexShrink: 0 }} />
                <input value={sName} onChange={e => setSName(e.target.value)} placeholder="이름 *" style={{ flex: 1, padding: '12px 14px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 12, fontFamily: f, fontSize: 14, color: '#0C0C0A', background: '#fff', outline: 'none' }} />
              </div>
              {/* Daily 입력 */}
              <input value={sDaily} onChange={e => setSDaily(e.target.value)} placeholder="Daily (예: daily / weekly)" style={{ width: '100%', padding: '10px 14px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 12, fontFamily: f, fontSize: 13, color: '#0C0C0A', background: '#fff', outline: 'none', boxSizing: 'border-box' as const, marginBottom: 8 }} />
              <textarea value={sDesc} onChange={e => setSDesc(e.target.value)} placeholder="간단한 설명 (선택)" rows={2} style={{ width: '100%', padding: '10px 14px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 12, fontFamily: f, fontSize: 13, color: '#0C0C0A', background: '#fff', outline: 'none', resize: 'none', boxSizing: 'border-box' as const, lineHeight: 1.5, marginBottom: 8 }} />

              {/* 참고 링크 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 12, padding: '10px 14px', background: '#fff', marginBottom: 8 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9A9490" strokeWidth="2.5" style={{ flexShrink: 0 }}>
                  <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>
                </svg>
                <input type="url" value={sSourceUrl} onChange={e => setSSourceUrl(e.target.value)} placeholder="참고 링크 (Instagram, YouTube...)" style={{ flex: 1, border: 'none', outline: 'none', fontFamily: f, fontSize: 13, color: '#0C0C0A', background: 'transparent' }} />
                {sSourceUrl && <button onClick={() => setSSourceUrl('')} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#BCBAB6', fontSize: 14, padding: 0 }}>✕</button>}
              </div>

              {/* 이미지 */}
              <div style={{ marginBottom: 16 }}>
                <ImagePicker
                  preview={sImagePreview}
                  onChange={(file, base64) => { setSImageFile(file); setSImagePreview(base64); }}
                  onClear={() => { setSImageFile(null); setSImagePreview(''); }}
                  height={230}
                  placeholderLabel="이미지 추가"
                />
              </div>

              {/* 아이템 매핑 */}
              <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.16em', textTransform: 'uppercase' as const, color: '#9A9490', marginBottom: 8, marginTop: 8 }}>아이템 매핑</div>
              {sItems.filter((i): i is { type: 'product'; id: string } => i.type === 'product').length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                  {sItems.filter((i): i is { type: 'product'; id: string } => i.type === 'product').map((it, idx) => (
                    <span key={idx} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: f, fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 9999, background: '#EEEDE9', color: '#0C0C0A' }}>
                      {productName(it.id)}
                      <button onClick={() => setSItems(p => p.filter((_, i) => i !== idx))} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#9A9490', fontSize: 12, padding: 0, lineHeight: 1 }}>×</button>
                    </span>
                  ))}
                </div>
              )}
              <button onClick={() => { setPicker('main'); setPickerSearch(''); setPickerSelected(new Set()); }} style={{ padding: '7px 10px', background: '#0C0C0A', border: 'none', borderRadius: 8, fontFamily: f, fontSize: 11, fontWeight: 700, color: '#C5FF00', cursor: 'pointer', flexShrink: 0, marginBottom: 16 }}>BOX</button>

              {/* T.P.O (룩북만) */}
              {filter === 'lookbook' && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.16em', textTransform: 'uppercase' as const, color: '#9A9490', marginBottom: 8 }}>T.P.O</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {TPO_OPTIONS.map(tp => <button key={tp} onClick={() => setSTpo(p => p.includes(tp) ? p.filter(x => x !== tp) : [...p, tp])} style={{ padding: '7px 14px', borderRadius: 9999, border: `1.5px solid ${sTpo.includes(tp) ? '#0C0C0A' : 'rgba(12,12,10,.14)'}`, background: sTpo.includes(tp) ? '#0C0C0A' : 'transparent', color: sTpo.includes(tp) ? '#fff' : '#4A4846', fontFamily: f, fontSize: 12, fontWeight: 700, cursor: 'pointer', transition: 'all .15s' }}>{tp}</button>)}
                  </div>
                </div>
              )}

              {/* 예정 날짜 */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.16em', textTransform: 'uppercase' as const, color: '#9A9490', marginBottom: 8 }}>예정 날짜</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                  {sDates.map(d => <span key={d} onClick={() => setSDates(p => p.filter(x => x !== d))} style={{ fontFamily: f, fontSize: 12, fontWeight: 700, padding: '5px 10px', borderRadius: 9999, background: '#0C0C0A', color: '#fff', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}>{fmtDate(d)} <span style={{ opacity: .6, fontSize: 10 }}>✕</span></span>)}
                  <input type="date" onChange={e => { if (e.target.value && !sDates.includes(e.target.value)) { setSDates(p => [...p, e.target.value].sort()); e.target.value = ''; } }} style={{ padding: '5px 10px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 9999, fontFamily: f, fontSize: 12, color: '#0C0C0A', background: '#fff', outline: 'none' }} />
                </div>
              </div>

              {/* Today 토글 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginBottom: 20 }} onClick={() => { const next = !sPublished; setSPublished(next); const today = format(new Date(), 'yyyy-MM-dd'); if (next) setSDates(p => p.includes(today) ? p : [...p, today].sort()); }}>
                <div style={{ width: 44, height: 26, borderRadius: 13, background: sPublished ? '#0C0C0A' : '#D8D6CF', transition: 'background .2s', position: 'relative', flexShrink: 0 }}>
                  <div style={{ position: 'absolute', top: 3, left: sPublished ? 21 : 3, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.3)' }} />
                </div>
                <span style={{ fontFamily: f, fontSize: 14, fontWeight: 700, color: '#0C0C0A' }}>{sPublished ? 'Today에 표시 ON' : 'Today에 표시 OFF'}</span>
              </div>

              {/* 버튼 */}
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={closeSheet} style={{ flex: 1, height: 52, background: '#EEEDE9', color: '#0C0C0A', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 12, fontFamily: f, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>취소</button>
                <button onClick={handleSave} disabled={saving || !sName.trim()} style={{ flex: 1, height: 52, background: sName.trim() ? '#0C0C0A' : 'rgba(12,12,10,.14)', color: sName.trim() ? '#fff' : '#9A9490', border: 'none', borderRadius: 12, fontFamily: f, fontSize: 13, fontWeight: 700, cursor: sName.trim() ? 'pointer' : 'default' }}>
                  {saving ? '저장 중...' : editItem ? '수정' : '저장'}
                </button>
              </div>
              {editItem && (
                <button onClick={handleDelete} style={{ width: '100%', padding: 14, background: 'none', border: '1.5px solid rgba(186,26,26,.3)', borderRadius: 12, fontFamily: f, fontSize: 13, color: '#BA1A1A', cursor: 'pointer', fontWeight: 700, marginTop: 8 }}>삭제</button>
              )}
            </div>
          </div>

          {/* 제품 피커 */}
          {picker && (
            <>
              <div onClick={() => setPicker(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.25)', zIndex: 220 }} />
              <div style={{ position: 'fixed', bottom: 0, left: 'max(0px,calc(50vw - 215px))', right: 'max(0px,calc(50vw - 215px))', zIndex: 230, background: '#FAFAF8', borderRadius: '20px 20px 0 0', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: '12px 26px 8px', flexShrink: 0 }}>
                  <div style={{ width: 32, height: 3, background: 'rgba(12,12,10,.14)', borderRadius: 2, margin: '0 auto 12px' }} />
                  <div style={{ fontFamily: f, fontSize: 16, fontWeight: 800, color: '#0C0C0A', marginBottom: 10 }}>제품 선택</div>
                  <input type="search" value={pickerSearch} onChange={e => setPickerSearch(e.target.value)} placeholder="제품명 · 브랜드 검색..." autoFocus style={{ width: '100%', padding: '10px 12px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 8, fontFamily: f, fontSize: 13, color: '#0C0C0A', background: '#F4F4F0', outline: 'none', boxSizing: 'border-box' as const, marginBottom: 4 }} />
                  <div style={{ fontFamily: f, fontSize: 11, color: '#9A9490', marginBottom: 8 }}>{pickerSelected.size > 0 ? `${pickerSelected.size}개 선택됨` : 'BOX에서 제품을 선택하세요'}</div>
                </div>
                <div style={{ flex: 1, overflowY: 'auto' }}>
                  {filteredPicker.map(p => {
                    const sel = pickerSelected.has(p.id);
                    const imgSrc = p.imageUrl || p.storageUrl;
                    return (
                      <div key={p.id} onClick={() => setPickerSelected(prev => { const n = new Set(prev); sel ? n.delete(p.id) : n.add(p.id); return n; })} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 26px', borderBottom: '1px solid rgba(12,12,10,.07)', cursor: 'pointer', background: sel ? 'rgba(197,255,0,.06)' : 'transparent' }}>
                        <div style={{ width: 36, height: 36, borderRadius: 8, background: '#EEEDE9', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          {imgSrc ? <img src={imgSrc} alt={p.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <span style={{ fontSize: 16 }}>{filter === 'makeup' ? '💄' : '👗'}</span>}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontFamily: f, fontSize: 14, fontWeight: 600, color: '#0C0C0A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{p.name}</div>
                          {p.brand && <div style={{ fontFamily: f, fontSize: 12, color: '#9A9490', marginTop: 2 }}>{p.brand}</div>}
                        </div>
                        <div style={{ width: 22, height: 22, borderRadius: '50%', border: `1.5px solid ${sel ? '#8AB000' : 'rgba(12,12,10,.14)'}`, background: sel ? '#C5FF00' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#0C0C0A', flexShrink: 0 }}>{sel ? '✓' : ''}</div>
                      </div>
                    );
                  })}
                  {pickerSearch.trim() && filteredPicker.length === 0 && (
                    <div onClick={async () => {
                      if (!db) return;
                      const now = new Date().toISOString();
                      const domain = filter === 'makeup' ? 'beauty' : 'fashion';
                      const ref = await addDoc(collection(db, 'users', userId, 'products'), { name: pickerSearch.trim(), brand: '', domain, ...(filter === 'makeup' ? { subCategory: 'makeup' } : {}), packageCount: 1, unitPerPackage: 0, itemUnit: '', totalAmount: 0, dosePerUse: 0, usesPerDay: 1, frequencyType: 'daily', currentRemaining: 0, createdAt: now, updatedAt: now });
                      setPickerSelected(prev => { const n = new Set(prev); n.add(ref.id); return n; });
                      setPickerSearch('');
                    }} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 26px', cursor: 'pointer', background: 'rgba(197,255,0,.06)', borderBottom: '1px solid rgba(12,12,10,.07)' }}>
                      <div style={{ width: 36, height: 36, borderRadius: 8, background: '#C5FF00', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>+</div>
                      <div>
                        <div style={{ fontFamily: f, fontSize: 14, fontWeight: 700, color: '#0C0C0A' }}>"{pickerSearch.trim()}" 이름으로 등록 후 추가</div>
                        <div style={{ fontFamily: f, fontSize: 11, color: '#9A9490', marginTop: 2 }}>BOX에 자동 저장 · 나중에 수정 가능</div>
                      </div>
                    </div>
                  )}
                  {!pickerSearch.trim() && filteredPicker.length === 0 && <div style={{ padding: '32px 26px', textAlign: 'center', fontFamily: f, fontSize: 13, color: '#9A9490' }}>BOX에 해당 도메인 제품이 없어요</div>}
                </div>
                <div style={{ padding: '12px 26px calc(env(safe-area-inset-bottom,0px) + 20px)', borderTop: '1px solid rgba(12,12,10,.07)', flexShrink: 0 }}>
                  <button onClick={confirmPicker} style={{ width: '100%', height: 52, background: '#0C0C0A', color: '#fff', border: 'none', borderRadius: 12, fontFamily: f, fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>완료{pickerSelected.size > 0 ? ` (${pickerSelected.size}개)` : ''}</button>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}

// ─── 빈 상태 ─────────────────────────────────────────────────────────────────

function EmptyState({ isLoading, isLoggedIn }: { isLoading: boolean; isLoggedIn: boolean }) {
  if (isLoading) {
    return (
      <div
        style={{
          margin: '0 26px',
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
        기록 불러오는 중...
      </div>
    );
  }

  if (!isLoggedIn) {
    return (
      <div
        style={{
          margin: '0 26px',
          padding: '40px 26px',
          textAlign: 'center',
          border: '1.5px dashed rgba(12,12,10,.14)',
          borderRadius: 20,
          background: '#F4F4F0',
          fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
        }}
      >
        <div style={{ fontSize: 28, marginBottom: 12 }}>🔐</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#0C0C0A', marginBottom: 6 }}>로그인이 필요해요</div>
        <div style={{ fontSize: 12, color: '#9A9490' }}>Google 로그인 후 루틴 기록을 확인할 수 있어요</div>
      </div>
    );
  }

  return (
    <div
      style={{
        margin: '0 26px',
        padding: '48px 26px',
        textAlign: 'center',
        border: '1.5px dashed rgba(12,12,10,.14)',
        borderRadius: 20,
        background: '#F4F4F0',
      }}
    >
      <div style={{ fontSize: 28, marginBottom: 12, opacity: 0.3 }}>◎</div>
      <div
        style={{
          fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
          fontSize: 14,
          fontWeight: 700,
          color: '#9A9490',
          marginBottom: 8,
        }}
      >
        이번 달 기록이 없어요
      </div>
      <div
        style={{
          fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
          fontSize: 12,
          color: '#9A9490',
          lineHeight: 1.7,
        }}
      >
        Today에서 루틴을 체크하면<br />
        여기에 기록이 쌓입니다
      </div>
    </div>
  );
}

// ─── 메인 페이지 컴포넌트 ─────────────────────────────────────────────────────

function LogPageInner() {
  // ── 공유 컨텍스트 ──
  const { user, userId, authLoading, products: ctxProducts, sessions, makeupItems, lookItems, lifetipItems, careItems, habits, dietPrograms, healthRoutines, medRoutines } = useAppContext();
  const products = new Map(ctxProducts.map((p) => [p.id, p]));

  // ── 캘린더 상태 ──
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // ── 오늘 habitLogs ──
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const [todayHabitLogs, setTodayHabitLogs] = useState<{ id: string; habitId: string }[]>([]);
  useEffect(() => {
    if (authLoading || !user || !db) return;
    const q = query(collection(db, 'users', userId, 'habitLogs'), where('dateStr', '==', todayStr));
    const unsub = onSnapshot(q, (snap) => {
      setTodayHabitLogs(snap.docs.map(d => ({ id: d.id, ...d.data() as { habitId: string } })));
    });
    return () => unsub();
  }, [userId, authLoading, user, todayStr]);

  // ── 오늘 dietLogs ──
  const [todayDietLogs, setTodayDietLogs] = useState<{ id: string; programId: string; slotId: string }[]>([]);
  useEffect(() => {
    if (authLoading || !user || !db) return;
    const q = query(collection(db, 'users', userId, 'dietLogs'), where('dateStr', '==', todayStr));
    const unsub = onSnapshot(q, (snap) => {
      setTodayDietLogs(snap.docs.map(d => ({ id: d.id, ...d.data() as { programId: string; slotId: string } })));
    });
    return () => unsub();
  }, [userId, authLoading, user, todayStr]);

  // ── 오늘 healthLogs ──
  const [todayHealthLogs, setTodayHealthLogs] = useState<{ id: string; routineId: string }[]>([]);
  useEffect(() => {
    if (authLoading || !user || !db) return;
    const q = query(collection(db, 'users', userId, 'healthLogs'), where('dateStr', '==', todayStr));
    const unsub = onSnapshot(q, (snap) => {
      setTodayHealthLogs(snap.docs.map(d => ({ id: d.id, ...d.data() as { routineId: string } })));
    });
    return () => unsub();
  }, [userId, authLoading, user, todayStr]);

  // ── 오늘 medLogs ──
  const [todayMedLogs, setTodayMedLogs] = useState<{ id: string; routineId: string }[]>([]);
  useEffect(() => {
    if (authLoading || !user || !db) return;
    const q = query(collection(db, 'users', userId, 'medLogs'), where('dateStr', '==', todayStr));
    const unsub = onSnapshot(q, (snap) => {
      setTodayMedLogs(snap.docs.map(d => ({ id: d.id, ...d.data() as { routineId: string } })));
    });
    return () => unsub();
  }, [userId, authLoading, user, todayStr]);

  // ── 탭 상태 ──
  const [mainTab, setMainTab] = useState<'기록' | '라이브러리' | '아카이브' | '수집'>('기록');
  const [archiveFilter, setArchiveFilter] = useState<'all' | 'makeup' | 'lookbook' | 'lifetip'>('all');
  const [libFilter, setLibFilter] = useState<'all' | 'makeup' | 'lookbook' | 'lifetip' | 'ootd'>('all');
  const [lifetipCategory, setLifetipCategory] = useState<string | null>(null); // null = 그리드 홈
  const [editingLifetipId, setEditingLifetipId] = useState<string | null>(null); // 이모지 편집 중인 아이템

  // ── 수집 탭 상태 ──
  const [references, setReferences] = useState<Reference[]>([]);
  const [refUrl, setRefUrl] = useState('');
  const [refTitle, setRefTitle] = useState('');
  const [refTags, setRefTags] = useState<string[]>([]);
  const [refTagInput, setRefTagInput] = useState('');
  const [refTagFocused, setRefTagFocused] = useState(false);
  const [refImageFile, setRefImageFile] = useState<File | null>(null);
  const [refImagePreview, setRefImagePreview] = useState('');
  const [refSaving, setRefSaving] = useState(false);
  const [refFilter, setRefFilter] = useState<string>('all');
  const [refOgLoading, setRefOgLoading] = useState(false);
  // 빠른선택 태그 — localStorage에서 불러오고, 편집 가능
  const [presetTags, setPresetTags] = useState<string[]>(() => {
    if (typeof window === 'undefined') return DEFAULT_PRESET_TAGS;
    try {
      const saved = localStorage.getItem('onstep_ref_preset_tags');
      return saved ? JSON.parse(saved) : DEFAULT_PRESET_TAGS;
    } catch { return DEFAULT_PRESET_TAGS; }
  });
  const [presetEditMode, setPresetEditMode] = useState(false);
  const [presetNewTag, setPresetNewTag] = useState('');
  // 수집 편집 시트 상태
  const [editingRef, setEditingRef] = useState<Reference | null>(null);
  const [refEditUrl, setRefEditUrl] = useState('');
  const [refEditTitle, setRefEditTitle] = useState('');
  const [refEditTags, setRefEditTags] = useState<string[]>([]);
  const [refEditTagInput, setRefEditTagInput] = useState('');
  const [refEditImageFile, setRefEditImageFile] = useState<File | null>(null);
  const [refEditImagePreview, setRefEditImagePreview] = useState('');
  const [refEditSaving, setRefEditSaving] = useState(false);
  const [refEditTagFocused, setRefEditTagFocused] = useState(false);
  // 수집 정렬 + 페이지네이션
  const [refSort, setRefSort] = useState<'date_desc' | 'name' | 'tag'>('date_desc');
  const [refVisibleCount, setRefVisibleCount] = useState(10);
  // 빠른선택 태그 드래그앤드롭 순서 변경
  const [dragPresetIdx, setDragPresetIdx] = useState<number | null>(null);
  const [dragPresetOverIdx, setDragPresetOverIdx] = useState<number | null>(null);

  // OOTD 편집 시트 상태
  const [editingOotd, setEditingOotd] = useState<OOTDLog | null>(null);
  const [ootdEditTheme, setOotdEditTheme] = useState('');
  const [ootdEditNote, setOotdEditNote] = useState('');
  const [ootdEditPhotoFile, setOotdEditPhotoFile] = useState<File | null>(null);
  const [ootdEditPreview, setOotdEditPreview] = useState('');
  const [ootdEditProductIds, setOotdEditProductIds] = useState<string[]>([]);
  const [ootdEditSaving, setOotdEditSaving] = useState(false);
  const [ootdPickerOpen, setOotdPickerOpen] = useState(false);
  const [ootdPickerSearch, setOotdPickerSearch] = useState('');
  const ootdFileRef = useRef<HTMLInputElement>(null);

  function openOotdEdit(log: OOTDLog) {
    setEditingOotd(log);
    setOotdEditTheme(log.theme || '');
    setOotdEditNote(log.note || '');
    setOotdEditPhotoFile(null);
    setOotdEditPreview(log.photoUrl || '');
    setOotdEditProductIds(log.productIds ?? []);
    setOotdPickerSearch('');
  }

  async function saveOotdEdit() {
    if (!editingOotd || !db || !user) return;
    setOotdEditSaving(true);
    try {
      let photoUrl = editingOotd.photoUrl ?? '';
      if (ootdEditPhotoFile) {
        photoUrl = await imageFileToBase64(ootdEditPhotoFile);
      }
      await updateDoc(doc(db, 'users', userId, 'ootdLogs', editingOotd.id), {
        theme: ootdEditTheme,
        note: ootdEditNote,
        photoUrl,
        productIds: ootdEditProductIds,
        updatedAt: new Date().toISOString(),
      });
      setEditingOotd(null);
    } catch (err) {
      console.error('[OnStep] OOTD 수정 실패:', err);
    } finally {
      setOotdEditSaving(false);
    }
  }

  async function deleteOotdEdit() {
    if (!editingOotd || !db || !user) return;
    if (!confirm('이 기록을 삭제할까요?')) return;
    try {
      await deleteDoc(doc(db, 'users', userId, 'ootdLogs', editingOotd.id));
      setEditingOotd(null);
    } catch (err) {
      console.error('[OnStep] OOTD 삭제 실패:', err);
    }
  }

  // ── URL 파라미터로 탭 이동 + 필터 + 특정 아이템 스크롤 ──
  const searchParams = useSearchParams();
  useEffect(() => {
    const tab = searchParams.get('tab') as '라이브러리' | '아카이브' | '수집' | null;
    const filter = searchParams.get('filter') as 'all' | 'makeup' | 'lookbook' | 'ootd' | 'lifetip' | null;
    const id = searchParams.get('id');
    if (tab === '라이브러리' || tab === '아카이브' || tab === '수집') setMainTab(tab);
    if (filter === 'all' || filter === 'makeup' || filter === 'lookbook' || filter === 'lifetip') setArchiveFilter(filter);
    if (filter === 'ootd') setLibFilter('ootd');
    if (id) {
      setTimeout(() => {
        const el = document.getElementById(`lib-item-${id}`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 400);
    }
  }, [searchParams]);

  // ── FAB 상태 ──
  const [fabMenuOpen, setFabMenuOpen] = useState(false);
  const [refToLib, setRefToLib] = useState<Reference | null>(null);
  const [refToLibType, setRefToLibType] = useState<'makeup' | 'lookbook' | 'lifetip'>('makeup');
  const [refToLibTipCategory, setRefToLibTipCategory] = useState('');
  const [refToLibEmoji, setRefToLibEmoji] = useState('');
  const [refToLibSaving, setRefToLibSaving] = useState(false);
  const [makeupAddTrigger, setMakeupAddTrigger] = useState(0);
  const [lookbookAddTrigger, setLookbookAddTrigger] = useState(0);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [makeupEditTrigger, setMakeupEditTrigger] = useState<{ id: string; ts: number } | undefined>();
  const [lookbookEditTrigger, setLookbookEditTrigger] = useState<{ id: string; ts: number } | undefined>();

  function triggerCollectionEdit(item: CtItem) {
    const trigger = { id: item.id, ts: Date.now() };
    if (item.ctType === 'makeup') setMakeupEditTrigger(trigger);
    else setLookbookEditTrigger(trigger);
  }

  // CtPanel CRUD — makeupItems / lookItems 공유 (SETUP과 동일 컬렉션)
  async function handleCtAdd(filter: 'makeup' | 'lookbook', data: Omit<CtItem, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
    if (!db) return '';
    const colName = filter === 'makeup' ? 'makeupItems' : 'lookItems';
    const now = new Date().toISOString();
    const ref = await addDoc(collection(db, 'users', userId, colName), { ...data, createdAt: now, updatedAt: now });
    return ref.id;
  }
  async function handleCtUpdate(filter: 'makeup' | 'lookbook', id: string, data: Partial<Omit<CtItem, 'id'>>) {
    if (!db) return;
    await updateDoc(doc(db, 'users', userId, filter === 'makeup' ? 'makeupItems' : 'lookItems', id), data);
  }
  async function handleCtDelete(filter: 'makeup' | 'lookbook', id: string) {
    if (!db) return;
    await deleteDoc(doc(db, 'users', userId, filter === 'makeup' ? 'makeupItems' : 'lookItems', id));
  }

  // ── 아침/저녁 수동 완료 토글 — 날짜 지정 버전 ──
  async function handleToggleMorningForDate(dateStr: string) {
    const _db = db;
    if (!_db || !user) return;
    const dayLog = dayLogs.get(dateStr);
    if (dayLog?.hasMorning) {
      const entries = dayLog.entries.filter(e => e.timeSlot === 'morning');
      await Promise.all(entries.map(e => deleteDoc(doc(_db, 'users', userId, 'usageLogs', e.id))));
    } else {
      await addDoc(collection(_db, 'users', userId, 'usageLogs'), {
        timeSlot: 'morning', dateStr,
        loggedAt: new Date(dateStr + 'T09:00:00').toISOString(),
        type: 'manual',
      });
    }
  }
  async function handleToggleEveningForDate(dateStr: string) {
    const _db = db;
    if (!_db || !user) return;
    const dayLog = dayLogs.get(dateStr);
    if (dayLog?.hasEvening) {
      const entries = dayLog.entries.filter(e => e.timeSlot === 'evening');
      await Promise.all(entries.map(e => deleteDoc(doc(_db, 'users', userId, 'usageLogs', e.id))));
    } else {
      await addDoc(collection(_db, 'users', userId, 'usageLogs'), {
        timeSlot: 'evening', dateStr,
        loggedAt: new Date(dateStr + 'T21:00:00').toISOString(),
        type: 'manual',
      });
    }
  }
  // 오늘 날짜용 래퍼 (MonthCalendar 기존 props 호환)
  async function handleToggleMorning() { return handleToggleMorningForDate(format(new Date(), 'yyyy-MM-dd')); }
  async function handleToggleEvening() { return handleToggleEveningForDate(format(new Date(), 'yyyy-MM-dd')); }

  // Today 즉시 적용/해제 — Firestore 업데이트 → AppContext onSnapshot 자동 반영
  async function handleToggleToday(item: CtItem) {
    if (!db || togglingId) return;
    const colName = item.ctType === 'makeup' ? 'makeupItems' : 'lookItems';
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    const isOnToday = item.published && (item.dates ?? []).includes(todayStr);
    setTogglingId(item.id);
    try {
      if (isOnToday) {
        const newDates = (item.dates ?? []).filter(d => d !== todayStr);
        await updateDoc(doc(db, 'users', userId, colName, item.id), {
          published: newDates.length > 0,
          dates: newDates,
          updatedAt: new Date().toISOString(),
        });
      } else {
        const newDates = [...new Set([...(item.dates ?? []), todayStr])].sort();
        await updateDoc(doc(db, 'users', userId, colName, item.id), {
          published: true,
          dates: newDates,
          updatedAt: new Date().toISOString(),
        });
      }
    } catch (err) {
      console.error('[OnStep] Today 토글 실패:', err);
      alert('변경에 실패했습니다. 로그인 상태를 확인해주세요.');
    } finally {
      setTogglingId(null);
    }
  }

  // ── 데이터 상태 ──
  const [dayLogs, setDayLogs] = useState<Map<string, DayLog>>(new Map());
  const [dataLoading, setDataLoading] = useState(true); // 초기값 true: 첫 렌더에 "미완료" 오표시 방지

  // 비로그인 확정 시 로딩 해제 (authLoading 끝났는데 user 없으면 영원히 스피너 방지)
  useEffect(() => {
    if (!authLoading && !user) setDataLoading(false);
  }, [authLoading, user]);

  // 월별 med/health/diet 로그 → 날짜별 완료 여부 (캘린더 이모지 표시용)
  const [medDayMap, setMedDayMap] = useState<Map<string, Set<string>>>(new Map());
  const [healthDayMap, setHealthDayMap] = useState<Map<string, Set<string>>>(new Map());
  const [dietDayMap, setDietDayMap] = useState<Map<string, Set<string>>>(new Map());

  // OOTD 기록 — 전체 구독
  const [ootdLogs, setOotdLogs] = useState<OOTDLog[]>([]);

  // auth/products/ct → AppContext에서 공유

  // ── 실시간 구독 1: 월별 사용 로그 ──
  useEffect(() => {
    if (authLoading || !user || !db) return;
    const _db = db;
    setDataLoading(true);
    const monthStart = toDateStr(startOfMonth(currentMonth));
    const monthEnd = toDateStr(endOfMonth(currentMonth));
    const q = query(
      collection(_db, 'users', userId, 'usageLogs'),
      where('dateStr', '>=', monthStart),
      where('dateStr', '<=', monthEnd),
      orderBy('dateStr', 'asc')
    );
    const unsub = onSnapshot(q, (snap) => {
      const logsMap = new Map<string, DayLog>();
      snap.docs.forEach((d) => {
        const data = d.data() as Omit<LogEntry, 'id'>;
        const entry: LogEntry = { id: d.id, ...data };
        // getEveningDateStr()이 이미 자정 넘어도 올바른 세션 날짜로 저장하므로
        // 별도 변환 없이 dateStr을 그대로 사용
        const ds = entry.dateStr;
        if (!logsMap.has(ds)) {
          logsMap.set(ds, { dateStr: ds, hasMorning: false, hasEvening: false, entries: [] });
        }
        const dayLog = logsMap.get(ds)!;
        dayLog.entries.push(entry);
        if (entry.timeSlot === 'morning') dayLog.hasMorning = true;
        if (entry.timeSlot === 'evening') dayLog.hasEvening = true;
      });
      setDayLogs(logsMap);
      setDataLoading(false);
    }, (err) => {
      console.error('[OnStep] 로그 로드 실패:', err);
      setDataLoading(false);
    });
    return () => unsub();
  }, [userId, authLoading, user, currentMonth]);

  // ── 실시간 구독 2: 월별 medLogs ──
  useEffect(() => {
    if (authLoading || !user || !db) return;
    const _db = db;
    const monthStart = toDateStr(startOfMonth(currentMonth));
    const monthEnd = toDateStr(endOfMonth(currentMonth));
    const q = query(
      collection(_db, 'users', userId, 'medLogs'),
      where('dateStr', '>=', monthStart),
      where('dateStr', '<=', monthEnd),
    );
    const unsub = onSnapshot(q, (snap) => {
      const map = new Map<string, Set<string>>();
      snap.docs.forEach((d) => {
        const data = d.data() as { dateStr: string; routineId: string };
        if (!map.has(data.dateStr)) map.set(data.dateStr, new Set());
        map.get(data.dateStr)!.add(data.routineId);
      });
      setMedDayMap(map);
    });
    return () => unsub();
  }, [userId, authLoading, user, currentMonth]);

  // ── 실시간 구독 3: 월별 healthLogs ──
  useEffect(() => {
    if (authLoading || !user || !db) return;
    const _db = db;
    const monthStart = toDateStr(startOfMonth(currentMonth));
    const monthEnd = toDateStr(endOfMonth(currentMonth));
    const q = query(
      collection(_db, 'users', userId, 'healthLogs'),
      where('dateStr', '>=', monthStart),
      where('dateStr', '<=', monthEnd),
    );
    const unsub = onSnapshot(q, (snap) => {
      const map = new Map<string, Set<string>>();
      snap.docs.forEach((d) => {
        const data = d.data() as { dateStr: string; routineId: string };
        if (!map.has(data.dateStr)) map.set(data.dateStr, new Set());
        map.get(data.dateStr)!.add(data.routineId);
      });
      setHealthDayMap(map);
    });
    return () => unsub();
  }, [userId, authLoading, user, currentMonth]);

  // ── 실시간 구독 4: 월별 dietLogs ──
  useEffect(() => {
    if (authLoading || !user || !db) return;
    const _db = db;
    const monthStart = toDateStr(startOfMonth(currentMonth));
    const monthEnd = toDateStr(endOfMonth(currentMonth));
    const q = query(
      collection(_db, 'users', userId, 'dietLogs'),
      where('dateStr', '>=', monthStart),
      where('dateStr', '<=', monthEnd),
    );
    const unsub = onSnapshot(q, (snap) => {
      const map = new Map<string, Set<string>>();
      snap.docs.forEach((d) => {
        const data = d.data() as { dateStr: string; programId: string };
        if (!map.has(data.dateStr)) map.set(data.dateStr, new Set());
        map.get(data.dateStr)!.add(data.programId);
      });
      setDietDayMap(map);
    });
    return () => unsub();
  }, [userId, authLoading, user, currentMonth]);

  // products/makeupItems/lookItems → AppContext에서 공유

  // ── OOTD 기록 실시간 구독 ──
  useEffect(() => {
    if (authLoading || !user || !db) return;
    const _db = db;
    const q = query(
      collection(_db, 'users', userId, 'ootdLogs'),
      orderBy('date', 'desc')
    );
    const unsub = onSnapshot(q, (snap) => {
      setOotdLogs(snap.docs.map(d => ({ id: d.id, ...d.data() } as OOTDLog)));
    });
    return () => unsub();
  }, [userId, authLoading, user]);

  // ── 수집 탭 — references 실시간 구독 ──
  useEffect(() => {
    if (authLoading || !user || !db) return;
    const _db = db;
    const q = query(
      collection(_db, 'users', userId, 'references'),
      orderBy('createdAt', 'desc')
    );
    const unsub = onSnapshot(q, (snap) => {
      setReferences(snap.docs.map(d => ({ id: d.id, ...d.data() } as Reference)));
    });
    return () => unsub();
  }, [userId, authLoading, user]);

  // ── 수집 탭 — 플랫폼 자동 감지 ──
  function detectPlatform(url: string): Reference['platform'] {
    if (url.includes('instagram.com')) return 'instagram';
    if (url.includes('youtube.com') || url.includes('youtu.be')) return 'youtube';
    if (url.includes('pinterest.com')) return 'pinterest';
    return 'other';
  }

  // ── 수집 탭 — OG 메타 자동 채우기 ──
  // URL을 입력하면 ogFetch Firebase Function이 og:title, og:image를 가져와 자동 입력
  // 💡 env.local에 NEXT_PUBLIC_OG_API_URL 미설정 시 조용히 건너뜀 (수동 입력 모드)
  async function fetchOgMeta(url: string) {
    const base = process.env.NEXT_PUBLIC_OG_API_URL;
    if (!base || !url.trim()) return;
    setRefOgLoading(true);
    try {
      const res = await fetch(`${base}?url=${encodeURIComponent(url)}`);
      if (!res.ok) return;
      const data = await res.json();
      // 이미 사용자가 직접 입력한 값이 있으면 덮어쓰지 않음
      if (data.title && !refTitle.trim()) setRefTitle(data.title);
      if (data.image && !refImagePreview) setRefImagePreview(data.image);
    } catch {
      // 실패해도 무시 — 수동 입력으로 대체
    } finally {
      setRefOgLoading(false);
    }
  }

  // ── 수집 탭 — 레퍼런스 저장 ──
  async function saveReference() {
    const trimmedUrl = refUrl.trim();
    const trimmedTitle = refTitle.trim();
    const hasContent = trimmedUrl || trimmedTitle || refTags.length > 0 || refTagInput.trim() || refImagePreview;
    if (!hasContent || !db || !userId) return;
    setRefSaving(true);
    // 입력창에 남아있는 태그 텍스트를 자동으로 추가
    const pendingTag = refTagInput.trim();
    const finalTags = pendingTag && !refTags.includes(pendingTag)
      ? [...refTags, pendingTag]
      : [...refTags];
    // 낙관적 UI — 폼 즉시 초기화 (Firestore 응답 기다리지 않음)
    const snapshotUrl = trimmedUrl;
    const snapshotTitle = trimmedTitle;
    const snapshotTags = finalTags;
    const snapshotImageFile = refImageFile;
    const snapshotImagePreview = refImagePreview;
    setRefUrl('');
    setRefTitle('');
    setRefTags([]);
    setRefTagInput('');
    setRefImageFile(null);
    setRefImagePreview('');

    try {
      let displayTitle = snapshotTitle;
      if (!displayTitle && snapshotUrl) {
        try { displayTitle = new URL(snapshotUrl).hostname; } catch { displayTitle = snapshotUrl; }
      }
      // 이미지는 400px 압축 base64라 Firestore에 직접 저장 (Storage 업로드 불필요)
      const imageUrl = snapshotImagePreview || '';
      await addDoc(collection(db, 'users', userId, 'references'), {
        url: snapshotUrl,
        title: displayTitle || snapshotTitle,
        imageUrl,
        description: '',
        platform: snapshotUrl ? detectPlatform(snapshotUrl) : '',
        tags: snapshotTags,
        createdAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error('[OnStep] reference 저장 실패:', err);
      alert('저장에 실패했습니다. 다시 시도해주세요.');
    } finally {
      setRefSaving(false);
    }
  }

  // ── 수집 탭 — 레퍼런스 편집 열기 ──
  // presetTags가 바뀌면 localStorage에 저장
  useEffect(() => {
    try { localStorage.setItem('onstep_ref_preset_tags', JSON.stringify(presetTags)); } catch {}
  }, [presetTags]);

  function savePresetTag() {
    const t = presetNewTag.trim();
    if (!t || presetTags.includes(t)) { setPresetNewTag(''); return; }
    setPresetTags(prev => [...prev, t]);
    setPresetNewTag('');
  }

  function openRefEdit(ref: Reference) {
    setEditingRef(ref);
    setRefEditUrl(ref.url || '');
    setRefEditTitle(ref.title || '');
    setRefEditTags(ref.tags || []);
    setRefEditTagInput('');
    setRefEditImageFile(null);
    setRefEditImagePreview(ref.imageUrl || '');
  }

  // ── 수집 탭 — 레퍼런스 편집 저장 ──
  async function saveRefEdit() {
    if (!editingRef || !db || !userId) return;
    setRefEditSaving(true);
    // 입력창에 남아있는 태그 텍스트를 자동으로 추가
    const pendingEditTag = refEditTagInput.trim();
    const finalEditTags = pendingEditTag && !refEditTags.includes(pendingEditTag)
      ? [...refEditTags, pendingEditTag]
      : [...refEditTags];
    try {
      // 이미지는 400px 압축 base64라 Firestore에 직접 저장
      const imageUrl = refEditImagePreview || editingRef.imageUrl || '';
      await updateDoc(doc(db, 'users', userId, 'references', editingRef.id), {
        url: refEditUrl.trim() || editingRef.url,
        title: refEditTitle.trim() || editingRef.title,
        tags: finalEditTags,
        imageUrl,
        updatedAt: new Date().toISOString(),
      });
      setEditingRef(null);
    } catch (err) {
      console.error('[OnStep] reference 업데이트 실패:', err);
    } finally {
      setRefEditSaving(false);
    }
  }


  // ── 수집 → 라이브러리 등록 ──
  async function saveRefToLibrary() {
    if (!refToLib || !db || !userId) return;
    setRefToLibSaving(true);
    try {
      if (refToLibType === 'lifetip') {
        const category = refToLibTipCategory.trim() || '기타';
        const emoji = refToLibEmoji.trim() || getLifetipEmoji(category);
        await addDoc(collection(db, 'users', userId, 'lifetipItems'), {
          name: refToLib.title || refToLib.url || '새 아이템',
          emoji,
          imageUrl: refToLib.imageUrl || '',
          sourceUrl: refToLib.url || '',
          tipCategory: category,
          published: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } satisfies Omit<LifetipItem, 'id'>);
      } else {
        const colName = refToLibType === 'makeup' ? 'makeupItems' : 'lookItems';
        await addDoc(collection(db, 'users', userId, colName), {
          ctType: refToLibType,
          name: refToLib.title || refToLib.url || '새 아이템',
          emoji: refToLibType === 'makeup' ? '💄' : '👗',
          imageUrl: refToLib.imageUrl || '',
          tpo: [],
          items: [],
          published: false,
          dates: [],
          sourceUrl: refToLib.url || '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
      setRefToLib(null);
    } catch (err) {
      console.error('[OnStep] refToLib 저장 실패:', err);
    } finally {
      setRefToLibSaving(false);
    }
  }

  // ── 수집 탭 — 레퍼런스 삭제 ──
  async function deleteReference(id: string) {
    if (!db || !userId) return;
    if (!confirm('이 레퍼런스를 삭제할까요?')) return;
    try {
      await deleteDoc(doc(db, 'users', userId, 'references', id));
    } catch (err) {
      console.error('[OnStep] reference 삭제 실패:', err);
    }
  }

  // 날짜 선택 토글 (이미 선택된 날 클릭 → 선택 해제)
  const handleSelectDate = (ds: string) => {
    setSelectedDate((prev) => (prev === ds || ds === '' ? null : ds));
  };

  // 선택된 날의 DayLog
  const selectedDayLog = selectedDate ? dayLogs.get(selectedDate) : undefined;

  // 이번 달 총 완료 일수 (아침 or 저녁 한 번이라도 완료)
  const completedDays = Array.from(dayLogs.values()).filter(
    (l) => l.hasMorning || l.hasEvening
  ).length;

  const totalDaysInMonth = endOfMonth(currentMonth).getDate();

  // ── 렌더링 ──
  return (
    <div style={{ background: '#FAFAF8', minHeight: '100%', position: 'relative' }}>

      <div style={{ paddingBottom: 100 }}>

        {/* 페이지 헤더 */}
        <PageHeader
          label="Log"
          title="LOG"
          subtitle="오늘 본 무드가 내일의 내 모습이 된다"
        />

        {/* 탭 바 — 기록 / 라이브러리 / 아카이브 / 수집 */}
        <div style={{ display: 'flex', gap: 0, height: 46, alignItems: 'stretch', background: 'rgba(250,250,248,.96)', backdropFilter: 'blur(8px)', borderBottom: '1px solid rgba(12,12,10,.07)', margin: '16px 0 0', padding: '0 26px' }}>
          {(['기록', '라이브러리', '아카이브', '수집'] as const).map((t) => (
            <button key={t} onClick={() => setMainTab(t)}
              style={{ flex: 1, border: 'none', background: 'none', fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 11, fontWeight: 800, letterSpacing: '.02em', color: mainTab === t ? '#0C0C0A' : '#9A9490', borderBottom: mainTab === t ? '2px solid #0C0C0A' : '2px solid transparent', cursor: 'pointer', transition: 'all .18s' }}
            >
              {t}
            </button>
          ))}
        </div>

        {/* ── 기록 탭 — 날짜 중심 타임라인 ── */}
        {mainTab === '기록' && (
          <div style={{ paddingTop: 8 }}>

            {/* ── 스트릭 + 월간 달성률 카드 ── */}
            {(() => {
              const f = "'Plus Jakarta Sans','Space Grotesk',sans-serif";

              // 연속 기록일: 완료된 날짜 배열에서 역산
              // - dayLogs에서 완료된 날짜만 추출해 오름차순 정렬
              // - 가장 최근 완료일이 오늘 또는 어제여야 스트릭 유효
              const MS_PER_DAY = 86_400_000;
              const noon = (ds: string) => new Date(ds + 'T12:00:00').getTime();
              const prevDay = (ds: string) => toDateStr(new Date(noon(ds) - MS_PER_DAY));

              const doneDates = Array.from(dayLogs.entries())
                .filter(([, log]) => log.hasMorning || log.hasEvening)
                .map(([ds]) => ds)
                .sort();

              let streak = 0;
              if (doneDates.length > 0) {
                const newest = doneDates[doneDates.length - 1];
                const yesterday = prevDay(todayStr);
                // 가장 최근 완료가 오늘 또는 어제일 때만 스트릭 유효
                if (newest === todayStr || newest === yesterday) {
                  let expected = newest;
                  for (let i = doneDates.length - 1; i >= 0; i--) {
                    if (doneDates[i] === expected) {
                      streak++;
                      expected = prevDay(expected);
                    } else {
                      break;
                    }
                  }
                }
              }

              // 이번 달 달성률: 완료 일수 / 해당 월 총 일수
              const pct = totalDaysInMonth > 0 ? Math.round((completedDays / totalDaysInMonth) * 100) : 0;

              // 아직 기록이 없으면 카드 숨김
              if (completedDays === 0) return null;

              return (
                <div style={{ margin: '0 26px 16px', background: 'linear-gradient(135deg,#EFF9DC,#E6F5C2)', borderRadius: 16, padding: '14px 26px', border: '1px solid rgba(74,119,0,.12)' }}>
                  <div style={{ display: 'flex', gap: 0, justifyContent: 'space-between' }}>

                    {/* 연속 기록일 */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span style={{ fontFamily: f, fontSize: 10, fontWeight: 700, color: '#4A7700', letterSpacing: '.06em' }}>연속 기록</span>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
                        <span style={{ fontFamily: f, fontSize: 28, fontWeight: 800, color: '#2D5200', lineHeight: 1 }}>{streak}</span>
                        <span style={{ fontFamily: f, fontSize: 12, fontWeight: 700, color: '#4A7700' }}>일</span>
                        {streak >= 3 && <span style={{ fontSize: 14 }}>🔥</span>}
                      </div>
                    </div>

                    {/* 구분선 */}
                    <div style={{ width: 1, background: 'rgba(74,119,0,.2)', margin: '0 12px' }} />

                    {/* 월간 달성률 */}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6, justifyContent: 'center' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontFamily: f, fontSize: 10, fontWeight: 700, color: '#4A7700', letterSpacing: '.06em' }}>
                          {format(currentMonth, 'M월', { locale: ko })} 달성률
                        </span>
                        <span style={{ fontFamily: f, fontSize: 13, fontWeight: 800, color: '#2D5200' }}>{pct}%</span>
                      </div>
                      {/* 프로그레스 바 */}
                      <div style={{ height: 6, background: 'rgba(74,119,0,.15)', borderRadius: 9999, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: '#4A7700', borderRadius: 9999, transition: 'width .5s ease' }} />
                      </div>
                      <span style={{ fontFamily: f, fontSize: 10, color: '#4A7700' }}>
                        {completedDays}일 완료 / {totalDaysInMonth}일
                      </span>
                    </div>
                  </div>
                </div>
              );
            })()}

            <RecentStrip dayLogs={dayLogs} selectedDate={selectedDate} onSelectDate={handleSelectDate} />
            <div style={{ height: 1, background: 'rgba(12,12,10,.07)', margin: '16px 26px 0' }} />
            <MonthCalendar
              currentMonth={currentMonth} dayLogs={dayLogs} selectedDate={selectedDate} onSelectDate={handleSelectDate}
              onPrevMonth={() => { setCurrentMonth(m => subMonths(m, 1)); setSelectedDate(null); }}
              onNextMonth={() => { setCurrentMonth(m => addMonths(m, 1)); setSelectedDate(null); }}
              medDayMap={medDayMap} healthDayMap={healthDayMap} dietDayMap={dietDayMap}
              hasMed={medRoutines.some(m => m.active)}
              hasHealth={healthRoutines.some(h => h.active && h.showInToday)}
              hasDiet={dietPrograms.some(p => p.showInToday)}
              onToggleMorning={handleToggleMorning}
              onToggleEvening={handleToggleEvening}
              sessionStartMap={new Map(
                sessions
                  .filter(s => (s.sessionTag ?? '').trim().length > 0)
                  .map(s => [s.startDate, s.sessionTag!.trim()])
              )}
            />
            {selectedDate ? (
              <DayDetail
                dateStr={selectedDate} dayLog={selectedDayLog} products={products} sessions={sessions}
                makeupItems={makeupItems} lookItems={lookItems}
                onClose={() => setSelectedDate(null)}
                onToggleMorning={() => handleToggleMorningForDate(selectedDate)}
                onToggleEvening={() => handleToggleEveningForDate(selectedDate)}
                medRoutines={medRoutines}
                healthRoutines={healthRoutines}
                dietPrograms={dietPrograms}
                medChecked={medDayMap.get(selectedDate) ?? new Set<string>()}
                healthChecked={healthDayMap.get(selectedDate) ?? new Set<string>()}
                dietChecked={dietDayMap.get(selectedDate) ?? new Set<string>()}
              />
            ) : (
              <>
                {dayLogs.size === 0 && isSameMonth(currentMonth, new Date()) && <EmptyState isLoading={dataLoading || authLoading} isLoggedIn={!!user} />}

                {/* 오늘의 루틴 · 룩 · 메이크업 목록 */}
                {(() => {
                  const f = "'Plus Jakarta Sans','Space Grotesk',sans-serif";
                  const todayDayLog = dayLogs.get(todayStr);
                  const todayMotd = makeupItems.filter(i => (i.dates ?? []).includes(todayStr));
                  const todayOotd = lookItems.filter(i => (i.dates ?? []).includes(todayStr));
                  const todayCare = careItems.filter(i => (i.dates ?? []).includes(todayStr));
                  const checkedHabitIds = new Set(todayHabitLogs.map(l => l.habitId));
                  const todayWD = new Date().getDay();
                  const todayHabits = habits.filter(h => {
                    if (!h.showInToday) return false;
                    if (h.repeatType === 'allday' || h.repeatType === 'daily') return true;
                    if (h.repeatType === 'once') return h.date === todayStr;
                    if (h.repeatType === 'scheduled') return (h.weekdays ?? []).includes(todayWD);
                    return false;
                  });
                  const hasAny = todayDayLog || todayMotd.length || todayOotd.length || todayCare.length || todayHabits.length
                    || dietPrograms.some(p => p.showInToday)
                    || healthRoutines.some(h => h.active && h.showInToday)
                    || medRoutines.some(m => m.active && m.showInToday);
                  if (!hasAny) return null;

                  // ── 공통 헬퍼 ──
                  const CardHeader = ({ emoji, title, badge }: { emoji: string; title: string; badge?: string }) => (
                    <div style={{ padding: '10px 14px 8px', display: 'flex', alignItems: 'center', gap: 7, borderBottom: '1px solid rgba(12,12,10,.05)' }}>
                      <span style={{ fontSize: 15 }}>{emoji}</span>
                      <span style={{ fontFamily: f, fontSize: 12, fontWeight: 800, color: '#0C0C0A', letterSpacing: '.02em', flex: 1 }}>{title}</span>
                      {badge && <span style={{ fontFamily: f, fontSize: 10, fontWeight: 700, color: '#9A9490' }}>{badge}</span>}
                    </div>
                  );
                  const CheckDot = ({ done }: { done: boolean }) => (
                    <div style={{ width: 16, height: 16, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {done ? <CatBadge color="#C5FF00" size={16} /> : <div style={{ width: 14, height: 14, borderRadius: 3, border: '1.5px solid rgba(12,12,10,.2)' }} />}
                    </div>
                  );

                  return (
                    <div style={{ margin: '12px 26px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {/* ── 💊 약 복용 카드 ── */}
                      {medRoutines.filter(m => m.active).length > 0 && (() => {
                        const doneSet = new Set(todayMedLogs.map(l => l.routineId));
                        const activeMeds = medRoutines.filter(m => m.active);
                        const doneCnt = activeMeds.filter(m => doneSet.has(m.id)).length;
                        const getTime = (m: { time?: string; times?: string[] }) => {
                          if (m.time) return m.time;
                          const first = (m.times ?? [])[0];
                          return first === 'morning' ? '09:00' : first === 'lunch' ? '12:00' : first === 'evening' ? '18:00' : '22:00';
                        };
                        // 아침(파랑) 04-12 · 점심(오렌지) 12-18 · 저녁(핑크) 18-04
                        const periodOfD = (m: { time?: string; times?: string[] }): 'am' | 'pm' | 'ev' => {
                          if (m.time && m.time.trim()) { const h = parseInt(m.time.split(':')[0], 10); return h >= 4 && h < 12 ? 'am' : h >= 12 && h < 18 ? 'pm' : 'ev'; }
                          const ts = m.times ?? [];
                          if (ts.includes('morning')) return 'am';
                          if (ts.includes('lunch')) return 'pm';
                          if (ts.some((t: string) => t === 'evening' || t === 'bedtime')) return 'ev';
                          return 'ev';
                        };
                        const groups = [
                          { label: '아침', color: '#6B7CE8', meds: activeMeds.filter(m => periodOfD(m) === 'am') },
                          { label: '오후', color: '#E8A86B', meds: activeMeds.filter(m => periodOfD(m) === 'pm') },
                          { label: '저녁', color: '#E86BAA', meds: activeMeds.filter(m => periodOfD(m) === 'ev') },
                        ].filter(g => g.meds.length > 0);
                        const MedRow = ({ m }: { m: typeof activeMeds[0] }) => {
                          const done = doneSet.has(m.id);
                          return (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <CheckDot done={done} />
                              <span style={{ fontFamily: f, fontSize: 11, fontWeight: 700, color: '#9A9490', width: 38, flexShrink: 0 }}>{getTime(m)}</span>
                              <span style={{ fontFamily: f, fontSize: 12, color: done ? '#BCBAB6' : '#0C0C0A', textDecoration: done ? 'line-through' : 'none', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{m.name}</span>
                            </div>
                          );
                        };
                        return (
                          <div style={{ background: '#fff', border: '1px solid rgba(12,12,10,.07)', borderRadius: 16, overflow: 'hidden' }}>
                            <CardHeader emoji="💊" title="약 복용" badge={`${doneCnt}/${activeMeds.length}`} />
                            <div style={{ padding: '8px 14px 10px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                              {groups.map((g, gi) => (
                                <div key={g.label}>
                                  <div style={{ fontFamily: f, fontSize: 10, fontWeight: 800, color: g.color, letterSpacing: '.06em', marginBottom: 5 }}>{g.label}</div>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>{g.meds.map(m => <MedRow key={m.id} m={m} />)}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })()}

                      {/* ── ⭐ 습관 카드 ── */}
                      {todayHabits.length > 0 && (() => {
                        const doneCnt = todayHabits.filter(h => checkedHabitIds.has(h.id)).length;
                        return (
                          <div style={{ background: '#fff', border: '1px solid rgba(12,12,10,.07)', borderRadius: 16, overflow: 'hidden' }}>
                            <CardHeader emoji="⭐" title="습관" badge={`${doneCnt}/${todayHabits.length}`} />
                            <div style={{ padding: '8px 14px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                              {todayHabits.map(h => {
                                const done = checkedHabitIds.has(h.id);
                                return (
                                  <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <CheckDot done={done} />
                                    <span style={{ fontSize: 13, flexShrink: 0 }}>{h.icon || '•'}</span>
                                    {h.time && h.repeatType !== 'allday' && (
                                      <span style={{ fontFamily: f, fontSize: 11, fontWeight: 700, color: '#9A9490', width: 38, flexShrink: 0 }}>{h.time}</span>
                                    )}
                                    <span style={{ fontFamily: f, fontSize: 12, color: done ? '#BCBAB6' : '#0C0C0A', textDecoration: done ? 'line-through' : 'none', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{h.name}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })()}

                      {/* ── 🏃 건강루틴 카드 ── */}
                      {healthRoutines.filter(h => h.active && h.showInToday).length > 0 && (() => {
                        const doneSet = new Set(todayHealthLogs.map(l => l.routineId));
                        const activeH = healthRoutines.filter(h => h.active && h.showInToday);
                        const doneCnt = activeH.filter(h => doneSet.has(h.id)).length;
                        return (
                          <div style={{ background: '#fff', border: '1px solid rgba(12,12,10,.07)', borderRadius: 16, overflow: 'hidden' }}>
                            <CardHeader emoji="🏃" title="건강루틴" badge={`${doneCnt}/${activeH.length}`} />
                            <div style={{ padding: '8px 14px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                              {activeH.map(h => {
                                const done = doneSet.has(h.id);
                                const pt = (() => {
                                  const timed = (h.entries ?? []).map((e: { time: string }) => e.time).filter((t: string) => t && t.includes(':'));
                                  if (timed.length > 0) return (timed as string[]).sort()[0];
                                  return h.time && h.time.includes(':') ? h.time : '';
                                })();
                                return (
                                  <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <CheckDot done={done} />
                                    <span style={{ fontSize: 13, flexShrink: 0 }}>{h.icon || '🏃'}</span>
                                    {pt && <span style={{ fontFamily: f, fontSize: 11, fontWeight: 700, color: '#9A9490', width: 38, flexShrink: 0 }}>{pt}</span>}
                                    <span style={{ fontFamily: f, fontSize: 12, color: done ? '#BCBAB6' : '#0C0C0A', textDecoration: done ? 'line-through' : 'none', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{h.name}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })()}

                      {/* ── 📋 리셋플랜 카드 ── */}
                      {dietPrograms.filter(p => p.showInToday).map(p => {
                        const doneSet = new Set(todayDietLogs.map(l => `${l.programId}:${l.slotId}`));
                        const dayN = Math.floor((Date.now() - new Date(p.startDate).getTime()) / 86400000) + 1;
                        const sortedPats = [...(p.patterns ?? [])].sort((a, b) => a.dayStart - b.dayStart);
                        const pat = sortedPats.find(pt => dayN >= pt.dayStart && dayN <= pt.dayEnd) ?? sortedPats[sortedPats.length - 1];
                        if (!pat) return null;
                        type DS = import('@/types/dietplan').DietSlot;
                        const slotMap = new Map<string, DS>();
                        for (const aPat of sortedPats) {
                          for (const item of aPat.timeline) {
                            if (item.isWarning) continue;
                            const s = item as DS;
                            if (!slotMap.has(s.label)) slotMap.set(s.label, s);
                          }
                        }
                        const toMin2 = (t?: string) => t ? +t.split(':')[0] * 60 + +t.split(':')[1] : 9999;
                        const getSortKey = (s: DS): number => {
                          if (s.time) return toMin2(s.time);
                          for (const aPat of sortedPats) {
                            const idx = aPat.timeline.findIndex(it => !it.isWarning && (it as DS).label === s.label);
                            if (idx === -1) continue;
                            const prevT = [...aPat.timeline].slice(0, idx).reverse().find(it => !it.isWarning && (it as DS).time);
                            return prevT ? toMin2((prevT as DS).time) + 0.5 : 0;
                          }
                          return 9999;
                        };
                        const allSlots = Array.from(slotMap.values()).sort((a, b) => getSortKey(a) - getSortKey(b));
                        if (allSlots.length === 0) return null;
                        const curSlotByLabel = new Map<string, DS>();
                        for (const item of pat.timeline) {
                          if (!item.isWarning) { const s = item as DS; curSlotByLabel.set(s.label, s); }
                        }
                        const doneCnt = allSlots.filter(s => doneSet.has(`${p.id}:${(curSlotByLabel.get(s.label) ?? s).id}`)).length;
                        return (
                          <div key={p.id} style={{ background: '#fff', border: '1px solid rgba(12,12,10,.07)', borderRadius: 16, overflow: 'hidden' }}>
                            <CardHeader emoji={p.icon || '📋'} title={`${p.name}`} badge={`D+${dayN} · ${doneCnt}/${allSlots.length}`} />
                            <div style={{ padding: '8px 14px 10px', display: 'flex', flexDirection: 'column', gap: 7 }}>
                              {allSlots.map(slot => {
                                const cur = curSlotByLabel.get(slot.label);
                                const done = doneSet.has(`${p.id}:${(cur ?? slot).id}`);
                                return (
                                  <div key={slot.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                                    <CheckDot done={done} />
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                        {slot.time && <span style={{ fontFamily: f, fontSize: 10, fontWeight: 800, background: done ? '#F0F0ED' : '#0C0C0A', color: done ? '#BCBAB6' : '#C5FF00', padding: '1px 6px', borderRadius: 4, flexShrink: 0 }}>{slot.time}</span>}
                                        <span style={{ fontFamily: f, fontSize: 12, color: done ? '#BCBAB6' : '#0C0C0A', textDecoration: done ? 'line-through' : 'none' }}>{slot.label}</span>
                                        {slot.water > 0 && <span style={{ fontFamily: f, fontSize: 10, color: '#4A9ED6', fontWeight: 700, marginLeft: 'auto' }}>💧{slot.water}ml</span>}
                                      </div>
                                      {slot.items && slot.items.length > 0 && (
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 3 }}>
                                          {slot.items.map(it => (
                                            <span key={it.id} style={{ fontFamily: f, fontSize: 10, background: done ? '#F4F4F2' : '#EEEDE9', color: done ? '#BCBAB6' : '#4A4846', padding: '1px 6px', borderRadius: 4 }}>
                                              {it.name}{it.qty ? ` ${it.qty}` : ''}
                                            </span>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}

                      {/* ── 💄👗 MOTD + OOTD 카드 ── */}
                      {(todayMotd.length > 0 || todayOotd.length > 0) && (
                        <div style={{ background: '#fff', border: '1px solid rgba(12,12,10,.07)', borderRadius: 16, overflow: 'hidden' }}>
                          <div style={{ padding: '10px 14px 8px', borderBottom: '1px solid rgba(12,12,10,.05)', display: 'flex', gap: 10 }}>
                            <span style={{ fontFamily: f, fontSize: 12, fontWeight: 800, color: '#0C0C0A' }}>💄 MOTD</span>
                            <span style={{ fontFamily: f, fontSize: 12, fontWeight: 800, color: '#0C0C0A', marginLeft: 'auto' }}>👗 OOTD</span>
                          </div>
                          <div style={{ padding: '10px 14px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                            {/* MOTD — 컬럼 전체 너비 채움 */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
                              {todayMotd.length > 0 ? todayMotd.slice(0, 1).map(item => (
                                <div key={item.id} style={{ display: 'flex', flexDirection: 'column', gap: 5, width: '100%' }}>
                                  <div style={{ width: '100%', background: 'linear-gradient(135deg,#f5f0ff,#d0b0ff)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    {item.imageUrl
                                      // eslint-disable-next-line @next/next/no-img-element
                                      ? <img src={item.imageUrl} alt={item.name} style={{ width: '100%', height: 'auto', display: 'block' }} />
                                      : <span style={{ fontSize: 36 }}>{item.emoji || '💄'}</span>}
                                  </div>
                                  <span style={{ fontFamily: f, fontSize: 12, fontWeight: 600, color: '#0C0C0A', width: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{item.name}</span>
                                </div>
                              )) : (
                                <div style={{ width: '100%', minHeight: 120, background: 'linear-gradient(135deg,#f5f0ff,#d0b0ff)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                  <TodayStampBadge size={68} rotate={-9} label="MOTD" f={f} />
                                </div>
                              )}
                            </div>
                            {/* OOTD — 컬럼 전체 너비 채움 */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
                              {todayOotd.length > 0 ? todayOotd.slice(0, 1).map(item => (
                                <div key={item.id} style={{ display: 'flex', flexDirection: 'column', gap: 5, width: '100%' }}>
                                  <div style={{ width: '100%', background: 'linear-gradient(135deg,#fff0f5,#ffc0d0)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    {item.imageUrl
                                      // eslint-disable-next-line @next/next/no-img-element
                                      ? <img src={item.imageUrl} alt={item.name} style={{ width: '100%', height: 'auto', display: 'block' }} />
                                      : <span style={{ fontSize: 36 }}>{item.emoji || '👗'}</span>}
                                  </div>
                                  <span style={{ fontFamily: f, fontSize: 12, fontWeight: 600, color: '#0C0C0A', width: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{item.name}</span>
                                </div>
                              )) : (
                                <div style={{ width: '100%', minHeight: 120, background: 'linear-gradient(135deg,#fff0f5,#ffc0d0)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                  <TodayStampBadge size={68} rotate={-9} label="OOTD" f={f} />
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </>
            )}
          </div>
        )}

        {/* ── 아카이브 탭 ── */}
        {mainTab === '아카이브' && (() => {
          const f = "'Plus Jakarta Sans','Space Grotesk',sans-serif";
          const usedMakeup = makeupItems.filter(i => (i.dates ?? []).length > 0);
          const usedLook = lookItems.filter(i => (i.dates ?? []).length > 0);
          const tabs: { key: 'all' | 'makeup' | 'lookbook' | 'lifetip' | 'ootd'; label: string; count: number }[] = [
            { key: 'all',      label: 'ALL',        count: usedMakeup.length + usedLook.length + lifetipItems.length + ootdLogs.length },
            { key: 'makeup',   label: '💄 메이크업',  count: usedMakeup.length },
            { key: 'lookbook', label: '👗 룩북',     count: usedLook.length },
            { key: 'lifetip',  label: '📌 Life TIP', count: lifetipItems.length },
            { key: 'ootd',     label: '오늘의룩',    count: ootdLogs.length },
          ];

          // 아이템 목록 (makeup + lookbook)
          const ctItems = libFilter === 'all'
            ? [...usedMakeup, ...usedLook].sort((a, b) => (b.dates ?? []).length - (a.dates ?? []).length)
            : libFilter === 'makeup' ? usedMakeup
            : libFilter === 'lookbook' ? usedLook
            : [];

          // Life TIP — 카테고리별 그루핑
          const lifetipByCategory: Record<string, LifetipItem[]> = {};
          for (const item of lifetipItems) {
            const cat = item.tipCategory || '기타';
            if (!lifetipByCategory[cat]) lifetipByCategory[cat] = [];
            lifetipByCategory[cat].push(item);
          }
          const lifetipCategories = Object.keys(lifetipByCategory).sort((a, b) =>
            lifetipByCategory[b].length - lifetipByCategory[a].length
          );

          // OOTD 카드 리스트 — LogLibraryCard와 동일 CSS
          const OotdGrid = () => (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
              {ootdLogs.map(log => {
                const pIds = log.productIds ?? [];
                return (
                <div key={log.id} style={{ border: '1px solid #000000', background: '#FFFFFF' }}>
                  {/* 카드 본체 */}
                  <div style={{ boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', padding: '20px 26px 0px', position: 'relative', width: '100%', isolation: 'isolate', flexShrink: 0 }}>
                    {/* 배지 */}
                    <div style={{ position: 'absolute', right: 7, top: 42, width: 113, height: 32, background: '#C6F432', border: '1px solid #18181B', transform: 'rotate(-3deg)', display: 'flex', alignItems: 'center', padding: '0 12px', zIndex: 3 }}>
                      <span style={{ fontFamily: f, fontSize: 14, fontWeight: 700, color: '#525252', transform: 'rotate(-3deg)' }}>#OOTD</span>
                    </div>
                    {/* 이미지 */}
                    {log.photoUrl
                      ? // eslint-disable-next-line @next/next/no-img-element
                        <img src={log.photoUrl} alt={log.theme} style={{ width: '100%', height: 'auto', display: 'block' }} />
                      : <div style={{ width: '100%', aspectRatio: '4/3', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <span style={{ fontSize: 120, opacity: 0.3, lineHeight: 1 }}>👗</span>
                        </div>
                    }
                    {/* 제목 (테마) */}
                    <div style={{ fontFamily: f, fontSize: 20, fontWeight: 600, color: '#000', lineHeight: '24px', marginTop: 12, width: '100%', zIndex: 1 }}>
                      {log.theme || '오늘의 룩'}
                    </div>
                    {/* 날짜 + 메모 */}
                    <div style={{ fontFamily: f, fontSize: 16, fontWeight: 400, color: '#000', lineHeight: '18px', marginTop: 4, marginBottom: 12, width: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, zIndex: 2 }}>
                      {log.date}{log.note ? ` · ${log.note}` : ''}
                    </div>
                  </div>
                  {/* 제품 영역 */}
                  {pIds.length > 0 && (
                    <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '12px 8px 8px', width: '100%', scrollbarWidth: 'none' as const, borderTop: '1px solid #000000', boxSizing: 'border-box' as const }}>
                      {pIds.map((pid, idx) => {
                        const p = products.get(pid);
                        const imgSrc = p?.imageUrl ?? (p as (Product & { storageUrl?: string }) | undefined)?.storageUrl;
                        return (
                          <div key={idx} style={{ flexShrink: 0, width: 120, display: 'flex', flexDirection: 'column', gap: 5 }}>
                            <div style={{ width: 120, height: 160, background: '#F3F3F4', border: '1px solid #000000', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              {imgSrc ? <img src={imgSrc} alt={p?.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <span style={{ fontSize: 24, opacity: 0.2 }}>🧴</span>}
                            </div>
                            <span style={{ fontFamily: f, fontSize: 11, fontWeight: 600, color: '#525252', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{p?.name ?? ''}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {/* 편집 버튼 */}
                  <button onClick={() => openOotdEdit(log)} style={{ width: '100%', padding: '12px 0', background: '#F3F3F1', color: '#0C0C0A', border: 'none', borderTop: '1px solid #000000', fontFamily: f, fontSize: 12, fontWeight: 700, letterSpacing: '.06em', cursor: 'pointer' }}>편집</button>
                </div>
                );
              })}
            </div>
          );

          // 카테고리별 색상 설정
          const TAB_COLOR: Record<string, { active: string; bg: string; text: string }> = {
            all:      { active: '#0C0C0A', bg: '#0C0C0A',           text: '#C5FF00' },
            makeup:   { active: '#C5FF00', bg: 'rgba(197,255,0,.14)', text: '#3A6000' },
            lookbook: { active: '#FF8C42', bg: 'rgba(255,140,66,.14)', text: '#B85A00' },
            lifetip:  { active: '#60A5FA', bg: 'rgba(96,165,250,.14)', text: '#1D6DDB' },
            ootd:     { active: '#C5FF00', bg: 'rgba(197,255,0,.14)', text: '#3A6000' },
          };

          return (
            <div style={{ padding: '16px 26px 0' }}>
              {/* ── 카테고리 카드 그리드 ── */}
              <div style={{ marginBottom: 18 }}>

                {/* ALL — 전체 너비 카드 */}
                {(() => {
                  const t = tabs[0]; // all
                  const sel = libFilter === t.key;
                  const col = TAB_COLOR[t.key];
                  return (
                    <button type="button" key={t.key} onClick={() => setLibFilter(t.key)}
                      style={{ width: '100%', padding: '12px 18px', marginBottom: 8, borderRadius: 14,
                        border: `1.5px solid ${sel ? col.active : 'rgba(12,12,10,.1)'}`,
                        background: sel ? col.bg : '#fff',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        cursor: 'pointer', transition: 'all .15s', boxSizing: 'border-box' as const }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                        <span style={{ fontFamily: f, fontSize: 11, fontWeight: 700, color: sel ? '#fff' : '#9A9490', letterSpacing: '.08em' }}>ALL</span>
                        <span style={{ fontFamily: f, fontSize: 11, fontWeight: 600, color: sel ? 'rgba(255,255,255,.6)' : '#BCBAB6' }}>전체 아카이브</span>
                      </div>
                      <span style={{ fontFamily: f, fontSize: 32, fontWeight: 900, lineHeight: 1,
                        color: sel ? col.text : '#0C0C0A' }}>{t.count}</span>
                    </button>
                  );
                })()}

                {/* 4개 카테고리 — 2×2 그리드 */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {tabs.slice(1).map(t => {
                    const sel = libFilter === t.key;
                    const col = TAB_COLOR[t.key] ?? TAB_COLOR.all;
                    const ICON: Record<string, string> = { makeup: '💄', lookbook: '👗', lifetip: '📌', ootd: '👟' };
                    const NAME: Record<string, string> = { makeup: '메이크업', lookbook: '룩북', lifetip: 'Life TIP', ootd: '오늘의룩' };
                    return (
                      <button type="button" key={t.key} onClick={() => setLibFilter(t.key)}
                        style={{ padding: '14px 16px', borderRadius: 14,
                          border: `1.5px solid ${sel ? col.active : 'rgba(12,12,10,.1)'}`,
                          background: sel ? col.bg : '#fff',
                          display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10,
                          cursor: 'pointer', transition: 'all .15s', textAlign: 'left' }}>
                        <span style={{ fontSize: 22, lineHeight: 1 }}>{ICON[t.key]}</span>
                        <div style={{ width: '100%', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
                          <span style={{ fontFamily: f, fontSize: 11, fontWeight: 700,
                            color: sel ? col.text : '#9A9490' }}>{NAME[t.key]}</span>
                          <span style={{ fontFamily: f, fontSize: 26, fontWeight: 900, lineHeight: 1,
                            color: sel ? col.text : '#0C0C0A' }}>{t.count}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 콘텐츠 */}
              {libFilter === 'ootd' ? (
                ootdLogs.length === 0
                  ? <div style={{ padding: '32px 20px', textAlign: 'center', background: '#fff', border: '1px solid #000000', borderRadius: 16, marginBottom: 20 }}>
                      <div style={{ fontSize: 28, marginBottom: 8 }}>👗</div>
                      <div style={{ fontFamily: f, fontSize: 13, fontWeight: 700, color: '#0C0C0A', marginBottom: 4 }}>오늘의 룩 기록이 없어요</div>
                      <div style={{ fontFamily: f, fontSize: 12, color: '#9A9490' }}>TODAY 화면에서 기록해보세요</div>
                    </div>
                  : <OotdGrid />

              ) : libFilter === 'lifetip' ? (
                /* ── Life TIP 탭 ── */
                lifetipItems.length === 0 ? (
                  <div style={{ padding: '40px 20px', textAlign: 'center', background: '#fff', borderRadius: 16, border: '1px solid rgba(12,12,10,.08)', marginBottom: 20 }}>
                    <div style={{ fontSize: 32, marginBottom: 8 }}>📌</div>
                    <div style={{ fontFamily: f, fontSize: 13, fontWeight: 700, color: '#0C0C0A', marginBottom: 4 }}>Life TIP이 없어요</div>
                    <div style={{ fontFamily: f, fontSize: 12, color: '#9A9490' }}>수집에서 + 라이브러리 버튼으로 추가하세요</div>
                  </div>
                ) : lifetipCategory === null ? (
                  /* 카테고리 그리드 홈 */
                  <div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
                      {lifetipCategories.map(cat => {
                        const items = lifetipByCategory[cat];
                        const emoji = items[0]?.emoji || getLifetipEmoji(cat);
                        return (
                          <button key={cat} type="button" onClick={() => setLifetipCategory(cat)}
                            style={{ background: '#fff', border: '1px solid rgba(12,12,10,.1)', borderRadius: 16, padding: '18px 16px', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8, cursor: 'pointer', textAlign: 'left', transition: 'all .15s' }}>
                            <span style={{ fontSize: 28, lineHeight: 1 }}>{emoji}</span>
                            <div>
                              <div style={{ fontFamily: f, fontSize: 13, fontWeight: 800, color: '#0C0C0A', marginBottom: 2 }}>{cat}</div>
                              <div style={{ fontFamily: f, fontSize: 11, color: '#9A9490' }}>{items.length}개</div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  /* 카테고리 상세 */
                  <div>
                    {/* 뒤로가기 헤더 */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                      <button type="button" onClick={() => setLifetipCategory(null)}
                        style={{ width: 32, height: 32, borderRadius: 9999, background: 'rgba(12,12,10,.06)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                          <path d="M10 3L5 8l5 5" stroke="#0C0C0A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </button>
                      <span style={{ fontFamily: f, fontSize: 18, lineHeight: 1 }}>{lifetipByCategory[lifetipCategory]?.[0]?.emoji || getLifetipEmoji(lifetipCategory)}</span>
                      <span style={{ fontFamily: f, fontSize: 16, fontWeight: 800, color: '#0C0C0A' }}>{lifetipCategory}</span>
                      <span style={{ fontFamily: f, fontSize: 12, color: '#9A9490', marginLeft: 'auto' }}>{lifetipByCategory[lifetipCategory]?.length ?? 0}개</span>
                    </div>

                    {/* 아이템 목록 */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
                      {(lifetipByCategory[lifetipCategory] ?? []).map(item => (
                        <div key={item.id} style={{ background: '#fff', borderRadius: 14, border: '1px solid rgba(12,12,10,.08)', overflow: 'hidden' }}>
                          <div style={{ display: 'flex', alignItems: 'stretch' }}>

                            {/* 이모지 — 탭하면 편집 가능 */}
                            <button type="button" onClick={() => setEditingLifetipId(editingLifetipId === item.id ? null : item.id)}
                              style={{ width: 64, flexShrink: 0, background: '#F5F4F0', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26 }}>
                              {item.emoji || getLifetipEmoji(item.tipCategory)}
                            </button>

                            {/* 텍스트 */}
                            <div style={{ flex: 1, padding: '12px 14px', minWidth: 0 }}>
                              <div style={{ fontFamily: f, fontSize: 13, fontWeight: 700, color: '#0C0C0A', marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                                {item.name}
                              </div>
                              <div style={{ fontFamily: f, fontSize: 11, color: '#BCBAB6' }}>
                                {item.createdAt?.slice(0, 10)}
                              </div>
                            </div>

                            {/* 링크 버튼 */}
                            {item.sourceUrl && (
                              <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer"
                                style={{ width: 44, flexShrink: 0, background: '#F5F4F0', display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none', borderLeft: '1px solid rgba(12,12,10,.06)' }}>
                                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                                  <path d="M7 3H3a1 1 0 00-1 1v9a1 1 0 001 1h9a1 1 0 001-1V9" stroke="#9A9490" strokeWidth="1.5" strokeLinecap="round"/>
                                  <path d="M10 2h4v4M14 2L8 8" stroke="#9A9490" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                              </a>
                            )}
                          </div>

                          {/* 이모지 인라인 편집 패널 — 모바일 키보드로 직접 입력 */}
                          {editingLifetipId === item.id && (
                            <div style={{ padding: '10px 14px', borderTop: '1px solid rgba(12,12,10,.06)', background: '#FAFAF8', display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ fontFamily: f, fontSize: 11, fontWeight: 700, color: '#9A9490', flexShrink: 0 }}>이모지</span>
                              <input
                                type="text"
                                defaultValue={item.emoji}
                                autoFocus
                                onBlur={async e => {
                                  const newEmoji = e.target.value.trim();
                                  if (newEmoji && newEmoji !== item.emoji && db && userId) {
                                    await updateDoc(doc(db, 'users', userId, 'lifetipItems', item.id), {
                                      emoji: newEmoji, updatedAt: new Date().toISOString()
                                    });
                                  }
                                  setEditingLifetipId(null);
                                }}
                                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                                style={{ flex: 1, height: 36, padding: '0 10px', border: '1.5px solid rgba(12,12,10,.2)', borderRadius: 8, background: '#fff', fontSize: 20, outline: 'none' }}
                              />
                              <button type="button" onClick={() => setEditingLifetipId(null)}
                                style={{ height: 36, padding: '0 12px', borderRadius: 8, border: '1px solid rgba(12,12,10,.12)', background: 'transparent', fontFamily: f, fontSize: 11, fontWeight: 700, color: '#9A9490', cursor: 'pointer' }}>
                                취소
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )

              ) : (
                <>
                  {ctItems.length === 0 && libFilter !== 'all' && (
                    <div style={{ padding: '32px 20px', textAlign: 'center', background: '#fff', border: '1px solid #000000', borderRadius: 16, marginBottom: 20 }}>
                      <div style={{ fontSize: 28, marginBottom: 8 }}>{libFilter === 'makeup' ? '💄' : '👗'}</div>
                      <div style={{ fontFamily: f, fontSize: 13, fontWeight: 700, color: '#0C0C0A', marginBottom: 4 }}>사용 기록이 없어요</div>
                      <div style={{ fontFamily: f, fontSize: 12, color: '#9A9490' }}>라이브러리에서 Today ON을 설정하면 기록됩니다</div>
                    </div>
                  )}
                  {ctItems.map(item => (
                    <LogLibraryCard key={item.id} item={item} products={products} onEdit={() => triggerCollectionEdit(item)} />
                  ))}
                  {/* ALL일 때 Life TIP 카테고리 미니 카드 */}
                  {libFilter === 'all' && lifetipItems.length > 0 && (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '20px 0 12px' }}>
                        <span style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.16em', color: '#9A9490' }}>LIFE TIP</span>
                        <span style={{ fontFamily: f, fontSize: 11, fontWeight: 800, color: '#1D6DDB' }}>{lifetipItems.length}개</span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 20 }}>
                        {lifetipCategories.map(cat => {
                          const items = lifetipByCategory[cat];
                          const emoji = items[0]?.emoji || getLifetipEmoji(cat);
                          return (
                            <button key={cat} type="button"
                              onClick={() => { setLibFilter('lifetip'); setLifetipCategory(cat); }}
                              style={{ background: 'rgba(96,165,250,.08)', border: '1.5px solid rgba(96,165,250,.3)', borderRadius: 12, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', textAlign: 'left' }}>
                              <span style={{ fontSize: 20, lineHeight: 1, flexShrink: 0 }}>{emoji}</span>
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontFamily: f, fontSize: 12, fontWeight: 800, color: '#1D6DDB', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{cat}</div>
                                <div style={{ fontFamily: f, fontSize: 11, color: '#60A5FA' }}>{items.length}개</div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                  {/* ALL일 때 OOTD 그리드도 함께 표시 */}
                  {libFilter === 'all' && ootdLogs.length > 0 && (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '20px 0 12px' }}>
                        <span style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.16em', color: '#9A9490' }}>오늘의룩</span>
                        <span style={{ fontFamily: f, fontSize: 11, fontWeight: 800, color: '#0C0C0A' }}>{ootdLogs.length}개</span>
                      </div>
                      <OotdGrid />
                    </>
                  )}
                  {libFilter === 'all' && ctItems.length === 0 && ootdLogs.length === 0 && lifetipItems.length === 0 && (
                    <div style={{ padding: '32px 20px', textAlign: 'center', background: '#fff', border: '1px solid #000000', borderRadius: 16, marginBottom: 20 }}>
                      <div style={{ fontSize: 28, marginBottom: 8 }}>📂</div>
                      <div style={{ fontFamily: f, fontSize: 13, fontWeight: 700, color: '#0C0C0A', marginBottom: 4 }}>아카이브가 비어있어요</div>
                      <div style={{ fontFamily: f, fontSize: 12, color: '#9A9490' }}>라이브러리에서 Today ON을 설정하면 기록됩니다</div>
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })()}

        {/* ── 수집 탭 — 레퍼런스 링크 보드 ── */}
        {mainTab === '수집' && (() => {
          const f = "'Plus Jakarta Sans','Space Grotesk',sans-serif";
          const PLATFORM_ICON: Record<string, string> = {
            instagram: '📸',
            youtube: '▶️',
            pinterest: '📌',
            other: '🔗',
          };

          // Life TIP에 등록된 카테고리 집합 — 태그 색상 구분에 사용
          const lifetipCategorySet = new Set(lifetipItems.map(i => i.tipCategory));

          // 필터링 + 정렬 + 페이지네이션
          const filtered = refFilter === 'all'
            ? references
            : references.filter(r => (r.tags ?? []).includes(refFilter));

          const sortedFiltered = (() => {
            const list = [...filtered];
            if (refSort === 'name') return list.sort((a, b) => {
              const ta = (a.title ?? '').toLowerCase();
              const tb = (b.title ?? '').toLowerCase();
              if (!ta && tb) return 1; if (ta && !tb) return -1;
              return ta.localeCompare(tb, 'ko');
            });
            if (refSort === 'tag') return list.sort((a, b) => {
              const ta = (a.tags ?? [])[0] ?? '';
              const tb = (b.tags ?? [])[0] ?? '';
              if (ta !== tb) return ta.localeCompare(tb, 'ko');
              return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
            });
            return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          })();

          const visibleRefs = sortedFiltered.slice(0, refVisibleCount);

          // 플랫폼별 색상 + 레이블
          const PLATFORM_COLOR: Record<string, string> = {
            instagram: '#C13584', youtube: '#FF0000', pinterest: '#E60023', other: '#9A9490',
          };
          const PLATFORM_LABEL: Record<string, string> = {
            instagram: 'Instagram', youtube: 'YouTube', pinterest: 'Pinterest', other: 'Link',
          };

          // 아이콘 버튼용 툴팁 래퍼
          const Tip = ({ label, children }: { label: string; children: React.ReactNode }) => {
            const [show, setShow] = useState(false);
            return (
              <div style={{ position: 'relative', flexShrink: 0, display: 'flex' }}
                onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
                {show && (
                  <div style={{ position: 'absolute', bottom: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)', background: '#0C0C0A', color: '#fff', fontFamily: f, fontSize: 10, fontWeight: 700, padding: '4px 9px', borderRadius: 6, whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: 99, letterSpacing: '.02em' }}>
                    {label}
                    <div style={{ position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)', width: 0, height: 0, borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderTop: '5px solid #0C0C0A' }} />
                  </div>
                )}
                {children}
              </div>
            );
          };

          // 카드 렌더러 — 3가지 정렬 모드에서 공통 사용
          const renderRef = (ref: Reference) => {
            const platform = ref.platform ?? 'other';
            const pColor = PLATFORM_COLOR[platform];
            return (
              <div key={ref.id} style={{ background: '#fff', borderRadius: 16, border: '1px solid rgba(12,12,10,.08)', overflow: 'hidden' }}>

                {/* ── 메인 콘텐츠 영역 ── */}
                <div style={{ display: 'flex', alignItems: 'stretch' }}>

                  {/* 썸네일 — 이미지 있으면 cover, 없으면 플랫폼 이모지 */}
                  <div style={{ width: 90, flexShrink: 0, background: '#F0EEE8', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', minHeight: 90 }}>
                    {ref.imageUrl
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={ref.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : <span style={{ fontSize: 34 }}>{PLATFORM_ICON[platform]}</span>
                    }
                  </div>

                  {/* 텍스트 영역 */}
                  <div style={{ flex: 1, padding: '11px 12px 10px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>

                    {/* 상단 행: 플랫폼 뱃지(좌) + 태그(우) */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>

                      {/* 플랫폼 뱃지 */}
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0, height: 18, padding: '0 7px', borderRadius: 9999, background: `${pColor}18` }}>
                        <span style={{ fontSize: 9 }}>{PLATFORM_ICON[platform]}</span>
                        <span style={{ fontFamily: f, fontSize: 9, fontWeight: 800, color: pColor, letterSpacing: '.06em', textTransform: 'uppercase' as const }}>
                          {PLATFORM_LABEL[platform]}
                        </span>
                      </div>

                      {/* 태그 칩 — 우측 상단, 최대 2개 표시 */}
                      {(ref.tags ?? []).length > 0 && (
                        <div style={{ display: 'flex', gap: 3, overflow: 'hidden', flexShrink: 1 }}>
                          {(ref.tags ?? []).slice(0, 2).map(tag => (
                            <span key={tag} style={{ fontFamily: f, fontSize: 9, fontWeight: 800, color: '#C5FF00', background: '#0C0C0A', padding: '2px 7px', borderRadius: 9999, letterSpacing: '.03em', whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 70 }}>
                              {tag}
                            </span>
                          ))}
                          {(ref.tags ?? []).length > 2 && (
                            <span style={{ fontFamily: f, fontSize: 9, fontWeight: 800, color: '#C5FF00', background: '#0C0C0A', padding: '2px 6px', borderRadius: 9999, flexShrink: 0 }}>
                              +{(ref.tags ?? []).length - 2}
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* 제목 */}
                    <div style={{ fontFamily: f, fontSize: 13, fontWeight: 700, color: '#0C0C0A', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const, overflow: 'hidden' }}>
                      {ref.title || ref.url || '제목 없음'}
                    </div>
                  </div>
                </div>

                {/* ── 구분선 ── */}
                <div style={{ height: 1, background: 'rgba(12,12,10,.06)', margin: '0 12px' }} />

                {/* ── 액션 바 — 5:5 분리 ── */}
                <div style={{ display: 'flex', alignItems: 'stretch', padding: '8px 10px 10px', gap: 6 }}>

                  {/* ← 50% 좌측: 라이브러리 등록 */}
                  <button
                    type="button"
                    onClick={() => {
                      setRefToLib(ref);
                      // ref 태그 중 Life TIP 카테고리로 등록된 것이 있으면 lifetip 타입 기본 선택
                      const tipTag = (ref.tags ?? []).find(t => lifetipCategorySet.has(t));
                      if (tipTag) {
                        setRefToLibType('lifetip');
                        setRefToLibTipCategory(tipTag);
                        setRefToLibEmoji(getLifetipEmoji(tipTag));
                      } else {
                        setRefToLibType('makeup');
                        setRefToLibTipCategory('');
                        setRefToLibEmoji('');
                      }
                    }}
                    style={{ flex: 1, height: 42, borderRadius: 12, background: '#0C0C0A', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, cursor: 'pointer' }}
                  >
                    <span style={{ fontSize: 13, color: '#C5FF00', lineHeight: 1 }}>＋</span>
                    <span style={{ fontFamily: f, fontSize: 11, fontWeight: 800, color: '#C5FF00' }}>라이브러리</span>
                  </button>

                  {/* → 50% 우측: 링크공유 + 편집 + 삭제 (3등분) */}
                  <div style={{ flex: 1, display: 'flex', gap: 5 }}>

                    {/* 링크 공유 */}
                    {ref.url ? (
                      <a href={ref.url} target="_blank" rel="noopener noreferrer" aria-label="링크 열기"
                        style={{ flex: 1, height: 42, borderRadius: 10, background: '#EDFAD0', border: '1px solid rgba(74,119,0,.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}>
                        <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                          <path d="M7 3H3a1 1 0 00-1 1v9a1 1 0 001 1h9a1 1 0 001-1V9" stroke="#3A6000" strokeWidth="1.5" strokeLinecap="round"/>
                          <path d="M10 2h4v4M14 2L8 8" stroke="#3A6000" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </a>
                    ) : (
                      <span aria-label="링크 없음"
                        style={{ flex: 1, height: 42, borderRadius: 10, background: 'rgba(12,12,10,.04)', border: '1px solid rgba(12,12,10,.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" style={{ opacity: 0.2 }}>
                          <path d="M7 3H3a1 1 0 00-1 1v9a1 1 0 001 1h9a1 1 0 001-1V9" stroke="#0C0C0A" strokeWidth="1.5" strokeLinecap="round"/>
                          <path d="M10 2h4v4M14 2L8 8" stroke="#0C0C0A" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </span>
                    )}

                    {/* 편집 */}
                    <button type="button" onClick={() => openRefEdit(ref)} aria-label="편집"
                      style={{ flex: 1, height: 42, borderRadius: 10, background: '#F5F4F2', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                        <path d="M11 2l3 3-9 9H2v-3L11 2z" stroke="#44474A" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </button>

                    {/* 삭제 */}
                    <button type="button" onClick={() => deleteReference(ref.id)} aria-label="삭제"
                      style={{ flex: 1, height: 42, borderRadius: 10, background: 'rgba(233,79,107,.08)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                        <path d="M3 3l10 10M13 3L3 13" stroke="#E94F6B" strokeWidth="2" strokeLinecap="round"/>
                      </svg>
                    </button>

                  </div>
                </div>
              </div>
            );
          };

          return (
            <div style={{ paddingTop: 16, paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 100px)' }}>

              {/* ── 수집 등록 폼 ── 편집 시트와 동일한 레이아웃·스타일 */}
              <div style={{ margin: '0 26px 16px', background: '#FAFAF8', borderRadius: 16, padding: '16px 16px 20px', border: '1px solid rgba(12,12,10,.08)' }}>

                {/* 헤더 */}
                <div style={{ fontFamily: f, fontSize: 16, fontWeight: 800, color: '#0C0C0A', marginBottom: 20 }}>새 수집 추가</div>

                {/* 제목 */}
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase' as const, color: '#9A9490', marginBottom: 8 }}>제목</div>
                  <input
                    type="text"
                    value={refTitle}
                    onChange={e => setRefTitle(e.target.value)}
                    placeholder="제목 입력"
                    style={{ width: '100%', boxSizing: 'border-box' as const, height: 44, padding: '0 14px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 10, background: '#fff', fontFamily: f, fontSize: 13, color: '#0C0C0A', outline: 'none' }}
                  />
                </div>

                {/* 링크 */}
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase' as const, color: '#9A9490', marginBottom: 8 }}>링크</div>
                  <div style={{ position: 'relative' }}>
                    <input
                      type="url"
                      value={refUrl}
                      onChange={e => setRefUrl(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && refUrl.trim() && saveReference()}
                      onBlur={() => { if (refUrl.trim()) fetchOgMeta(refUrl.trim()); }}
                      onPaste={e => {
                        const pasted = e.clipboardData.getData('text');
                        if (pasted.startsWith('http')) setTimeout(() => fetchOgMeta(pasted.trim()), 50);
                      }}
                      placeholder="링크 입력 (선택)"
                      style={{ width: '100%', boxSizing: 'border-box' as const, height: 44, padding: '0 14px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 10, background: '#fff', fontFamily: f, fontSize: 13, color: '#0C0C0A', outline: 'none' }}
                    />
                    {refOgLoading && (
                      <div style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', gap: 5, pointerEvents: 'none' }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ animation: 'spin 1s linear infinite' }}>
                          <circle cx="12" cy="12" r="10" stroke="#C5FF00" strokeWidth="2.5" strokeDasharray="30" strokeDashoffset="10"/>
                        </svg>
                        <span style={{ fontFamily: f, fontSize: 10, fontWeight: 700, color: '#9A9490' }}>미리보기 중...</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* 이미지 */}
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase' as const, color: '#9A9490', marginBottom: 8 }}>이미지</div>
                  <ImagePicker
                    preview={refImagePreview}
                    onChange={(file, base64) => { setRefImageFile(file); setRefImagePreview(base64); }}
                    onClear={() => { setRefImageFile(null); setRefImagePreview(''); }}
                    height={180}
                    placeholderLabel="이미지 추가 (선택)"
                    isOpen={mainTab === '수집'}
                  />
                </div>

                {/* 태그 */}
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase' as const, color: '#9A9490', marginBottom: 8 }}>태그</div>

                  {/* 선택된 태그 칩 + 직접 입력창 */}
                  <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 6, padding: '8px 10px', minHeight: 44, border: `1.5px solid ${refTagFocused ? 'rgba(12,12,10,.32)' : 'rgba(12,12,10,.14)'}`, borderRadius: 10, background: '#fff', alignItems: 'center', marginBottom: 0, transition: 'border-color .15s' }}>
                    {refTags.map(tag => (
                      <div key={tag} style={{ display: 'flex', alignItems: 'center', gap: 4, height: 30, padding: '0 6px 0 10px', borderRadius: 9999, background: 'rgba(197,255,0,.18)', border: '1.5px solid #4A7700', flexShrink: 0, maxWidth: 200 }}>
                        <span style={{ fontFamily: f, fontSize: 12, fontWeight: 700, color: '#3A6000', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, maxWidth: 130 }}>{tag}</span>
                        <button type="button" title="태그 삭제" onClick={() => setRefTags(prev => prev.filter(t => t !== tag))} style={{ width: 22, height: 22, minWidth: 22, borderRadius: 9999, background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, flexShrink: 0, color: 'rgba(58,96,0,.65)' }}>
                          <svg width="9" height="9" viewBox="0 0 9 9" fill="none"><path d="M1.5 1.5l6 6M7.5 1.5l-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
                        </button>
                      </div>
                    ))}
                    <input
                      type="text"
                      value={refTagInput}
                      onChange={e => setRefTagInput(e.target.value)}
                      onFocus={() => setRefTagFocused(true)}
                      onBlur={() => { setTimeout(() => setRefTagFocused(false), 200); }}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.nativeEvent.isComposing && refTagInput.trim()) {
                          e.preventDefault();
                          const t = refTagInput.trim();
                          if (!refTags.includes(t)) setRefTags(prev => [...prev, t]);
                          setRefTagInput('');
                        }
                      }}
                      placeholder={refTags.length === 0 ? '태그 입력 후 Enter' : '태그 추가...'}
                      style={{ flex: 1, minWidth: 80, border: 'none', outline: 'none', background: 'transparent', fontFamily: f, fontSize: 12, color: '#0C0C0A' }}
                    />
                  </div>

                  {/* 빠른 선택 — 입력창 포커스 시에만 노출 */}
                  {(refTagFocused || presetEditMode) && (
                    <div style={{ marginTop: 8, padding: '10px 12px', borderRadius: 10, background: 'rgba(12,12,10,.03)', border: '1px solid rgba(12,12,10,.08)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                        <span style={{ fontFamily: f, fontSize: 10, fontWeight: 700, color: '#BCBAB6', letterSpacing: '.06em', textTransform: 'uppercase' as const }}>빠른 선택</span>
                        <button type="button"
                          onMouseDown={e => e.preventDefault()}
                          onClick={() => { setPresetEditMode(v => !v); setPresetNewTag(''); }}
                          style={{ height: 24, padding: '0 10px', borderRadius: 9999, border: 'none', background: presetEditMode ? 'rgba(12,12,10,.08)' : '#0C0C0A', fontFamily: f, fontSize: 10, fontWeight: 800, color: presetEditMode ? '#9A9490' : '#C5FF00', cursor: 'pointer', letterSpacing: '.04em', flexShrink: 0 }}>
                          {presetEditMode ? '완료' : '태그 편집'}
                        </button>
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const, alignItems: 'center' }}>
                        {presetTags.map((tag, pIdx) => {
                          const selected = refTags.includes(tag);
                          return (
                            <div
                              key={tag}
                              draggable={presetEditMode}
                              onDragStart={e => { if (!presetEditMode) return; e.dataTransfer.effectAllowed = 'move'; setDragPresetIdx(pIdx); }}
                              onDragOver={e => { if (!presetEditMode) return; e.preventDefault(); setDragPresetOverIdx(pIdx); }}
                              onDrop={e => {
                                if (!presetEditMode) return;
                                e.preventDefault();
                                if (dragPresetIdx === null || dragPresetIdx === pIdx) { setDragPresetIdx(null); setDragPresetOverIdx(null); return; }
                                setPresetTags(prev => {
                                  const next = [...prev];
                                  const [moved] = next.splice(dragPresetIdx, 1);
                                  next.splice(pIdx, 0, moved);
                                  return next;
                                });
                                setDragPresetIdx(null);
                                setDragPresetOverIdx(null);
                              }}
                              onDragEnd={() => { setDragPresetIdx(null); setDragPresetOverIdx(null); }}
                              style={{ position: 'relative', display: 'inline-flex', outline: presetEditMode && dragPresetOverIdx === pIdx ? '2px dashed #C5FF00' : 'none', borderRadius: 9999, opacity: presetEditMode && dragPresetIdx === pIdx ? 0.4 : 1 }}
                            >
                              {/* 이미 선택된 태그는 비활성 표시 (칩으로 표시됨), 미선택은 클릭 가능 */}
                              <button type="button"
                                onMouseDown={e => e.preventDefault()}
                                onClick={() => { if (!presetEditMode) setRefTags(prev => selected ? prev.filter(t => t !== tag) : [...prev, tag]); }}
                                style={{ height: 28, padding: presetEditMode ? '0 28px 0 12px' : '0 12px', borderRadius: 9999, border: `1.5px solid ${selected && !presetEditMode ? 'rgba(74,119,0,.3)' : 'rgba(12,12,10,.12)'}`, background: selected && !presetEditMode ? 'rgba(197,255,0,.10)' : presetEditMode ? 'rgba(12,12,10,.04)' : 'transparent', fontFamily: f, fontSize: 11, fontWeight: 700, color: selected && !presetEditMode ? 'rgba(58,96,0,.45)' : '#9A9490', cursor: presetEditMode ? 'grab' : 'pointer', transition: 'all .15s', textDecoration: selected && !presetEditMode ? 'line-through' : 'none' }}>
                                {tag}
                              </button>
                              {presetEditMode && (
                                <button type="button" title="태그 삭제"
                                  onMouseDown={e => e.preventDefault()}
                                  onClick={() => setPresetTags(prev => prev.filter(t => t !== tag))}
                                  style={{ position: 'absolute', right: 5, top: '50%', transform: 'translateY(-50%)', width: 18, height: 18, minWidth: 18, borderRadius: 9999, background: 'rgba(220,50,50,.15)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, color: '#C0392B' }}>
                                  <svg width="7" height="7" viewBox="0 0 7 7" fill="none"><path d="M1 1l5 5M6 1L1 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
                                </button>
                              )}
                            </div>
                          );
                        })}
                        {presetEditMode && (
                          <input
                            type="text"
                            value={presetNewTag}
                            onChange={e => setPresetNewTag(e.target.value)}
                            onMouseDown={e => e.preventDefault()}
                            onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) savePresetTag(); }}
                            placeholder="태그 추가..."
                            style={{ height: 28, padding: '0 10px', borderRadius: 9999, border: '1.5px dashed rgba(12,12,10,.25)', background: 'transparent', fontFamily: f, fontSize: 11, color: '#0C0C0A', outline: 'none', minWidth: 80 }}
                          />
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* 버튼 */}
                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    type="button"
                    onClick={() => { setRefUrl(''); setRefTitle(''); setRefTags([]); setRefTagInput(''); setRefImageFile(null); setRefImagePreview(''); }}
                    style={{ flex: 1, height: 48, background: '#fff', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 12, fontFamily: f, fontSize: 13, fontWeight: 700, color: '#9A9490', cursor: 'pointer' }}
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    onClick={saveReference}
                    disabled={(!refUrl.trim() && !refTitle.trim() && refTags.length === 0 && !refTagInput.trim() && !refImagePreview) || refSaving}
                    style={{ flex: 1, height: 48, background: (refUrl.trim() || refTitle.trim() || refTags.length > 0 || refTagInput.trim() || refImagePreview) ? '#0C0C0A' : '#E5E4E2', border: 'none', borderRadius: 12, fontFamily: f, fontSize: 13, fontWeight: 700, color: (refUrl.trim() || refTitle.trim() || refTags.length > 0 || refTagInput.trim() || refImagePreview) ? '#fff' : '#9A9490', cursor: (refUrl.trim() || refTitle.trim() || refTags.length > 0 || refTagInput.trim() || refImagePreview) ? 'pointer' : 'default', transition: 'all .15s', opacity: refSaving ? 0.6 : 1 }}
                  >
                    {refSaving ? '저장 중...' : '수집'}
                  </button>
                </div>
              </div>

              {/* 정렬 드롭다운 */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '0 26px 10px' }}>
                <select
                  value={refSort}
                  onChange={e => { setRefSort(e.target.value as typeof refSort); setRefVisibleCount(10); }}
                  style={{ height: 32, padding: '0 10px', borderRadius: 8, border: '1.5px solid rgba(12,12,10,.14)', background: '#fff', fontFamily: f, fontSize: 12, fontWeight: 700, color: '#0C0C0A', cursor: 'pointer', outline: 'none', appearance: 'none' as const, WebkitAppearance: 'none' as const, paddingRight: 28, backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%239A9490' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center' }}
                >
                  <option value="date_desc">최신순</option>
                  <option value="name">이름순</option>
                  <option value="tag">태그별</option>
                </select>
              </div>

              {/* 태그 필터 바 */}
              <div style={{ display: 'flex', gap: 6, padding: '0 26px 14px', overflowX: 'auto', scrollbarWidth: 'none' as const }}>
                {(['all', ...Array.from(new Set(references.flatMap(r => r.tags ?? []))).sort()] as string[]).map(tag => {
                  const active = refFilter === tag;
                  const label = tag === 'all' ? `ALL (${references.length})` : tag;
                  // Life TIP 카테고리 태그는 블루 컬러로 구분
                  const isTip = tag !== 'all' && lifetipCategorySet.has(tag);
                  return (
                    <button
                      key={tag}
                      onClick={() => { setRefFilter(tag); setRefVisibleCount(10); }}
                      style={{
                        flexShrink: 0, height: 28, padding: '0 12px', borderRadius: 9999,
                        border: active
                          ? `1.5px solid ${isTip ? 'rgba(96,165,250,.5)' : 'rgba(74,119,0,.5)'}`
                          : '1.5px solid rgba(12,12,10,.14)',
                        background: active
                          ? (isTip ? 'rgba(96,165,250,.18)' : 'rgba(197,255,0,.18)')
                          : 'transparent',
                        fontFamily: f, fontSize: 11, fontWeight: 700,
                        color: active ? (isTip ? '#1D6DDB' : '#3A6000') : '#9A9490',
                        cursor: 'pointer', transition: 'all .15s',
                        whiteSpace: 'nowrap' as const,
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>

              {/* 레퍼런스 목록 */}
              {sortedFiltered.length === 0 ? (
                <div style={{ padding: '48px 26px', textAlign: 'center' }}>
                  <div style={{ fontSize: 32, marginBottom: 12 }}>🔗</div>
                  <div style={{ fontFamily: f, fontSize: 14, fontWeight: 700, color: '#0C0C0A', marginBottom: 6 }}>
                    {refFilter === 'all' ? '아직 수집한 항목이 없어요' : `${refFilter} 항목이 없어요`}
                  </div>
                  <div style={{ fontFamily: f, fontSize: 12, color: '#9A9490' }}>
                    이미지, 링크, 제목 중 하나만 있어도 저장할 수 있어요
                  </div>
                </div>
              ) : (
                <div style={{ padding: '0 26px' }}>
                  {/* 최신순 — 월별 그루핑 */}
                  {refSort === 'date_desc' && (() => {
                    const grouped = visibleRefs.reduce<Record<string, Reference[]>>((acc, ref) => {
                      const month = ref.createdAt ? format(new Date(ref.createdAt), 'yyyy년 M월', { locale: ko }) : '날짜 없음';
                      if (!acc[month]) acc[month] = [];
                      acc[month].push(ref);
                      return acc;
                    }, {});
                    return Object.entries(grouped).map(([month, items]) => (
                      <div key={month} style={{ marginBottom: 24 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                          <span style={{ fontFamily: f, fontSize: 13, fontWeight: 800, color: '#0C0C0A' }}>{month}</span>
                          <span style={{ fontFamily: f, fontSize: 11, fontWeight: 700, color: '#9A9490' }}>{items.length}개</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{items.map(renderRef)}</div>
                      </div>
                    ));
                  })()}
                  {/* 태그별 — 태그 그루핑 */}
                  {refSort === 'tag' && (() => {
                    const gByTag = visibleRefs.reduce<Record<string, Reference[]>>((acc, ref) => {
                      const tag = (ref.tags ?? [])[0] ?? '태그 없음';
                      if (!acc[tag]) acc[tag] = [];
                      acc[tag].push(ref);
                      return acc;
                    }, {});
                    const sortedG = Object.entries(gByTag).sort(([a], [b]) => {
                      if (a === '태그 없음') return 1;
                      if (b === '태그 없음') return -1;
                      return a.localeCompare(b, 'ko');
                    });
                    return sortedG.map(([tag, items]) => {
                      const isTipSection = lifetipCategorySet.has(tag);
                      return (
                        <div key={tag} style={{ marginBottom: 24 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                            <span style={{
                              fontFamily: f, fontSize: 11, fontWeight: 800,
                              color: isTipSection ? '#1D6DDB' : '#4A7700',
                              background: isTipSection ? 'rgba(96,165,250,.18)' : 'rgba(197,255,0,.18)',
                              padding: '3px 10px', borderRadius: 9999, letterSpacing: '.06em',
                            }}>{tag}</span>
                            <span style={{ fontFamily: f, fontSize: 11, fontWeight: 700, color: '#9A9490' }}>{items.length}개</span>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{items.map(renderRef)}</div>
                        </div>
                      );
                    });
                  })()}
                  {/* 이름순 — 플랫 리스트 */}
                  {refSort === 'name' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
                      {visibleRefs.map(renderRef)}
                    </div>
                  )}
                  <MoreButton
                    visible={visibleRefs.length}
                    total={sortedFiltered.length}
                    onMore={() => setRefVisibleCount(n => n + 10)}
                  />
                </div>
              )}
            </div>
          );
        })()}

        {/* ── 아카이브 탭 — 메이크업·룩북 CRUD + Today ON ── */}
        {mainTab === '라이브러리' && (
          <div style={{ paddingTop: 16 }}>
            {/* 필터 바 */}
            <div style={{ display: 'flex', gap: 6, padding: '0 26px', marginBottom: 16, overflowX: 'auto', scrollbarWidth: 'none' as const }}>
              {([
                { key: 'all', label: 'ALL' },
                { key: 'makeup', label: '💄 Makeup' },
                { key: 'lookbook', label: '👗 Lookbook' },
                { key: 'lifetip', label: '📌 Life TIP' },
              ] as const).map(tab => (
                <button key={tab.key} onClick={() => { setArchiveFilter(tab.key); setLifetipCategory(null); }}
                  style={{ flexShrink: 0, height: 30, padding: '0 14px', borderRadius: 9999,
                    border: `1.5px solid ${archiveFilter === tab.key ? (tab.key === 'lifetip' ? '#60A5FA' : '#0C0C0A') : 'rgba(12,12,10,.14)'}`,
                    background: archiveFilter === tab.key ? (tab.key === 'lifetip' ? 'rgba(96,165,250,.14)' : '#0C0C0A') : 'transparent',
                    fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 12, fontWeight: 700,
                    color: archiveFilter === tab.key ? (tab.key === 'lifetip' ? '#1D6DDB' : '#fff') : '#9A9490',
                    cursor: 'pointer', transition: 'all .15s', whiteSpace: 'nowrap' as const }}>
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Life TIP 탭 콘텐츠 */}
            {archiveFilter === 'lifetip' && (() => {
              const f = "'Plus Jakarta Sans','Space Grotesk',sans-serif";
              const lifetipByCategory2: Record<string, typeof lifetipItems[0][]> = {};
              for (const item of lifetipItems) {
                const cat = item.tipCategory || '기타';
                if (!lifetipByCategory2[cat]) lifetipByCategory2[cat] = [];
                lifetipByCategory2[cat].push(item);
              }
              const lifetipCategories2 = Object.keys(lifetipByCategory2).sort(
                (a, b) => lifetipByCategory2[b].length - lifetipByCategory2[a].length
              );
              return (
                <div style={{ padding: '0 26px 20px' }}>
                  {lifetipItems.length === 0 ? (
                    <div style={{ padding: '40px 20px', textAlign: 'center', background: '#fff', borderRadius: 16, border: '1px solid rgba(12,12,10,.08)' }}>
                      <div style={{ fontSize: 32, marginBottom: 8 }}>📌</div>
                      <div style={{ fontFamily: f, fontSize: 13, fontWeight: 700, color: '#0C0C0A', marginBottom: 4 }}>Life TIP이 없어요</div>
                      <div style={{ fontFamily: f, fontSize: 12, color: '#9A9490' }}>수집에서 + 라이브러리 버튼으로 추가하세요</div>
                    </div>
                  ) : lifetipCategory === null ? (
                    /* 카테고리 그리드 홈 */
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      {lifetipCategories2.map(cat => {
                        const items = lifetipByCategory2[cat];
                        const emoji = items[0]?.emoji || getLifetipEmoji(cat);
                        return (
                          <button key={cat} type="button" onClick={() => setLifetipCategory(cat)}
                            style={{ background: '#fff', border: '1px solid rgba(12,12,10,.1)', borderRadius: 16, padding: '18px 16px', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8, cursor: 'pointer', textAlign: 'left', transition: 'all .15s' }}>
                            <span style={{ fontSize: 28, lineHeight: 1 }}>{emoji}</span>
                            <div>
                              <div style={{ fontFamily: f, fontSize: 13, fontWeight: 800, color: '#0C0C0A', marginBottom: 2 }}>{cat}</div>
                              <div style={{ fontFamily: f, fontSize: 11, color: '#9A9490' }}>{items.length}개</div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    /* 카테고리 상세 */
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                        <button type="button" title="뒤로" onClick={() => setLifetipCategory(null)}
                          style={{ width: 32, height: 32, borderRadius: 9999, background: 'rgba(12,12,10,.06)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                            <path d="M10 3L5 8l5 5" stroke="#0C0C0A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </button>
                        <span style={{ fontFamily: f, fontSize: 18, lineHeight: 1 }}>{lifetipByCategory2[lifetipCategory]?.[0]?.emoji || getLifetipEmoji(lifetipCategory)}</span>
                        <span style={{ fontFamily: f, fontSize: 16, fontWeight: 800, color: '#0C0C0A' }}>{lifetipCategory}</span>
                        <span style={{ fontFamily: f, fontSize: 12, color: '#9A9490', marginLeft: 'auto' }}>{lifetipByCategory2[lifetipCategory]?.length ?? 0}개</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {(lifetipByCategory2[lifetipCategory] ?? []).map(item => (
                          <div key={item.id} style={{ background: '#fff', borderRadius: 14, border: '1px solid rgba(12,12,10,.08)', overflow: 'hidden' }}>
                            <div style={{ display: 'flex', alignItems: 'stretch' }}>
                              <button type="button" onClick={() => setEditingLifetipId(editingLifetipId === item.id ? null : item.id)}
                                style={{ width: 64, flexShrink: 0, background: '#F5F4F0', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26 }}>
                                {item.emoji || getLifetipEmoji(item.tipCategory)}
                              </button>
                              <div style={{ flex: 1, padding: '12px 14px', minWidth: 0 }}>
                                <div style={{ fontFamily: f, fontSize: 13, fontWeight: 700, color: '#0C0C0A', marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                                  {item.name}
                                </div>
                                <div style={{ fontFamily: f, fontSize: 11, color: '#BCBAB6' }}>{item.createdAt?.slice(0, 10)}</div>
                              </div>
                              {item.sourceUrl && (
                                <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer"
                                  style={{ width: 44, flexShrink: 0, background: '#F5F4F0', display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none', borderLeft: '1px solid rgba(12,12,10,.06)' }}>
                                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                                    <path d="M7 3H3a1 1 0 00-1 1v9a1 1 0 001 1h9a1 1 0 001-1V9" stroke="#9A9490" strokeWidth="1.5" strokeLinecap="round"/>
                                    <path d="M10 2h4v4M14 2L8 8" stroke="#9A9490" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                  </svg>
                                </a>
                              )}
                            </div>
                            {editingLifetipId === item.id && (
                              <div style={{ padding: '10px 14px', borderTop: '1px solid rgba(12,12,10,.06)', background: '#FAFAF8', display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ fontFamily: f, fontSize: 11, fontWeight: 700, color: '#9A9490', flexShrink: 0 }}>이모지</span>
                                <input type="text" defaultValue={item.emoji} autoFocus
                                  onBlur={async e => {
                                    const newEmoji = e.target.value.trim();
                                    if (newEmoji && newEmoji !== item.emoji && db && userId) {
                                      await updateDoc(doc(db, 'users', userId, 'lifetipItems', item.id), { emoji: newEmoji, updatedAt: new Date().toISOString() });
                                    }
                                    setEditingLifetipId(null);
                                  }}
                                  onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                                  style={{ flex: 1, height: 36, padding: '0 10px', border: '1.5px solid rgba(12,12,10,.2)', borderRadius: 8, background: '#fff', fontSize: 20, outline: 'none' }}
                                />
                                <button type="button" onClick={() => setEditingLifetipId(null)}
                                  style={{ height: 36, padding: '0 12px', borderRadius: 8, border: '1px solid rgba(12,12,10,.12)', background: 'transparent', fontFamily: f, fontSize: 11, fontWeight: 700, color: '#9A9490', cursor: 'pointer' }}>
                                  취소
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* 아이템 카드 목록 (메이크업 / 룩북) */}
            {archiveFilter !== 'lifetip' && (() => {
              const visibleItems = [
                ...(archiveFilter !== 'lookbook' ? makeupItems : []),
                ...(archiveFilter !== 'makeup' ? lookItems : []),
              ];
              const f = "'Plus Jakarta Sans','Space Grotesk',sans-serif";
              const todayStr = format(new Date(), 'yyyy-MM-dd');
              const sortedItems = [...visibleItems].sort((a, b) => {
                const aOn = a.published && (a.dates ?? []).includes(todayStr) ? 1 : 0;
                const bOn = b.published && (b.dates ?? []).includes(todayStr) ? 1 : 0;
                return bOn - aOn;
              });
              if (sortedItems.length === 0) return (
                <div style={{ padding: '40px 26px', textAlign: 'center', background: '#fff', border: '1px solid #000000', borderRadius: 16, margin: '0 26px' }}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>📁</div>
                  <div style={{ fontFamily: f, fontSize: 13, fontWeight: 700, color: '#0C0C0A', marginBottom: 4 }}>아카이브가 비어있어요</div>
                  <div style={{ fontFamily: f, fontSize: 12, color: '#9A9490' }}>+ 버튼으로 새 룩·메이크업을 추가해보세요</div>
                </div>
              );
              return (
                <div style={{ marginTop: 8 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '0 26px 20px' }}>
                    {sortedItems.map(item => {
                      const isMakeup = item.ctType === 'makeup';
                      const badge = isMakeup ? '#MAKEUP' : '#LOOKBOOK';
                      const isOnToday = item.published && (item.dates ?? []).includes(todayStr);
                      const prodItems = item.items.filter((i): i is { type: 'product'; id: string } => i.type === 'product');
                      return (
                        <div key={item.id} id={`lib-item-${item.id}`} style={{ border: '1px solid #000000', background: '#FFFFFF' }}>
                          {/* 이미지 + 텍스트 영역 */}
                          <div style={{ boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', padding: '20px 26px 0px', position: 'relative', width: '100%', isolation: 'isolate', flexShrink: 0 }}>
                            <div style={{ position: 'absolute', right: 7, top: 42, width: 113, height: 32, background: '#C6F432', border: '1px solid #18181B', transform: 'rotate(-3deg)', display: 'flex', alignItems: 'center', padding: '0 12px', zIndex: 3 }}>
                              <span style={{ fontFamily: f, fontSize: 14, fontWeight: 700, color: '#525252', transform: 'rotate(-3deg)' }}>{badge}</span>
                            </div>
                            {/* overflow: visible — 스탬프가 이미지 아래로 삐져나오게 */}
                            <div style={{ width: '100%', overflow: 'visible', flexShrink: 0, zIndex: 0, position: 'relative' }}>
                              {item.imageUrl
                                ? // eslint-disable-next-line @next/next/no-img-element
                                  <img src={item.imageUrl} alt={item.name} style={{ width: '100%', height: 'auto', display: 'block' }} />
                                : <div style={{ aspectRatio: '4/3', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <span style={{ fontSize: 220, opacity: 0.5, lineHeight: 1 }}>{item.emoji || (isMakeup ? '💄' : '👗')}</span>
                                  </div>
                              }
                              {isOnToday && (
                                <div style={{ position: 'absolute', bottom: -45, right: -20, transform: 'rotate(-9deg)', zIndex: 4, width: 88, height: 88, borderRadius: '50%', border: '3px solid rgba(190,30,30,.75)', background: 'rgba(255,255,255,.7)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', mixBlendMode: 'multiply' as const, flexShrink: 0 }}>
                                  <div style={{ position: 'absolute', inset: 5, borderRadius: '50%', border: '1px solid rgba(190,30,30,.3)', pointerEvents: 'none' }} />
                                  <img src="/logo.png" alt="today" style={{ width: 34, height: 34, objectFit: 'contain', filter: 'sepia(1) saturate(8) hue-rotate(-20deg) contrast(1.2)', opacity: .8, marginBottom: 1, position: 'relative', zIndex: 1 }} />
                                  <div style={{ fontFamily: f, fontSize: 8, fontWeight: 900, letterSpacing: '.32em', color: 'rgba(190,30,30,.85)', textTransform: 'uppercase' as const, marginTop: -2, position: 'relative', zIndex: 1 }}>TODAY</div>
                                </div>
                              )}
                            </div>
                            <div style={{ fontFamily: f, fontSize: 20, fontWeight: 600, color: '#000', lineHeight: '18px', marginTop: 12, width: '100%', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const, zIndex: 1 }}>{item.name}</div>
                            <div style={{ fontFamily: f, fontSize: 16, fontWeight: 400, color: '#000', lineHeight: '18px', marginTop: 6, marginBottom: 12, width: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, zIndex: 2 }}>{item.tpo?.join(' · ') || (isMakeup ? 'makeup' : 'lookbook')}</div>
                            {item.sourceUrl?.trim() && (() => {
                              let domain = item.sourceUrl!;
                              try { domain = new URL(item.sourceUrl!).hostname; } catch {}
                              return (
                                <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer"
                                  style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 20, padding: '8px 12px', border: '1px solid rgba(12,12,10,.15)', borderRadius: 8, textDecoration: 'none', fontFamily: f, fontSize: 11, fontWeight: 700, color: '#4A4846', letterSpacing: '.04em', background: 'rgba(0,0,0,.03)', width: '100%', boxSizing: 'border-box' as const }}
                                >
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ flexShrink: 0 }}>
                                    <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/>
                                    <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>
                                  </svg>
                                  SOURCE
                                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 400, color: '#9A9490' }}>{domain}</span>
                                </a>
                              );
                            })()}
                            {!item.sourceUrl?.trim() && <div style={{ height: 20 }} />}
                          </div>
                          {/* 현황 — 제품 스크롤 (있을 때만, borderTop 구분선) */}
                          {prodItems.length > 0 && (
                            <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '12px 8px 8px', width: '100%', scrollbarWidth: 'none' as const, borderTop: '1px solid #000000', boxSizing: 'border-box' as const }}>
                              {prodItems.map((it, idx) => {
                                const p = products.get(it.id);
                                const imgSrc = p?.imageUrl || p?.storageUrl;
                                return (
                                  <div key={idx} style={{ flexShrink: 0, width: 120, display: 'flex', flexDirection: 'column', gap: 5 }}>
                                    <div style={{ width: 120, height: 160, borderRadius: 0, background: '#F3F3F4', border: '1px solid #000000', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                      {imgSrc ? <img src={imgSrc} alt={p?.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <span style={{ fontSize: 24, opacity: 0.2 }}>🧴</span>}
                                    </div>
                                    <span style={{ fontFamily: f, fontSize: 11, fontWeight: 600, color: '#525252', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{p?.name ?? ''}</span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          {/* 버튼 영역 — borderTop 구분선 */}
                          <div style={{ display: 'flex', borderTop: '1px solid #000000' }}>
                            <button onClick={() => handleToggleToday(item)} disabled={!!togglingId} style={{ flex: 1, padding: '12px 0', background: isOnToday ? '#0C0C0A' : '#F3F3F1', color: isOnToday ? '#C5FF00' : '#0C0C0A', border: 'none', borderRight: '1px solid #000000', borderRadius: 0, fontFamily: f, fontSize: 12, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase' as const, cursor: togglingId ? 'default' : 'pointer', opacity: togglingId === item.id ? 0.6 : 1, transition: 'all .15s' }}>
                              {togglingId === item.id ? '...' : isOnToday ? 'Today ON' : 'Today OFF'}
                            </button>
                            <button onClick={() => triggerCollectionEdit(item)} style={{ flex: 1, padding: '12px 0', background: '#F3F3F1', color: '#0C0C0A', border: 'none', borderRadius: 0, fontFamily: f, fontSize: 12, fontWeight: 700, letterSpacing: '.06em', cursor: 'pointer', textTransform: 'uppercase' as const }}>편집</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>
        )}

      </div>

      {/* LogCtPanel — 탭에 무관하게 항상 마운트 (hiddenMode: 편집 시트만 사용) */}
      <LogCtPanel key="makeup" filter="makeup" items={makeupItems} products={Array.from(products.values())} userId={userId}
        onAdd={(data) => handleCtAdd('makeup', data)} onUpdate={(id, data) => handleCtUpdate('makeup', id, data)} onDelete={(id) => handleCtDelete('makeup', id)}
        hideAddButton addTrigger={makeupAddTrigger} editTrigger={makeupEditTrigger} hiddenMode
      />
      <LogCtPanel key="lookbook" filter="lookbook" items={lookItems} products={Array.from(products.values())} userId={userId}
        onAdd={(data) => handleCtAdd('lookbook', data)} onUpdate={(id, data) => handleCtUpdate('lookbook', id, data)} onDelete={(id) => handleCtDelete('lookbook', id)}
        hideAddButton addTrigger={lookbookAddTrigger} editTrigger={lookbookEditTrigger} hiddenMode
      />

      {/* FAB — 라이브러리 탭에서만 노출 */}
      {mainTab === '라이브러리' && (
        <>
          {/* 타입 선택 팝업 배경 */}
          {fabMenuOpen && (
            <div onClick={() => setFabMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 38 }} />
          )}

          {/* 타입 선택 메뉴 — FAB 위에 떠오름 */}
          {fabMenuOpen && (
            <div style={{ position: 'fixed', bottom: 156, right: 'max(18px, calc(50vw - 215px + 18px))', zIndex: 39, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
              <button
                onClick={() => { setLookbookAddTrigger(n => n + 1); setFabMenuOpen(false); }}
                style={{ display: 'flex', alignItems: 'center', gap: 10, height: 44, padding: '0 26px 0 14px', background: '#0C0C0A', color: '#fff', border: 'none', borderRadius: 9999, fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 13, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 16px rgba(0,0,0,.18)', whiteSpace: 'nowrap' as const }}
              >
                <span style={{ fontSize: 18 }}>👗</span> 룩북 등록
              </button>
              <button
                onClick={() => { setMakeupAddTrigger(n => n + 1); setFabMenuOpen(false); }}
                style={{ display: 'flex', alignItems: 'center', gap: 10, height: 44, padding: '0 26px 0 14px', background: '#0C0C0A', color: '#fff', border: 'none', borderRadius: 9999, fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 13, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 16px rgba(0,0,0,.18)', whiteSpace: 'nowrap' as const }}
              >
                <span style={{ fontSize: 18 }}>💄</span> 메이크업 등록
              </button>
            </div>
          )}

          {/* FAB 본체 */}
          <button
            onClick={() => setFabMenuOpen(o => !o)}
            style={{
              position: 'fixed', bottom: 'calc(env(safe-area-inset-bottom, 0px) + 76px)', right: 'max(18px, calc(50vw - 215px + 18px))', zIndex: 40,
              width: 52, height: 52, borderRadius: 9999,
              background: '#C5FF00', color: '#0C0C0A',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: 'none', cursor: 'pointer',
              boxShadow: '0 4px 20px rgba(197,255,0,.4)',
              fontSize: 22, fontWeight: 700,
              transform: fabMenuOpen ? 'rotate(45deg)' : 'rotate(0deg)',
              transition: 'transform .2s',
            }}
            aria-label="등록"
          >
            ＋
          </button>
        </>
      )}

      {/* ── 수집 → 라이브러리 등록 시트 ── */}
      {refToLib && (() => {
        const f = "'Plus Jakarta Sans','Space Grotesk',sans-serif";
        const refTags = refToLib.tags ?? [];
        return (
          <>
            <div onClick={() => setRefToLib(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 200 }} />
            <div style={{ position: 'fixed', bottom: 0, left: 'max(0px,calc(50vw - 215px))', right: 'max(0px,calc(50vw - 215px))', zIndex: 201, background: '#FAFAF8', borderRadius: '20px 20px 0 0', maxHeight: '85vh', overflowY: 'auto', padding: '12px 20px calc(env(safe-area-inset-bottom,0px) + 24px)', scrollbarWidth: 'none' as const }}>
              <div style={{ width: 36, height: 4, borderRadius: 9999, background: 'rgba(12,12,10,.12)', margin: '0 auto 16px' }} />
              <div style={{ fontFamily: f, fontSize: 16, fontWeight: 800, color: '#0C0C0A', marginBottom: 4 }}>라이브러리에 등록</div>
              <div style={{ fontFamily: f, fontSize: 12, color: '#9A9490', marginBottom: 16 }}>{refToLib.title || refToLib.url}</div>

              {/* 썸네일 */}
              {refToLib.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={refToLib.imageUrl} alt="" style={{ width: '100%', maxHeight: 120, objectFit: 'cover', borderRadius: 10, marginBottom: 16 }} />
              )}

              {/* 타입 선택 */}
              <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.1em', color: '#9A9490', marginBottom: 8 }}>카테고리</div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                {([
                  { key: 'makeup',  label: '💄 메이크업' },
                  { key: 'lookbook', label: '👗 룩북' },
                  { key: 'lifetip', label: '📌 Life TIP' },
                ] as const).map(t => (
                  <button key={t.key}
                    onClick={() => {
                      setRefToLibType(t.key);
                      if (t.key === 'lifetip') {
                        const firstTag = refTags[0] ?? '';
                        setRefToLibTipCategory(firstTag);
                        setRefToLibEmoji(getLifetipEmoji(firstTag));
                      }
                    }}
                    style={{ flex: 1, height: 44, borderRadius: 10, border: `1.5px solid ${refToLibType === t.key ? '#0C0C0A' : 'rgba(12,12,10,.14)'}`, background: refToLibType === t.key ? '#0C0C0A' : 'transparent', fontFamily: f, fontSize: 12, fontWeight: 700, color: refToLibType === t.key ? '#C5FF00' : '#9A9490', cursor: 'pointer', transition: 'all .15s' }}>
                    {t.label}
                  </button>
                ))}
              </div>

              {/* Life TIP 전용 — 카테고리 + 이모지 */}
              {refToLibType === 'lifetip' && (
                <div style={{ background: 'rgba(12,12,10,.03)', border: '1px solid rgba(12,12,10,.08)', borderRadius: 12, padding: '14px 14px 10px', marginBottom: 16 }}>

                  {/* 수집 태그로 빠른 선택 */}
                  {refTags.length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontFamily: f, fontSize: 10, fontWeight: 700, color: '#BCBAB6', letterSpacing: '.06em', textTransform: 'uppercase' as const, marginBottom: 6 }}>수집 태그로 선택</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const }}>
                        {refTags.map(tag => (
                          <button key={tag} type="button"
                            onClick={() => { setRefToLibTipCategory(tag); setRefToLibEmoji(getLifetipEmoji(tag)); }}
                            style={{ height: 30, padding: '0 12px', borderRadius: 9999, border: `1.5px solid ${refToLibTipCategory === tag ? '#0C0C0A' : 'rgba(12,12,10,.14)'}`, background: refToLibTipCategory === tag ? '#0C0C0A' : 'transparent', fontFamily: f, fontSize: 11, fontWeight: 700, color: refToLibTipCategory === tag ? '#C5FF00' : '#9A9490', cursor: 'pointer', transition: 'all .15s' }}>
                            {tag}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 카테고리 직접 입력 */}
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontFamily: f, fontSize: 10, fontWeight: 700, color: '#BCBAB6', letterSpacing: '.06em', textTransform: 'uppercase' as const, marginBottom: 6 }}>카테고리</div>
                    <input type="text" value={refToLibTipCategory}
                      onChange={e => { setRefToLibTipCategory(e.target.value); if (!refToLibEmoji) setRefToLibEmoji(getLifetipEmoji(e.target.value.trim())); }}
                      placeholder="예: 주식, 생활, 푸드..."
                      style={{ width: '100%', boxSizing: 'border-box' as const, height: 40, padding: '0 12px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 10, background: '#fff', fontFamily: f, fontSize: 13, color: '#0C0C0A', outline: 'none' }}
                    />
                  </div>

                  {/* 이모지 — 모바일 키보드로 직접 입력 가능 */}
                  <div>
                    <div style={{ fontFamily: f, fontSize: 10, fontWeight: 700, color: '#BCBAB6', letterSpacing: '.06em', textTransform: 'uppercase' as const, marginBottom: 6 }}>이모지</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 40, height: 40, borderRadius: 10, background: '#fff', border: '1.5px solid rgba(12,12,10,.14)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>
                        {refToLibEmoji || getLifetipEmoji(refToLibTipCategory)}
                      </div>
                      <input type="text" value={refToLibEmoji}
                        onChange={e => setRefToLibEmoji(e.target.value)}
                        placeholder="이모지 입력"
                        style={{ flex: 1, height: 40, padding: '0 12px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 10, background: '#fff', fontFamily: f, fontSize: 20, color: '#0C0C0A', outline: 'none' }}
                      />
                      <button type="button" onClick={() => setRefToLibEmoji(getLifetipEmoji(refToLibTipCategory))}
                        style={{ height: 40, padding: '0 12px', borderRadius: 10, border: '1.5px solid rgba(12,12,10,.12)', background: 'transparent', fontFamily: f, fontSize: 11, fontWeight: 700, color: '#9A9490', cursor: 'pointer', whiteSpace: 'nowrap' as const }}>
                        초기화
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* 버튼 */}
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => setRefToLib(null)} style={{ flex: 1, height: 48, background: '#fff', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 12, fontFamily: f, fontSize: 13, fontWeight: 700, color: '#9A9490', cursor: 'pointer' }}>취소</button>
                <button onClick={saveRefToLibrary} disabled={refToLibSaving || (refToLibType === 'lifetip' && !refToLibTipCategory.trim())}
                  style={{ flex: 2, height: 48, background: '#0C0C0A', border: 'none', borderRadius: 12, fontFamily: f, fontSize: 13, fontWeight: 700, color: '#fff', cursor: 'pointer', opacity: (refToLibSaving || (refToLibType === 'lifetip' && !refToLibTipCategory.trim())) ? 0.4 : 1 }}>
                  {refToLibSaving ? '등록 중...' : '라이브러리 등록'}
                </button>
              </div>
            </div>
          </>
        );
      })()}

      {/* ── 수집 편집 시트 ── */}
      {editingRef && (() => {
        const f = "'Plus Jakarta Sans','Space Grotesk',sans-serif";
        return (
          <>
            {/* 딤 오버레이 */}
            <div onClick={() => setEditingRef(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 200 }} />
            {/* 시트 */}
            <div style={{ position: 'fixed', bottom: 0, left: 'max(0px,calc(50vw - 215px))', right: 'max(0px,calc(50vw - 215px))', zIndex: 201, background: '#FAFAF8', borderRadius: '20px 20px 0 0', maxHeight: '90vh', overflowY: 'auto', padding: '10px 20px calc(env(safe-area-inset-bottom,0px) + 24px)', scrollbarWidth: 'none' as const }}>

              {/* 핸들 */}
              <div style={{ width: 36, height: 4, borderRadius: 9999, background: 'rgba(12,12,10,.12)', margin: '0 auto 16px' }} />

              {/* 헤더 */}
              <div style={{ fontFamily: f, fontSize: 16, fontWeight: 800, color: '#0C0C0A', marginBottom: 20 }}>수집 편집</div>

              {/* 제목 — 등록 폼과 동일한 순서: 제목 → 링크 → 이미지 → 태그 */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase' as const, color: '#9A9490', marginBottom: 8 }}>제목</div>
                <input
                  type="text"
                  value={refEditTitle}
                  onChange={e => setRefEditTitle(e.target.value)}
                  placeholder="제목 입력"
                  style={{ width: '100%', boxSizing: 'border-box' as const, height: 44, padding: '0 14px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 10, background: '#fff', fontFamily: f, fontSize: 13, color: '#0C0C0A', outline: 'none' }}
                />
              </div>

              {/* 링크 */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase' as const, color: '#9A9490', marginBottom: 8 }}>링크</div>
                <input
                  type="url"
                  value={refEditUrl}
                  onChange={e => setRefEditUrl(e.target.value)}
                  placeholder="링크 입력 (선택)"
                  style={{ width: '100%', boxSizing: 'border-box' as const, height: 44, padding: '0 14px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 10, background: '#fff', fontFamily: f, fontSize: 13, color: '#0C0C0A', outline: 'none' }}
                />
              </div>

              {/* 이미지 */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase' as const, color: '#9A9490', marginBottom: 8 }}>이미지</div>
                <ImagePicker
                  preview={refEditImagePreview}
                  onChange={(file, base64) => { setRefEditImageFile(file); setRefEditImagePreview(base64); }}
                  onClear={() => { setRefEditImageFile(null); setRefEditImagePreview(''); }}
                  height={180}
                  placeholderLabel="이미지 추가 (선택)"
                  isOpen={!!editingRef}
                />
              </div>

              {/* 태그 */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase' as const, color: '#9A9490', marginBottom: 8 }}>태그</div>

                {/* 선택된 태그 칩 + 직접 입력창 */}
                <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 6, padding: '8px 10px', minHeight: 44, border: `1.5px solid ${refEditTagFocused ? 'rgba(12,12,10,.32)' : 'rgba(12,12,10,.14)'}`, borderRadius: 10, background: '#fff', alignItems: 'center', marginBottom: 0, transition: 'border-color .15s' }}>
                  {refEditTags.map(tag => (
                    <div key={tag} style={{ display: 'flex', alignItems: 'center', gap: 4, height: 30, padding: '0 6px 0 10px', borderRadius: 9999, background: 'rgba(197,255,0,.18)', border: '1.5px solid #4A7700', flexShrink: 0, maxWidth: 200 }}>
                      <span style={{ fontFamily: f, fontSize: 12, fontWeight: 700, color: '#3A6000', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, maxWidth: 130 }}>{tag}</span>
                      <button type="button" title="태그 삭제"
                        onClick={() => setRefEditTags(prev => prev.filter(t => t !== tag))}
                        style={{ width: 22, height: 22, minWidth: 22, borderRadius: 9999, background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, flexShrink: 0, color: 'rgba(58,96,0,.65)' }}>
                        <svg width="9" height="9" viewBox="0 0 9 9" fill="none"><path d="M1.5 1.5l6 6M7.5 1.5l-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
                      </button>
                    </div>
                  ))}
                  <input
                    type="text"
                    value={refEditTagInput}
                    onChange={e => setRefEditTagInput(e.target.value)}
                    onFocus={() => setRefEditTagFocused(true)}
                    onBlur={() => { setTimeout(() => setRefEditTagFocused(false), 200); }}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.nativeEvent.isComposing && refEditTagInput.trim()) {
                        e.preventDefault();
                        const t = refEditTagInput.trim();
                        if (!refEditTags.includes(t)) setRefEditTags(prev => [...prev, t]);
                        setRefEditTagInput('');
                      }
                    }}
                    placeholder={refEditTags.length === 0 ? '태그 입력 후 Enter' : '태그 추가...'}
                    style={{ flex: 1, minWidth: 80, border: 'none', outline: 'none', background: 'transparent', fontFamily: f, fontSize: 12, color: '#0C0C0A' }}
                  />
                </div>

                {/* 빠른 선택 — 입력창 포커스 시에만 노출 (등록 폼과 동일) */}
                {(refEditTagFocused || presetEditMode) && (
                  <div style={{ marginTop: 8, padding: '10px 12px', borderRadius: 10, background: 'rgba(12,12,10,.03)', border: '1px solid rgba(12,12,10,.08)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={{ fontFamily: f, fontSize: 10, fontWeight: 700, color: '#BCBAB6', letterSpacing: '.06em', textTransform: 'uppercase' as const }}>빠른 선택</span>
                      <button type="button"
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => { setPresetEditMode(v => !v); setPresetNewTag(''); }}
                        style={{ height: 24, padding: '0 10px', borderRadius: 9999, border: 'none', background: presetEditMode ? 'rgba(12,12,10,.08)' : '#0C0C0A', fontFamily: f, fontSize: 10, fontWeight: 800, color: presetEditMode ? '#9A9490' : '#C5FF00', cursor: 'pointer', letterSpacing: '.04em', flexShrink: 0 }}>
                        {presetEditMode ? '완료' : '태그 편집'}
                      </button>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const, alignItems: 'center' }}>
                      {presetTags.map((tag, pIdx) => {
                        const selected = refEditTags.includes(tag);
                        return (
                          <div key={tag}
                            draggable={presetEditMode}
                            onDragStart={e => { if (!presetEditMode) return; e.dataTransfer.effectAllowed = 'move'; setDragPresetIdx(pIdx); }}
                            onDragOver={e => { if (!presetEditMode) return; e.preventDefault(); setDragPresetOverIdx(pIdx); }}
                            onDrop={e => {
                              if (!presetEditMode) return;
                              e.preventDefault();
                              if (dragPresetIdx === null || dragPresetIdx === pIdx) { setDragPresetIdx(null); setDragPresetOverIdx(null); return; }
                              setPresetTags(prev => {
                                const next = [...prev];
                                const [moved] = next.splice(dragPresetIdx, 1);
                                next.splice(pIdx, 0, moved);
                                return next;
                              });
                              setDragPresetIdx(null); setDragPresetOverIdx(null);
                            }}
                            onDragEnd={() => { setDragPresetIdx(null); setDragPresetOverIdx(null); }}
                            style={{ position: 'relative', display: 'inline-flex', outline: presetEditMode && dragPresetOverIdx === pIdx ? '2px dashed #C5FF00' : 'none', borderRadius: 9999, opacity: presetEditMode && dragPresetIdx === pIdx ? 0.4 : 1 }}
                          >
                            <button type="button"
                              onMouseDown={e => e.preventDefault()}
                              onClick={() => { if (!presetEditMode) setRefEditTags(prev => selected ? prev.filter(t => t !== tag) : [...prev, tag]); }}
                              style={{ height: 28, padding: presetEditMode ? '0 28px 0 12px' : '0 12px', borderRadius: 9999, border: `1.5px solid ${selected && !presetEditMode ? 'rgba(74,119,0,.3)' : 'rgba(12,12,10,.12)'}`, background: selected && !presetEditMode ? 'rgba(197,255,0,.10)' : presetEditMode ? 'rgba(12,12,10,.04)' : 'transparent', fontFamily: f, fontSize: 11, fontWeight: 700, color: selected && !presetEditMode ? 'rgba(58,96,0,.45)' : '#9A9490', cursor: presetEditMode ? 'grab' : 'pointer', transition: 'all .15s', textDecoration: selected && !presetEditMode ? 'line-through' : 'none' }}>
                              {tag}
                            </button>
                            {presetEditMode && (
                              <button type="button" title="태그 삭제"
                                onMouseDown={e => e.preventDefault()}
                                onClick={() => setPresetTags(prev => prev.filter(t => t !== tag))}
                                style={{ position: 'absolute', right: 5, top: '50%', transform: 'translateY(-50%)', width: 18, height: 18, minWidth: 18, borderRadius: 9999, background: 'rgba(220,50,50,.15)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, color: '#C0392B' }}>
                                <svg width="7" height="7" viewBox="0 0 7 7" fill="none"><path d="M1 1l5 5M6 1L1 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
                              </button>
                            )}
                          </div>
                        );
                      })}
                      {presetEditMode && (
                        <input type="text" value={presetNewTag}
                          onChange={e => setPresetNewTag(e.target.value)}
                          onMouseDown={e => e.preventDefault()}
                          onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) savePresetTag(); }}
                          placeholder="태그 추가..."
                          style={{ height: 28, padding: '0 10px', borderRadius: 9999, border: '1.5px dashed rgba(12,12,10,.25)', background: 'transparent', fontFamily: f, fontSize: 11, color: '#0C0C0A', outline: 'none', minWidth: 80 }}
                        />
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* 버튼 */}
              <div style={{ display: 'flex', gap: 10 }}>
                <button type="button" onClick={() => setEditingRef(null)} style={{ flex: 1, height: 48, background: '#fff', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 12, fontFamily: f, fontSize: 13, fontWeight: 700, color: '#9A9490', cursor: 'pointer' }}>
                  취소
                </button>
                <button type="button" onClick={saveRefEdit} disabled={refEditSaving} style={{ flex: 1, height: 48, background: '#0C0C0A', border: 'none', borderRadius: 12, fontFamily: f, fontSize: 13, fontWeight: 700, color: '#fff', cursor: 'pointer', opacity: refEditSaving ? .6 : 1 }}>
                  {refEditSaving ? '저장 중...' : '저장'}
                </button>
              </div>
            </div>
          </>
        );
      })()}

      {/* ── OOTD 편집 시트 ── */}
      {editingOotd && (() => {
        const f = "'Plus Jakarta Sans','Space Grotesk','sans-serif'";
        const THEMES = ['캐주얼', '오피스룩', '스트릿', '미니멀', '빈티지', '스포티', '포멀', '로맨틱'];
        const displayImg = ootdEditPreview;
        return (
          <>
            <div onClick={() => setEditingOotd(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 200 }} />
            <div style={{ position: 'fixed', bottom: 0, left: 'max(0px,calc(50vw - 215px))', right: 'max(0px,calc(50vw - 215px))', zIndex: 201, background: '#FAFAF8', borderRadius: '20px 20px 0 0', maxHeight: '90vh', overflowY: 'auto', padding: '10px 20px calc(env(safe-area-inset-bottom,0px) + 24px)' }}>
              <div style={{ width: 32, height: 3, background: 'rgba(12,12,10,.14)', borderRadius: 2, margin: '0 auto 18px' }} />
              <div style={{ fontFamily: f, fontSize: 13, fontWeight: 700, color: '#9A9490', marginBottom: 4 }}>{editingOotd.date}</div>
              <div style={{ fontFamily: f, fontSize: 20, fontWeight: 800, color: '#0C0C0A', marginBottom: 16 }}>오늘의 룩 편집</div>

              {/* 사진 */}
              <input ref={ootdFileRef} type="file" accept="image/*" style={{ display: 'none' }}
                onChange={async e => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setOotdEditPhotoFile(file);
                  setOotdEditPreview(URL.createObjectURL(file));
                }} />
              <div onClick={() => ootdFileRef.current?.click()}
                style={{ width: '100%', height: 220, borderRadius: 12, overflow: 'hidden', background: '#F4F4F0', cursor: 'pointer', position: 'relative', marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {displayImg
                  ? <img src={displayImg} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                  : <span style={{ fontFamily: f, fontSize: 13, color: '#9A9490' }}>📷 사진 추가</span>}
                {displayImg && <div style={{ position: 'absolute', bottom: 8, right: 8, background: 'rgba(0,0,0,.5)', color: '#fff', borderRadius: 6, padding: '4px 8px', fontFamily: f, fontSize: 11, fontWeight: 700 }}>사진 변경</div>}
              </div>

              {/* 테마 */}
              <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, color: '#9A9490', letterSpacing: '.08em', marginBottom: 8 }}>테마</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const, marginBottom: 14 }}>
                {THEMES.map(t => (
                  <button key={t} type="button" onClick={() => setOotdEditTheme(ootdEditTheme === t ? '' : t)}
                    style={{ padding: '6px 14px', borderRadius: 9999, border: `1.5px solid ${ootdEditTheme === t ? '#0C0C0A' : 'rgba(12,12,10,.14)'}`, background: ootdEditTheme === t ? '#0C0C0A' : '#fff', fontFamily: f, fontSize: 12, fontWeight: 700, color: ootdEditTheme === t ? '#C5FF00' : '#4A4846', cursor: 'pointer', transition: 'all .15s' }}>
                    {t}
                  </button>
                ))}
              </div>

              {/* 메모 */}
              <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, color: '#9A9490', letterSpacing: '.08em', marginBottom: 8 }}>메모</div>
              <textarea value={ootdEditNote} onChange={e => setOotdEditNote(e.target.value)} placeholder="오늘의 룩 메모…"
                style={{ width: '100%', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 12, padding: '11px 14px', fontFamily: f, fontSize: 14, color: '#0C0C0A', resize: 'none', height: 72, outline: 'none', boxSizing: 'border-box' as const, marginBottom: 16 }} />

              {/* 제품 등록 — BOX 불러오기 */}
              <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, color: '#9A9490', letterSpacing: '.08em', marginBottom: 8 }}>BOX 제품 연결</div>
              <button type="button" onClick={() => setOotdPickerOpen(true)}
                style={{ width: '100%', padding: '12px', border: '1.5px dashed rgba(12,12,10,.14)', borderRadius: 10, background: 'transparent', fontFamily: f, fontSize: 12, fontWeight: 700, color: '#9A9490', cursor: 'pointer', marginBottom: 8 }}>
                {ootdEditProductIds.length > 0 ? `${ootdEditProductIds.length}개 선택됨 · 변경` : '+ BOX에서 불러오기'}
              </button>
              {ootdEditProductIds.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const, marginBottom: 16 }}>
                  {ootdEditProductIds.map(pid => {
                    const p = products.get(pid);
                    return <span key={pid} style={{ fontFamily: f, fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 9999, background: '#EEEDE9', color: '#0C0C0A' }}>{p?.name ?? pid}</span>;
                  })}
                </div>
              )}
              {ootdEditProductIds.length === 0 && <div style={{ marginBottom: 16 }} />}

              {/* 버튼 */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <button type="button" onClick={() => setEditingOotd(null)} style={{ flex: 1, padding: 14, background: '#F4F4F0', border: 'none', borderRadius: 12, fontFamily: f, fontSize: 13, fontWeight: 700, color: '#4A4846', cursor: 'pointer' }}>취소</button>
                <button type="button" onClick={saveOotdEdit} disabled={ootdEditSaving} style={{ flex: 1, padding: 14, background: '#0C0C0A', border: 'none', borderRadius: 12, fontFamily: f, fontSize: 13, fontWeight: 700, color: '#fff', cursor: 'pointer', opacity: ootdEditSaving ? .6 : 1 }}>
                  {ootdEditSaving ? '저장 중…' : '저장'}
                </button>
              </div>
              <button type="button" onClick={deleteOotdEdit} style={{ width: '100%', padding: 14, background: 'none', border: '1.5px solid rgba(186,26,26,.3)', borderRadius: 12, fontFamily: f, fontSize: 13, fontWeight: 700, color: '#BA1A1A', cursor: 'pointer' }}>삭제</button>
            </div>

            {/* BOX 제품 피커 바텀시트 */}
            {ootdPickerOpen && (() => {
              // OOTD = 룩북과 동일: fashion + acc 도메인
              const ootdDomainProducts = ctxProducts.filter(p => p.domain === 'fashion' || p.domain === 'acc');
              const filtered = ootdDomainProducts.filter(p =>
                ootdPickerSearch.trim() ? p.name.toLowerCase().includes(ootdPickerSearch.toLowerCase()) : true
              );
              return (
                <>
                  <div onClick={() => setOotdPickerOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.25)', zIndex: 320 }} />
                  <div style={{ position: 'fixed', bottom: 0, left: 'max(0px,calc(50vw - 215px))', right: 'max(0px,calc(50vw - 215px))', zIndex: 330, background: '#FAFAF8', borderRadius: '20px 20px 0 0', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ padding: '12px 26px 8px', flexShrink: 0 }}>
                      <div style={{ width: 32, height: 3, background: 'rgba(12,12,10,.14)', borderRadius: 2, margin: '0 auto 12px' }} />
                      <input type="search" value={ootdPickerSearch} onChange={e => setOotdPickerSearch(e.target.value)} placeholder="제품 검색..." autoFocus
                        style={{ width: '100%', padding: '10px 12px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 8, fontFamily: f, fontSize: 13, color: '#0C0C0A', background: '#F4F4F0', outline: 'none', boxSizing: 'border-box' as const }} />
                    </div>
                    <div style={{ flex: 1, overflowY: 'auto' }}>
                      {filtered.map(p => {
                        const sel = ootdEditProductIds.includes(p.id);
                        const imgSrc = p.imageUrl ?? (p as Product & { storageUrl?: string }).storageUrl;
                        return (
                          <div key={p.id} onClick={() => setOotdEditProductIds(ids => sel ? ids.filter(id => id !== p.id) : [...ids, p.id])}
                            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 26px', borderBottom: '1px solid rgba(12,12,10,.07)', cursor: 'pointer', background: sel ? 'rgba(197,255,0,.06)' : 'transparent' }}>
                            <div style={{ width: 36, height: 36, borderRadius: 8, background: '#EEEDE9', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                              {imgSrc ? <img src={imgSrc} alt={p.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <span style={{ fontSize: 16 }}>👗</span>}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontFamily: f, fontSize: 14, fontWeight: 600, color: '#0C0C0A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{p.name}</div>
                              {p.brand && <div style={{ fontFamily: f, fontSize: 12, color: '#9A9490', marginTop: 2 }}>{p.brand}</div>}
                            </div>
                            <div style={{ width: 22, height: 22, borderRadius: '50%', border: `1.5px solid ${sel ? '#8AB000' : 'rgba(12,12,10,.14)'}`, background: sel ? '#C5FF00' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#0C0C0A', flexShrink: 0 }}>{sel ? '✓' : ''}</div>
                          </div>
                        );
                      })}
                      {!ootdPickerSearch.trim() && ootdDomainProducts.length === 0 && (
                        <div style={{ padding: '32px 26px', textAlign: 'center', fontFamily: f, fontSize: 13, color: '#9A9490', lineHeight: 1.6 }}>
                          BOX에 Fashion · Acc 제품이 없어요<br />이름을 검색하면 바로 등록할 수 있어요
                        </div>
                      )}
                      {ootdPickerSearch.trim() && filtered.length === 0 && (
                        <div style={{ padding: '32px 26px', textAlign: 'center', fontFamily: f, fontSize: 13, color: '#9A9490' }}>검색 결과가 없습니다</div>
                      )}
                    </div>
                    <div style={{ padding: '12px 26px calc(env(safe-area-inset-bottom,0px) + 20px)', borderTop: '1px solid rgba(12,12,10,.07)', flexShrink: 0 }}>
                      <button onClick={() => setOotdPickerOpen(false)} style={{ width: '100%', height: 52, background: '#0C0C0A', color: '#fff', border: 'none', borderRadius: 12, fontFamily: f, fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>완료 ({ootdEditProductIds.length}개)</button>
                    </div>
                  </div>
                </>
              );
            })()}
          </>
        );
      })()}
    </div>
  );
}

export default function LogPage() {
  return (
    <Suspense fallback={null}>
      <LogPageInner />
    </Suspense>
  );
}
