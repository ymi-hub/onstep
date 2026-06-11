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
  getDocs,
  doc,
  type Firestore,
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
import { DOMAIN_LABELS } from '@/types/ctitem';
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
type CachedLibrary = {
  name: string;
  emoji: string;
  tipCategory: string;
  sourceUrl: string;
  imageUrl: string;
  tags: string[];
  memo: string;
  productIds: string[];
};

type Reference = {
  id: string;
  url: string;
  title: string;
  imageUrl: string;
  description: string;
  platform: 'instagram' | 'youtube' | 'pinterest' | 'other';
  tags: string[];         // '메이크업' | '스킨케어' | '코디' | '루틴'
  note?: string;          // 메모 (선택)
  inLibrary?: boolean;    // 라이브러리 등록 여부
  libraryItemId?: string;               // 등록된 라이브러리 문서 ID
  libraryItemType?: 'makeup' | 'lookbook' | 'lifetip'; // 등록된 컬렉션 타입
  cachedLibrary?: CachedLibrary;        // 마지막 라이브러리 편집 내용 캐시
  createdAt: string;      // ISO datetime
};


// 수집 탭 빠른선택 태그 기본값 (localStorage에 없을 때 사용)
const DEFAULT_PRESET_TAGS: string[] = [];
const DEFAULT_CATEGORY_TAGS = ['Life tip', 'Makeup', 'Lookbook'];
const LIB_CATEGORY_TAGS = ['Life tip', 'Makeup', 'Lookbook'] as const;
// 카테고리 버튼 색상 팔레트 (순서대로 순환 사용)
const CAT_COLORS = [
  { selBg: 'rgba(96,165,250,.14)',  selBorder: '#60A5FA', selText: '#1D6DDB' },
  { selBg: 'rgba(197,255,0,.14)',   selBorder: '#4A7700', selText: '#3A6000' },
  { selBg: 'rgba(255,140,66,.14)',  selBorder: '#FF8C42', selText: '#B85A00' },
  { selBg: 'rgba(167,139,250,.14)', selBorder: '#7C3AED', selText: '#5B21B6' },
  { selBg: 'rgba(251,191,36,.14)',  selBorder: '#D97706', selText: '#92400E' },
  { selBg: 'rgba(236,72,153,.14)',  selBorder: '#DB2777', selText: '#9D174D' },
];

