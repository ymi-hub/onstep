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
import { imageFileToBase64 } from '@/lib/imageUtils';
import type { RoutineItem } from '@/types/routine';
import type { CtType } from '@/types/ctitem';
import { useAppContext } from '@/lib/AppContext';
import { FALLBACK_USER_ID } from '@/lib/constants';
import type { Product } from '@/types/product';
import type { CtItem } from '@/types/ctitem';
import PageHeader from '@/components/PageHeader';

// ─── 타입 ─────────────────────────────────────────────────────────────────────

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

// Date → "YYYY-MM-DD" 문자열
function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// SVG 고양이 — TODAY 체크 버튼과 동일한 드로잉, 색상 파라미터
function CatBadge({ color, size = 20 }: { color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" fill="none">
      <polygon points="9,16 5,3 17,12" fill={color} stroke="#0C0C0A" strokeWidth="1.3"/>
      <polygon points="27,16 31,3 19,12" fill={color} stroke="#0C0C0A" strokeWidth="1.3"/>
      <polygon points="10,15 7,6 15,11" fill="#FFB3C6" opacity="0.7"/>
      <polygon points="26,15 29,6 21,11" fill="#FFB3C6" opacity="0.7"/>
      <circle cx="18" cy="22" r="13" fill={color} stroke="#0C0C0A" strokeWidth="1.5"/>
      <path d="M10 20 Q13 25 16 20" stroke="#0C0C0A" strokeWidth="2.2" strokeLinecap="round" fill="none"/>
      <path d="M20 20 Q23 25 26 20" stroke="#0C0C0A" strokeWidth="2.2" strokeLinecap="round" fill="none"/>
      <ellipse cx="10" cy="25" rx="3.2" ry="2" fill="#FF8FA3" opacity="0.45"/>
      <ellipse cx="26" cy="25" rx="3.2" ry="2" fill="#FF8FA3" opacity="0.45"/>
      <path d="M13.5 28 Q15.5 31.5 18 29.5 Q20.5 31.5 22.5 28" stroke="#0C0C0A" strokeWidth="1.6" strokeLinecap="round" fill="none"/>
    </svg>
  );
}

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
}) {
  const [isOpen, setIsOpen] = useState(false);

  const days = eachDayOfInterval({
    start: startOfMonth(currentMonth),
    end: endOfMonth(currentMonth),
  });
  const startBlank = getDay(days[0]);
  const fullDays = Array.from(dayLogs.values()).filter(l => l.hasMorning && l.hasEvening).length;
  const morningOnly = Array.from(dayLogs.values()).filter(l => l.hasMorning && !l.hasEvening).length;
  const eveningOnly = Array.from(dayLogs.values()).filter(l => !l.hasMorning && l.hasEvening).length;
  const completionParts: string[] = [];
  if (fullDays > 0) completionParts.push(`${fullDays}일`);
  if (morningOnly > 0) completionParts.push(`아침 ${morningOnly}`);
  if (eveningOnly > 0) completionParts.push(`저녁 ${eveningOnly}`);
  const completionText = completionParts.join(' + ');

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 15, fontWeight: 800, color: '#0C0C0A', letterSpacing: '-0.01em' }}>
            {format(currentMonth, 'yyyy년 M월', { locale: ko })}
          </span>
          {completionText && (
            <span style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 11, fontWeight: 700, color: '#4A7700', background: 'rgba(197,255,0,.18)', padding: '2px 8px', borderRadius: 9999 }}>
              {completionText} 완료
            </span>
          )}
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
          const hasLog = !!log;
          const bothDone = !!(log?.hasMorning && log?.hasEvening);
          const anyDone = !!(log?.hasMorning || log?.hasEvening);

          return (
            <button
              key={ds}
              onClick={() => onSelectDate(isSelected ? '' : ds)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 3,
                padding: '6px 2px',
                background: isSelected ? '#0C0C0A' : 'transparent',
                border: today && !isSelected ? '1.5px solid rgba(12,12,10,.2)' : '1.5px solid transparent',
                borderRadius: 10,
                cursor: 'pointer',
                transition: 'background .15s',
              }}
            >
              {/* 날짜 숫자 */}
              <span
                style={{
                  fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
                  fontSize: 13,
                  fontWeight: isSelected || today ? 800 : 400,
                  color: isSelected ? '#FFFFFF' : today ? '#0C0C0A' : '#4A4846',
                }}
              >
                {format(day, 'd')}
              </span>

              {/* 아침(라임)·저녁(오렌지) SVG 고양이 */}
              <div style={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <span style={{ opacity: log?.hasMorning ? 1 : 0.8 }}><CatBadge color={log?.hasMorning ? '#C5FF00' : 'rgba(12,12,10,.12)'} size={14} /></span>
                <span style={{ opacity: log?.hasEvening ? 1 : 0.8 }}><CatBadge color={log?.hasEvening ? '#f7bc45' : 'rgba(12,12,10,.12)'} size={14} /></span>
              </div>
              {/* 약·건강·식단 이모지 행 — 활성 루틴 흐리게 표시 */}
              {(hasMed || hasHealth || hasDiet) && (
                <div style={{ display: 'flex', gap: 2, alignItems: 'center', marginTop: 1 }}>
                  {hasMed && <span style={{ fontSize: 9, lineHeight: 1, opacity: 0.7, filter: 'grayscale(1)' }}>💊</span>}
                  {hasHealth && <span style={{ fontSize: 9, lineHeight: 1, opacity: 0.7, filter: 'grayscale(1)' }}>🏃</span>}
                  {hasDiet && <span style={{ fontSize: 9, lineHeight: 1, opacity: 0.7, filter: 'grayscale(1)' }}>📋</span>}
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
            <span style={{ fontSize: 12, opacity: 0.7, filter: 'grayscale(1)' }}>💊</span>
            <span style={{ fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif", fontSize: 11, color: '#9A9490', fontWeight: 600 }}>약 복용</span>
          </div>
        )}
        {hasHealth && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ fontSize: 12, opacity: 0.7, filter: 'grayscale(1)' }}>🏃</span>
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
          <span
            style={{
              marginLeft: 'auto',
              width: 18,
              height: 18,
              borderRadius: 9999,
              background: '#C5FF00',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#0C0C0A" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
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
        margin: '0 16px',
        background: '#FFFFFF',
        border: '1px solid #0C0C0A',
        borderRadius: 20,
        overflow: 'hidden',
        boxShadow: '0 1px 2px rgba(0,0,0,.04)',
      }}
    >
      {/* 날짜 헤더 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 16px',
          borderBottom: '1px solid #0C0C0A',
          background: '#F4F4F0',
        }}
      >
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
            {dayLog
              ? `${dayLog.hasMorning ? '아침 ✓' : ''}${dayLog.hasMorning && dayLog.hasEvening ? ' · ' : ''}${dayLog.hasEvening ? '저녁 ✓' : ''}`
              : '기록 없음'}
          </div>
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
        const morningMeds = activeMeds.filter(m => (m.times ?? []).some((t: string) => t === 'morning' || t === 'lunch'));
        const nightMeds   = activeMeds.filter(m => (m.times ?? []).some((t: string) => t === 'evening' || t === 'bedtime'));
        const ungrouped   = activeMeds.filter(m => !morningMeds.includes(m) && !nightMeds.includes(m));
        const nightAll    = [...nightMeds, ...ungrouped];
        const MedRow = ({ m }: { m: import('@/types/medication').MedRoutine }) => {
          const done = medChecked.has(m.id);
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '4px 0' }}>
              <div style={{ width: 14, height: 14, borderRadius: 3, background: done ? '#C5FF00' : 'rgba(12,12,10,.06)', border: `1.5px solid ${done ? '#8AB000' : 'rgba(12,12,10,.14)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 900, color: '#0C0C0A', flexShrink: 0 }}>
                {done ? '✓' : '○'}
              </div>
              <span style={{ fontFamily: f, fontSize: 11, fontWeight: 700, color: done ? '#C5C6CA' : '#44474A', width: 36, flexShrink: 0 }}>{getTime(m)}</span>
              <span style={{ fontFamily: f, fontSize: 12, fontWeight: 600, color: done ? '#9A9490' : '#0C0C0A', textDecoration: done ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{m.name}</span>
            </div>
          );
        };
        return (
          <div style={{ padding: '10px 14px', borderTop: '1px solid rgba(12,12,10,.06)' }}>
            <div style={{ fontFamily: f, fontSize: 10, fontWeight: 700, color: '#9A9490', letterSpacing: '.08em', marginBottom: 6 }}>💊 약 루틴</div>
            {morningMeds.length > 0 && (
              <div style={{ marginBottom: nightAll.length > 0 ? 8 : 0 }}>
                <div style={{ fontFamily: "'Courier New',monospace", fontSize: 9, color: '#6B7CE8', letterSpacing: '.04em', marginBottom: 4 }}>·+ +°.Morning°·++·° *</div>
                {morningMeds.map(m => <MedRow key={m.id} m={m} />)}
              </div>
            )}
            {nightAll.length > 0 && (
              <div>
                <div style={{ fontFamily: "'Courier New',monospace", fontSize: 9, color: '#E86BAA', letterSpacing: '.04em', marginBottom: 4 }}>·+ +°.Night°·++·° *</div>
                {nightAll.map(m => <MedRow key={m.id} m={m} />)}
              </div>
            )}
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
                return (
                  <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '4px 0' }}>
                    <div style={{ width: 14, height: 14, borderRadius: 3, background: done ? '#C5FF00' : 'rgba(12,12,10,.06)', border: `1.5px solid ${done ? '#8AB000' : 'rgba(12,12,10,.14)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 900, color: '#0C0C0A', flexShrink: 0 }}>
                      {done ? '✓' : '○'}
                    </div>
                    <span style={{ fontFamily: f, fontSize: 11, fontWeight: 700, color: done ? '#C5C6CA' : '#44474A', width: 36, flexShrink: 0 }}>{h.time ?? '—'}</span>
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
                    {programDone && <span style={{ width: 14, height: 14, borderRadius: 3, background: '#C5FF00', border: '1.5px solid #8AB000', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 900, color: '#0C0C0A', flexShrink: 0 }}>✓</span>}
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
    <div style={{ padding: '0 16px 0' }}>
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
      <div style={{ display: 'flex', gap: 6 }}>
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
                border: isSelected
                  ? '2px solid #0C0C0A'
                  : today
                  ? '1.5px solid rgba(12,12,10,.2)'
                  : '1.5px solid transparent',
                background: isSelected ? '#0C0C0A' : bothDone ? '#F5FDD4' : 'transparent',
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
                  color: isSelected ? '#C5FF00' : '#9A9490',
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
                  color: isSelected ? '#FFFFFF' : today ? '#0C0C0A' : '#4A4846',
                  position: 'relative', zIndex: 1,
                }}
              >
                {format(day, 'd')}
              </span>

              {/* 오늘: 하나라도 완료면 캐릭터 / 나머지: 아침(라임)·저녁(블랙) 닷 */}
              {/* 아침(라임)·저녁(오렌지) SVG 고양이 */}
              <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
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
      {/* 카드 본체 — border는 outer wrapper에 위임 */}
      <div style={{
        boxSizing: 'border-box',
        display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
        padding: '20px 24px 0px',
        position: 'relative',
        width: '100%',
        isolation: 'isolate',
        flexShrink: 0,
      }}>
        {/* 라임 배지 */}
        <div style={{
          position: 'absolute', right: 7, top: 42,
          width: 113, height: 32,
          background: '#C6F432', border: '1px solid #18181B',
          transform: 'rotate(-3deg)',
          display: 'flex', alignItems: 'center', padding: '0 12px',
          zIndex: 3,
        }}>
          <span style={{ fontFamily: f, fontSize: 14, fontWeight: 700, color: '#525252', transform: 'rotate(-3deg)' }}>{badge}</span>
        </div>

        {/* 이미지 — overflow: visible for stamp */}
        <div style={{ width: '100%', height: 487, background: '#F3F3F4', overflow: 'visible', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, zIndex: 0, position: 'relative' }}>
          {item.imageUrl
            ? <img src={item.imageUrl} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
            : <span style={{ fontSize: 220, opacity: 0.5, lineHeight: 1 }}>{item.emoji || (isMakeup ? '💄' : '👗')}</span>
          }
          {isOnToday && (
            <div style={{ position: 'absolute', bottom: -50, right: -14, transform: 'rotate(-9deg)', zIndex: 4, width: 88, height: 88, borderRadius: '50%', border: '3px solid rgba(190,30,30,.75)', background: 'rgba(255,255,255,.7)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', mixBlendMode: 'multiply' as const, flexShrink: 0 }}>
              <div style={{ position: 'absolute', inset: 5, borderRadius: '50%', border: '1px solid rgba(190,30,30,.3)', pointerEvents: 'none' }} />
              <img src="/logo.png" alt="today" style={{ width: 34, height: 34, objectFit: 'contain', filter: 'sepia(1) saturate(8) hue-rotate(-20deg) contrast(1.2)', opacity: .8, marginBottom: 1, position: 'relative', zIndex: 1 }} />
              <div style={{ fontFamily: f, fontSize: 8, fontWeight: 900, letterSpacing: '.32em', color: 'rgba(190,30,30,.85)', textTransform: 'uppercase' as const, marginTop: -2, position: 'relative', zIndex: 1 }}>TODAY</div>
            </div>
          )}
        </div>

        {/* 제목 */}
        <div style={{ fontFamily: f, fontSize: 20, fontWeight: 600, color: '#000', lineHeight: '18px', marginTop: 12, width: '100%', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const, zIndex: 1 }}>{item.name}</div>
        {/* daily — 우측 정렬 */}
        {item.daily && <div style={{ width: '100%', textAlign: 'right', fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.1em', color: '#BCBAB6', marginTop: 6, zIndex: 1 }}>{item.daily}</div>}
        {/* 서브 */}
        <div style={{ fontFamily: f, fontSize: 16, fontWeight: 400, color: '#000', lineHeight: '18px', marginTop: 4, marginBottom: 12, width: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, zIndex: 2 }}>{item.tpo?.join(' · ') || (isMakeup ? 'makeup' : 'lookbook')}</div>
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
  const fileRef = useRef<HTMLInputElement>(null);

  const domainProducts = ctType === 'makeup'
    ? Array.from(products.values()).filter(p => p.domain === 'beauty' && p.subCategory === 'makeup')
    : Array.from(products.values()).filter(p => p.domain === 'fashion' || p.domain === 'acc');

  const filteredProds = pickerSearch.trim()
    ? domainProducts.filter(p => p.name.toLowerCase().includes(pickerSearch.toLowerCase()))
    : domainProducts;

  // 파일 → Base64 변환 → 미리보기 (Storage 없이 Firestore에 직접 저장)
  async function applyImageFile(file: File) {
    try {
      const base64 = await imageFileToBase64(file);
      setImgFile(file);
      setImgPreview(base64);
    } catch (err) {
      console.error('[OnStep] imageFileToBase64 실패, FileReader 폴백:', err);
      if (file.size > 500 * 1024) {
        alert('이미지 파일이 너무 큽니다. 500KB 이하 파일을 선택해주세요.');
        return;
      }
      const reader = new FileReader();
      reader.onload = ev => { const r = ev.target?.result; if (typeof r === 'string') { setImgFile(file); setImgPreview(r); } };
      reader.onerror = () => { alert('이미지를 불러오지 못했습니다. 다른 파일을 선택해주세요.'); };
      reader.readAsDataURL(file);
    }
  }

  function handleImg(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void applyImageFile(file);
    e.target.value = '';
  }

  // ⌘V / Ctrl+V 클립보드 이미지 붙여넣기
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const blob = item.getAsFile();
          if (blob) {
            void applyImageFile(new File([blob], 'pasted-image.png', { type: blob.type }));
            e.preventDefault();
            break;
          }
        }
      }
    }
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, []);

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

          {/* 이미지 — 탭(갤러리/카메라) + 클립보드 붙여넣기 */}
          <div
            onClick={() => fileRef.current?.click()}
            style={{ width: '100%', height: 180, background: imgPreview ? 'transparent' : '#F4F4F0', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', marginBottom: 8, overflow: 'hidden', position: 'relative', backgroundImage: imgPreview ? `url(${imgPreview})` : 'none', backgroundSize: 'contain', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' }}
          >
            {!imgPreview && (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 28, opacity: 0.2, marginBottom: 6 }}>📷</div>
                <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.08em', color: '#9A9490' }}>BASELINE 이미지</div>
                <div style={{ fontFamily: f, fontSize: 11, color: '#C4C2BE', marginTop: 4 }}>탭하여 갤러리/카메라 선택</div>
              </div>
            )}
            {imgPreview && (
              <button onClick={e => { e.stopPropagation(); setImgFile(null); setImgPreview(''); }} style={{ position: 'absolute', top: 8, right: 8, width: 28, height: 28, borderRadius: '50%', background: 'rgba(0,0,0,.5)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
            )}
          </div>
          {/* 클립보드 붙여넣기 버튼 — 모바일/PC 공통 */}
          {!imgPreview && (
            <button
              onClick={async () => {
                try {
                  const items = await navigator.clipboard.read();
                  for (const item of items) {
                    for (const type of item.types) {
                      if (type.startsWith('image/')) {
                        const blob = await item.getType(type);
                        void applyImageFile(new File([blob], 'pasted.png', { type }));
                        return;
                      }
                    }
                  }
                  alert('클립보드에 이미지가 없습니다.');
                } catch { fileRef.current?.click(); }
              }}
              style={{ width: '100%', padding: '10px', border: '1.5px dashed rgba(12,12,10,.14)', borderRadius: 10, background: 'transparent', fontFamily: f, fontSize: 12, fontWeight: 700, color: '#9A9490', cursor: 'pointer', marginBottom: 16 }}
            >📋 클립보드에서 붙여넣기</button>
          )}
          {imgPreview && <div style={{ marginBottom: 16 }} />}
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImg} />

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
                  {ctType === 'makeup' ? 'BOX에 메이크업 제품이 없어요' : 'BOX에 패션·악세서리 제품이 없어요'}<br />
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

  async function applyImg(file: File) {
    try {
      const base64 = await imageFileToBase64(file);
      setSImageFile(file);
      setSImagePreview(base64);
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
  }

  // HubCard 스타일 카드 — setup HubView와 동일한 구조
  const BG = filter === 'makeup'
    ? 'linear-gradient(135deg,#f5f0ff 0%,#d0b0ff 100%)'
    : 'linear-gradient(135deg,#fff0f5 0%,#ffc0d0 100%)';
  const BADGE = filter === 'makeup' ? '#MAKEUP' : '#LOOKBOOK';

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
          <div style={{ display: 'inline-block', fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.1em', background: '#C5FF00', color: '#0C0C0A', padding: '3px 8px', borderRadius: 4, marginBottom: 6, textTransform: 'uppercase' as const }}>{BADGE}</div>
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
          <button onClick={() => togglePublished(item)} style={{ flex: 1, padding: '6px 0', background: item.published ? '#0C0C0A' : 'rgba(12,12,10,.06)', color: item.published ? '#C5FF00' : '#9A9490', border: 'none', borderRadius: 6, fontFamily: f, fontSize: 9, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase' as const, cursor: 'pointer', transition: 'all .15s' }}>
            {item.published ? 'Today ON' : 'Today OFF'}
          </button>
          <button onClick={() => openEdit(item)} style={{ padding: '6px 8px', background: '#EEEDE9', color: '#4A4846', border: 'none', borderRadius: 6, fontFamily: f, fontSize: 9, fontWeight: 700, cursor: 'pointer' }}>편집</button>
        </div>
      </div>
    );
  }

  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!sheetOpen) return;
    function onPaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const blob = item.getAsFile();
          if (blob) { void applyImg(new File([blob], 'pasted.png', { type: blob.type })); e.preventDefault(); break; }
        }
      }
    }
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [sheetOpen]);

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
                <div style={{ display: 'inline-block', fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.1em', background: '#E4E2DC', color: '#9A9490', padding: '3px 8px', borderRadius: 4, marginBottom: 7, textTransform: 'uppercase' as const }}>{BADGE}</div>
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
                <button onClick={closeSheet} style={{ width: 28, height: 28, borderRadius: 8, background: '#E4E2DC', border: 'none', cursor: 'pointer', fontSize: 12, color: '#4A4846' }}>✕</button>
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

              {/* 이미지 — 탭(갤러리/카메라) + 클립보드 붙여넣기 */}
              <div onClick={() => fileRef.current?.click()} style={{ width: '100%', height: 430, background: sImagePreview ? 'transparent' : '#F4F4F0', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', marginBottom: 8, overflow: 'hidden', position: 'relative', backgroundImage: sImagePreview ? `url(${sImagePreview})` : 'none', backgroundSize: 'contain', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' }}>
                {!sImagePreview && (
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 28, opacity: 0.2, marginBottom: 6 }}>📷</div>
                    <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.08em', color: '#9A9490' }}>이미지 추가</div>
                    <div style={{ fontFamily: f, fontSize: 11, color: '#C4C2BE', marginTop: 4 }}>탭하여 갤러리/카메라 선택</div>
                  </div>
                )}
                {sImagePreview && <button onClick={e => { e.stopPropagation(); setSImageFile(null); setSImagePreview(''); }} style={{ position: 'absolute', top: 8, right: 8, width: 28, height: 28, borderRadius: '50%', background: 'rgba(0,0,0,.5)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>}
              </div>
              {!sImagePreview && (
                <button
                  onClick={async () => {
                    try {
                      const items = await navigator.clipboard.read();
                      for (const item of items) {
                        for (const type of item.types) {
                          if (type.startsWith('image/')) {
                            const blob = await item.getType(type);
                            void applyImg(new File([blob], 'pasted.png', { type }));
                            return;
                          }
                        }
                      }
                      alert('클립보드에 이미지가 없습니다.');
                    } catch { fileRef.current?.click(); }
                  }}
                  style={{ width: '100%', padding: '10px', border: '1.5px dashed rgba(12,12,10,.14)', borderRadius: 10, background: 'transparent', fontFamily: f, fontSize: 12, fontWeight: 700, color: '#9A9490', cursor: 'pointer', marginBottom: 16 }}
                >📋 클립보드에서 붙여넣기</button>
              )}
              {sImagePreview && <div style={{ marginBottom: 16 }} />}
              <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { const file = e.target.files?.[0]; if (file) void applyImg(file); e.target.value = ''; }} />

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
                <div style={{ padding: '12px 16px 8px', flexShrink: 0 }}>
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
                      <div key={p.id} onClick={() => setPickerSelected(prev => { const n = new Set(prev); sel ? n.delete(p.id) : n.add(p.id); return n; })} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid rgba(12,12,10,.07)', cursor: 'pointer', background: sel ? 'rgba(197,255,0,.06)' : 'transparent' }}>
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

function EmptyState({ isLoading }: { isLoading: boolean }) {
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

  return (
    <div
      style={{
        margin: '0 16px',
        padding: '48px 24px',
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
  const { user, userId, authLoading, products: ctxProducts, sessions, makeupItems, lookItems, careItems, habits, dietPrograms, healthRoutines, medRoutines } = useAppContext();
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
  const [mainTab, setMainTab] = useState<'기록' | '라이브러리' | '아카이브'>('기록');
  const [archiveFilter, setArchiveFilter] = useState<'all' | 'makeup' | 'lookbook'>('all');
  const [libFilter, setLibFilter] = useState<'all' | 'makeup' | 'lookbook' | 'ootd'>('all');

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
    const tab = searchParams.get('tab') as '라이브러리' | '아카이브' | null;
    const filter = searchParams.get('filter') as 'all' | 'makeup' | 'lookbook' | null;
    const id = searchParams.get('id');
    if (tab === '라이브러리' || tab === '아카이브') setMainTab(tab);
    if (filter === 'all' || filter === 'makeup' || filter === 'lookbook') setArchiveFilter(filter);
    if (id) {
      setTimeout(() => {
        const el = document.getElementById(`lib-item-${id}`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 400);
    }
  }, [searchParams]);

  // ── FAB 상태 ──
  const [fabMenuOpen, setFabMenuOpen] = useState(false);
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

        {/* 탭 바 — 기록 / 라이브러리 / 아카이브 */}
        <div style={{ display: 'flex', gap: 0, height: 46, alignItems: 'stretch', background: 'rgba(250,250,248,.96)', backdropFilter: 'blur(8px)', borderBottom: '1px solid rgba(12,12,10,.07)', margin: '16px 0 0', padding: '0 16px' }}>
          {(['기록', '라이브러리', '아카이브'] as const).map((t) => (
            <button key={t} onClick={() => setMainTab(t)}
              style={{ flex: 1, border: 'none', background: 'none', fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 12, fontWeight: 800, letterSpacing: '.02em', color: mainTab === t ? '#0C0C0A' : '#9A9490', borderBottom: mainTab === t ? '2px solid #0C0C0A' : '2px solid transparent', cursor: 'pointer', transition: 'all .18s' }}
            >
              {t}
            </button>
          ))}
        </div>

        {/* ── 기록 탭 — 날짜 중심 타임라인 ── */}
        {mainTab === '기록' && (
          <div style={{ paddingTop: 8 }}>
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
            />
            {selectedDate ? (
              <DayDetail
                dateStr={selectedDate} dayLog={selectedDayLog} products={products} sessions={sessions}
                makeupItems={makeupItems} lookItems={lookItems}
                onClose={() => setSelectedDate(null)}
                medRoutines={medRoutines}
                healthRoutines={healthRoutines}
                dietPrograms={dietPrograms}
                medChecked={medDayMap.get(selectedDate) ?? new Set<string>()}
                healthChecked={healthDayMap.get(selectedDate) ?? new Set<string>()}
                dietChecked={dietDayMap.get(selectedDate) ?? new Set<string>()}
              />
            ) : (
              <>
                {dayLogs.size === 0 && <EmptyState isLoading={dataLoading || authLoading} />}

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
                    <div style={{ width: 16, height: 16, borderRadius: 4, background: done ? '#C5FF00' : 'transparent', border: `1.5px solid ${done ? '#A6D900' : 'rgba(12,12,10,.2)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 900, color: '#0C0C0A', flexShrink: 0 }}>
                      {done ? '✓' : ''}
                    </div>
                  );

                  return (
                    <div style={{ margin: '12px 16px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {/* 날짜 라벨 */}
                      <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, color: '#9A9490', letterSpacing: '.08em', padding: '0 2px' }}>
                        {format(new Date(), 'M월 d일 (EEE)', { locale: ko })} · 오늘의 기록
                      </div>

                      {/* ── 🌿 스킨케어 카드 ── */}
                      {!dataLoading && (
                        <div style={{ background: '#fff', border: '1px solid rgba(12,12,10,.07)', borderRadius: 16, overflow: 'hidden' }}>
                          <CardHeader emoji="🌿" title="스킨케어"
                            badge={todayDayLog?.hasMorning && todayDayLog?.hasEvening ? '아침·저녁 완료' : todayDayLog?.hasMorning ? '아침 완료' : todayDayLog?.hasEvening ? '저녁 완료' : '미완료'}
                          />
                          <div style={{ padding: '8px 14px 10px', display: 'flex', gap: 8 }}>
                            {(['morning', 'evening'] as const).map(slot => {
                              const done = slot === 'morning' ? (todayDayLog?.hasMorning ?? false) : (todayDayLog?.hasEvening ?? false);
                              return (
                                <div key={slot} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', borderRadius: 10, background: done ? 'rgba(197,255,0,.1)' : 'rgba(12,12,10,.03)', border: `1px solid ${done ? 'rgba(166,217,0,.3)' : 'rgba(12,12,10,.07)'}` }}>
                                  <span style={{ fontSize: 13 }}>{slot === 'morning' ? '☀' : '🌙'}</span>
                                  <span style={{ fontFamily: f, fontSize: 11, fontWeight: 700, color: done ? '#4A7700' : '#BCBAB6' }}>{slot === 'morning' ? '아침' : '저녁'}</span>
                                  {done && <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 900, color: '#5A8A00' }}>✓</span>}
                                </div>
                              );
                            })}
                          </div>
                          {todayCare.length > 0 && (
                            <div style={{ borderTop: '1px solid rgba(12,12,10,.05)', padding: '6px 14px 10px', display: 'flex', flexDirection: 'column', gap: 5 }}>
                              {todayCare.map(item => (
                                <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                                  <span style={{ fontSize: 12 }}>🧴</span>
                                  <span style={{ fontFamily: f, fontSize: 12, color: '#0C0C0A', flex: 1 }}>{item.name}</span>
                                  <span style={{ fontFamily: f, fontSize: 9, fontWeight: 700, color: '#4A9ED6', letterSpacing: '.04em' }}>집중</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* ── 💊 약 복용 카드 ── */}
                      {medRoutines.filter(m => m.active && m.showInToday).length > 0 && (() => {
                        const doneSet = new Set(todayMedLogs.map(l => l.routineId));
                        const activeMeds = medRoutines.filter(m => m.active && m.showInToday);
                        const doneCnt = activeMeds.filter(m => doneSet.has(m.id)).length;
                        const getTime = (m: { time?: string; times?: string[] }) => {
                          if (m.time) return m.time;
                          const first = (m.times ?? [])[0];
                          return first === 'morning' ? '09:00' : first === 'lunch' ? '12:00' : first === 'evening' ? '18:00' : '22:00';
                        };
                        const morningMeds = activeMeds.filter(m => (m.times ?? []).some((t: string) => t === 'morning' || t === 'lunch'));
                        const nightMeds   = activeMeds.filter(m => (m.times ?? []).some((t: string) => t === 'evening' || t === 'bedtime'));
                        const ungrouped   = activeMeds.filter(m => !morningMeds.includes(m) && !nightMeds.includes(m));
                        const nightAll    = [...nightMeds, ...ungrouped];
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
                            <div style={{ padding: '8px 14px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                              {morningMeds.length > 0 && (
                                <div>
                                  <div style={{ fontFamily: "'Courier New',monospace", fontSize: 9, color: '#6B7CE8', marginBottom: 5 }}>·+ +°.Morning°·++·° *</div>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>{morningMeds.map(m => <MedRow key={m.id} m={m} />)}</div>
                                </div>
                              )}
                              {nightAll.length > 0 && (
                                <div style={{ marginTop: morningMeds.length > 0 ? 6 : 0 }}>
                                  <div style={{ fontFamily: "'Courier New',monospace", fontSize: 9, color: '#E86BAA', marginBottom: 5 }}>·+ +°.Night°·++·° *</div>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>{nightAll.map(m => <MedRow key={m.id} m={m} />)}</div>
                                </div>
                              )}
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
                                    <span style={{ fontFamily: f, fontSize: 12, color: done ? '#BCBAB6' : '#0C0C0A', textDecoration: done ? 'line-through' : 'none', flex: 1 }}>{h.name}</span>
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
                                return (
                                  <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <CheckDot done={done} />
                                    <span style={{ fontSize: 13, flexShrink: 0 }}>{h.icon || '🏃'}</span>
                                    <span style={{ fontFamily: f, fontSize: 12, color: done ? '#BCBAB6' : '#0C0C0A', textDecoration: done ? 'line-through' : 'none', flex: 1 }}>{h.name}</span>
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
                            {/* MOTD */}
                            <div style={{ display: 'flex', flexDirection: 'row', gap: 8, flexWrap: 'wrap' as const }}>
                              {todayMotd.length > 0 ? todayMotd.slice(0, 2).map(item => (
                                <div key={item.id} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                                  <div style={{ width: 140, height: 200, borderRadius: 0, overflow: 'hidden', background: 'linear-gradient(135deg,#f5f0ff,#d0b0ff)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    {item.imageUrl
                                      // eslint-disable-next-line @next/next/no-img-element
                                      ? <img src={item.imageUrl} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                                      : <span style={{ fontSize: 28 }}>{item.emoji || '💄'}</span>}
                                  </div>
                                  <span style={{ fontFamily: f, fontSize: 12, fontWeight: 600, color: '#0C0C0A', width: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{item.name}</span>
                                </div>
                              )) : <span style={{ fontFamily: f, fontSize: 11, color: '#BCBAB6' }}>없음</span>}
                            </div>
                            {/* OOTD */}
                            <div style={{ display: 'flex', flexDirection: 'row', gap: 8, flexWrap: 'wrap' as const }}>
                              {todayOotd.length > 0 ? todayOotd.slice(0, 2).map(item => (
                                <div key={item.id} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                                  <div style={{ width: 140, height: 200, borderRadius: 0, overflow: 'hidden', background: 'linear-gradient(135deg,#fff0f5,#ffc0d0)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    {item.imageUrl
                                      // eslint-disable-next-line @next/next/no-img-element
                                      ? <img src={item.imageUrl} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                                      : <span style={{ fontSize: 28 }}>{item.emoji || '👗'}</span>}
                                  </div>
                                  <span style={{ fontFamily: f, fontSize: 12, fontWeight: 600, color: '#0C0C0A', width: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{item.name}</span>
                                </div>
                              )) : <span style={{ fontFamily: f, fontSize: 11, color: '#BCBAB6' }}>없음</span>}
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
          const tabs: { key: 'all' | 'makeup' | 'lookbook' | 'ootd'; label: string; count: number }[] = [
            { key: 'all',     label: 'ALL',      count: usedMakeup.length + usedLook.length + ootdLogs.length },
            { key: 'makeup',  label: '💄 메이크업', count: usedMakeup.length },
            { key: 'lookbook',label: '👗 룩북',   count: usedLook.length },
            { key: 'ootd',    label: '오늘의룩',  count: ootdLogs.length },
          ];

          // 아이템 목록 (makeup + lookbook)
          const ctItems = libFilter === 'all'
            ? [...usedMakeup, ...usedLook].sort((a, b) => (b.dates ?? []).length - (a.dates ?? []).length)
            : libFilter === 'makeup' ? usedMakeup
            : libFilter === 'lookbook' ? usedLook
            : [];

          // OOTD 카드 리스트 — LogLibraryCard와 동일 CSS
          const OotdGrid = () => (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
              {ootdLogs.map(log => {
                const pIds = log.productIds ?? [];
                return (
                <div key={log.id} style={{ border: '1px solid #000000', background: '#FFFFFF' }}>
                  {/* 카드 본체 */}
                  <div style={{ boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', padding: '20px 24px 0px', position: 'relative', width: '100%', isolation: 'isolate', flexShrink: 0 }}>
                    {/* 배지 */}
                    <div style={{ position: 'absolute', right: 7, top: 42, width: 113, height: 32, background: '#C6F432', border: '1px solid #18181B', transform: 'rotate(-3deg)', display: 'flex', alignItems: 'center', padding: '0 12px', zIndex: 3 }}>
                      <span style={{ fontFamily: f, fontSize: 14, fontWeight: 700, color: '#525252', transform: 'rotate(-3deg)' }}>#OOTD</span>
                    </div>
                    {/* 이미지 */}
                    <div style={{ width: '100%', height: 487, background: '#F3F3F4', overflow: 'visible', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, zIndex: 0, position: 'relative' }}>
                      {log.photoUrl
                        ? <img src={log.photoUrl} alt={log.theme} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
                        : <span style={{ fontSize: 120, opacity: 0.3, lineHeight: 1 }}>👗</span>}
                    </div>
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

          return (
            <div style={{ padding: '16px 16px 0' }}>
              {/* 필터 탭 */}
              <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
                {tabs.map(t => (
                  <button key={t.key} onClick={() => setLibFilter(t.key)}
                    style={{ flex: 1, height: 28, padding: '0 6px', borderRadius: 9999, border: `1.5px solid ${libFilter === t.key ? '#0C0C0A' : 'rgba(12,12,10,.14)'}`, background: libFilter === t.key ? '#0C0C0A' : 'transparent', fontFamily: f, fontSize: 11, fontWeight: 700, color: libFilter === t.key ? '#fff' : '#9A9490', cursor: 'pointer', transition: 'all .15s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, whiteSpace: 'nowrap' as const }}>
                    {t.label}
                    {t.count > 0 && <span style={{ width: 16, height: 16, borderRadius: 9999, background: libFilter === t.key ? '#C5FF00' : '#EEEDE9', color: '#0C0C0A', fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{t.count}</span>}
                  </button>
                ))}
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
                  {libFilter === 'all' && ctItems.length === 0 && ootdLogs.length === 0 && (
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

        {/* ── 아카이브 탭 — 메이크업·룩북 CRUD + Today ON ── */}
        {mainTab === '라이브러리' && (
          <div style={{ paddingTop: 16 }}>
            {/* 필터 */}
            <div style={{ display: 'flex', gap: 6, padding: '0 16px', marginBottom: 16 }}>
              {(['all', 'makeup', 'lookbook'] as const).map(tab => (
                <button key={tab} onClick={() => setArchiveFilter(tab)}
                  style={{ height: 30, padding: '0 14px', borderRadius: 9999, border: `1.5px solid ${archiveFilter === tab ? '#0C0C0A' : 'rgba(12,12,10,.14)'}`, background: archiveFilter === tab ? '#0C0C0A' : 'transparent', fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 12, fontWeight: 700, color: archiveFilter === tab ? '#fff' : '#9A9490', cursor: 'pointer', transition: 'all .15s' }}>
                  {tab === 'all' ? 'ALL' : tab === 'makeup' ? '💄 Makeup' : '👗 Lookbook'}
                </button>
              ))}
            </div>

            {/* 아이템 카드 목록 */}
            {(() => {
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
                <div style={{ padding: '40px 16px', textAlign: 'center', background: '#fff', border: '1px solid #000000', borderRadius: 16, margin: '0 16px' }}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>📁</div>
                  <div style={{ fontFamily: f, fontSize: 13, fontWeight: 700, color: '#0C0C0A', marginBottom: 4 }}>아카이브가 비어있어요</div>
                  <div style={{ fontFamily: f, fontSize: 12, color: '#9A9490' }}>+ 버튼으로 새 룩·메이크업을 추가해보세요</div>
                </div>
              );
              return (
                <div style={{ marginTop: 8 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '0 16px 20px' }}>
                    {sortedItems.map(item => {
                      const isMakeup = item.ctType === 'makeup';
                      const badge = isMakeup ? '#MAKEUP' : '#LOOKBOOK';
                      const isOnToday = item.published && (item.dates ?? []).includes(todayStr);
                      const prodItems = item.items.filter((i): i is { type: 'product'; id: string } => i.type === 'product');
                      return (
                        <div key={item.id} id={`lib-item-${item.id}`} style={{ border: '1px solid #000000', background: '#FFFFFF' }}>
                          {/* 이미지 + 텍스트 영역 */}
                          <div style={{ boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', padding: '20px 24px 0px', position: 'relative', width: '100%', isolation: 'isolate', flexShrink: 0 }}>
                            <div style={{ position: 'absolute', right: 7, top: 42, width: 113, height: 32, background: '#C6F432', border: '1px solid #18181B', transform: 'rotate(-3deg)', display: 'flex', alignItems: 'center', padding: '0 12px', zIndex: 3 }}>
                              <span style={{ fontFamily: f, fontSize: 14, fontWeight: 700, color: '#525252', transform: 'rotate(-3deg)' }}>{badge}</span>
                            </div>
                            {/* overflow: visible — 스탬프가 이미지 아래로 삐져나오게 */}
                            <div style={{ width: '100%', height: 487, background: '#F3F3F4', overflow: 'visible', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, zIndex: 0, position: 'relative' }}>
                              {item.imageUrl
                                ? <img src={item.imageUrl} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
                                : <span style={{ fontSize: 220, opacity: 0.5, lineHeight: 1 }}>{item.emoji || (isMakeup ? '💄' : '👗')}</span>
                              }
                              {isOnToday && (
                                <div style={{ position: 'absolute', bottom: -50, right: -14, transform: 'rotate(-9deg)', zIndex: 4, width: 88, height: 88, borderRadius: '50%', border: '3px solid rgba(190,30,30,.75)', background: 'rgba(255,255,255,.7)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', mixBlendMode: 'multiply' as const, flexShrink: 0 }}>
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
                style={{ display: 'flex', alignItems: 'center', gap: 10, height: 44, padding: '0 16px 0 14px', background: '#0C0C0A', color: '#fff', border: 'none', borderRadius: 9999, fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 13, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 16px rgba(0,0,0,.18)', whiteSpace: 'nowrap' as const }}
              >
                <span style={{ fontSize: 18 }}>👗</span> 룩북 등록
              </button>
              <button
                onClick={() => { setMakeupAddTrigger(n => n + 1); setFabMenuOpen(false); }}
                style={{ display: 'flex', alignItems: 'center', gap: 10, height: 44, padding: '0 16px 0 14px', background: '#0C0C0A', color: '#fff', border: 'none', borderRadius: 9999, fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 13, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 16px rgba(0,0,0,.18)', whiteSpace: 'nowrap' as const }}
              >
                <span style={{ fontSize: 18 }}>💄</span> 메이크업 등록
              </button>
            </div>
          )}

          {/* FAB 본체 */}
          <button
            onClick={() => setFabMenuOpen(o => !o)}
            style={{
              position: 'fixed', bottom: 88, right: 'max(18px, calc(50vw - 215px + 18px))', zIndex: 40,
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
                    <div style={{ padding: '12px 16px 8px', flexShrink: 0 }}>
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
                            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid rgba(12,12,10,.07)', cursor: 'pointer', background: sel ? 'rgba(197,255,0,.06)' : 'transparent' }}>
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
                        <div style={{ padding: '32px 16px', textAlign: 'center', fontFamily: f, fontSize: 13, color: '#9A9490', lineHeight: 1.6 }}>
                          BOX에 Fashion · Acc 제품이 없어요<br />이름을 검색하면 바로 등록할 수 있어요
                        </div>
                      )}
                      {ootdPickerSearch.trim() && filtered.length === 0 && (
                        <div style={{ padding: '32px 16px', textAlign: 'center', fontFamily: f, fontSize: 13, color: '#9A9490' }}>검색 결과가 없습니다</div>
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