// 오늘의 룩 기록
type OOTDLog = {
  id: string;
  date: string;      // "YYYY-MM-DD"
  category: string;
  theme?: string;    // 구 필드 — 하위 호환 읽기용
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
    <div style={{ margin: '0 16px 16px', border: '1px solid #0C0C0A', borderRadius: 16, overflow: 'hidden', background: '#fff' }}>
      {/* 월 헤더 — 클릭으로 접기/펼치기 */}
      <div
        onClick={() => setIsOpen(o => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 16px',
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
      <div style={{ padding: '0 16px 16px', borderTop: '1px solid #0C0C0A' }}>
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
      if (!e.productId) return false; // null / undefined (수동 체크, 제품 미매핑 완료) 제외
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
            const isDeleted = !product;
            return (
              <div key={entry.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 28, height: 28, borderRadius: 9999, background: isDeleted ? 'rgba(12,12,10,.06)' : '#EEEDE9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flexShrink: 0 }}>
                  {isDeleted ? '🗑' : '🧴'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif", fontSize: 13, fontWeight: 600, color: isDeleted ? '#BCBAB6' : '#0C0C0A', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', textDecoration: isDeleted ? 'line-through' : 'none' }}>
                    {product?.name ?? '삭제된 제품'}
                  </div>
                  {!isDeleted && entry.amount != null && entry.amount > 0 && (
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
        margin: '0 16px',
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
          padding: '14px 16px',
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
    <div style={{ padding: '0 16px', overflow: 'hidden' }}>
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
  const badgeBg = isMakeup ? '#C5FF00' : '#FF8C42';
  const badgeTextColor = isMakeup ? '#3A6000' : '#7A3000';
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
        {/* 카테고리 뱃지 */}
        <div style={{
          position: 'absolute', right: 7, top: 10,
          width: 113, height: 32,
          background: badgeBg, border: '1px solid #18181B',
          transform: 'rotate(-3deg)',
          display: 'flex', alignItems: 'center', padding: '0 12px',
          zIndex: 3,
        }}>
          <span style={{ fontFamily: f, fontSize: 14, fontWeight: 700, color: badgeTextColor, transform: 'rotate(-3deg)' }}>{badge}</span>
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
        padding: '12px 16px 0px',
        width: '100%',
        isolation: 'isolate',
        flexShrink: 0,
      }}>
        {/* 제목 */}
        <div style={{ fontFamily: f, fontSize: 20, fontWeight: 600, color: '#000', lineHeight: '18px', width: '100%', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const }}>{item.name}</div>
        {/* daily — 우측 정렬 */}
        {item.daily && <div style={{ width: '100%', textAlign: 'right', fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.1em', color: '#BCBAB6', marginTop: 6 }}>{item.daily}</div>}
        {/* 서브 */}
        {item.desc && <div style={{ fontFamily: f, fontSize: 13, fontWeight: 400, color: '#1D6DDB', lineHeight: '18px', marginTop: 4, marginBottom: 12, width: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{item.desc}</div>}
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
      <div style={{ padding: '14px 16px 8px', display: 'flex', flexDirection: 'column', gap: 8 }}>
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

// ─── Life TIP 라이브러리 카드 — LogLibraryCard와 동일한 구조 ─────────────────
// 이미지 영역은 고정 높이(160px)로 이미지 크기와 무관하게 타이틀·편집바 위치 고정
// 카드는 flex column + height 100% → 2열 그리드에서 편집바가 항상 하단 고정
function LifetipLibraryCard({
  item,
  products,
  onEdit,
  onToggleToday,
}: {
  item: import('@/types/lifetip').LifetipItem;
  products: Map<string, Product>;
  onEdit: () => void;
  onToggleToday: () => void;
}) {
  const f = "'Plus Jakarta Sans', 'Space Grotesk', sans-serif";
  const pIds = item.productIds ?? [];
  const createdDate = item.createdAt?.slice(0, 10) ?? '';
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const isOnToday = item.published && (item.dates ?? []).includes(todayStr);

  return (
    // height: '100%' + flex col → CSS Grid 행 높이에 맞게 늘어나면서 편집바가 하단 고정
    <div style={{ border: '1px solid #000000', background: '#FFFFFF', display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* ① 이미지 영역 — 이미지 비율 그대로, 세로 이미지도 잘림 없이 전체 노출 */}
      <div style={{ position: 'relative', width: '100%', background: '#EEF6FF', flexShrink: 0 }}>
        {/* 카테고리 뱃지 스티커 */}
        <div style={{
          position: 'absolute', right: 7, top: 42,
          width: 113, height: 32,
          background: '#93C5FD', border: '1px solid #18181B',
          transform: 'rotate(-3deg)',
          display: 'flex', alignItems: 'center', padding: '0 12px',
          zIndex: 3,
        }}>
          <span style={{ fontFamily: f, fontSize: 14, fontWeight: 700, color: '#1E3A8A', transform: 'rotate(-3deg)' }}>#LIFETIP</span>
        </div>

        {item.imageUrl
          ? // eslint-disable-next-line @next/next/no-img-element
            <img src={item.imageUrl} alt={item.name} style={{ width: '100%', height: 'auto', display: 'block' }} />
          : <div style={{ width: '100%', height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: 80, opacity: 0.45, lineHeight: 1 }}>{item.emoji || '📌'}</span>
            </div>
        }
      </div>

      {/* ② 텍스트 콘텐츠 — LogLibraryCard와 동일한 패딩·폰트 */}
      <div style={{
        boxSizing: 'border-box',
        display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
        padding: '12px 10px 0px',
        width: '100%', isolation: 'isolate', flexShrink: 0,
      }}>
        {/* 제목 */}
        <div style={{ fontFamily: f, fontSize: 14, fontWeight: 700, color: '#000', lineHeight: '18px', width: '100%', marginBottom: item.memo ? 6 : 10, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const }}>{item.name}</div>
        {item.memo ? (
          <div style={{ fontFamily: f, fontSize: 13, fontWeight: 400, color: '#1D6DDB', lineHeight: '18px', marginTop: 6, marginBottom: item.tags?.length ? 8 : 12, width: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
            {item.memo}
          </div>
        ) : (
          <div style={{ marginBottom: item.tags?.length ? 8 : 12 }} />
        )}
        {(item.tags ?? []).length > 0 && (
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' as const, marginBottom: 12 }}>
            {(item.tags ?? []).map(tag => (
              <span key={tag} style={{ fontFamily: f, fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 9999, background: 'rgba(12,12,10,.06)', border: '1px solid rgba(12,12,10,.1)', color: '#6A6866' }}>#{tag}</span>
            ))}
          </div>
        )}
        {item.sourceUrl?.trim() && (() => {
          let domain = item.sourceUrl!;
          try { domain = new URL(item.sourceUrl!).hostname; } catch {}
          return (
            <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer"
              style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 20, padding: '8px 12px', border: '1px solid rgba(12,12,10,.15)', borderRadius: 8, textDecoration: 'none', fontFamily: f, fontSize: 11, fontWeight: 700, color: '#4A4846', letterSpacing: '.04em', background: 'rgba(0,0,0,.03)', width: '100%', boxSizing: 'border-box' as const }}>
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

      {/* ③ 연결 BOX 제품 — LogLibraryCard와 동일한 120×160 썸네일 */}
      {pIds.length > 0 && (
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '12px 8px 8px', width: '100%', scrollbarWidth: 'none' as const, borderTop: '1px solid #000000', boxSizing: 'border-box' as const }}>
          {pIds.map((pid, idx) => {
            const p = products.get(pid);
            const imgSrc = p?.imageUrl || (p as (Product & { storageUrl?: string }) | undefined)?.storageUrl;
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

      {/* ④ 등록 정보 — LogLibraryCard 통계 영역과 동일한 패딩·구조 */}
      <div style={{ padding: '14px 16px 8px', display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
            <span style={{ fontFamily: f, fontSize: 28, fontWeight: 800, color: '#1D6DDB', lineHeight: 1 }}>{item.emoji || '📌'}</span>
          </div>
          {createdDate && (
            <>
              <div style={{ width: 1, height: 16, background: 'rgba(12,12,10,.12)' }} />
              <span style={{ fontFamily: f, fontSize: 11, fontWeight: 600, color: '#9A9490' }}>등록 {createdDate}</span>
            </>
          )}
        </div>
      </div>

      {/* ⑤ 편집 바 — marginTop: auto로 항상 카드 하단 고정 */}
      <div style={{ display: 'flex', borderTop: '1px solid #000000', marginTop: 'auto', flexShrink: 0 }}>
        <button onClick={onToggleToday}
          style={{ flex: 1, padding: '12px 0', background: isOnToday ? '#0C0C0A' : 'rgba(12,12,10,.06)', color: isOnToday ? '#C5FF00' : '#9A9490', border: 'none', borderRight: '1px solid #000000', borderRadius: 0, fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.06em', cursor: 'pointer', transition: 'all .15s', textTransform: 'uppercase' as const }}>
          {isOnToday ? 'Today ON' : 'Today OFF'}
        </button>
        <button onClick={onEdit} style={{ flex: 1, padding: '12px 0', background: '#F3F3F1', color: '#0C0C0A', border: 'none', borderRadius: 0, fontFamily: f, fontSize: 12, fontWeight: 700, letterSpacing: '.06em', cursor: 'pointer' }}>편집</button>
      </div>
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
  const [imgFile, setImgFile] = useState<File | null>(null);
  const [imgPreview, setImgPreview] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [selectedProds, setSelectedProds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const domainProducts = ctType === 'makeup'
    ? Array.from(products.values()).filter(p => p.domain === 'beauty')
    : Array.from(products.values()).filter(p => p.domain === 'fashion' || p.domain === 'acc');

  const filteredProds = pickerSearch.trim()
    ? domainProducts.filter(p => p.name.toLowerCase().includes(pickerSearch.toLowerCase()))
    : domainProducts;

  // 검색어로 제품 없을 때 → BOX에 즉시 등록 후 피커에 추가
  async function registerAndAddProduct(prodName: string) {
    if (!db || !prodName.trim()) return;
    const now = new Date().toISOString();
    const domain = ctType === 'makeup' ? 'beauty' : 'fashion';
    const ref = await addDoc(collection(db, 'users', userId, 'products'), {
      name: prodName.trim(), brand: '', domain,
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
            <div style={{ padding: '12px 16px 8px', flexShrink: 0 }}>
              <div style={{ width: 32, height: 3, background: 'rgba(12,12,10,.14)', borderRadius: 2, margin: '0 auto 12px' }} />
              <input type="search" value={pickerSearch} onChange={e => setPickerSearch(e.target.value)} placeholder="제품 검색..." autoFocus style={{ width: '100%', padding: '10px 12px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 8, fontFamily: f, fontSize: 13, color: '#0C0C0A', background: '#F4F4F0', outline: 'none', boxSizing: 'border-box' as const }} />
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {filteredProds.map(p => {
                const sel = selectedProds.has(p.id);
                const imgSrc = p.imageUrl || p.storageUrl;
                return (
                  <div key={p.id} onClick={() => setSelectedProds(prev => { const n = new Set(prev); sel ? n.delete(p.id) : n.add(p.id); return n; })} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid rgba(12,12,10,.07)', cursor: 'pointer', background: sel ? 'rgba(197,255,0,.06)' : 'transparent' }}>
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
                <div onClick={() => registerAndAddProduct(pickerSearch)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', cursor: 'pointer', background: 'rgba(197,255,0,.06)', borderBottom: '1px solid rgba(12,12,10,.07)' }}>
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: '#C5FF00', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 300 }}>+</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: f, fontSize: 14, fontWeight: 700, color: '#0C0C0A' }}>"{pickerSearch.trim()}" 이름으로 등록 후 추가</div>
                    <div style={{ fontFamily: f, fontSize: 11, color: '#9A9490', marginTop: 2 }}>BOX에 자동 저장 · 나중에 상세 정보 수정 가능</div>
                  </div>
                </div>
              )}
              {!pickerSearch.trim() && filteredProds.length === 0 && (
                <div style={{ padding: '32px 16px', textAlign: 'center', fontFamily: f, fontSize: 13, color: '#9A9490', lineHeight: 1.6 }}>
                  BOX에 {ctType === 'makeup' ? '메이크업' : '패션·악세서리'} 제품이 없어요<br />
                  이름을 검색하면 바로 등록할 수 있어요
                </div>
              )}
            </div>
            <div style={{ padding: '12px 16px calc(env(safe-area-inset-bottom,0px) + 20px)', borderTop: '1px solid rgba(12,12,10,.07)', flexShrink: 0 }}>
              <button onClick={() => setPickerOpen(false)} style={{ width: '100%', height: 52, background: '#0C0C0A', color: '#fff', border: 'none', borderRadius: 12, fontFamily: f, fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>완료 ({selectedProds.size}개)</button>
            </div>
          </div>
        </>
      )}
    </>
  );
}

// 도메인 이모지 매핑 — LogCtPanel과 메인 컴포넌트 모두에서 사용
const DOMAIN_EMOJIS: Record<string, string> = { beauty: '💄', fashion: '👗', acc: '👜', interior: '🛋' };

// ─── LOG CtPanel (setup의 Makeup/Lookbook과 동일한 구조) ──────────────────────

function LogCtPanel({
  filter, items, products, userId, onAdd, onUpdate, onDelete,
  hideAddButton, addTrigger, editTrigger, hiddenMode,
  onAfterSave,
}: {
  filter: string;  // BOX 도메인 (예: 'beauty', 'fashion', 'interior')
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
  onAfterSave?: (itemId: string, tags: string[]) => void;
}) {
  const f = "'Plus Jakarta Sans','Space Grotesk',sans-serif";
  const ctType: CtType = filter === 'fashion' ? 'lookbook' : 'makeup';
  const colLabel = DOMAIN_LABELS[filter] ?? filter;
  const icon = DOMAIN_EMOJIS[filter] ?? '📦';

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
  const [sPublished, setSPublished] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [sImageFile, setSImageFile] = useState<File | null>(null);
  const [sImagePreview, setSImagePreview] = useState('');
  const [sSourceUrl, setSSourceUrl] = useState('');
  const [sTags, setSTags] = useState<string[]>([]);
  const [sTagInput, setSTagInput] = useState('');
  const [sTagEditOpen, setSTagEditOpen] = useState(false);
  const [dragTagIdx, setDragTagIdx] = useState<number | null>(null);
  const [dragTagOverIdx, setDragTagOverIdx] = useState<number | null>(null);

  // picker
  const [picker, setPicker] = useState<'main' | 'tip' | null>(null);
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickerSelected, setPickerSelected] = useState<Set<string>>(new Set());
  const [pickerDomain, setPickerDomain] = useState<string | null>(filter);

  const pickerDomainFiltered = pickerDomain ? products.filter(p => p.domain === pickerDomain) : products;
  const filteredPicker = pickerSearch.trim()
    ? pickerDomainFiltered.filter(p => p.name.toLowerCase().includes(pickerSearch.toLowerCase()) || (p.brand ?? '').toLowerCase().includes(pickerSearch.toLowerCase()))
    : pickerDomainFiltered;

  function productName(id: string) { return products.find(p => p.id === id)?.name ?? '?'; }

  function openNew() {
    setEditItem(null); setSEmoji(icon); setSName(''); setSDesc(''); setSDaily('');
    setSItems([]); setSTipItems([]); setSDates([]);
    setSPublished(false); setSImageFile(null); setSImagePreview(''); setSSourceUrl('');
    setSTags([]); setSTagInput(''); setSTagEditOpen(false);
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
    setEditItem(item); setSEmoji(item.emoji); setSName(item.name ?? ''); setSDesc(item.desc ?? ''); setSDaily(item.daily ?? '');
    setSItems(item.items ?? []); setSTipItems(item.tipItems ?? []); setSDates(item.dates ?? []);
    setSPublished(item.published);
    setSImageFile(null); setSImagePreview(item.imageUrl ?? ''); setSSourceUrl(item.sourceUrl ?? '');
    setSTags(item.tags ?? []); setSTagInput(''); setSTagEditOpen(false);
    setSheetOpen(true);
  }

  function closeSheet() { setSheetOpen(false); setPicker(null); setSaveError(''); }

  // Firestore는 undefined 값을 거부하므로 객체/배열에서 제거
  function stripUndefined<T>(val: T): T {
    if (Array.isArray(val)) return val.map(stripUndefined) as unknown as T;
    if (val !== null && typeof val === 'object') {
      return Object.fromEntries(
        Object.entries(val as Record<string, unknown>)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, stripUndefined(v)])
      ) as T;
    }
    return val;
  }

  async function handleSave() {
    if (!sName.trim()) return;
    setSaving(true);
    setSaveError('');
    try {
      const now = new Date().toISOString();
      const data: Omit<CtItem, 'id' | 'createdAt' | 'updatedAt'> = {
        ctType,
        emoji: sEmoji || icon,
        name: sName.trim(), desc: (sDesc ?? '').trim(),
        items: stripUndefined(sItems ?? []), tipItems: stripUndefined(sTipItems ?? []), expertTip: '',
        published: sPublished, dates: sDates,
        tags: sTags,
        ...((sSourceUrl ?? '').trim() ? { sourceUrl: sSourceUrl.trim() } : {}),
        ...(sImagePreview ? { imageUrl: sImagePreview } : {}),
        domain: filter,
        ...((sDaily ?? '').trim() ? { daily: sDaily.trim() } : {}),
      };
      if (editItem) {
        await onUpdate(editItem.id, { ...data, updatedAt: now });
        onAfterSave?.(editItem.id, sTags);
      } else {
        const newId = await onAdd(data);
        onAfterSave?.(newId, sTags);
      }
      closeSheet();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[LogCtPanel] 저장 실패:', err);
      setSaveError(msg || '저장에 실패했습니다. 다시 시도해주세요.');
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
  // 도메인별 배경/배지 색상 매핑
  const DOMAIN_BG: Record<string, string> = {
    beauty:   'linear-gradient(135deg,#f5f0ff 0%,#d0b0ff 100%)',
    fashion:  'linear-gradient(135deg,#fff0f5 0%,#ffc0d0 100%)',
    acc:      'linear-gradient(135deg,#fff8e6 0%,#ffd580 100%)',
    interior: 'linear-gradient(135deg,#e8f5e9 0%,#a5d6a7 100%)',
  };
  const DOMAIN_BADGE: Record<string, string> = {
    beauty:   '#MAKEUP',
    fashion:  '#LOOKBOOK',
    acc:      '#ACCESSORY',
    interior: '#INTERIOR',
  };
  const DOMAIN_BADGE_COLOR: Record<string, string> = {
    beauty:   '#C5FF00',
    fashion:  '#FF8C42',
    acc:      '#FFD700',
    interior: '#69DB7C',
  };
  const BG = DOMAIN_BG[filter] ?? 'linear-gradient(135deg,#f0f0f0 0%,#d0d0d0 100%)';
  const BADGE = DOMAIN_BADGE[filter] ?? `#${(DOMAIN_LABELS[filter] ?? filter).toUpperCase()}`;
  const BADGE_COLOR = DOMAIN_BADGE_COLOR[filter] ?? '#C5FF00';

  function HubStyleCard({ item, featured }: { item: CtItem; featured?: boolean }) {
    const today = format(new Date(), 'yyyy-MM-dd');
    const isOnToday = item.published && (item.dates ?? []).includes(today);
    const prodItems = item.items.filter((i): i is { type: 'product'; id: string } => i.type === 'product');
    const sub = item.desc ? item.desc.slice(0, 28) : '';

    // featured: 히어로 340px / square: 130px
    const heroH = featured ? 340 : 130;

    /* ── featured(Card 1): 이미지 + 배지/제목 + 제품 스크롤 + CTA ── */
    if (featured) return (
      <div style={{ background: '#FAFAF8', overflow: 'hidden' }}>
        <div style={{ width: '100%', height: 340, background: item.imageUrl ? 'transparent' : BG, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 48, overflow: 'visible', position: 'relative' }}>
          {item.imageUrl ? <img src={item.imageUrl} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} /> : item.emoji || (DOMAIN_EMOJIS[filter] ?? '📦')}
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
          {item.imageUrl ? <img src={item.imageUrl} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} /> : item.emoji || (DOMAIN_EMOJIS[filter] ?? '📦')}
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
      <div style={{ padding: '0 16px', display: hiddenMode ? 'none' : undefined }}>
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
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
                <input value={sEmoji} onChange={e => setSEmoji(e.target.value)} placeholder={icon} maxLength={2} style={{ width: 48, padding: '11px 6px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 12, fontSize: 22, textAlign: 'center', background: '#fff', outline: 'none', flexShrink: 0 }} />
                <input value={sName} onChange={e => setSName(e.target.value)} placeholder="이름 *" style={{ flex: 1, padding: '12px 14px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 12, fontFamily: f, fontSize: 14, color: '#0C0C0A', background: '#fff', outline: 'none' }} />
              </div>

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

              {/* 메모 */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.16em', textTransform: 'uppercase' as const, color: '#9A9490', marginBottom: 8 }}>메모</div>
                <textarea value={sDesc} onChange={e => setSDesc(e.target.value)}
                  placeholder="메모 입력 (선택)..."
                  rows={3}
                  style={{ width: '100%', padding: '10px 14px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 10, fontFamily: f, fontSize: 13, color: '#0C0C0A', background: '#fff', outline: 'none', resize: 'none', boxSizing: 'border-box' as const, lineHeight: 1.5 }}
                />
              </div>

              {/* BOX 제품 연결 */}
              <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, color: '#9A9490', letterSpacing: '.08em', marginBottom: 8, marginTop: 8 }}>BOX 제품 연결</div>
              <button type="button" onClick={() => { setPicker('main'); setPickerSearch(''); setPickerDomain(filter); setPickerSelected(new Set(sItems.filter((i): i is { type: 'product'; id: string } => i.type === 'product').map(i => i.id))); }}
                style={{ width: '100%', padding: '12px', border: '1.5px dashed rgba(12,12,10,.14)', borderRadius: 10, background: 'transparent', fontFamily: f, fontSize: 12, fontWeight: 700, color: '#9A9490', cursor: 'pointer', marginBottom: 8 }}>
                {sItems.filter((i): i is { type: 'product'; id: string } => i.type === 'product').length > 0
                  ? `${sItems.filter((i): i is { type: 'product'; id: string } => i.type === 'product').length}개 선택됨 · 변경`
                  : '+ BOX에서 불러오기'}
              </button>
              {sItems.filter((i): i is { type: 'product'; id: string } => i.type === 'product').length > 0 ? (
                <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 6, marginBottom: 16 }}>
                  {sItems.filter((i): i is { type: 'product'; id: string } => i.type === 'product').map((it, idx) => (
                    <span key={idx} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: f, fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 9999, background: '#EEEDE9', color: '#0C0C0A' }}>
                      {productName(it.id)}
                      <button type="button" onClick={() => setSItems(p => p.filter((_, i) => i !== idx))} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#9A9490', fontSize: 12, padding: 0, lineHeight: 1 }}>×</button>
                    </span>
                  ))}
                </div>
              ) : <div style={{ marginBottom: 16 }} />}

              {/* 예정 날짜 */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.16em', textTransform: 'uppercase' as const, color: '#9A9490', marginBottom: 8 }}>예정 날짜</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                  {sDates.map(d => <span key={d} onClick={() => setSDates(p => p.filter(x => x !== d))} style={{ fontFamily: f, fontSize: 12, fontWeight: 700, padding: '5px 10px', borderRadius: 9999, background: '#0C0C0A', color: '#fff', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}>{fmtDate(d)} <span style={{ opacity: .6, fontSize: 10 }}>✕</span></span>)}
                  <input type="date" onChange={e => { if (e.target.value && !sDates.includes(e.target.value)) { setSDates(p => [...p, e.target.value].sort()); e.target.value = ''; } }} style={{ padding: '5px 10px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 9999, fontFamily: f, fontSize: 12, color: '#0C0C0A', background: '#fff', outline: 'none' }} />
                </div>
              </div>

              {/* 구분선 */}
              <div style={{ height: 1, background: 'rgba(12,12,10,.08)', margin: '4px 0 16px' }} />

              {/* 카테고리 — 읽기 전용 배지 */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: '#0C0C0A', display: 'inline-block' }} />
                  <span style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.1em', color: '#0C0C0A' }}>카테고리</span>
                </div>
                <span style={{ fontFamily: f, fontSize: 11, fontWeight: 800, color: BADGE_COLOR, background: '#0C0C0A', padding: '4px 12px', borderRadius: 9999, letterSpacing: '.04em' }}>
                  {DOMAIN_LABELS[filter] ?? filter}
                </span>
              </div>

              {/* 태그 */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontFamily: f, fontSize: 11, fontWeight: 800, color: '#555250' }}>#</span>
                    <span style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.08em', color: '#555250' }}>태그</span>
                  </div>
                  <button type="button"
                    onClick={() => { setSTagEditOpen(v => !v); if (sTagEditOpen) setSTagInput(''); }}
                    style={{ height: 24, padding: '0 10px', borderRadius: 9999, border: 'none', background: '#0C0C0A', fontFamily: f, fontSize: 10, fontWeight: 800, color: '#C5FF00', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, letterSpacing: '.04em' }}>
                    <svg width="9" height="9" viewBox="0 0 12 12" fill="none"><path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                    태그 편집
                  </button>
                </div>
                {sTags.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const, marginBottom: 8 }}>
                    {sTags.map((tag, i) => (
                      <span key={tag} style={{ fontFamily: f, fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: 'rgba(12,12,10,.07)', color: '#555250' }}>#{tag}</span>
                    ))}
                  </div>
                )}
                {sTags.length === 0 && !sTagEditOpen && (
                  <div style={{ fontFamily: f, fontSize: 12, color: '#BCBAB6', marginBottom: 4 }}>태그를 추가해보세요</div>
                )}
                {sTagEditOpen && (
                  <div style={{ marginTop: 8, padding: '10px 12px 12px', borderRadius: 10, background: 'rgba(12,12,10,.03)', border: '1px solid rgba(12,12,10,.1)' }}>
                    <span style={{ fontFamily: f, fontSize: 10, fontWeight: 700, color: '#BCBAB6', letterSpacing: '.06em', textTransform: 'uppercase' as const, display: 'block', marginBottom: 8 }}>드래그로 순서 변경</span>
                    <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 5, marginBottom: 8 }}>
                      {sTags.map((tag, i) => (
                        <div key={tag}
                          draggable
                          onDragStart={() => setDragTagIdx(i)}
                          onDragOver={e => { e.preventDefault(); setDragTagOverIdx(i); }}
                          onDrop={() => {
                            if (dragTagIdx === null || dragTagIdx === i) return;
                            setSTags(prev => {
                              const arr = [...prev];
                              const [moved] = arr.splice(dragTagIdx, 1);
                              arr.splice(i, 0, moved);
                              return arr;
                            });
                            setDragTagIdx(null); setDragTagOverIdx(null);
                          }}
                          onDragEnd={() => { setDragTagIdx(null); setDragTagOverIdx(null); }}
                          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 8, background: dragTagOverIdx === i ? 'rgba(12,12,10,.07)' : 'rgba(12,12,10,.03)', border: `1px solid ${dragTagOverIdx === i ? 'rgba(12,12,10,.2)' : 'rgba(12,12,10,.08)'}`, cursor: 'grab', transition: 'all .1s' }}>
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0, color: '#BCBAB6' }}><circle cx="4" cy="3" r="1" fill="currentColor"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="9" r="1" fill="currentColor"/><circle cx="8" cy="3" r="1" fill="currentColor"/><circle cx="8" cy="6" r="1" fill="currentColor"/><circle cx="8" cy="9" r="1" fill="currentColor"/></svg>
                          <span style={{ fontFamily: f, fontSize: 12, fontWeight: 600, color: '#0C0C0A', flex: 1 }}>#{tag}</span>
                          <button type="button" onClick={() => setSTags(prev => prev.filter(t => t !== tag))}
                            style={{ width: 20, height: 20, borderRadius: 9999, background: 'rgba(220,50,50,.1)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, color: '#C0392B', flexShrink: 0 }}>
                            <svg width="7" height="7" viewBox="0 0 7 7" fill="none"><path d="M1 1l5 5M6 1L1 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
                          </button>
                        </div>
                      ))}
                    </div>
                    <input type="text" value={sTagInput}
                      onChange={e => setSTagInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                          const t = sTagInput.trim();
                          if (t && !sTags.includes(t)) setSTags(prev => [...prev, t]);
                          setSTagInput('');
                        }
                      }}
                      placeholder="+ 태그 추가 (Enter)"
                      style={{ width: '100%', height: 32, padding: '0 10px', borderRadius: 8, border: '1.5px dashed rgba(12,12,10,.25)', background: 'transparent', fontFamily: f, fontSize: 11, color: '#0C0C0A', outline: 'none', boxSizing: 'border-box' as const }}
                    />
                  </div>
                )}
              </div>

              {/* Today 토글 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginBottom: 20 }} onClick={() => { const next = !sPublished; setSPublished(next); const today = format(new Date(), 'yyyy-MM-dd'); if (next) setSDates(p => p.includes(today) ? p : [...p, today].sort()); }}>
                <div style={{ width: 44, height: 26, borderRadius: 13, background: sPublished ? '#0C0C0A' : '#D8D6CF', transition: 'background .2s', position: 'relative', flexShrink: 0 }}>
                  <div style={{ position: 'absolute', top: 3, left: sPublished ? 21 : 3, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.3)' }} />
                </div>
                <span style={{ fontFamily: f, fontSize: 14, fontWeight: 700, color: '#0C0C0A' }}>{sPublished ? 'Today에 표시 ON' : 'Today에 표시 OFF'}</span>
              </div>

              {/* 저장 에러 배너 */}
              {saveError && (
                <div style={{ padding: '10px 14px', background: '#FFF0F0', border: '1.5px solid rgba(186,26,26,.25)', borderRadius: 10, marginBottom: 8, fontFamily: f, fontSize: 12, color: '#BA1A1A', lineHeight: 1.5, wordBreak: 'break-all' as const }}>
                  ⚠ 저장 실패: {saveError}
                </div>
              )}

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
                <div style={{ padding: '12px 16px 8px', flexShrink: 0 }}>
                  <div style={{ width: 32, height: 3, background: 'rgba(12,12,10,.14)', borderRadius: 2, margin: '0 auto 12px' }} />
                  {/* 도메인 탭 */}
                  {(() => {
                    const allDomains = [...new Set(products.map(p => p.domain).filter(Boolean))] as string[];
                    const ORDER = ['beauty', 'fashion', 'acc', 'interior'];
                    const sorted = [...ORDER.filter(d => allDomains.includes(d)), ...allDomains.filter(d => !ORDER.includes(d))];
                    return sorted.length > 1 ? (
                      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 10, scrollbarWidth: 'none' as const }}>
                        <button type="button" onClick={() => setPickerDomain(null)}
                          style={{ flexShrink: 0, background: pickerDomain === null ? '#0C0C0A' : '#fff', border: `1px solid ${pickerDomain === null ? '#0C0C0A' : 'rgba(12,12,10,.15)'}`, borderRadius: 9999, padding: '5px 12px', fontFamily: f, fontSize: 11, fontWeight: 700, color: pickerDomain === null ? '#fff' : '#0C0C0A', cursor: 'pointer', whiteSpace: 'nowrap' as const }}>
                          전체 {products.length}
                        </button>
                        {sorted.map(d => {
                          const cnt = products.filter(p => p.domain === d).length;
                          const sel = pickerDomain === d;
                          return (
                            <button key={d} type="button" onClick={() => setPickerDomain(d)}
                              style={{ flexShrink: 0, background: sel ? '#0C0C0A' : '#fff', border: `1px solid ${sel ? '#0C0C0A' : 'rgba(12,12,10,.15)'}`, borderRadius: 9999, padding: '5px 12px', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', whiteSpace: 'nowrap' as const }}>
                              <span style={{ fontSize: 12 }}>{DOMAIN_EMOJIS[d] ?? '📦'}</span>
                              <span style={{ fontFamily: f, fontSize: 11, fontWeight: 700, color: sel ? '#fff' : '#0C0C0A' }}>{DOMAIN_LABELS[d] ?? d}</span>
                              <span style={{ fontFamily: f, fontSize: 10, color: sel ? 'rgba(255,255,255,.5)' : '#BCBAB6' }}>{cnt}</span>
                            </button>
                          );
                        })}
                      </div>
                    ) : null;
                  })()}
                  <input type="search" value={pickerSearch} onChange={e => setPickerSearch(e.target.value)} placeholder="제품명 · 브랜드 검색..." autoFocus style={{ width: '100%', padding: '10px 12px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 8, fontFamily: f, fontSize: 13, color: '#0C0C0A', background: '#F4F4F0', outline: 'none', boxSizing: 'border-box' as const, marginBottom: 4 }} />
                  <div style={{ fontFamily: f, fontSize: 11, color: '#9A9490', marginBottom: 8 }}>{pickerSelected.size > 0 ? `${pickerSelected.size}개 선택됨` : 'BOX에서 제품을 선택하세요'}</div>
                </div>
                <div style={{ flex: 1, overflowY: 'auto' }}>
                  {filteredPicker.map(p => {
                    const sel = pickerSelected.has(p.id);
                    const imgSrc = p.imageUrl || p.storageUrl;
                    return (
                      <div key={p.id} onClick={() => setPickerSelected(prev => { const n = new Set(prev); sel ? n.delete(p.id) : n.add(p.id); return n; })} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid rgba(12,12,10,.07)', cursor: 'pointer', background: sel ? 'rgba(197,255,0,.06)' : 'transparent' }}>
                        <div style={{ width: 36, height: 36, borderRadius: 8, background: '#EEEDE9', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          {imgSrc ? <img src={imgSrc} alt={p.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <span style={{ fontSize: 16 }}>{DOMAIN_EMOJIS[filter] ?? '📦'}</span>}
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
                      const domain = filter; // 현재 탭 도메인 그대로 사용
                      const ref = await addDoc(collection(db, 'users', userId, 'products'), { name: pickerSearch.trim(), brand: '', domain, packageCount: 1, unitPerPackage: 0, itemUnit: '', totalAmount: 0, dosePerUse: 0, usesPerDay: 1, frequencyType: 'daily', currentRemaining: 0, createdAt: now, updatedAt: now });
                      setPickerSelected(prev => { const n = new Set(prev); n.add(ref.id); return n; });
                      setPickerSearch('');
                    }} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', cursor: 'pointer', background: 'rgba(197,255,0,.06)', borderBottom: '1px solid rgba(12,12,10,.07)' }}>
                      <div style={{ width: 36, height: 36, borderRadius: 8, background: '#C5FF00', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>+</div>
                      <div>
                        <div style={{ fontFamily: f, fontSize: 14, fontWeight: 700, color: '#0C0C0A' }}>"{pickerSearch.trim()}" 이름으로 등록 후 추가</div>
                        <div style={{ fontFamily: f, fontSize: 11, color: '#9A9490', marginTop: 2 }}>BOX에 자동 저장 · 나중에 수정 가능</div>
                      </div>
                    </div>
                  )}
                  {!pickerSearch.trim() && filteredPicker.length === 0 && <div style={{ padding: '32px 16px', textAlign: 'center', fontFamily: f, fontSize: 13, color: '#9A9490' }}>BOX에 해당 도메인 제품이 없어요</div>}
                </div>
                <div style={{ padding: '12px 16px calc(env(safe-area-inset-bottom,0px) + 20px)', borderTop: '1px solid rgba(12,12,10,.07)', flexShrink: 0 }}>
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
        기록 불러오는 중...
      </div>
    );
  }

  if (!isLoggedIn) {
    return (
      <div
        style={{
          margin: '0 16px',
          padding: '40px 16px',
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
        margin: '0 16px',
        padding: '48px 16px',
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
  const { user, userId, authLoading, products: ctxProducts, sessions, makeupItems, lookItems, libraryItems, lifetipItems, careItems, habits, dietPrograms, healthRoutines, medRoutines } = useAppContext();
  const products = new Map(ctxProducts.map((p) => [p.id, p]));

  // ── allLibItems: libraryItems(신규) + makeupItems/lookItems(구 — 마이그레이션 전 호환) 중복 제거 ──
  const libItemIds = new Set(libraryItems.map(i => i.id));
  const allLibItems: CtItem[] = [
    ...libraryItems,
    ...makeupItems.filter(i => !libItemIds.has(i.id)).map(i => ({ ...i, domain: i.domain ?? 'beauty' })),
    ...lookItems.filter(i => !libItemIds.has(i.id)).map(i => ({ ...i, domain: i.domain ?? 'fashion' })),
  ];
  // 아이템 ID → 실제 컬렉션명 매핑 (CRUD 시 올바른 컬렉션 사용)
  const itemCollectionMap = new Map<string, string>([
    ...libraryItems.map(i => [i.id, 'libraryItems'] as [string, string]),
    ...makeupItems.filter(i => !libItemIds.has(i.id)).map(i => [i.id, 'makeupItems'] as [string, string]),
    ...lookItems.filter(i => !libItemIds.has(i.id)).map(i => [i.id, 'lookItems'] as [string, string]),
  ]);

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
  const [mainTab, setMainTab] = useState<'기록' | '라이브러리' | '수집'>('기록');
  const [archiveFilter, setArchiveFilter] = useState<string>('all');
  const [lifetipCategory, setLifetipCategory] = useState<string | null>(null); // null = 전체
  const [domainTagFilter, setDomainTagFilter] = useState<string | null>(null); // 도메인 탭 태그 필터
  const [editingLifetipId, setEditingLifetipId] = useState<string | null>(null); // 인라인 이모지 편집
  // Life TIP 편집 시트
  const [editingLifetip, setEditingLifetip] = useState<import('@/types/lifetip').LifetipItem | null>(null);
  const [lifetipEditName, setLifetipEditName] = useState('');
  const [lifetipEditEmoji, setLifetipEditEmoji] = useState('');
  const [lifetipEditCategory, setLifetipEditCategory] = useState(''); // 내부 필터링용 tipCategory
  const [lifetipEditCategoryLabel, setLifetipEditCategoryLabel] = useState(''); // UI 표시용 카테고리 (Life tip / Makeup / Lookbook)
  const [lifetipEditUrl, setLifetipEditUrl] = useState('');
  const [lifetipEditProductIds, setLifetipEditProductIds] = useState<string[]>([]);
  const [lifetipEditImageFile, setLifetipEditImageFile] = useState<File | null>(null);
  const [lifetipEditImagePreview, setLifetipEditImagePreview] = useState('');
  const [lifetipEditMemo, setLifetipEditMemo] = useState('');
  const [lifetipEditTags, setLifetipEditTags] = useState<string[]>([]);
  const [lifetipTagEditOpen, setLifetipTagEditOpen] = useState(false);
  const [lifetipTagNewTag, setLifetipTagNewTag] = useState('');
  const [dragLifetipTagIdx, setDragLifetipTagIdx] = useState<number | null>(null);
  const [dragLifetipTagOverIdx, setDragLifetipTagOverIdx] = useState<number | null>(null);
  const [lifetipEditPublished, setLifetipEditPublished] = useState(false);
  const [lifetipEditDates, setLifetipEditDates] = useState<string[]>([]);
  const [lifetipEditSaving, setLifetipEditSaving] = useState(false);
  const [lifetipPickerOpen, setLifetipPickerOpen] = useState(false);
  const [lifetipPickerSearch, setLifetipPickerSearch] = useState('');
  const [lifetipPickerDomain, setLifetipPickerDomain] = useState<string | null>(null);

  // ── 수집 탭 상태 ──
  const [references, setReferences] = useState<Reference[]>([]);
  const [refUrl, setRefUrl] = useState('');
  const [refTitle, setRefTitle] = useState('');
  const [refNote, setRefNote] = useState('');
  const [refTags, setRefTags] = useState<string[]>([]);
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
  // 카테고리 편집 패널 상태
  const [catEditOpen, setCatEditOpen] = useState(false);
  const [catNewTag, setCatNewTag] = useState('');
  const [dragCatIdx, setDragCatIdx] = useState<number | null>(null);
  const [dragCatOverIdx, setDragCatOverIdx] = useState<number | null>(null);
  const [categoryTags, setCategoryTags] = useState<string[]>(() => {
    if (typeof window === 'undefined') return DEFAULT_CATEGORY_TAGS;
    try {
      const saved = localStorage.getItem('onstep_category_tags');
      return saved ? JSON.parse(saved) : DEFAULT_CATEGORY_TAGS;
    } catch { return DEFAULT_CATEGORY_TAGS; }
  });
  // 수집 편집 시트 상태
  const [editingRef, setEditingRef] = useState<Reference | null>(null);
  const [refEditUrl, setRefEditUrl] = useState('');
  const [refEditTitle, setRefEditTitle] = useState('');
  const [refEditNote, setRefEditNote] = useState('');
  const [refEditTags, setRefEditTags] = useState<string[]>([]);
  const [refEditTagInput, setRefEditTagInput] = useState('');
  const [refEditImageFile, setRefEditImageFile] = useState<File | null>(null);
  const [refEditImagePreview, setRefEditImagePreview] = useState('');
  const [refEditSaving, setRefEditSaving] = useState(false);
  const [refEditTagFocused, setRefEditTagFocused] = useState(false);
  // 수집 정렬 + 페이지네이션
  const [refSort, setRefSort] = useState<'date_desc' | 'category'>('date_desc');
  const [refVisibleCount, setRefVisibleCount] = useState(10);

  // OOTD 편집 시트 상태
  const [editingOotd, setEditingOotd] = useState<OOTDLog | null>(null);
  const [ootdEditCategory, setOotdEditCategory] = useState('');
  const [ootdEditNote, setOotdEditNote] = useState('');
  const [ootdEditPhotoFile, setOotdEditPhotoFile] = useState<File | null>(null);
  const [ootdEditPreview, setOotdEditPreview] = useState('');
  const [ootdEditProductIds, setOotdEditProductIds] = useState<string[]>([]);
  const [ootdEditSaving, setOotdEditSaving] = useState(false);
  const [ootdPickerOpen, setOotdPickerOpen] = useState(false);
  const [ootdPickerSearch, setOotdPickerSearch] = useState('');
  const [ootdPickerDomain, setOotdPickerDomain] = useState<string | null>(null);
  function openOotdEdit(log: OOTDLog) {
    setEditingOotd(log);
    setOotdEditCategory(log.category || log.theme || '');
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
      const photoUrl = ootdEditPreview; // ImagePicker가 base64로 세팅, 변경 없으면 기존 URL 유지
      await updateDoc(doc(db, 'users', userId, 'ootdLogs', editingOotd.id), {
        category: ootdEditCategory,
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
    const tab = searchParams.get('tab') as '라이브러리' | '수집' | null;
    const filter = searchParams.get('filter');
    const id = searchParams.get('id');
    if (tab === '라이브러리' || tab === '수집') setMainTab(tab);
    if (filter) setArchiveFilter(filter);
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
  const [refToLibCatName, setRefToLibCatName] = useState<string>('Life tip');
  const [refToLibTipCategory, setRefToLibTipCategory] = useState('');
  const [refToLibEmoji, setRefToLibEmoji] = useState('');
  const [refToLibSaving, setRefToLibSaving] = useState(false);
  const [libCatEditOpen, setLibCatEditOpen] = useState(false);
  // 캐시 미리보기 시트 — cachedLibrary가 있는 수집 아이템 재등록 시
  const [refCachePreview, setRefCachePreview] = useState<Reference | null>(null);
  // 등록 시트에서 사용할 캐시 데이터 (수정 후 등록 시 tags/memo/productIds 재활용)
  const [refToLibCacheData, setRefToLibCacheData] = useState<CachedLibrary | null>(null);
  // 등록 시트 편집 필드 (처음 등록 / 수정 후 등록 공통)
  const [refToLibEditName, setRefToLibEditName] = useState('');
  const [refToLibEditUrl, setRefToLibEditUrl] = useState('');
  const [refToLibEditMemo, setRefToLibEditMemo] = useState('');
  const [refToLibEditImageFile, setRefToLibEditImageFile] = useState<File | null>(null);
  const [refToLibEditImagePreview, setRefToLibEditImagePreview] = useState('');
  // 도메인별 add/edit 트리거 (동적 패널 지원)
  const [domainAddTrigger, setDomainAddTrigger] = useState<Record<string, number>>({});
  const [domainEditTrigger, setDomainEditTrigger] = useState<Record<string, { id: string; ts: number } | undefined>>({});
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [addSheetOpen, setAddSheetOpen] = useState(false);

  function triggerCollectionEdit(item: CtItem) {
    const domain = item.domain ?? (item.ctType === 'makeup' ? 'beauty' : 'fashion');
    setDomainEditTrigger(prev => ({ ...prev, [domain]: { id: item.id, ts: Date.now() } }));
  }

  // CtPanel CRUD — 신규 아이템은 libraryItems에 저장, 기존 아이템은 원래 컬렉션 유지
  async function handleCtAdd(_domain: string, data: Omit<CtItem, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
    if (!db) return '';
    const now = new Date().toISOString();
    const ref = await addDoc(collection(db, 'users', userId, 'libraryItems'), { ...data, createdAt: now, updatedAt: now });
    return ref.id;
  }
  async function handleCtUpdate(_domain: string, id: string, data: Partial<Omit<CtItem, 'id'>>) {
    if (!db) return;
    const colName = itemCollectionMap.get(id) ?? 'libraryItems';
    await updateDoc(doc(db, 'users', userId, colName, id), data);
  }
  async function handleCtDelete(_domain: string, id: string) {
    if (!db) return;
    const colName = itemCollectionMap.get(id) ?? 'libraryItems';
    await deleteDoc(doc(db, 'users', userId, colName, id));
  }

  // ── 수동 완료 토글 공통 헬퍼: 날짜 + 슬롯에 맞는 제품 목록 로그 저장 ──
  async function saveManualLogs(_db: Firestore, timeSlot: 'morning' | 'evening', dateStr: string) {
    const logsRef = collection(_db, 'users', userId, 'usageLogs');
    const loggedAt = new Date(dateStr + (timeSlot === 'morning' ? 'T09:00:00' : 'T21:00:00')).toISOString();

    // 해당 날짜에 활성 세션 찾기 (startDate ≤ dateStr ≤ endDate)
    const session = sessions.find(s => s.startDate <= dateStr && s.endDate >= dateStr);

    if (!session) {
      // 세션 없으면 완료 마커만 저장
      await addDoc(logsRef, { timeSlot, dateStr, loggedAt, type: 'manual' });
      return;
    }

    // DAY 인덱스 계산
    const slot = timeSlot === 'morning' ? session.morning : session.evening;
    const dayCount = slot?.days?.length || 1;
    const diff = Math.max(0, Math.floor(
      (new Date(dateStr).getTime() - new Date(session.startDate).getTime()) / 86400000
    ));
    const dayIdx = diff % dayCount;
    const day = slot?.days?.[dayIdx] ?? slot?.days?.[0];

    const productItems = (day?.items ?? []).filter(
      (i): i is { type: 'product'; id: string } => i.type === 'product'
    );

    if (productItems.length === 0) {
      // 제품 없는 슬롯: 완료 마커만 저장
      await addDoc(logsRef, { routineId: session.id, timeSlot, dateStr, loggedAt, type: 'manual' });
    } else {
      // 각 제품별로 로그 저장
      await Promise.all(productItems.map(item => addDoc(logsRef, {
        routineId: session.id,
        productId: item.id,
        amount: 0,
        type: 'manual',
        timeSlot,
        dateStr,
        loggedAt,
      })));
    }
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
      await saveManualLogs(_db, 'morning', dateStr);
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
      await saveManualLogs(_db, 'evening', dateStr);
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
    const hasContent = trimmedUrl || trimmedTitle || refImagePreview;
    if (!hasContent || !db || !userId) return;
    setRefSaving(true);
    // 낙관적 UI — 폼 즉시 초기화 (Firestore 응답 기다리지 않음)
    const snapshotUrl = trimmedUrl;
    const snapshotTitle = trimmedTitle;
    const snapshotNote = refNote.trim();
    // 카테고리 미선택 시 첫 번째 카테고리(Life tip)로 자동 설정
    const hasCategorySelected = refTags.some(t => categoryTags.includes(t));
    const snapshotTags = hasCategorySelected ? [...refTags] : [categoryTags[0] ?? 'Life tip', ...refTags];
    const snapshotImageFile = refImageFile;
    const snapshotImagePreview = refImagePreview;
    setRefUrl('');
    setRefTitle('');
    setRefNote('');
    setRefTags([]);
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
        ...(snapshotNote ? { note: snapshotNote } : {}),
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

  // categoryTags가 바뀌면 localStorage에 저장
  useEffect(() => {
    try { localStorage.setItem('onstep_category_tags', JSON.stringify(categoryTags)); } catch {}
  }, [categoryTags]);

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
    setRefEditNote(ref.note || '');
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
        note: refEditNote.trim(),
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
      // 새 이미지 파일이 선택된 경우 base64 변환, 아니면 입력된 URL 사용
      const finalImageUrl = refToLibEditImageFile
        ? await imageFileToBase64(refToLibEditImageFile)
        : refToLibEditImagePreview;
      const finalName = refToLibEditName.trim() || refToLib.title || refToLib.url || '새 아이템';
      const finalUrl = refToLibEditUrl.trim() || refToLib.url || '';
      const finalMemo = refToLibEditMemo.trim();

      let libraryItemId = '';
      if (refToLibType === 'lifetip') {
        const category = refToLibTipCategory.trim() || refToLibCatName || 'Life tip';
        const emoji = refToLibEmoji.trim() || getLifetipEmoji(category);
        const newRef = await addDoc(collection(db, 'users', userId, 'lifetipItems'), {
          name: finalName,
          emoji,
          imageUrl: finalImageUrl,
          sourceUrl: finalUrl,
          tipCategory: category,
          tags: refToLibCacheData?.tags ?? [],
          memo: finalMemo || refToLibCacheData?.memo || '',
          productIds: refToLibCacheData?.productIds ?? [],
          published: false,
          dates: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } satisfies Omit<LifetipItem, 'id'>);
        libraryItemId = newRef.id;
      } else {
        const colName = refToLibType === 'makeup' ? 'makeupItems' : 'lookItems';
        const newRef = await addDoc(collection(db, 'users', userId, colName), {
          ctType: refToLibType,
          name: finalName,
          emoji: refToLibType === 'makeup' ? '💄' : '👗',
          imageUrl: finalImageUrl,
          items: [],
          published: false,
          dates: [],
          sourceUrl: finalUrl,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        libraryItemId = newRef.id;
      }
      // 수집 문서 업데이트: 라이브러리 등록 완료 + 편집된 기본 정보도 반영
      // tipTag(태그 필드값)를 reference.tags에 포함 → 카드 메모 하단에 노출
      const tipTag = refToLibTipCategory.trim();
      const updatedRefTags = [
        refToLibCatName,
        ...(tipTag ? [tipTag] : []),
        ...(refToLib.tags ?? []).filter(t => !categoryTags.includes(t) && t !== tipTag),
      ];
      await updateDoc(doc(db, 'users', userId, 'references', refToLib.id), {
        inLibrary: true,
        libraryItemId,
        libraryItemType: refToLibType,
        tags: updatedRefTags,
        title: finalName,
        url: finalUrl,
        imageUrl: finalImageUrl,
      });
      setRefToLib(null);
      setRefToLibCacheData(null);
      setRefToLibEditName('');
      setRefToLibEditUrl('');
      setRefToLibEditMemo('');
      setRefToLibEditImageFile(null);
      setRefToLibEditImagePreview('');
    } catch (err) {
      console.error('[OnStep] refToLib 저장 실패:', err);
    } finally {
      setRefToLibSaving(false);
    }
  }

  // ── 라이브러리 해지 (LIB OFF) ──
  async function removeFromLibrary(ref: Reference) {
    if (!db || !userId) return;
    const _db = db;
    try {
      // Life TIP이면 해지 전에 현재 데이터를 cachedLibrary로 저장
      let cachedLibrary: CachedLibrary | undefined;
      if (ref.libraryItemId && ref.libraryItemType === 'lifetip') {
        const item = lifetipItems.find(i => i.id === ref.libraryItemId);
        if (item) {
          cachedLibrary = {
            name: item.name,
            emoji: item.emoji,
            tipCategory: item.tipCategory,
            sourceUrl: item.sourceUrl || '',
            imageUrl: item.imageUrl || '',
            tags: item.tags ?? [],
            memo: item.memo || '',
            productIds: item.productIds ?? [],
          };
        }
      }

      if (ref.libraryItemId && ref.libraryItemType) {
        // ① 신규 방식: libraryItemId로 직접 삭제
        const colName = ref.libraryItemType === 'makeup' ? 'makeupItems'
                       : ref.libraryItemType === 'lookbook' ? 'lookItems'
                       : 'lifetipItems';
        await deleteDoc(doc(_db, 'users', userId, colName, ref.libraryItemId));
      } else if (ref.url) {
        // ② 구버전 호환: sourceUrl이 일치하는 라이브러리 아이템 전체 삭제
        const colNames = ['makeupItems', 'lookItems', 'lifetipItems'] as const;
        await Promise.all(colNames.map(async (colName) => {
          const snap = await getDocs(query(
            collection(_db, 'users', userId, colName),
            where('sourceUrl', '==', ref.url)
          ));
          await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
        }));
      }

      // 수집 문서 업데이트 — 해제 + 캐시 저장 + 제목/이미지를 라이브러리 편집값으로 갱신
      await updateDoc(doc(_db, 'users', userId, 'references', ref.id), {
        inLibrary: false,
        libraryItemId: null,
        libraryItemType: null,
        ...(cachedLibrary && {
          title: cachedLibrary.name || ref.title,
          imageUrl: cachedLibrary.imageUrl || ref.imageUrl,
          cachedLibrary,
        }),
      });
    } catch (err) {
      console.error('[OnStep] 라이브러리 해지 실패:', err);
    }
  }

  // ── Life TIP Today ON/OFF 토글 ──
  async function toggleLifetipToday(item: import('@/types/lifetip').LifetipItem) {
    if (!db || !userId) return;
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    const dates = item.dates ?? [];
    const isOn = item.published && dates.includes(todayStr);
    const newDates = isOn ? dates.filter(d => d !== todayStr) : [...new Set([...dates, todayStr])].sort();
    await updateDoc(doc(db, 'users', userId, 'lifetipItems', item.id), {
      published: newDates.length > 0,
      dates: newDates,
      updatedAt: new Date().toISOString(),
    });
  }

  // ── Life TIP 편집 시트 ──
  function openLifetipEdit(item: import('@/types/lifetip').LifetipItem) {
    setEditingLifetip(item);
    setLifetipEditName(item.name);
    setLifetipEditEmoji(item.emoji || getLifetipEmoji(item.tipCategory));
    setLifetipEditCategory(item.tipCategory || '');

    // 카테고리 레이블: 연결된 수집 reference에서 Life tip / Makeup / Lookbook 조회
    const linkedRef = references.find(r => r.libraryItemId === item.id);
    const catLabel = linkedRef
      ? (linkedRef.tags ?? []).find(t => categoryTags.includes(t)) ?? 'Life tip'
      : 'Life tip';
    setLifetipEditCategoryLabel(catLabel);

    setLifetipEditUrl(item.sourceUrl || '');
    setLifetipEditProductIds(item.productIds ?? []);
    setLifetipEditImageFile(null);
    setLifetipEditImagePreview(item.imageUrl ?? '');
    setLifetipEditMemo(item.memo || '');
    // tipCategory(등록 시 태그) + tags 를 하나의 편집 리스트로 합침
    const mergedTags = [...new Set([
      ...(item.tipCategory ? [item.tipCategory] : []),
      ...(item.tags ?? []),
    ])];
    setLifetipEditTags(mergedTags);
    setLifetipEditPublished(item.published);
    setLifetipEditDates(item.dates ?? []);
    setLifetipTagEditOpen(false);
    setLifetipTagNewTag('');
    setLifetipPickerSearch('');
    setLifetipPickerDomain(null);
  }

  async function saveLifetipEdit() {
    if (!editingLifetip || !db || !userId) return;
    setLifetipEditSaving(true);
    try {
      const imageUrl = lifetipEditImageFile
        ? await imageFileToBase64(lifetipEditImageFile)
        : lifetipEditImagePreview;
      // tipCategory: 태그 리스트 첫 번째 값 (라이브러리 내부 필터링용)
      const newTipCategory = lifetipEditTags[0] || editingLifetip.tipCategory;
      await updateDoc(doc(db, 'users', userId, 'lifetipItems', editingLifetip.id), {
        name: lifetipEditName.trim() || editingLifetip.name,
        emoji: lifetipEditEmoji.trim() || editingLifetip.emoji,
        tipCategory: newTipCategory,
        sourceUrl: lifetipEditUrl.trim(),
        productIds: lifetipEditProductIds,
        memo: lifetipEditMemo.trim(),
        tags: lifetipEditTags,
        published: lifetipEditPublished,
        dates: lifetipEditDates,
        imageUrl,
        updatedAt: new Date().toISOString(),
      });
      // 수집 문서 실시간 동기화 — 카테고리 태그 유지, 나머지를 lifetipEditTags로 교체
      const linkedRef = references.find(r => r.libraryItemId === editingLifetip.id);
      if (linkedRef) {
        const catTags = (linkedRef.tags ?? []).filter(t => categoryTags.includes(t));
        await updateDoc(doc(db, 'users', userId, 'references', linkedRef.id), {
          tags: [...catTags, ...lifetipEditTags],
        });
      }
      setEditingLifetip(null);
    } catch (err) {
      console.error('[OnStep] Life TIP 편집 저장 실패:', err);
    } finally {
      setLifetipEditSaving(false);
    }
  }

  async function deleteLifetipEdit() {
    if (!editingLifetip || !db || !userId) return;
    if (!confirm('이 Life TIP을 삭제할까요?')) return;
    try {
      await deleteDoc(doc(db, 'users', userId, 'lifetipItems', editingLifetip.id));
      setEditingLifetip(null);
    } catch (err) {
      console.error('[OnStep] Life TIP 삭제 실패:', err);
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

        {/* 탭 바 — 기록 / 라이브러리 / 수집 */}
        <div style={{ display: 'flex', gap: 0, height: 46, alignItems: 'stretch', background: 'rgba(250,250,248,.96)', backdropFilter: 'blur(8px)', borderBottom: '1px solid rgba(12,12,10,.07)', margin: '16px 0 0', padding: '0 16px' }}>
          {(['기록', '라이브러리', '수집'] as const).map((t) => (
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
                <div style={{ margin: '0 16px 16px', background: 'linear-gradient(135deg,#EFF9DC,#E6F5C2)', borderRadius: 16, padding: '14px 16px', border: '1px solid rgba(74,119,0,.12)' }}>
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
            <div style={{ height: 1, background: 'rgba(12,12,10,.07)', margin: '16px 16px 0' }} />
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
                    <div style={{ margin: '12px 16px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
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
          // 삭제된 카테고리가 refFilter에 남아있으면 'all'로 폴백
          const activeFilter = (refFilter === 'all' || categoryTags.includes(refFilter)) ? refFilter : 'all';
          const filtered = activeFilter === 'all'
            ? references
            : references.filter(r => (r.tags ?? []).includes(activeFilter));

          const sortedFiltered = (() => {
            const list = [...filtered];
            if (refSort === 'category') return list.sort((a, b) => {
              const getOrder = (r: Reference) => {
                const tags = r.tags ?? [];
                for (let i = 0; i < categoryTags.length; i++) {
                  if (tags.includes(categoryTags[i])) return i;
                }
                return categoryTags.length;
              };
              const oa = getOrder(a), ob = getOrder(b);
              if (oa !== ob) return oa - ob;
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

                    {/* 상단 행: 플랫폼 뱃지(좌) + 카테고리 칩(우) — 블랙 배경 라임 폰트 */}
                    {(() => {
                      const catChips = (ref.tags ?? []).filter(t => categoryTags.includes(t));
                      return (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0, height: 18, padding: '0 7px', borderRadius: 9999, background: `${pColor}18` }}>
                            <span style={{ fontSize: 9 }}>{PLATFORM_ICON[platform]}</span>
                            <span style={{ fontFamily: f, fontSize: 9, fontWeight: 800, color: pColor, letterSpacing: '.06em', textTransform: 'uppercase' as const }}>
                              {PLATFORM_LABEL[platform]}
                            </span>
                          </div>
                          {catChips.length > 0 && (
                            <div style={{ display: 'flex', gap: 3, overflow: 'hidden', flexShrink: 1 }}>
                              {catChips.slice(0, 2).map(tag => (
                                <span key={tag} style={{ fontFamily: f, fontSize: 9, fontWeight: 800, color: '#C5FF00', background: '#0C0C0A', padding: '2px 7px', borderRadius: 9999, letterSpacing: '.03em', whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 70 }}>
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* 제목 */}
                    <div style={{ fontFamily: f, fontSize: 15, fontWeight: 700, color: '#0C0C0A', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const, overflow: 'hidden' }}>
                      {ref.title || ref.url || '제목 없음'}
                    </div>

                    {/* 메모 */}
                    {ref.note && (
                      <div style={{ fontFamily: f, fontSize: 11, color: '#1D6DDB', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                        {ref.note}
                      </div>
                    )}

                    {/* 태그 — 메모 하단, "#" 접두사 + 연한 회색 배경 */}
                    {(() => {
                      const userTags = (ref.tags ?? []).filter(t => !categoryTags.includes(t));
                      return userTags.length > 0 ? (
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' as const }}>
                          {userTags.map(tag => (
                            <span key={tag} style={{ fontFamily: f, fontSize: 10, fontWeight: 700, color: '#555250', background: 'rgba(12,12,10,.07)', padding: '2px 8px', borderRadius: 9999, letterSpacing: '.02em' }}>
                              #{tag}
                            </span>
                          ))}
                        </div>
                      ) : null;
                    })()}
                  </div>
                </div>

                {/* ── 구분선 ── */}
                <div style={{ height: 1, background: 'rgba(12,12,10,.06)', margin: '0 12px' }} />

                {/* ── 액션 바 ── */}
                <div style={{ display: 'flex', alignItems: 'stretch', padding: '8px 10px 10px', gap: 6 }}>

                  {/* ← 좌측: 라이브러리 등록/해지 토글 */}
                  <button
                    type="button"
                    onClick={() => {
                      if (ref.inLibrary) {
                        // LIB ON → 해지
                        removeFromLibrary(ref);
                      } else if (ref.cachedLibrary) {
                        // 이전 자료 있음 → 미리보기 시트
                        setRefCachePreview(ref);
                      } else {
                        // 처음 등록 → 일반 등록 시트
                        setRefToLib(ref);
                        setRefToLibCacheData(null);
                        setLibCatEditOpen(false);
                        setRefToLibEditName(ref.title || '');
                        setRefToLibEditUrl(ref.url || '');
                        setRefToLibEditMemo('');
                        setRefToLibEditImageFile(null);
                        setRefToLibEditImagePreview(ref.imageUrl || '');
                        const tags = ref.tags ?? [];
                        const firstCat = categoryTags.find(c => tags.includes(c)) ?? categoryTags[0] ?? 'Life tip';
                        setRefToLibCatName(firstCat);
                        const libType = firstCat === 'Lookbook' ? 'lookbook' : firstCat === 'Makeup' ? 'makeup' : 'lifetip';
                        setRefToLibType(libType);
                        setRefToLibTipCategory(libType === 'lifetip' && firstCat !== 'Life tip' ? firstCat : '');
                        setRefToLibEmoji('');
                      }
                    }}
                    style={{
                      flex: 1, height: 42, borderRadius: 8,
                      background: ref.inLibrary ? '#0C0C0A' : ref.cachedLibrary ? 'rgba(29,109,219,.1)' : 'rgba(12,12,10,.06)',
                      border: `1px solid ${ref.inLibrary ? 'transparent' : ref.cachedLibrary ? 'rgba(29,109,219,.3)' : 'rgba(12,12,10,.1)'}`,
                      fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.06em',
                      color: ref.inLibrary ? '#C5FF00' : ref.cachedLibrary ? '#1D6DDB' : '#9A9490',
                      cursor: 'pointer', transition: 'all .15s', textTransform: 'uppercase' as const,
                    }}
                  >
                    {ref.inLibrary ? 'LIB ON ✓' : ref.cachedLibrary ? '📦 RE-ADD' : 'LIB OFF'}
                  </button>

                  {/* → 우측: 링크공유 + (편집 — LIB ON 중엔 숨김) + 삭제 */}
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

                    {/* 편집 — LIB ON 중엔 숨김 (라이브러리에서 편집) */}
                    {!ref.inLibrary && (
                      <button type="button" onClick={() => openRefEdit(ref)} aria-label="편집"
                        style={{ flex: 1, height: 42, borderRadius: 10, background: '#F5F4F2', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                          <path d="M11 2l3 3-9 9H2v-3L11 2z" stroke="#44474A" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </button>
                    )}

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
              <div style={{ margin: '0 16px 16px', background: '#FAFAF8', borderRadius: 16, padding: '16px 16px 20px', border: '1px solid rgba(12,12,10,.08)' }}>

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

                {/* 카테고리 + 편집 */}
                <div style={{ marginBottom: 14 }}>
                  {/* 레이블 행 */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase' as const, color: '#9A9490' }}>카테고리</div>
                    <button type="button"
                      onClick={() => { setCatEditOpen(v => !v); if (catEditOpen) setCatNewTag(''); }}
                      style={{ height: 24, padding: '0 10px', borderRadius: 9999, border: 'none', background: '#0C0C0A', fontFamily: f, fontSize: 10, fontWeight: 800, color: '#C5FF00', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, letterSpacing: '.04em' }}>
                      <svg width="9" height="9" viewBox="0 0 12 12" fill="none"><path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                      카테고리 편집
                    </button>
                  </div>

                  {/* 라이브러리 카테고리 — 동적, 항상 노출 */}
                  <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' as const, marginBottom: 8 }}>
                    {categoryTags.map((cat, i) => {
                      const color = CAT_COLORS[i % CAT_COLORS.length];
                      const sel = refTags.includes(cat);
                      return (
                        <button key={cat} type="button"
                          onClick={() => setRefTags(prev => sel ? prev.filter(t => t !== cat) : [...prev.filter(t => !categoryTags.includes(t)), cat])}
                          style={{ flex: 1, minWidth: 0, height: 36, borderRadius: 10, border: `1.5px solid ${sel ? color.selBorder : 'rgba(12,12,10,.12)'}`, background: sel ? color.selBg : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, cursor: 'pointer', transition: 'all .15s' }}>
                          <span style={{ fontFamily: f, fontSize: 11, fontWeight: 700, color: sel ? color.selText : '#9A9490' }}>{cat}</span>
                        </button>
                      );
                    })}
                  </div>

                  {/* 카테고리 편집 패널 — catEditOpen 시 노출 */}
                  {catEditOpen && (
                    <div style={{ marginTop: 8, padding: '10px 12px 12px', borderRadius: 10, background: 'rgba(12,12,10,.03)', border: '1px solid rgba(12,12,10,.1)' }}>
                      <span style={{ fontFamily: f, fontSize: 10, fontWeight: 700, color: '#BCBAB6', letterSpacing: '.06em', textTransform: 'uppercase' as const, display: 'block', marginBottom: 8 }}>드래그로 순서 변경</span>
                      <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 5, marginBottom: 8 }}>
                        {categoryTags.map((cat, i) => (
                          <div key={cat}
                            draggable
                            onDragStart={() => setDragCatIdx(i)}
                            onDragOver={e => { e.preventDefault(); setDragCatOverIdx(i); }}
                            onDrop={() => {
                              if (dragCatIdx === null || dragCatIdx === i) return;
                              setCategoryTags(prev => {
                                const arr = [...prev];
                                const [item] = arr.splice(dragCatIdx, 1);
                                arr.splice(i, 0, item);
                                return arr;
                              });
                              setDragCatIdx(null); setDragCatOverIdx(null);
                            }}
                            onDragEnd={() => { setDragCatIdx(null); setDragCatOverIdx(null); }}
                            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 8, background: dragCatOverIdx === i ? 'rgba(12,12,10,.07)' : 'rgba(12,12,10,.03)', border: `1px solid ${dragCatOverIdx === i ? 'rgba(12,12,10,.2)' : 'rgba(12,12,10,.08)'}`, cursor: 'grab', transition: 'all .1s' }}>
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0, color: '#BCBAB6' }}><circle cx="4" cy="3" r="1" fill="currentColor"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="9" r="1" fill="currentColor"/><circle cx="8" cy="3" r="1" fill="currentColor"/><circle cx="8" cy="6" r="1" fill="currentColor"/><circle cx="8" cy="9" r="1" fill="currentColor"/></svg>
                            <span style={{ width: 8, height: 8, borderRadius: 9999, background: CAT_COLORS[i % CAT_COLORS.length].selBorder, display: 'inline-block', flexShrink: 0 }} />
                            <span style={{ fontFamily: f, fontSize: 12, fontWeight: 600, color: '#0C0C0A', flex: 1 }}>{cat}</span>
                            <button type="button" title="삭제"
                              onClick={() => { setCategoryTags(prev => prev.filter(t => t !== cat)); setRefTags(prev => prev.filter(t => t !== cat)); }}
                              style={{ width: 20, height: 20, borderRadius: 9999, background: 'rgba(220,50,50,.1)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, color: '#C0392B', flexShrink: 0 }}>
                              <svg width="7" height="7" viewBox="0 0 7 7" fill="none"><path d="M1 1l5 5M6 1L1 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
                            </button>
                          </div>
                        ))}
                      </div>
                      <input type="text" value={catNewTag}
                        onChange={e => setCatNewTag(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                            const t = catNewTag.trim();
                            if (t && !categoryTags.includes(t)) setCategoryTags(prev => [...prev, t]);
                            setCatNewTag('');
                          }
                        }}
                        placeholder="+ 카테고리 추가 (Enter)"
                        style={{ width: '100%', height: 32, padding: '0 10px', borderRadius: 8, border: '1.5px dashed rgba(12,12,10,.25)', background: 'transparent', fontFamily: f, fontSize: 11, color: '#0C0C0A', outline: 'none', boxSizing: 'border-box' as const }}
                      />
                    </div>
                  )}
                </div>

                {/* 메모 */}
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase' as const, color: '#9A9490', marginBottom: 8 }}>메모</div>
                  <textarea
                    value={refNote}
                    onChange={e => setRefNote(e.target.value)}
                    placeholder="메모 입력 (선택)..."
                    rows={2}
                    style={{ width: '100%', boxSizing: 'border-box' as const, padding: '10px 14px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 10, background: '#fff', fontFamily: f, fontSize: 13, color: '#0C0C0A', outline: 'none', resize: 'none', lineHeight: 1.5 }}
                  />
                </div>

                {/* 버튼 */}
                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    type="button"
                    onClick={() => { setRefUrl(''); setRefTitle(''); setRefNote(''); setRefTags([]); setRefImageFile(null); setRefImagePreview(''); }}
                    style={{ flex: 1, height: 48, background: '#fff', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 12, fontFamily: f, fontSize: 13, fontWeight: 700, color: '#9A9490', cursor: 'pointer' }}
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    onClick={saveReference}
                    disabled={(!refUrl.trim() && !refTitle.trim() && !refImagePreview) || refSaving}
                    style={{ flex: 1, height: 48, background: (refUrl.trim() || refTitle.trim() || refImagePreview) ? '#0C0C0A' : '#E5E4E2', border: 'none', borderRadius: 12, fontFamily: f, fontSize: 13, fontWeight: 700, color: (refUrl.trim() || refTitle.trim() || refImagePreview) ? '#fff' : '#9A9490', cursor: (refUrl.trim() || refTitle.trim() || refImagePreview) ? 'pointer' : 'default', transition: 'all .15s', opacity: refSaving ? 0.6 : 1 }}
                  >
                    {refSaving ? '저장 중...' : '수집'}
                  </button>
                </div>
              </div>

              {/* 정렬 버튼 */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4, padding: '0 16px 10px' }}>
                {(['date_desc', 'category'] as const).map(s => (
                  <button key={s} type="button"
                    onClick={() => { setRefSort(s); setRefVisibleCount(10); }}
                    style={{ height: 28, padding: '0 12px', borderRadius: 9999, border: `1.5px solid ${refSort === s ? 'rgba(12,12,10,.3)' : 'rgba(12,12,10,.14)'}`, background: refSort === s ? '#0C0C0A' : 'transparent', fontFamily: f, fontSize: 11, fontWeight: 700, color: refSort === s ? '#fff' : '#9A9490', cursor: 'pointer', transition: 'all .15s' }}>
                    {s === 'date_desc' ? '최신순' : '카테고리순'}
                  </button>
                ))}
              </div>

              {/* 카테고리 필터 바 — categoryTags 기반 실시간 반영 */}
              <div style={{ display: 'flex', gap: 6, padding: '0 16px 14px', overflowX: 'auto', scrollbarWidth: 'none' as const }}>
                {(['all', ...categoryTags]).map((tag, i) => {
                  const active = activeFilter === tag;
                  const count = tag === 'all' ? references.length : references.filter(r => (r.tags ?? []).includes(tag)).length;
                  const color = tag !== 'all' ? CAT_COLORS[(i - 1) % CAT_COLORS.length] : null;
                  return (
                    <button key={tag}
                      onClick={() => { setRefFilter(tag); setRefVisibleCount(10); }}
                      style={{
                        flexShrink: 0, height: 28, padding: '0 12px', borderRadius: 9999,
                        border: active
                          ? `1.5px solid ${tag === 'all' ? 'rgba(12,12,10,.4)' : color!.selBorder}`
                          : '1.5px solid rgba(12,12,10,.14)',
                        background: active
                          ? (tag === 'all' ? '#0C0C0A' : color!.selBg)
                          : 'transparent',
                        fontFamily: f, fontSize: 11, fontWeight: 700,
                        color: active ? (tag === 'all' ? '#fff' : color!.selText) : '#9A9490',
                        cursor: 'pointer', transition: 'all .15s', whiteSpace: 'nowrap' as const,
                      }}>
                      {tag === 'all' ? `ALL (${count})` : `${tag} (${count})`}
                    </button>
                  );
                })}
              </div>

              {/* 레퍼런스 목록 */}
              {sortedFiltered.length === 0 ? (
                <div style={{ padding: '48px 16px', textAlign: 'center' }}>
                  <div style={{ fontSize: 32, marginBottom: 12 }}>🔗</div>
                  <div style={{ fontFamily: f, fontSize: 14, fontWeight: 700, color: '#0C0C0A', marginBottom: 6 }}>
                    {activeFilter === 'all' ? '아직 수집한 항목이 없어요' : `${activeFilter} 항목이 없어요`}
                  </div>
                  <div style={{ fontFamily: f, fontSize: 12, color: '#9A9490' }}>
                    이미지, 링크, 제목 중 하나만 있어도 저장할 수 있어요
                  </div>
                </div>
              ) : (
                <div style={{ padding: '0 16px' }}>
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
                  {/* 카테고리순 — categoryTags 순서로 그루핑 */}
                  {refSort === 'category' && (() => {
                    const groups = [
                      ...categoryTags.map((cat, i) => ({
                        label: cat, colorIdx: i,
                        items: visibleRefs.filter(r => (r.tags ?? []).includes(cat)),
                      })),
                      {
                        label: '미분류', colorIdx: -1,
                        items: visibleRefs.filter(r => !(r.tags ?? []).some(t => categoryTags.includes(t))),
                      },
                    ].filter(g => g.items.length > 0);
                    return groups.map(({ label, colorIdx, items }) => {
                      const color = colorIdx >= 0 ? CAT_COLORS[colorIdx % CAT_COLORS.length] : null;
                      return (
                        <div key={label} style={{ marginBottom: 24 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                            <span style={{
                              fontFamily: f, fontSize: 11, fontWeight: 800,
                              color: color ? color.selText : '#9A9490',
                              background: color ? color.selBg : 'rgba(12,12,10,.06)',
                              border: `1px solid ${color ? color.selBorder : 'rgba(12,12,10,.12)'}`,
                              padding: '3px 10px', borderRadius: 9999,
                            }}>{label}</span>
                            <span style={{ fontFamily: f, fontSize: 11, fontWeight: 700, color: '#9A9490' }}>{items.length}개</span>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{items.map(renderRef)}</div>
                        </div>
                      );
                    });
                  })()}
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

        {/* ── 라이브러리 탭 — 메이크업·룩북·OOTD·Life TIP CRUD + Today ON ── */}
        {mainTab === '라이브러리' && (
          <div style={{ paddingTop: 16 }}>
            {/* 미니카드 필터 그리드 */}
            {(() => {
              const f = "'Plus Jakarta Sans','Space Grotesk',sans-serif";
              const TAB_COLOR: Record<string, { active: string; bg: string; text: string }> = {
                all:      { active: '#0C0C0A', bg: '#0C0C0A',                text: '#C5FF00' },
                beauty:   { active: '#C5FF00', bg: 'rgba(197,255,0,.14)',   text: '#3A6000' },
                fashion:  { active: '#FF8C42', bg: 'rgba(255,140,66,.14)',  text: '#B85A00' },
                acc:      { active: '#FFD700', bg: 'rgba(255,215,0,.14)',   text: '#7A5A00' },
                interior: { active: '#69DB7C', bg: 'rgba(105,219,124,.14)', text: '#1E6B30' },
                lifetip:  { active: '#60A5FA', bg: 'rgba(96,165,250,.14)', text: '#1D6DDB' },
                ootd:     { active: '#C5FF00', bg: 'rgba(197,255,0,.14)',   text: '#3A6000' },
              };
              // allLibItems에서 실제 존재하는 도메인 목록 (순서: beauty → fashion → acc → interior → 기타)
              const DOMAIN_ORDER = ['beauty', 'fashion', 'acc', 'interior'];
              const existingDomains = [...new Set(allLibItems.map(i => i.domain ?? 'beauty'))];
              const sortedDomains = [
                ...DOMAIN_ORDER.filter(d => existingDomains.includes(d)),
                ...existingDomains.filter(d => !DOMAIN_ORDER.includes(d)),
              ];
              const domainSubCards = sortedDomains.map(d => ({
                key: d,
                label: `${DOMAIN_EMOJIS[d] ?? '📦'} ${DOMAIN_LABELS[d] ?? d}`,
                count: allLibItems.filter(i => (i.domain ?? 'beauty') === d).length,
              }));
              const subCards = [
                ...domainSubCards,
                { key: 'lifetip',  label: '📌 Life TIP', count: lifetipItems.length },
                { key: 'ootd',     label: '👗 OOTD',    count: ootdLogs.length },
              ];
              const totalCount = allLibItems.length + lifetipItems.length + ootdLogs.length;
              const selAll = archiveFilter === 'all';
              const colAll = TAB_COLOR.all;
              return (
                <div style={{ padding: '0 16px', marginBottom: 18 }}>
                  {/* ALL — 전체 너비 카드 */}
                  <button type="button" onClick={() => { setArchiveFilter('all'); setLifetipCategory(null); setDomainTagFilter(null); }}
                    style={{ width: '100%', padding: '12px 18px', marginBottom: 8, borderRadius: 14,
                      border: `1.5px solid ${selAll ? colAll.active : 'rgba(12,12,10,.1)'}`,
                      background: selAll ? colAll.bg : '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      cursor: 'pointer', transition: 'all .15s', boxSizing: 'border-box' as const }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                      <span style={{ fontFamily: f, fontSize: 11, fontWeight: 700, color: selAll ? '#fff' : '#9A9490', letterSpacing: '.08em' }}>ALL</span>
                      <span style={{ fontFamily: f, fontSize: 11, fontWeight: 600, color: selAll ? 'rgba(255,255,255,.6)' : '#BCBAB6' }}>전체 라이브러리</span>
                    </div>
                    <span style={{ fontFamily: f, fontSize: 32, fontWeight: 900, lineHeight: 1, color: selAll ? colAll.text : '#0C0C0A' }}>{totalCount}</span>
                  </button>
                  {/* 도메인 카드 — 2×N 그리드 (동적 생성) */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    {subCards.map(t => {
                      const sel = archiveFilter === t.key;
                      const col = TAB_COLOR[t.key] ?? TAB_COLOR.beauty;
                      return (
                        <button type="button" key={t.key} onClick={() => { setArchiveFilter(t.key); setLifetipCategory(null); setDomainTagFilter(null); }}
                          style={{ padding: '14px 16px', borderRadius: 14,
                            border: `1.5px solid ${sel ? col.active : 'rgba(12,12,10,.1)'}`,
                            background: sel ? col.bg : '#fff',
                            display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10,
                            cursor: 'pointer', transition: 'all .15s', textAlign: 'left' as const }}>
                          <span style={{ fontSize: 22, lineHeight: 1 }}>{t.label.split(' ')[0]}</span>
                          <div style={{ width: '100%', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
                            <span style={{ fontFamily: f, fontSize: 11, fontWeight: 700, color: sel ? col.text : '#9A9490' }}>{t.label.split(' ').slice(1).join(' ')}</span>
                            <span style={{ fontFamily: f, fontSize: 26, fontWeight: 900, lineHeight: 1, color: sel ? col.text : '#0C0C0A' }}>{t.count}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

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
              const filteredTips = lifetipCategory
                ? (lifetipByCategory2[lifetipCategory] ?? [])
                : lifetipItems;
              return (
                <div style={{ padding: '12px 10px 0px' }}>
                  {lifetipItems.length === 0 ? (
                    <div style={{ padding: '40px 20px', textAlign: 'center', background: '#fff', borderRadius: 16, border: '1px solid rgba(12,12,10,.08)' }}>
                      <div style={{ fontSize: 32, marginBottom: 8 }}>📌</div>
                      <div style={{ fontFamily: f, fontSize: 13, fontWeight: 700, color: '#0C0C0A', marginBottom: 4 }}>Life TIP이 없어요</div>
                      <div style={{ fontFamily: f, fontSize: 12, color: '#9A9490' }}>수집에서 + 라이브러리 버튼으로 추가하세요</div>
                    </div>
                  ) : (
                    <>
                      {/* 카테고리 필터 칩 — 가로 스크롤 */}
                      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 10, scrollbarWidth: 'none' as const }}>
                        <button type="button" onClick={() => setLifetipCategory(null)}
                          style={{ flexShrink: 0, background: lifetipCategory === null ? '#0C0C0A' : '#fff', border: `1px solid ${lifetipCategory === null ? '#0C0C0A' : 'rgba(12,12,10,.15)'}`, borderRadius: 9999, padding: '5px 12px', fontFamily: f, fontSize: 11, fontWeight: 700, color: lifetipCategory === null ? '#fff' : '#0C0C0A', cursor: 'pointer', transition: 'all .15s' }}>
                          전체 {lifetipItems.length}
                        </button>
                        {lifetipCategories2.map(cat => {
                          const items = lifetipByCategory2[cat];
                          const emoji = items[0]?.emoji || getLifetipEmoji(cat);
                          const sel = lifetipCategory === cat;
                          return (
                            <button key={cat} type="button" onClick={() => setLifetipCategory(cat)}
                              style={{ flexShrink: 0, background: sel ? '#0C0C0A' : '#fff', border: `1px solid ${sel ? '#0C0C0A' : 'rgba(12,12,10,.15)'}`, borderRadius: 9999, padding: '5px 12px', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', transition: 'all .15s' }}>
                              <span style={{ fontSize: 12, lineHeight: 1 }}>{emoji}</span>
                              <span style={{ fontFamily: f, fontSize: 11, fontWeight: 700, color: sel ? '#fff' : '#0C0C0A', whiteSpace: 'nowrap' as const }}>{cat}</span>
                              <span style={{ fontFamily: f, fontSize: 10, color: sel ? 'rgba(255,255,255,.5)' : '#BCBAB6' }}>{items.length}</span>
                            </button>
                          );
                        })}
                      </div>
                      {/* 카드 1열 */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {filteredTips.map(item => (
                          <LifetipLibraryCard
                            key={item.id}
                            item={item}
                            products={products}
                            onEdit={() => openLifetipEdit(item)}
                            onToggleToday={() => toggleLifetipToday(item)}
                          />
                        ))}
                      </div>
                    </>
                  )}
                </div>
              );
            })()}

            {/* OOTD 탭 콘텐츠 */}
            {archiveFilter === 'ootd' && (() => {
              const f = "'Plus Jakarta Sans','Space Grotesk',sans-serif";
              return (
                <div style={{ padding: '0 16px 20px' }}>
                  {ootdLogs.length === 0 ? (
                    <div style={{ padding: '40px 20px', textAlign: 'center', background: '#fff', border: '1px solid #000000', borderRadius: 16 }}>
                      <div style={{ fontSize: 28, marginBottom: 8 }}>👗</div>
                      <div style={{ fontFamily: f, fontSize: 13, fontWeight: 700, color: '#0C0C0A', marginBottom: 4 }}>오늘의 룩 기록이 없어요</div>
                      <div style={{ fontFamily: f, fontSize: 12, color: '#9A9490' }}>TODAY 화면에서 기록해보세요</div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {ootdLogs.map(log => {
                        const pIds = log.productIds ?? [];
                        return (
                          <div key={log.id} style={{ border: '1px solid #000000', background: '#FFFFFF' }}>
                            <div style={{ boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', padding: '20px 16px 0px', position: 'relative', width: '100%', isolation: 'isolate' }}>
                              <div style={{ position: 'absolute', right: 7, top: 42, width: 113, height: 32, background: '#C6F432', border: '1px solid #18181B', transform: 'rotate(-3deg)', display: 'flex', alignItems: 'center', padding: '0 12px', zIndex: 3 }}>
                                <span style={{ fontFamily: f, fontSize: 14, fontWeight: 700, color: '#525252', transform: 'rotate(-3deg)' }}>#OOTD</span>
                              </div>
                              {log.photoUrl
                                ? <img src={log.photoUrl} alt={log.category || log.theme} style={{ width: '100%', height: 'auto', display: 'block' }} />
                                : <div style={{ width: '100%', aspectRatio: '4/3', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <span style={{ fontSize: 120, opacity: 0.3, lineHeight: 1 }}>👗</span>
                                  </div>
                              }
                              {(log.category || log.theme) && (
                                <div style={{ width: '100%', display: 'flex', justifyContent: 'flex-end', marginTop: 12, marginBottom: 4 }}>
                                  <span style={{ fontFamily: f, fontSize: 10, fontWeight: 700, color: '#3A6000', background: 'rgba(197,255,0,.25)', border: '1px solid rgba(197,255,0,.6)', padding: '3px 8px', borderRadius: 9999, whiteSpace: 'nowrap' as const }}>{log.category || log.theme}</span>
                                </div>
                              )}
                              <div style={{ fontFamily: f, fontSize: 20, fontWeight: 600, color: '#000', lineHeight: '24px', marginTop: (log.category || log.theme) ? 0 : 12, width: '100%' }}>{log.category || log.theme || '오늘의 룩'}</div>
                              <div style={{ fontFamily: f, fontSize: 14, fontWeight: 400, color: '#525252', lineHeight: '18px', marginTop: 4 }}>{log.date}</div>
                              {log.note ? (
                                <div style={{ fontFamily: f, fontSize: 13, color: '#1D6DDB', lineHeight: '18px', marginTop: 6, marginBottom: 12, width: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{log.note}</div>
                              ) : <div style={{ marginBottom: 12 }} />}
                            </div>
                            {pIds.length > 0 && (
                              <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '12px 8px 8px', borderTop: '1px solid #000000', scrollbarWidth: 'none' as const }}>
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
                            <button onClick={() => openOotdEdit(log)} style={{ width: '100%', padding: '12px 0', background: '#F3F3F1', color: '#0C0C0A', border: 'none', borderTop: '1px solid #000000', fontFamily: f, fontSize: 12, fontWeight: 700, letterSpacing: '.06em', cursor: 'pointer' }}>편집</button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* 아이템 카드 목록 (도메인 탭 / ALL) */}
            {archiveFilter !== 'lifetip' && archiveFilter !== 'ootd' && (() => {
              const f = "'Plus Jakarta Sans','Space Grotesk',sans-serif";
              const todayStr = format(new Date(), 'yyyy-MM-dd');

              // 도메인 필터: 'all'이면 전체, 특정 도메인이면 해당 도메인만
              const domainFiltered = archiveFilter === 'all'
                ? allLibItems
                : allLibItems.filter(i => (i.domain ?? 'beauty') === archiveFilter);

              // 도메인 탭일 때 해당 아이템들의 모든 태그 수집 (태그 칩 생성용)
              const isDomainTab = archiveFilter !== 'all';
              const allTagsInDomain = isDomainTab
                ? [...new Set(domainFiltered.flatMap(i => i.tags ?? []))]
                : [];

              // 태그 필터 적용
              const visibleItems = domainTagFilter
                ? domainFiltered.filter(i => (i.tags ?? []).includes(domainTagFilter))
                : domainFiltered;

              const sortedItems = [...visibleItems].sort((a, b) => {
                const aOn = a.published && (a.dates ?? []).includes(todayStr) ? 1 : 0;
                const bOn = b.published && (b.dates ?? []).includes(todayStr) ? 1 : 0;
                return bOn - aOn;
              });
              if (sortedItems.length === 0 && archiveFilter !== 'all') return (
                <div style={{ padding: '40px 16px', textAlign: 'center', background: '#fff', border: '1px solid #000000', borderRadius: 16, margin: '0 16px' }}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>📁</div>
                  <div style={{ fontFamily: f, fontSize: 13, fontWeight: 700, color: '#0C0C0A', marginBottom: 4 }}>라이브러리가 비어있어요</div>
                  <div style={{ fontFamily: f, fontSize: 12, color: '#9A9490' }}>+ 버튼으로 추가해보세요</div>
                </div>
              );
              return (
                <div style={{ marginTop: 8 }}>
                  {/* 도메인 탭 선택 시 태그 필터 칩 (Life TIP 카테고리 칩과 동일 스타일) */}
                  {isDomainTab && allTagsInDomain.length > 0 && (
                    <div style={{ display: 'flex', gap: 6, overflowX: 'auto', padding: '0 10px 10px', scrollbarWidth: 'none' as const }}>
                      <button type="button" onClick={() => setDomainTagFilter(null)}
                        style={{ flexShrink: 0, background: domainTagFilter === null ? '#0C0C0A' : '#fff', border: `1px solid ${domainTagFilter === null ? '#0C0C0A' : 'rgba(12,12,10,.15)'}`, borderRadius: 9999, padding: '5px 12px', fontFamily: f, fontSize: 11, fontWeight: 700, color: domainTagFilter === null ? '#fff' : '#0C0C0A', cursor: 'pointer', transition: 'all .15s', whiteSpace: 'nowrap' as const }}>
                        전체 {domainFiltered.length}
                      </button>
                      {allTagsInDomain.map(tag => {
                        const count = domainFiltered.filter(i => (i.tags ?? []).includes(tag)).length;
                        const sel = domainTagFilter === tag;
                        return (
                          <button key={tag} type="button" onClick={() => setDomainTagFilter(sel ? null : tag)}
                            style={{ flexShrink: 0, background: sel ? '#0C0C0A' : '#fff', border: `1px solid ${sel ? '#0C0C0A' : 'rgba(12,12,10,.15)'}`, borderRadius: 9999, padding: '5px 12px', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', transition: 'all .15s' }}>
                            <span style={{ fontFamily: f, fontSize: 11, fontWeight: 700, color: sel ? '#fff' : '#0C0C0A', whiteSpace: 'nowrap' as const }}>{tag}</span>
                            <span style={{ fontFamily: f, fontSize: 10, color: sel ? 'rgba(255,255,255,.5)' : '#BCBAB6' }}>{count}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '0 16px 20px' }}>
                    {sortedItems.map(item => {
                      // 도메인 기반 배지 색상
                      const itemDomain = item.domain ?? (item.ctType === 'makeup' ? 'beauty' : 'fashion');
                      const CARD_BADGE_BG: Record<string, string> = { beauty: '#C5FF00', fashion: '#FF8C42', acc: '#FFD700', interior: '#69DB7C' };
                      const CARD_BADGE_TEXT: Record<string, string> = { beauty: '#3A6000', fashion: '#7A3000', acc: '#7A5A00', interior: '#1E6B30' };
                      const CARD_BADGE_LABELS: Record<string, string> = { beauty: '#MAKEUP', fashion: '#LOOKBOOK', acc: '#ACCESSORY', interior: '#INTERIOR' };
                      const badge = CARD_BADGE_LABELS[itemDomain] ?? `#${(DOMAIN_LABELS[itemDomain] ?? itemDomain).toUpperCase()}`;
                      const badgeBg2 = CARD_BADGE_BG[itemDomain] ?? '#C5FF00';
                      const badgeText2 = CARD_BADGE_TEXT[itemDomain] ?? '#3A6000';
                      const isOnToday = item.published && (item.dates ?? []).includes(todayStr);
                      const prodItems = item.items.filter((i): i is { type: 'product'; id: string } => i.type === 'product');
                      return (
                        <div key={item.id} id={`lib-item-${item.id}`} style={{ border: '1px solid #000000', background: '#FFFFFF' }}>
                          {/* 이미지 + 텍스트 영역 */}
                          <div style={{ boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', padding: '20px 16px 0px', position: 'relative', width: '100%', isolation: 'isolate', flexShrink: 0 }}>
                            <div style={{ position: 'absolute', right: 7, top: 42, width: 113, height: 32, background: badgeBg2, border: '1px solid #18181B', transform: 'rotate(-3deg)', display: 'flex', alignItems: 'center', padding: '0 12px', zIndex: 3 }}>
                              <span style={{ fontFamily: f, fontSize: 14, fontWeight: 700, color: badgeText2, transform: 'rotate(-3deg)' }}>{badge}</span>
                            </div>
                            {/* overflow: visible — 스탬프가 이미지 아래로 삐져나오게 */}
                            <div style={{ width: '100%', overflow: 'visible', flexShrink: 0, zIndex: 0, position: 'relative' }}>
                              {item.imageUrl
                                ? // eslint-disable-next-line @next/next/no-img-element
                                  <img src={item.imageUrl} alt={item.name} style={{ width: '100%', height: 'auto', display: 'block' }} />
                                : <div style={{ aspectRatio: '4/3', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <span style={{ fontSize: 220, opacity: 0.5, lineHeight: 1 }}>{item.emoji || (DOMAIN_EMOJIS[itemDomain] ?? '📦')}</span>
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
                            {/* 제목 — Life TIP과 동일: 14px/700 */}
                            <div style={{ fontFamily: f, fontSize: 14, fontWeight: 700, color: '#000', lineHeight: '18px', marginTop: 12, width: '100%', marginBottom: item.desc?.trim() ? 0 : 6, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const, zIndex: 1 }}>{item.name}</div>
                            {/* 메모(desc) — 블루컬러 */}
                            {item.desc?.trim() ? (
                              <div style={{ fontFamily: f, fontSize: 13, fontWeight: 400, color: '#1D6DDB', lineHeight: '18px', marginTop: 6, marginBottom: 8, width: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, zIndex: 2 }}>{item.desc}</div>
                            ) : null}
                            {/* 태그 — Life TIP과 동일: pill 스타일 */}
                            {(item.tags ?? []).length > 0 ? (
                              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' as const, marginTop: 6, marginBottom: 12, zIndex: 2 }}>
                                {(item.tags ?? []).map(tag => (
                                  <span key={tag} style={{ fontFamily: f, fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 9999, background: 'rgba(12,12,10,.06)', border: '1px solid rgba(12,12,10,.1)', color: '#6A6866' }}>#{tag.replace(/^#/, '')}</span>
                                ))}
                              </div>
                            ) : <div style={{ marginBottom: 12 }} />}
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
                  {/* ALL 뷰일 때 OOTD 로그도 함께 표시 */}
                  {archiveFilter === 'all' && ootdLogs.length > 0 && (
                    <div style={{ padding: '0 16px 20px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '20px 0 12px' }}>
                        <span style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.16em', color: '#9A9490' }}>OOTD</span>
                        <span style={{ fontFamily: f, fontSize: 11, fontWeight: 800, color: '#0C0C0A' }}>{ootdLogs.length}개</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {ootdLogs.map(log => {
                          const pIds = log.productIds ?? [];
                          return (
                            <div key={log.id} style={{ border: '1px solid #000000', background: '#FFFFFF' }}>
                              <div style={{ boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', padding: '20px 16px 0px', position: 'relative', width: '100%', isolation: 'isolate' }}>
                                <div style={{ position: 'absolute', right: 7, top: 42, width: 113, height: 32, background: '#C6F432', border: '1px solid #18181B', transform: 'rotate(-3deg)', display: 'flex', alignItems: 'center', padding: '0 12px', zIndex: 3 }}>
                                  <span style={{ fontFamily: f, fontSize: 14, fontWeight: 700, color: '#525252', transform: 'rotate(-3deg)' }}>#OOTD</span>
                                </div>
                                {log.photoUrl
                                  ? <img src={log.photoUrl} alt={log.category || log.theme} style={{ width: '100%', height: 'auto', display: 'block' }} />
                                  : <div style={{ width: '100%', aspectRatio: '4/3', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                      <span style={{ fontSize: 120, opacity: 0.3, lineHeight: 1 }}>👗</span>
                                    </div>
                                }
                                {log.theme && (
                                  <div style={{ width: '100%', display: 'flex', justifyContent: 'flex-end', marginTop: 12, marginBottom: 4 }}>
                                    <span style={{ fontFamily: f, fontSize: 10, fontWeight: 700, color: '#3A6000', background: 'rgba(197,255,0,.25)', border: '1px solid rgba(197,255,0,.6)', padding: '3px 8px', borderRadius: 9999, whiteSpace: 'nowrap' as const }}>{log.theme}</span>
                                  </div>
                                )}
                                <div style={{ fontFamily: f, fontSize: 20, fontWeight: 600, color: '#000', lineHeight: '24px', marginTop: log.theme ? 0 : 12, width: '100%' }}>{log.theme || '오늘의 룩'}</div>
                                <div style={{ fontFamily: f, fontSize: 14, fontWeight: 400, color: '#525252', lineHeight: '18px', marginTop: 4 }}>{log.date}</div>
                                {log.note ? (
                                  <div style={{ fontFamily: f, fontSize: 13, color: '#1D6DDB', lineHeight: '18px', marginTop: 6, marginBottom: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, width: '100%' }}>{log.note}</div>
                                ) : <div style={{ marginBottom: 12 }} />}
                              </div>
                              {pIds.length > 0 && (
                                <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '12px 8px 8px', borderTop: '1px solid #000000', scrollbarWidth: 'none' as const }}>
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
                              <button onClick={() => openOotdEdit(log)} style={{ width: '100%', padding: '12px 0', background: '#F3F3F1', color: '#0C0C0A', border: 'none', borderTop: '1px solid #000000', fontFamily: f, fontSize: 12, fontWeight: 700, letterSpacing: '.06em', cursor: 'pointer' }}>편집</button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {/* ALL 뷰일 때 Life TIP도 함께 표시 */}
                  {archiveFilter === 'all' && lifetipItems.length > 0 && (
                    <div style={{ padding: '0 10px 20px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '20px 6px 12px' }}>
                        <span style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.16em', color: '#9A9490' }}>LIFE TIP</span>
                        <span style={{ fontFamily: f, fontSize: 11, fontWeight: 800, color: '#0C0C0A' }}>{lifetipItems.length}개</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {lifetipItems.map(item => (
                          <LifetipLibraryCard
                            key={item.id}
                            item={item}
                            products={products}
                            onEdit={() => openLifetipEdit(item)}
                            onToggleToday={() => toggleLifetipToday(item)}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                  {/* ALL이고 아무것도 없는 경우 */}
                  {archiveFilter === 'all' && sortedItems.length === 0 && ootdLogs.length === 0 && lifetipItems.length === 0 && (
                    <div style={{ padding: '40px 16px', textAlign: 'center', background: '#fff', border: '1px solid #000000', borderRadius: 16, margin: '0 16px' }}>
                      <div style={{ fontSize: 28, marginBottom: 8 }}>📁</div>
                      <div style={{ fontFamily: f, fontSize: 13, fontWeight: 700, color: '#0C0C0A', marginBottom: 4 }}>라이브러리가 비어있어요</div>
                      <div style={{ fontFamily: f, fontSize: 12, color: '#9A9490' }}>+ 버튼으로 새 룩·메이크업을 추가해보세요</div>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}

      </div>

      {/* LogCtPanel — 도메인별 동적 패널 (hiddenMode: 편집 시트만 사용) */}
      {['beauty', 'fashion', 'acc', 'interior'].map(domain => {
        const domainItems = allLibItems.filter(i => (i.domain ?? 'beauty') === domain);
        return (
          <LogCtPanel key={domain} filter={domain}
            items={domainItems}
            products={Array.from(products.values())} userId={userId}
            onAdd={(data) => handleCtAdd(domain, data)}
            onUpdate={(id, data) => handleCtUpdate(domain, id, data)}
            onDelete={(id) => handleCtDelete(domain, id)}
            hideAddButton
            addTrigger={domainAddTrigger[domain] ?? 0}
            editTrigger={domainEditTrigger[domain]}
            hiddenMode
            onAfterSave={(itemId, tags) => {
              if (!db || !userId) return;
              const linkedRef = references.find(r => r.libraryItemId === itemId);
              if (!linkedRef) return;
              const catTags = (linkedRef.tags ?? []).filter(t => categoryTags.includes(t));
              updateDoc(doc(db, 'users', userId, 'references', linkedRef.id), { tags: [...catTags, ...tags] });
            }}
          />
        );
      })}

      {/* FAB — 라이브러리 탭에서만 노출 */}
      {mainTab === '라이브러리' && (
        <>
          {/* 타입 선택 팝업 배경 */}
          {fabMenuOpen && (
            <div onClick={() => setFabMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 38 }} />
          )}

          {/* 타입 선택 메뉴 — FAB 위에 떠오름 (BOX 도메인 기반 동적 생성) */}
          {fabMenuOpen && (() => {
            // BOX 제품에서 실제 존재하는 도메인 수집
            const FAB_DOMAIN_ORDER = ['beauty', 'fashion', 'acc', 'interior'];
            const boxDomains = [...new Set(ctxProducts.map(p => p.domain).filter(Boolean))] as string[];
            const fabDomains = [
              ...FAB_DOMAIN_ORDER.filter(d => boxDomains.includes(d)),
              ...boxDomains.filter(d => !FAB_DOMAIN_ORDER.includes(d)),
              // 도메인 없어도 beauty/fashion은 항상 표시
              ...(['beauty', 'fashion'].filter(d => !boxDomains.includes(d))),
            ];
            return (
              <div style={{ position: 'fixed', bottom: 156, right: 'max(18px, calc(50vw - 215px + 18px))', zIndex: 39, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
                {fabDomains.map(domain => (
                  <button key={domain} type="button"
                    onClick={() => {
                      setDomainAddTrigger(prev => ({ ...prev, [domain]: (prev[domain] ?? 0) + 1 }));
                      setFabMenuOpen(false);
                    }}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, height: 44, padding: '0 16px 0 14px', background: '#0C0C0A', color: '#fff', border: 'none', borderRadius: 9999, fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 13, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 16px rgba(0,0,0,.18)', whiteSpace: 'nowrap' as const }}
                  >
                    <span style={{ fontSize: 18 }}>{DOMAIN_EMOJIS[domain] ?? '📦'}</span> {DOMAIN_LABELS[domain] ?? domain} 등록
                  </button>
                ))}
              </div>
            );
          })()}

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

      {/* ── Life TIP 편집 시트 — Makeup/Lookbook/OOTD와 동일한 구조 ── */}
      {editingLifetip && (() => {
        const f = "'Plus Jakarta Sans','Space Grotesk',sans-serif";
        const allProducts = Array.from(products.values());
        return (
          <>
            {/* 딤 배경 */}
            <div onClick={() => setEditingLifetip(null)}
              style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 200 }} />
            {/* 시트 — Makeup/Lookbook과 동일한 center constraint, sticky 헤더 */}
            <div style={{ position: 'fixed', bottom: 0, left: 'max(0px,calc(50vw - 215px))', right: 'max(0px,calc(50vw - 215px))', zIndex: 210, background: '#FAFAF8', borderRadius: '20px 20px 0 0', maxHeight: '94%', overflowY: 'auto', paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 40px)', scrollbarWidth: 'none' as const }}>

              {/* Sticky 헤더 — Makeup/Lookbook과 동일 */}
              <div style={{ position: 'sticky', top: 0, background: 'rgba(250,250,248,.96)', backdropFilter: 'blur(12px)', zIndex: 1, paddingBottom: 14, borderBottom: '1px solid rgba(12,12,10,.07)' }}>
                <div style={{ width: 32, height: 3, background: 'rgba(12,12,10,.14)', borderRadius: 2, margin: '14px auto 0' }} />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px 0' }}>
                  <div style={{ fontFamily: f, fontSize: 20, fontWeight: 800, color: '#0C0C0A' }}>편집: {editingLifetip.name}</div>
                  <button type="button" onClick={() => setEditingLifetip(null)}
                    style={{ width: 36, height: 36, borderRadius: 10, background: '#E4E2DC', border: 'none', cursor: 'pointer', fontSize: 15, color: '#4A4846', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                </div>
              </div>

              <div style={{ padding: '16px 20px 0' }}>

                {/* 이모지 + 이름 */}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
                  <input type="text" value={lifetipEditEmoji} onChange={e => setLifetipEditEmoji(e.target.value)}
                    placeholder="📌" maxLength={2}
                    style={{ width: 48, padding: '11px 6px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 12, fontSize: 22, textAlign: 'center', background: '#fff', outline: 'none', flexShrink: 0 }} />
                  <input type="text" value={lifetipEditName} onChange={e => setLifetipEditName(e.target.value)}
                    placeholder="이름 *"
                    style={{ flex: 1, padding: '12px 14px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 12, fontFamily: f, fontSize: 14, color: '#0C0C0A', background: '#fff', outline: 'none' }} />
                </div>

                {/* 참고 링크 — Makeup/Lookbook과 동일한 스타일 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 12, padding: '10px 14px', background: '#fff', marginBottom: 8 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9A9490" strokeWidth="2.5" style={{ flexShrink: 0 }}>
                    <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>
                  </svg>
                  <input type="url" value={lifetipEditUrl} onChange={e => setLifetipEditUrl(e.target.value)}
                    placeholder="참고 링크 (Instagram, YouTube...)"
                    style={{ flex: 1, border: 'none', outline: 'none', fontFamily: f, fontSize: 13, color: '#0C0C0A', background: 'transparent' }} />
                  {lifetipEditUrl && <button type="button" onClick={() => setLifetipEditUrl('')} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#BCBAB6', fontSize: 14, padding: 0 }}>✕</button>}
                </div>

                {/* 이미지 — Makeup/Lookbook의 ImagePicker와 동일 */}
                <div style={{ marginBottom: 16 }}>
                  <ImagePicker
                    preview={lifetipEditImagePreview}
                    onChange={(file, base64) => { setLifetipEditImageFile(file); setLifetipEditImagePreview(base64); }}
                    onClear={() => { setLifetipEditImageFile(null); setLifetipEditImagePreview(''); }}
                    height={230}
                    placeholderLabel="이미지 추가"
                  />
                </div>

                {/* 메모 */}
                <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, color: '#9A9490', letterSpacing: '.08em', marginBottom: 8 }}>메모</div>
                <textarea value={lifetipEditMemo} onChange={e => setLifetipEditMemo(e.target.value)} placeholder="메모…"
                  style={{ width: '100%', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 12, padding: '11px 14px', fontFamily: f, fontSize: 14, color: '#0C0C0A', resize: 'none', height: 72, outline: 'none', boxSizing: 'border-box' as const, marginBottom: 16 }} />

                {/* 구분선 */}
                <div style={{ height: 1, background: 'rgba(12,12,10,.08)', margin: '4px 0 16px' }} />

                {/* 카테고리 — Life tip / Makeup / Lookbook, 읽기 전용 배지 */}
                <div style={{ marginBottom: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: '#0C0C0A', display: 'inline-block' }} />
                    <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.1em', color: '#0C0C0A' }}>카테고리</div>
                  </div>
                  <div style={{ display: 'inline-flex', alignItems: 'center' }}>
                    <span style={{ fontFamily: f, fontSize: 11, fontWeight: 800, color: '#60A5FA', background: '#0C0C0A', padding: '4px 12px', borderRadius: 9999, letterSpacing: '.04em' }}>
                      {lifetipEditCategoryLabel || 'Life tip'}
                    </span>
                  </div>
                </div>

                {/* 태그 */}
                <div style={{ marginBottom: 16 }}>
                  {/* 레이블 행 */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontFamily: f, fontSize: 11, fontWeight: 800, color: '#555250', letterSpacing: '.04em' }}>#</span>
                      <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.08em', color: '#555250' }}>태그</div>
                    </div>
                    <button type="button"
                      onClick={() => { setLifetipTagEditOpen(v => !v); if (lifetipTagEditOpen) setLifetipTagNewTag(''); }}
                      style={{ height: 24, padding: '0 10px', borderRadius: 9999, border: 'none', background: '#0C0C0A', fontFamily: f, fontSize: 10, fontWeight: 800, color: '#C5FF00', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, letterSpacing: '.04em' }}>
                      <svg width="9" height="9" viewBox="0 0 12 12" fill="none"><path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                      태그 편집
                    </button>
                  </div>

                  {/* 현재 태그 pills */}
                  {lifetipEditTags.length > 0 && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const, marginBottom: 8 }}>
                      {lifetipEditTags.map((tag) => (
                        <span key={tag} style={{ fontFamily: f, fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: 'rgba(12,12,10,.07)', color: '#555250' }}>#{tag}</span>
                      ))}
                    </div>
                  )}
                  {lifetipEditTags.length === 0 && !lifetipTagEditOpen && (
                    <div style={{ fontFamily: f, fontSize: 12, color: '#BCBAB6', marginBottom: 4 }}>태그를 추가해보세요</div>
                  )}

                  {/* 편집 패널 — 드래그앤드롭 */}
                  {lifetipTagEditOpen && (
                    <div style={{ marginTop: 8, padding: '10px 12px 12px', borderRadius: 10, background: 'rgba(12,12,10,.03)', border: '1px solid rgba(12,12,10,.1)' }}>
                      <span style={{ fontFamily: f, fontSize: 10, fontWeight: 700, color: '#BCBAB6', letterSpacing: '.06em', textTransform: 'uppercase' as const, display: 'block', marginBottom: 8 }}>드래그로 순서 변경</span>
                      <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 5, marginBottom: 8 }}>
                        {lifetipEditTags.map((tag, i) => (
                          <div key={tag}
                            draggable
                            onDragStart={() => setDragLifetipTagIdx(i)}
                            onDragOver={e => { e.preventDefault(); setDragLifetipTagOverIdx(i); }}
                            onDrop={() => {
                              if (dragLifetipTagIdx === null || dragLifetipTagIdx === i) return;
                              setLifetipEditTags(prev => {
                                const arr = [...prev];
                                const [moved] = arr.splice(dragLifetipTagIdx, 1);
                                arr.splice(i, 0, moved);
                                return arr;
                              });
                              setDragLifetipTagIdx(null); setDragLifetipTagOverIdx(null);
                            }}
                            onDragEnd={() => { setDragLifetipTagIdx(null); setDragLifetipTagOverIdx(null); }}
                            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 8, background: dragLifetipTagOverIdx === i ? 'rgba(12,12,10,.07)' : 'rgba(12,12,10,.03)', border: `1px solid ${dragLifetipTagOverIdx === i ? 'rgba(12,12,10,.2)' : 'rgba(12,12,10,.08)'}`, cursor: 'grab', transition: 'all .1s' }}>
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0, color: '#BCBAB6' }}><circle cx="4" cy="3" r="1" fill="currentColor"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="9" r="1" fill="currentColor"/><circle cx="8" cy="3" r="1" fill="currentColor"/><circle cx="8" cy="6" r="1" fill="currentColor"/><circle cx="8" cy="9" r="1" fill="currentColor"/></svg>
                            <span style={{ width: 8, height: 8, borderRadius: 9999, background: CAT_COLORS[i % CAT_COLORS.length].selBorder, display: 'inline-block', flexShrink: 0 }} />
                            <span style={{ fontFamily: f, fontSize: 12, fontWeight: 600, color: '#0C0C0A', flex: 1 }}>#{tag}</span>
                            <button type="button" title="삭제"
                              onClick={() => setLifetipEditTags(prev => prev.filter(t => t !== tag))}
                              style={{ width: 20, height: 20, borderRadius: 9999, background: 'rgba(220,50,50,.1)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, color: '#C0392B', flexShrink: 0 }}>
                              <svg width="7" height="7" viewBox="0 0 7 7" fill="none"><path d="M1 1l5 5M6 1L1 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
                            </button>
                          </div>
                        ))}
                      </div>
                      <input type="text" value={lifetipTagNewTag}
                        onChange={e => setLifetipTagNewTag(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                            const t = lifetipTagNewTag.trim();
                            if (t && !lifetipEditTags.includes(t)) setLifetipEditTags(prev => [...prev, t]);
                            setLifetipTagNewTag('');
                          }
                        }}
                        placeholder="+ 태그 추가 (Enter)"
                        style={{ width: '100%', height: 32, padding: '0 10px', borderRadius: 8, border: '1.5px dashed rgba(12,12,10,.25)', background: 'transparent', fontFamily: f, fontSize: 11, color: '#0C0C0A', outline: 'none', boxSizing: 'border-box' as const }}
                      />
                    </div>
                  )}
                </div>

                {/* BOX 제품 연결 */}
                <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, color: '#9A9490', letterSpacing: '.08em', marginBottom: 8 }}>BOX 제품 연결</div>
                <button type="button" onClick={() => setLifetipPickerOpen(true)}
                  style={{ width: '100%', padding: '12px', border: '1.5px dashed rgba(12,12,10,.14)', borderRadius: 10, background: 'transparent', fontFamily: f, fontSize: 12, fontWeight: 700, color: '#9A9490', cursor: 'pointer', marginBottom: 8 }}>
                  {lifetipEditProductIds.length > 0 ? `${lifetipEditProductIds.length}개 선택됨 · 변경` : '+ BOX에서 불러오기'}
                </button>
                {lifetipEditProductIds.length > 0 ? (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const, marginBottom: 16 }}>
                    {lifetipEditProductIds.map(pid => {
                      const p = allProducts.find(q => q.id === pid);
                      return <span key={pid} style={{ fontFamily: f, fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 9999, background: '#EEEDE9', color: '#0C0C0A' }}>{p?.name ?? pid}</span>;
                    })}
                  </div>
                ) : <div style={{ marginBottom: 16 }} />}

                {/* 예정 날짜 */}
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.16em', textTransform: 'uppercase' as const, color: '#9A9490', marginBottom: 8 }}>예정 날짜</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 6, alignItems: 'center' }}>
                    {lifetipEditDates.map(d => (
                      <span key={d} onClick={() => {
                        const next = lifetipEditDates.filter(x => x !== d);
                        setLifetipEditDates(next);
                        if (next.length === 0) setLifetipEditPublished(false);
                      }} style={{ fontFamily: f, fontSize: 12, fontWeight: 700, padding: '5px 10px', borderRadius: 9999, background: '#0C0C0A', color: '#fff', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        {d} <span style={{ opacity: .6, fontSize: 10 }}>✕</span>
                      </span>
                    ))}
                    <input type="date" title="날짜 추가" onChange={e => {
                      if (e.target.value && !lifetipEditDates.includes(e.target.value)) {
                        setLifetipEditDates(p => [...p, e.target.value].sort());
                        e.target.value = '';
                      }
                    }} style={{ padding: '5px 10px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 9999, fontFamily: f, fontSize: 12, color: '#0C0C0A', background: '#fff', outline: 'none' }} />
                  </div>
                </div>

                {/* Today 토글 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginBottom: 20 }}
                  onClick={() => {
                    const next = !lifetipEditPublished;
                    setLifetipEditPublished(next);
                    const today = format(new Date(), 'yyyy-MM-dd');
                    if (next) setLifetipEditDates(p => p.includes(today) ? p : [...p, today].sort());
                  }}>
                  <div style={{ width: 44, height: 26, borderRadius: 13, background: lifetipEditPublished ? '#0C0C0A' : '#D8D6CF', transition: 'background .2s', position: 'relative', flexShrink: 0 }}>
                    <div style={{ position: 'absolute', top: 3, left: lifetipEditPublished ? 21 : 3, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.3)' }} />
                  </div>
                  <span style={{ fontFamily: f, fontSize: 14, fontWeight: 700, color: '#0C0C0A' }}>{lifetipEditPublished ? 'Today에 표시 ON' : 'Today에 표시 OFF'}</span>
                </div>

                {/* 버튼 — Makeup/Lookbook과 동일한 취소/저장/삭제 구조 */}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" onClick={() => setEditingLifetip(null)}
                    style={{ flex: 1, height: 52, background: '#EEEDE9', color: '#0C0C0A', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 12, fontFamily: f, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>취소</button>
                  <button type="button" onClick={saveLifetipEdit} disabled={lifetipEditSaving || !lifetipEditName.trim()}
                    style={{ flex: 1, height: 52, background: lifetipEditName.trim() ? '#0C0C0A' : 'rgba(12,12,10,.14)', color: lifetipEditName.trim() ? '#fff' : '#9A9490', border: 'none', borderRadius: 12, fontFamily: f, fontSize: 13, fontWeight: 700, cursor: lifetipEditName.trim() ? 'pointer' : 'default' }}>
                    {lifetipEditSaving ? '저장 중...' : '수정'}
                  </button>
                </div>
                <button type="button" onClick={deleteLifetipEdit}
                  style={{ width: '100%', padding: 14, background: 'none', border: '1.5px solid rgba(186,26,26,.3)', borderRadius: 12, fontFamily: f, fontSize: 13, color: '#BA1A1A', cursor: 'pointer', fontWeight: 700, marginTop: 8 }}>삭제</button>
              </div>
            </div>

            {/* BOX 제품 피커 바텀시트 */}
            {lifetipPickerOpen && (() => {
              // 실제 존재하는 도메인 목록 (BOX 제품 기준)
              const allDomains = [...new Set(allProducts.map(p => p.domain).filter(Boolean))] as string[];
              const PICKER_DOMAIN_ORDER = ['beauty', 'fashion', 'acc', 'interior'];
              const sortedPickerDomains = [
                ...PICKER_DOMAIN_ORDER.filter(d => allDomains.includes(d)),
                ...allDomains.filter(d => !PICKER_DOMAIN_ORDER.includes(d)),
              ];
              // 도메인 필터 → 검색 적용
              const domainFiltered = lifetipPickerDomain
                ? allProducts.filter(p => p.domain === lifetipPickerDomain)
                : allProducts;
              const filtered = lifetipPickerSearch.trim()
                ? domainFiltered.filter(p => p.name.toLowerCase().includes(lifetipPickerSearch.toLowerCase()))
                : domainFiltered;
              return (
                <>
                  <div onClick={() => setLifetipPickerOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.25)', zIndex: 320 }} />
                  <div style={{ position: 'fixed', bottom: 0, left: 'max(0px,calc(50vw - 215px))', right: 'max(0px,calc(50vw - 215px))', zIndex: 330, background: '#FAFAF8', borderRadius: '20px 20px 0 0', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ padding: '12px 16px 8px', flexShrink: 0 }}>
                      <div style={{ width: 32, height: 3, background: 'rgba(12,12,10,.14)', borderRadius: 2, margin: '0 auto 12px' }} />
                      {/* 도메인 선택 탭 — 가로 스크롤 */}
                      {sortedPickerDomains.length > 1 && (
                        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 10, scrollbarWidth: 'none' as const }}>
                          <button type="button" onClick={() => setLifetipPickerDomain(null)}
                            style={{ flexShrink: 0, background: lifetipPickerDomain === null ? '#0C0C0A' : '#fff', border: `1px solid ${lifetipPickerDomain === null ? '#0C0C0A' : 'rgba(12,12,10,.15)'}`, borderRadius: 9999, padding: '5px 12px', fontFamily: f, fontSize: 11, fontWeight: 700, color: lifetipPickerDomain === null ? '#fff' : '#0C0C0A', cursor: 'pointer', whiteSpace: 'nowrap' as const }}>
                            전체 {allProducts.length}
                          </button>
                          {sortedPickerDomains.map(d => {
                            const cnt = allProducts.filter(p => p.domain === d).length;
                            const sel = lifetipPickerDomain === d;
                            return (
                              <button key={d} type="button" onClick={() => setLifetipPickerDomain(d)}
                                style={{ flexShrink: 0, background: sel ? '#0C0C0A' : '#fff', border: `1px solid ${sel ? '#0C0C0A' : 'rgba(12,12,10,.15)'}`, borderRadius: 9999, padding: '5px 12px', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', whiteSpace: 'nowrap' as const }}>
                                <span style={{ fontSize: 12 }}>{DOMAIN_EMOJIS[d] ?? '📦'}</span>
                                <span style={{ fontFamily: f, fontSize: 11, fontWeight: 700, color: sel ? '#fff' : '#0C0C0A' }}>{DOMAIN_LABELS[d] ?? d}</span>
                                <span style={{ fontFamily: f, fontSize: 10, color: sel ? 'rgba(255,255,255,.5)' : '#BCBAB6' }}>{cnt}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                      <input type="search" value={lifetipPickerSearch} onChange={e => setLifetipPickerSearch(e.target.value)} placeholder="제품 검색..." autoFocus
                        style={{ width: '100%', padding: '10px 12px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 8, fontFamily: f, fontSize: 13, color: '#0C0C0A', background: '#F4F4F0', outline: 'none', boxSizing: 'border-box' as const }} />
                    </div>
                    <div style={{ flex: 1, overflowY: 'auto' }}>
                      {filtered.length === 0 && (
                        <div style={{ padding: '24px', textAlign: 'center', fontFamily: f, fontSize: 13, color: '#9A9490' }}>제품이 없어요</div>
                      )}
                      {filtered.map(p => {
                        const sel = lifetipEditProductIds.includes(p.id);
                        const imgSrc = p.imageUrl ?? (p as Product & { storageUrl?: string }).storageUrl;
                        return (
                          <div key={p.id} onClick={() => setLifetipEditProductIds(ids => sel ? ids.filter(id => id !== p.id) : [...ids, p.id])}
                            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid rgba(12,12,10,.07)', cursor: 'pointer', background: sel ? 'rgba(197,255,0,.06)' : 'transparent' }}>
                            <div style={{ width: 36, height: 36, borderRadius: 8, background: '#EEEDE9', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                              {imgSrc ? <img src={imgSrc} alt={p.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <span style={{ fontSize: 16 }}>{DOMAIN_EMOJIS[p.domain ?? ''] ?? '🧴'}</span>}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontFamily: f, fontSize: 14, fontWeight: 600, color: '#0C0C0A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{p.name}</div>
                              <div style={{ fontFamily: f, fontSize: 11, color: '#9A9490', marginTop: 2 }}>
                                {DOMAIN_LABELS[p.domain ?? ''] ?? p.domain ?? ''}{p.brand ? ` · ${p.brand}` : ''}
                              </div>
                            </div>
                            <div style={{ width: 22, height: 22, borderRadius: '50%', border: `1.5px solid ${sel ? '#8AB000' : 'rgba(12,12,10,.14)'}`, background: sel ? '#C5FF00' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#0C0C0A', flexShrink: 0 }}>{sel ? '✓' : ''}</div>
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ padding: '12px 16px', flexShrink: 0, borderTop: '1px solid rgba(12,12,10,.07)' }}>
                      <button type="button" onClick={() => setLifetipPickerOpen(false)}
                        style={{ width: '100%', height: 48, background: '#0C0C0A', border: 'none', borderRadius: 12, fontFamily: f, fontSize: 13, fontWeight: 700, color: '#fff', cursor: 'pointer' }}>
                        완료 ({lifetipEditProductIds.length}개)
                      </button>
                    </div>
                  </div>
                </>
              );
            })()}
          </>
        );
      })()}

      {/* ── 캐시 미리보기 시트 — 이전 라이브러리 자료 재등록 ── */}
      {refCachePreview && (() => {
        const f = "'Plus Jakarta Sans','Space Grotesk',sans-serif";
        const cache = refCachePreview.cachedLibrary!;
        const linkedProducts = (cache.productIds ?? [])
          .map(pid => products.get(pid))
          .filter(Boolean) as import('@/types/product').Product[];

        function openRegistrationSheet(useCache: boolean) {
          const ref = refCachePreview!;
          setRefCachePreview(null);
          setRefToLib(ref);
          setLibCatEditOpen(false);
          if (useCache) {
            // 캐시값으로 pre-fill — 모든 편집 필드 복원
            setRefToLibCacheData(cache);
            setRefToLibEditName(cache.name || ref.title || '');
            setRefToLibEditUrl(cache.sourceUrl || ref.url || '');
            setRefToLibEditMemo(cache.memo || '');
            setRefToLibEditImageFile(null);
            setRefToLibEditImagePreview(cache.imageUrl || ref.imageUrl || '');
            const cat = (cache.tipCategory || categoryTags.find(c => (ref.tags ?? []).includes(c))) ?? categoryTags[0] ?? 'Life tip';
            const libType: 'makeup' | 'lookbook' | 'lifetip' = cat === 'Lookbook' ? 'lookbook' : cat === 'Makeup' ? 'makeup' : 'lifetip';
            setRefToLibCatName(cat);
            setRefToLibType(libType);
            setRefToLibTipCategory(libType === 'lifetip' ? cache.tipCategory : '');
            setRefToLibEmoji(cache.emoji);
          } else {
            // 처음부터 — 기본값 (수집 기본 정보만)
            setRefToLibCacheData(null);
            setRefToLibEditName(ref.title || '');
            setRefToLibEditUrl(ref.url || '');
            setRefToLibEditMemo('');
            setRefToLibEditImageFile(null);
            setRefToLibEditImagePreview(ref.imageUrl || '');
            const tags = ref.tags ?? [];
            const firstCat = categoryTags.find(c => tags.includes(c)) ?? categoryTags[0] ?? 'Life tip';
            setRefToLibCatName(firstCat);
            const libType: 'makeup' | 'lookbook' | 'lifetip' = firstCat === 'Lookbook' ? 'lookbook' : firstCat === 'Makeup' ? 'makeup' : 'lifetip';
            setRefToLibType(libType);
            setRefToLibTipCategory(libType === 'lifetip' && firstCat !== 'Life tip' ? firstCat : '');
            setRefToLibEmoji('');
          }
        }

        return (
          <>
            <div onClick={() => setRefCachePreview(null)}
              style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 200 }} />
            <div style={{ position: 'fixed', bottom: 0, left: 'max(0px,calc(50vw - 215px))', right: 'max(0px,calc(50vw - 215px))', zIndex: 201, background: '#FAFAF8', borderRadius: '20px 20px 0 0', maxHeight: '88vh', overflowY: 'auto', padding: '12px 20px calc(env(safe-area-inset-bottom,0px) + 28px)', scrollbarWidth: 'none' as const }}>

              {/* 핸들 */}
              <div style={{ width: 36, height: 4, borderRadius: 9999, background: 'rgba(12,12,10,.12)', margin: '0 auto 20px' }} />

              {/* 헤더 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 18 }}>📦</span>
                <div style={{ fontFamily: f, fontSize: 17, fontWeight: 800, color: '#0C0C0A' }}>이전 라이브러리 자료</div>
              </div>
              <div style={{ fontFamily: f, fontSize: 12, color: '#9A9490', marginBottom: 20 }}>
                마지막으로 편집한 내용을 확인 후 등록 방식을 선택하세요
              </div>

              {/* 미리보기 카드 */}
              <div style={{ border: '1px solid rgba(12,12,10,.1)', borderRadius: 14, overflow: 'hidden', marginBottom: 24, background: '#fff' }}>

                {/* 이미지 */}
                {cache.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={cache.imageUrl} alt="" style={{ width: '100%', maxHeight: 140, objectFit: 'cover', display: 'block' }} />
                )}

                <div style={{ padding: '14px 16px 16px' }}>
                  {/* 카테고리 + 이모지 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                    <span style={{ fontSize: 20 }}>{cache.emoji || '📌'}</span>
                    {cache.tipCategory && (
                      <span style={{ fontFamily: f, fontSize: 11, fontWeight: 700, color: '#1D6DDB', background: 'rgba(29,109,219,.1)', border: '1px solid rgba(29,109,219,.25)', padding: '3px 9px', borderRadius: 9999 }}>
                        {cache.tipCategory}
                      </span>
                    )}
                  </div>

                  {/* 이름 */}
                  <div style={{ fontFamily: f, fontSize: 15, fontWeight: 700, color: '#0C0C0A', marginBottom: cache.memo ? 6 : 10 }}>
                    {cache.name}
                  </div>

                  {/* 메모 */}
                  {cache.memo && (
                    <div style={{ fontFamily: f, fontSize: 12, color: '#6A6866', lineHeight: 1.5, marginBottom: 10 }}>
                      {cache.memo}
                    </div>
                  )}

                  {/* 태그 */}
                  {cache.tags.length > 0 && (
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' as const, marginBottom: 10 }}>
                      {cache.tags.map(tag => (
                        <span key={tag} style={{ fontFamily: f, fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 9999, background: 'rgba(12,12,10,.06)', border: '1px solid rgba(12,12,10,.1)', color: '#6A6866' }}>
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* 연결 제품 */}
                  {linkedProducts.length > 0 && (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
                        <rect x="2" y="2" width="5" height="5" rx="1" stroke="#9A9490" strokeWidth="1.5"/>
                        <rect x="9" y="2" width="5" height="5" rx="1" stroke="#9A9490" strokeWidth="1.5"/>
                        <rect x="2" y="9" width="5" height="5" rx="1" stroke="#9A9490" strokeWidth="1.5"/>
                        <rect x="9" y="9" width="5" height="5" rx="1" stroke="#9A9490" strokeWidth="1.5"/>
                      </svg>
                      <span style={{ fontFamily: f, fontSize: 11, color: '#9A9490', fontWeight: 600 }}>
                        BOX {linkedProducts.map(p => p.name).join(', ')}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* 3가지 액션 버튼 */}
              <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 8 }}>

                {/* ① 이대로 등록 */}
                <button type="button"
                  onClick={async () => {
                    if (!db || !userId || !refCachePreview) return;
                    const ref = refCachePreview;
                    setRefCachePreview(null);
                    // cachedLibrary 값으로 lifetipItem 즉시 생성
                    const newItem = await addDoc(collection(db, 'users', userId, 'lifetipItems'), {
                      name: cache.name,
                      emoji: cache.emoji,
                      tipCategory: cache.tipCategory,
                      sourceUrl: cache.sourceUrl,
                      imageUrl: cache.imageUrl,
                      tags: cache.tags,
                      memo: cache.memo,
                      productIds: cache.productIds,
                      published: false,
                      dates: [],
                      createdAt: new Date().toISOString(),
                      updatedAt: new Date().toISOString(),
                    } satisfies Omit<import('@/types/lifetip').LifetipItem, 'id'>);
                    await updateDoc(doc(db, 'users', userId, 'references', ref.id), {
                      inLibrary: true,
                      libraryItemId: newItem.id,
                      libraryItemType: 'lifetip',
                    });
                  }}
                  style={{ width: '100%', height: 52, background: '#0C0C0A', border: 'none', borderRadius: 14, fontFamily: f, fontSize: 14, fontWeight: 800, color: '#C5FF00', cursor: 'pointer', letterSpacing: '.02em' }}>
                  이대로 등록
                </button>

                {/* ② 수정 후 등록 */}
                <button type="button"
                  onClick={() => openRegistrationSheet(true)}
                  style={{ width: '100%', height: 52, background: '#fff', border: '1.5px solid rgba(12,12,10,.15)', borderRadius: 14, fontFamily: f, fontSize: 14, fontWeight: 700, color: '#0C0C0A', cursor: 'pointer' }}>
                  수정 후 등록
                </button>

                {/* ③ 처음부터 등록 */}
                <button type="button"
                  onClick={() => openRegistrationSheet(false)}
                  style={{ width: '100%', height: 44, background: 'none', border: 'none', fontFamily: f, fontSize: 13, fontWeight: 600, color: '#9A9490', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3 }}>
                  처음부터 등록
                </button>

              </div>
            </div>
          </>
        );
      })()}

      {/* ── 수집 → 라이브러리 등록 시트 ── */}
      {refToLib && (() => {
        const f = "'Plus Jakarta Sans','Space Grotesk',sans-serif";
        const refTags = refToLib.tags ?? [];
        return (
          <>
            <div onClick={() => setRefToLib(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 200 }} />
            <div style={{ position: 'fixed', bottom: 0, left: 'max(0px,calc(50vw - 215px))', right: 'max(0px,calc(50vw - 215px))', zIndex: 201, background: '#FAFAF8', borderRadius: '20px 20px 0 0', maxHeight: '85vh', overflowY: 'auto', padding: '12px 20px calc(env(safe-area-inset-bottom,0px) + 24px)', scrollbarWidth: 'none' as const }}>
              <div style={{ width: 36, height: 4, borderRadius: 9999, background: 'rgba(12,12,10,.12)', margin: '0 auto 16px' }} />
              <div style={{ fontFamily: f, fontSize: 16, fontWeight: 800, color: '#0C0C0A', marginBottom: refToLibCacheData ? 4 : 16 }}>라이브러리에 등록</div>
              {refToLibCacheData && (
                <div style={{ fontFamily: f, fontSize: 11, color: '#1D6DDB', background: 'rgba(29,109,219,.08)', border: '1px solid rgba(29,109,219,.18)', borderRadius: 8, padding: '5px 10px', marginBottom: 16, display: 'inline-block' }}>
                  이전 자료 불러옴 — 수정 후 등록
                </div>
              )}

              {/* 제목 */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase' as const, color: '#9A9490', marginBottom: 6 }}>제목</div>
                <input type="text" value={refToLibEditName}
                  onChange={e => setRefToLibEditName(e.target.value)}
                  placeholder="제목 입력"
                  style={{ width: '100%', boxSizing: 'border-box' as const, height: 44, padding: '0 14px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 10, background: '#fff', fontFamily: f, fontSize: 13, color: '#0C0C0A', outline: 'none' }}
                />
              </div>

              {/* 링크 */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase' as const, color: '#9A9490', marginBottom: 6 }}>링크</div>
                <input type="url" value={refToLibEditUrl}
                  onChange={e => setRefToLibEditUrl(e.target.value)}
                  placeholder="https://"
                  style={{ width: '100%', boxSizing: 'border-box' as const, height: 44, padding: '0 14px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 10, background: '#fff', fontFamily: f, fontSize: 13, color: '#0C0C0A', outline: 'none' }}
                />
              </div>

              {/* 이미지 */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase' as const, color: '#9A9490', marginBottom: 6 }}>이미지</div>
                <ImagePicker
                  preview={refToLibEditImagePreview}
                  onChange={(file, base64) => { setRefToLibEditImageFile(file); setRefToLibEditImagePreview(base64); }}
                  onClear={() => { setRefToLibEditImageFile(null); setRefToLibEditImagePreview(''); }}
                  height={160}
                  placeholderLabel="이미지 추가 (선택)"
                  isOpen={!!refToLib}
                />
              </div>

              {/* ── 구분선 ── */}
              <div style={{ height: 1, background: 'rgba(12,12,10,.08)', margin: '4px 0 16px' }} />

              {/* 카테고리 선택 — categoryTags 기반 pill + 편집 */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: '#0C0C0A', display: 'inline-block' }} />
                  <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.1em', color: '#0C0C0A' }}>카테고리</div>
                </div>
                <button type="button"
                  onClick={() => setLibCatEditOpen(v => !v)}
                  style={{ height: 24, padding: '0 10px', borderRadius: 9999, border: 'none', background: '#0C0C0A', fontFamily: f, fontSize: 10, fontWeight: 800, color: '#C5FF00', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, letterSpacing: '.04em' }}>
                  <svg width="9" height="9" viewBox="0 0 12 12" fill="none"><path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                  카테고리 편집
                </button>
              </div>
              <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' as const, marginBottom: 8 }}>
                {categoryTags.map((cat, i) => {
                  const libType: 'makeup' | 'lookbook' | 'lifetip' = cat === 'Lookbook' ? 'lookbook' : cat === 'Makeup' ? 'makeup' : 'lifetip';
                  const sel = refToLibCatName === cat;
                  const color = CAT_COLORS[i % CAT_COLORS.length];
                  return (
                    <button key={cat} type="button"
                      onClick={() => {
                        setRefToLibCatName(cat);
                        setRefToLibType(libType);
                        setRefToLibTipCategory(libType === 'lifetip' && cat !== 'Life tip' ? cat : '');
                        setRefToLibEmoji('');
                      }}
                      style={{ flex: 1, minWidth: 0, height: 36, borderRadius: 10, border: `1.5px solid ${sel ? color.selBorder : 'rgba(12,12,10,.12)'}`, background: sel ? color.selBg : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'all .15s' }}>
                      <span style={{ fontFamily: f, fontSize: 11, fontWeight: 700, color: sel ? color.selText : '#9A9490' }}>{cat}</span>
                    </button>
                  );
                })}
              </div>

              {/* 카테고리 편집 패널 */}
              {libCatEditOpen && (
                <div style={{ marginBottom: 12, padding: '10px 12px 12px', borderRadius: 10, background: 'rgba(12,12,10,.03)', border: '1px solid rgba(12,12,10,.1)' }}>
                  <span style={{ fontFamily: f, fontSize: 10, fontWeight: 700, color: '#BCBAB6', letterSpacing: '.06em', textTransform: 'uppercase' as const, display: 'block', marginBottom: 8 }}>드래그로 순서 변경</span>
                  <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 5, marginBottom: 8 }}>
                    {categoryTags.map((cat, i) => (
                      <div key={cat}
                        draggable
                        onDragStart={() => setDragCatIdx(i)}
                        onDragOver={e => { e.preventDefault(); setDragCatOverIdx(i); }}
                        onDrop={() => {
                          if (dragCatIdx === null || dragCatIdx === i) return;
                          setCategoryTags(prev => {
                            const arr = [...prev];
                            const [item] = arr.splice(dragCatIdx, 1);
                            arr.splice(i, 0, item);
                            return arr;
                          });
                          setDragCatIdx(null); setDragCatOverIdx(null);
                        }}
                        onDragEnd={() => { setDragCatIdx(null); setDragCatOverIdx(null); }}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 8, background: dragCatOverIdx === i ? 'rgba(12,12,10,.07)' : 'rgba(12,12,10,.03)', border: `1px solid ${dragCatOverIdx === i ? 'rgba(12,12,10,.2)' : 'rgba(12,12,10,.08)'}`, cursor: 'grab', transition: 'all .1s' }}>
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0, color: '#BCBAB6' }}><circle cx="4" cy="3" r="1" fill="currentColor"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="9" r="1" fill="currentColor"/><circle cx="8" cy="3" r="1" fill="currentColor"/><circle cx="8" cy="6" r="1" fill="currentColor"/><circle cx="8" cy="9" r="1" fill="currentColor"/></svg>
                        <span style={{ width: 8, height: 8, borderRadius: 9999, background: CAT_COLORS[i % CAT_COLORS.length].selBorder, display: 'inline-block', flexShrink: 0 }} />
                        <span style={{ fontFamily: f, fontSize: 12, fontWeight: 600, color: '#0C0C0A', flex: 1 }}>{cat}</span>
                        <button type="button" title="삭제"
                          onClick={() => { setCategoryTags(prev => prev.filter(t => t !== cat)); if (refToLibCatName === cat) { const next = categoryTags.filter(t => t !== cat)[0] ?? ''; setRefToLibCatName(next); } }}
                          style={{ width: 20, height: 20, borderRadius: 9999, background: 'rgba(220,50,50,.1)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, color: '#C0392B', flexShrink: 0 }}>
                          <svg width="7" height="7" viewBox="0 0 7 7" fill="none"><path d="M1 1l5 5M6 1L1 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
                        </button>
                      </div>
                    ))}
                  </div>
                  <input type="text" value={catNewTag}
                    onChange={e => setCatNewTag(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                        const t = catNewTag.trim();
                        if (t && !categoryTags.includes(t)) setCategoryTags(prev => [...prev, t]);
                        setCatNewTag('');
                      }
                    }}
                    placeholder="+ 카테고리 추가 (Enter)"
                    style={{ width: '100%', height: 32, padding: '0 10px', borderRadius: 8, border: '1.5px dashed rgba(12,12,10,.25)', background: 'transparent', fontFamily: f, fontSize: 11, color: '#0C0C0A', outline: 'none', boxSizing: 'border-box' as const }}
                  />
                </div>
              )}

              {/* Life TIP 전용 — 태그 입력 */}
              {refToLibType === 'lifetip' && refToLibCatName === 'Life tip' && (
                <>
                  <div style={{ height: 1, background: 'rgba(12,12,10,.08)', margin: '4px 0 16px' }} />
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                      <span style={{ fontFamily: f, fontSize: 11, fontWeight: 800, color: '#555250', letterSpacing: '.04em' }}>#</span>
                      <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.1em', color: '#555250' }}>태그 (선택)</div>
                    </div>
                    <input type="text" value={refToLibTipCategory}
                      onChange={e => setRefToLibTipCategory(e.target.value)}
                      placeholder="예: 스킨케어, 헤어, 푸드..."
                      style={{ width: '100%', boxSizing: 'border-box' as const, height: 40, padding: '0 12px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 10, background: 'rgba(12,12,10,.03)', fontFamily: f, fontSize: 13, color: '#0C0C0A', outline: 'none' }}
                    />
                  </div>
                </>
              )}

              {/* 메모 */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase' as const, color: '#9A9490', marginBottom: 6 }}>메모 (선택)</div>
                <textarea value={refToLibEditMemo}
                  onChange={e => setRefToLibEditMemo(e.target.value)}
                  placeholder="메모를 입력하세요"
                  rows={3}
                  style={{ width: '100%', boxSizing: 'border-box' as const, padding: '10px 14px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 10, background: '#fff', fontFamily: f, fontSize: 13, color: '#0C0C0A', outline: 'none', resize: 'none' as const, lineHeight: 1.5 }}
                />
              </div>

              {/* 버튼 */}
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => setRefToLib(null)} style={{ flex: 1, height: 48, background: '#fff', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 12, fontFamily: f, fontSize: 13, fontWeight: 700, color: '#9A9490', cursor: 'pointer' }}>취소</button>
                <button onClick={saveRefToLibrary} disabled={refToLibSaving || !refToLibCatName}
                  style={{ flex: 2, height: 48, background: '#0C0C0A', border: 'none', borderRadius: 12, fontFamily: f, fontSize: 13, fontWeight: 700, color: '#fff', cursor: 'pointer', opacity: (refToLibSaving || !refToLibCatName) ? 0.4 : 1 }}>
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

              {/* 카테고리 — categoryTags 기반 동적 버튼 */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase' as const, color: '#9A9490', marginBottom: 8 }}>카테고리</div>
                <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' as const }}>
                  {categoryTags.map((cat, i) => {
                    const color = CAT_COLORS[i % CAT_COLORS.length];
                    const sel = refEditTags.includes(cat);
                    return (
                      <button key={cat} type="button"
                        onClick={() => setRefEditTags(prev => sel ? prev.filter(t => t !== cat) : [...prev.filter(t => !categoryTags.includes(t)), cat])}
                        style={{ flex: 1, minWidth: 0, height: 36, borderRadius: 10, border: `1.5px solid ${sel ? color.selBorder : 'rgba(12,12,10,.12)'}`, background: sel ? color.selBg : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'all .15s' }}>
                        <span style={{ fontFamily: f, fontSize: 11, fontWeight: 700, color: sel ? color.selText : '#9A9490' }}>{cat}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 메모 */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase' as const, color: '#9A9490', marginBottom: 8 }}>메모</div>
                <textarea
                  value={refEditNote}
                  onChange={e => setRefEditNote(e.target.value)}
                  placeholder="메모 입력 (선택)..."
                  rows={2}
                  style={{ width: '100%', boxSizing: 'border-box' as const, padding: '10px 14px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 10, background: '#fff', fontFamily: f, fontSize: 13, color: '#0C0C0A', outline: 'none', resize: 'none', lineHeight: 1.5 }}
                />
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
              <div style={{ marginBottom: 14 }}>
                <ImagePicker
                  preview={displayImg}
                  onChange={(file, base64) => { setOotdEditPhotoFile(file); setOotdEditPreview(base64); }}
                  onClear={() => { setOotdEditPhotoFile(null); setOotdEditPreview(''); }}
                  height={220}
                  placeholderLabel="사진 추가"
                  isOpen={!!editingOotd}
                />
              </div>

              {/* 카테고리 */}
              <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, color: '#9A9490', letterSpacing: '.08em', marginBottom: 8 }}>카테고리 편집</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const, marginBottom: 14 }}>
                {THEMES.map(t => (
                  <button key={t} type="button" onClick={() => setOotdEditCategory(ootdEditCategory === t ? '' : t)}
                    style={{ padding: '6px 14px', borderRadius: 9999, border: `1.5px solid ${ootdEditCategory === t ? '#0C0C0A' : 'rgba(12,12,10,.14)'}`, background: ootdEditCategory === t ? '#0C0C0A' : '#fff', fontFamily: f, fontSize: 12, fontWeight: 700, color: ootdEditCategory === t ? '#C5FF00' : '#4A4846', cursor: 'pointer', transition: 'all .15s' }}>
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
              const allProds = ctxProducts;
              const allDomains = [...new Set(allProds.map(p => p.domain).filter(Boolean))] as string[];
              const ORDER = ['beauty', 'fashion', 'acc', 'interior'];
              const sortedDomains = [...ORDER.filter(d => allDomains.includes(d)), ...allDomains.filter(d => !ORDER.includes(d))];
              const domainFiltered = ootdPickerDomain ? allProds.filter(p => p.domain === ootdPickerDomain) : allProds;
              const filtered = ootdPickerSearch.trim()
                ? domainFiltered.filter(p => p.name.toLowerCase().includes(ootdPickerSearch.toLowerCase()))
                : domainFiltered;
              return (
                <>
                  <div onClick={() => setOotdPickerOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.25)', zIndex: 320 }} />
                  <div style={{ position: 'fixed', bottom: 0, left: 'max(0px,calc(50vw - 215px))', right: 'max(0px,calc(50vw - 215px))', zIndex: 330, background: '#FAFAF8', borderRadius: '20px 20px 0 0', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ padding: '12px 16px 8px', flexShrink: 0 }}>
                      <div style={{ width: 32, height: 3, background: 'rgba(12,12,10,.14)', borderRadius: 2, margin: '0 auto 12px' }} />
                      {sortedDomains.length > 1 && (
                        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 10, scrollbarWidth: 'none' as const }}>
                          <button type="button" onClick={() => setOotdPickerDomain(null)}
                            style={{ flexShrink: 0, background: ootdPickerDomain === null ? '#0C0C0A' : '#fff', border: `1px solid ${ootdPickerDomain === null ? '#0C0C0A' : 'rgba(12,12,10,.15)'}`, borderRadius: 9999, padding: '5px 12px', fontFamily: f, fontSize: 11, fontWeight: 700, color: ootdPickerDomain === null ? '#fff' : '#0C0C0A', cursor: 'pointer', whiteSpace: 'nowrap' as const }}>
                            전체 {allProds.length}
                          </button>
                          {sortedDomains.map(d => {
                            const cnt = allProds.filter(p => p.domain === d).length;
                            const sel = ootdPickerDomain === d;
                            return (
                              <button key={d} type="button" onClick={() => setOotdPickerDomain(d)}
                                style={{ flexShrink: 0, background: sel ? '#0C0C0A' : '#fff', border: `1px solid ${sel ? '#0C0C0A' : 'rgba(12,12,10,.15)'}`, borderRadius: 9999, padding: '5px 12px', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', whiteSpace: 'nowrap' as const }}>
                                <span style={{ fontSize: 12 }}>{DOMAIN_EMOJIS[d] ?? '📦'}</span>
                                <span style={{ fontFamily: f, fontSize: 11, fontWeight: 700, color: sel ? '#fff' : '#0C0C0A' }}>{DOMAIN_LABELS[d] ?? d}</span>
                                <span style={{ fontFamily: f, fontSize: 10, color: sel ? 'rgba(255,255,255,.5)' : '#BCBAB6' }}>{cnt}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                      <input type="search" value={ootdPickerSearch} onChange={e => setOotdPickerSearch(e.target.value)} placeholder="제품 검색..." autoFocus
                        style={{ width: '100%', padding: '10px 12px', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 8, fontFamily: f, fontSize: 13, color: '#0C0C0A', background: '#F4F4F0', outline: 'none', boxSizing: 'border-box' as const }} />
                    </div>
                    <div style={{ flex: 1, overflowY: 'auto' }}>
                      {filtered.map(p => {
                        const sel = ootdEditProductIds.includes(p.id);
                        const imgSrc = p.imageUrl ?? (p as Product & { storageUrl?: string }).storageUrl;
                        return (
                          <div key={p.id} onClick={() => setOotdEditProductIds(ids => sel ? ids.filter(id => id !== p.id) : [...ids, p.id])}
                            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid rgba(12,12,10,.07)', cursor: 'pointer', background: sel ? 'rgba(197,255,0,.06)' : 'transparent' }}>
                            <div style={{ width: 36, height: 36, borderRadius: 8, background: '#EEEDE9', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                              {imgSrc ? <img src={imgSrc} alt={p.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <span style={{ fontSize: 16 }}>{DOMAIN_EMOJIS[p.domain ?? ''] ?? '📦'}</span>}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontFamily: f, fontSize: 14, fontWeight: 600, color: '#0C0C0A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{p.name}</div>
                              {p.brand && <div style={{ fontFamily: f, fontSize: 12, color: '#9A9490', marginTop: 2 }}>{p.brand}</div>}
                            </div>
                            <div style={{ width: 22, height: 22, borderRadius: '50%', border: `1.5px solid ${sel ? '#8AB000' : 'rgba(12,12,10,.14)'}`, background: sel ? '#C5FF00' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#0C0C0A', flexShrink: 0 }}>{sel ? '✓' : ''}</div>
                          </div>
                        );
                      })}
                      {filtered.length === 0 && (
                        <div style={{ padding: '32px 16px', textAlign: 'center', fontFamily: f, fontSize: 13, color: '#9A9490' }}>제품이 없어요</div>
                      )}
                    </div>
                    <div style={{ padding: '12px 16px calc(env(safe-area-inset-bottom,0px) + 20px)', borderTop: '1px solid rgba(12,12,10,.07)', flexShrink: 0 }}>
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
