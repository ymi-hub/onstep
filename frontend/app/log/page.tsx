// app/log/page.tsx — LOG 페이지
// Stage 6: 월별 캘린더 + 날짜별 루틴 수행 기록
//
// 💡 이 파일에서 구현하는 기능:
//   1. Firebase Auth — Google 로그인/로그아웃 (today 페이지와 동일한 패턴)
//   2. 월별 캘린더 뷰 — 루틴 수행한 날에 도트 표시
//   3. 날짜 클릭 → 그날 아침/저녁 사용 제품 상세 카드
//   4. 최근 7일 요약 스트립

'use client';

import { useState, useEffect, useRef } from 'react';
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
}: {
  currentMonth: Date;
  dayLogs: Map<string, DayLog>;
  selectedDate: string | null;
  onSelectDate: (dateStr: string) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);

  const days = eachDayOfInterval({
    start: startOfMonth(currentMonth),
    end: endOfMonth(currentMonth),
  });
  const startBlank = getDay(days[0]);
  const completedCount = Array.from(dayLogs.values()).filter(l => l.hasMorning || l.hasEvening).length;

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
          {completedCount > 0 && (
            <span style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 11, fontWeight: 700, color: '#4A7700', background: 'rgba(197,255,0,.18)', padding: '2px 8px', borderRadius: 9999 }}>
              {completedCount}일 완료
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

              {/* 완료 표시 */}
              {anyDone ? (
                <StampBadge size={20} rotate={-8} full={bothDone} />
              ) : (
                <span style={{ width: 6, height: 6 }} />
              )}
            </button>
          );
        })}
      </div>

      {/* 범례 */}
      <div
        style={{
          display: 'flex',
          gap: 14,
          marginTop: 12,
          padding: '10px 0 0',
          borderTop: '1px solid #0C0C0A',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: 9999, background: '#C5FF00', display: 'inline-block' }} />
          <span style={{ fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif", fontSize: 11, color: '#9A9490', fontWeight: 600 }}>아침 완료</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: 9999, background: '#0C0C0A', display: 'inline-block' }} />
          <span style={{ fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif", fontSize: 11, color: '#9A9490', fontWeight: 600 }}>저녁 완료</span>
        </div>
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
  onClose,
}: {
  dateStr: string;
  dayLog: DayLog | undefined;
  products: Map<string, Product>;
  sessions: import('@/types/routine').Session[];
  onClose: () => void;
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

              {/* 완료 표시 */}
              {(bothDone || halfDone) ? (
                <StampBadge size={26} rotate={-10} full={!!bothDone} />
              ) : (
                <div style={{ width: 10, height: 10, borderRadius: 9999, background: 'rgba(12,12,10,.1)', flexShrink: 0 }} />
              )}
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
  item, products,
}: {
  item: CtItem;
  products: Map<string, Product>;
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
    <div style={{ marginBottom: 12 }}>
      {/* 카드 본체 */}
      <div style={{
        boxSizing: 'border-box',
        display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
        padding: '20px 24px 0px',
        position: 'relative',
        width: '100%',
        background: '#FFFFFF',
        border: '1px solid #E5E5E5',
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

        {/* 이미지 */}
        <div style={{ width: '100%', height: 487, background: '#F3F3F4', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, zIndex: 0, position: 'relative' }}>
          {item.imageUrl
            ? <img src={item.imageUrl} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <span style={{ fontSize: 220, opacity: 0.5, lineHeight: 1 }}>{item.emoji || (isMakeup ? '💄' : '👗')}</span>
          }
          {isOnToday && (
            <div style={{ position: 'absolute', bottom: 12, left: 12, background: '#0C0C0A', color: '#fff', fontFamily: f, fontSize: 12, fontWeight: 800, letterSpacing: '.12em', padding: '4px 12px', borderRadius: 9999, border: '1.5px solid #C5FF00', zIndex: 4 }}>TODAY</div>
          )}
        </div>

        {/* 제목 */}
        <div style={{ fontFamily: f, fontSize: 20, fontWeight: 600, color: '#000', lineHeight: '18px', marginTop: 12, width: '100%', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const, zIndex: 1 }}>{item.name}</div>
        {/* daily — 우측 정렬 */}
        {item.daily && <div style={{ width: '100%', textAlign: 'right', fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.1em', color: '#BCBAB6', marginTop: 6, zIndex: 1 }}>{item.daily}</div>}
        {/* 서브 */}
        <div style={{ fontFamily: f, fontSize: 16, fontWeight: 400, color: '#000', lineHeight: '18px', marginTop: 4, marginBottom: 20, width: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, zIndex: 2 }}>{item.tpo?.join(' · ') || (isMakeup ? 'makeup' : 'lookbook')}</div>
      </div>

      {/* 제품 영역 — 카드 밖 하단, 가로 스크롤 */}
      {prodItems.length > 0 && (
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '12px 0 4px', width: '100%', scrollbarWidth: 'none' as const }}>
          {prodItems.map((it, idx) => {
            const p = products.get(it.id);
            const imgSrc = p?.imageUrl || p?.storageUrl;
            return (
              <div key={idx} style={{ flexShrink: 0, width: 120, display: 'flex', flexDirection: 'column', gap: 5 }}>
                <div style={{ width: 120, height: 160, borderRadius: 10, background: '#F3F3F4', border: '1px solid #E5E5E5', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {imgSrc ? <img src={imgSrc} alt={p?.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: 24, opacity: 0.2 }}>🧴</span>}
                </div>
                <span style={{ fontFamily: f, fontSize: 11, fontWeight: 600, color: '#525252', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{p?.name ?? ''}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* 통계 영역 */}
      <div style={{ marginTop: 14, marginBottom: 4, display: 'flex', flexDirection: 'column', gap: 8 }}>
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
            style={{ width: '100%', height: 180, background: imgPreview ? 'transparent' : '#F4F4F0', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', marginBottom: 8, overflow: 'hidden', position: 'relative', backgroundImage: imgPreview ? `url(${imgPreview})` : 'none', backgroundSize: 'cover', backgroundPosition: 'center' }}
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
            <button onClick={handleSave} disabled={saving || !name.trim()} style={{ flex: 2, height: 52, background: name.trim() ? '#0C0C0A' : 'rgba(12,12,10,.14)', color: name.trim() ? '#fff' : '#9A9490', border: 'none', borderRadius: 12, fontFamily: f, fontSize: 15, fontWeight: 700, cursor: name.trim() ? 'pointer' : 'default' }}>
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
                return (
                  <div key={p.id} onClick={() => setSelectedProds(prev => { const n = new Set(prev); sel ? n.delete(p.id) : n.add(p.id); return n; })} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid rgba(12,12,10,.07)', cursor: 'pointer', background: sel ? 'rgba(197,255,0,.06)' : 'transparent' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontFamily: f, fontSize: 14, fontWeight: 600, color: '#0C0C0A' }}>{p.name}</div>
                      {p.brand && <div style={{ fontFamily: f, fontSize: 12, color: '#9A9490' }}>{p.brand}</div>}
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
        <div style={{ width: '100%', height: 340, background: item.imageUrl ? 'transparent' : BG, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 48, overflow: 'hidden', position: 'relative' }}>
          {item.imageUrl ? <img src={item.imageUrl} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : item.emoji || (filter === 'makeup' ? '💄' : '👗')}
          {isOnToday && <div style={{ position: 'absolute', top: 8, right: 8, background: '#0C0C0A', color: '#C5FF00', fontFamily: f, fontSize: 9, fontWeight: 800, letterSpacing: '.1em', padding: '3px 7px', borderRadius: 9999 }}>TODAY</div>}
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
                    {imgSrc ? <img src={imgSrc} alt={p?.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: 28, opacity: 0.2 }}>🧴</span>}
                  </div>
                  <span style={{ fontFamily: f, fontSize: 11, fontWeight: 600, color: '#0C0C0A', textAlign: 'center', width: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{p?.name ?? ''}</span>
                </div>
              );
            })}
          </div>
        )}
        <div style={{ padding: '0 12px 12px', display: 'flex', gap: 6 }}>
          <button onClick={() => togglePublished(item)} style={{ flex: 1, padding: '8px 0', background: item.published ? '#0C0C0A' : 'rgba(12,12,10,.06)', color: item.published ? '#C5FF00' : '#0C0C0A', border: 'none', borderRadius: 8, fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase' as const, cursor: 'pointer', transition: 'all .15s' }}>
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
        <div style={{ width: '100%', height: 180, background: item.imageUrl ? 'transparent' : BG, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, overflow: 'hidden', position: 'relative' }}>
          {item.imageUrl ? <img src={item.imageUrl} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : item.emoji || (filter === 'makeup' ? '💄' : '👗')}
          {/* 하단 그라데이션 + 이름 오버레이 */}
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '24px 8px 8px', background: 'linear-gradient(to top, rgba(0,0,0,.6) 0%, transparent 100%)' }}>
            <div style={{ fontFamily: f, fontSize: 12, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{item.name}</div>
            {isOnToday && <div style={{ fontFamily: f, fontSize: 9, fontWeight: 800, color: '#C5FF00', letterSpacing: '.08em', marginTop: 2 }}>TODAY</div>}
          </div>
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
                    {imgSrc ? <img src={imgSrc} alt={p?.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: 16, opacity: 0.2 }}>🧴</span>}
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
            {item.published ? 'ON' : 'OFF'}
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
              <div onClick={() => fileRef.current?.click()} style={{ width: '100%', height: 430, background: sImagePreview ? 'transparent' : '#F4F4F0', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', marginBottom: 8, overflow: 'hidden', position: 'relative', backgroundImage: sImagePreview ? `url(${sImagePreview})` : 'none', backgroundSize: 'cover', backgroundPosition: 'center' }}>
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
              <button onClick={() => { setPicker('main'); setPickerSearch(''); setPickerSelected(new Set()); }} style={{ padding: '8px 14px', borderRadius: 9999, border: 'none', background: '#0C0C0A', color: '#C5FF00', fontFamily: f, fontSize: 12, fontWeight: 700, cursor: 'pointer', marginBottom: 16 }}>제품 +</button>

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
                <button onClick={handleSave} disabled={saving || !sName.trim()} style={{ flex: 2, height: 52, background: sName.trim() ? '#0C0C0A' : 'rgba(12,12,10,.14)', color: sName.trim() ? '#fff' : '#9A9490', border: 'none', borderRadius: 12, fontFamily: f, fontSize: 15, fontWeight: 700, cursor: sName.trim() ? 'pointer' : 'default' }}>
                  {saving ? '저장 중...' : editItem ? '수정 저장' : '저장'}
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
                    return (
                      <div key={p.id} onClick={() => setPickerSelected(prev => { const n = new Set(prev); sel ? n.delete(p.id) : n.add(p.id); return n; })} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid rgba(12,12,10,.07)', cursor: 'pointer', background: sel ? 'rgba(197,255,0,.06)' : 'transparent' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontFamily: f, fontSize: 14, fontWeight: 600, color: '#0C0C0A' }}>{p.name}</div>
                          {p.brand && <div style={{ fontFamily: f, fontSize: 12, color: '#9A9490' }}>{p.brand}</div>}
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

export default function LogPage() {
  // ── 공유 컨텍스트 ──
  const { user, userId, authLoading, products: ctxProducts, sessions, makeupItems, lookItems } = useAppContext();
  const products = new Map(ctxProducts.map((p) => [p.id, p]));

  // ── 캘린더 상태 ──
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // ── 탭 상태 ──
  const [mainTab, setMainTab] = useState<'log' | 'library'>('log');
  const [logFilter, setLogFilter] = useState<'all' | 'makeup' | 'lookbook'>('all');
  const [libFilter, setLibFilter] = useState<'makeup' | 'lookbook'>('makeup');

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
  const [dataLoading, setDataLoading] = useState(false);

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

  // products/makeupItems/lookItems → AppContext에서 공유


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

        {/* 탭 바 — LOG / Library */}
        <div style={{ display: 'flex', gap: 0, height: 46, alignItems: 'stretch', background: 'rgba(250,250,248,.96)', backdropFilter: 'blur(8px)', borderBottom: '1px solid rgba(12,12,10,.07)', margin: '16px 0 0', padding: '0 16px' }}>
          {(['log', 'library'] as const).map((t) => (
            <button key={t} onClick={() => setMainTab(t)}
              style={{ flex: 1, border: 'none', background: 'none', fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 13, fontWeight: 800, letterSpacing: '.04em', textTransform: 'uppercase', color: mainTab === t ? '#0C0C0A' : '#9A9490', borderBottom: mainTab === t ? '2px solid #0C0C0A' : '2px solid transparent', cursor: 'pointer', transition: 'all .18s' }}
            >
              {t === 'log' ? 'Log' : 'Library'}
            </button>
          ))}
        </div>

        {mainTab === 'log' ? (
          /* LOG 탭 — ALL / 💄 / 👗 태그바 필터 */
          <div style={{ paddingTop: 16 }}>
            {/* 태그바 */}
            <div style={{ display: 'flex', gap: 6, padding: '0 16px', marginBottom: 16 }}>
              {(['all', 'makeup', 'lookbook'] as const).map(tab => (
                <button key={tab} onClick={() => setLogFilter(tab)}
                  style={{ height: 30, padding: '0 14px', borderRadius: 9999, border: `1.5px solid ${logFilter === tab ? '#0C0C0A' : 'rgba(12,12,10,.14)'}`, background: logFilter === tab ? '#0C0C0A' : 'transparent', fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 12, fontWeight: 700, color: logFilter === tab ? '#fff' : '#9A9490', cursor: 'pointer', transition: 'all .15s' }}>
                  {tab === 'all' ? 'ALL' : tab === 'makeup' ? '💄 Makeup' : '👗 Lookbook'}
                </button>
              ))}
            </div>

            {/* LogCtPanel — hiddenMode: 카드 숨김, 편집 시트만 사용 */}
            <LogCtPanel key="makeup" filter="makeup" items={makeupItems} products={Array.from(products.values())} userId={userId}
              onAdd={(data) => handleCtAdd('makeup', data)} onUpdate={(id, data) => handleCtUpdate('makeup', id, data)} onDelete={(id) => handleCtDelete('makeup', id)}
              hideAddButton addTrigger={makeupAddTrigger} editTrigger={makeupEditTrigger} hiddenMode
            />
            <LogCtPanel key="lookbook" filter="lookbook" items={lookItems} products={Array.from(products.values())} userId={userId}
              onAdd={(data) => handleCtAdd('lookbook', data)} onUpdate={(id, data) => handleCtUpdate('lookbook', id, data)} onDelete={(id) => handleCtDelete('lookbook', id)}
              hideAddButton addTrigger={lookbookAddTrigger} editTrigger={lookbookEditTrigger} hiddenMode
            />

            {/* ── 메인 카드 영역 (필터 적용) ── */}
            {(() => {
              const visibleItems = [
                ...(logFilter !== 'lookbook' ? makeupItems : []),
                ...(logFilter !== 'makeup' ? lookItems : []),
              ];
              const f = "'Plus Jakarta Sans','Space Grotesk',sans-serif";
              const todayStr = format(new Date(), 'yyyy-MM-dd');
              const sortedItems = [...visibleItems].sort((a, b) => {
                const aOn = a.published && (a.dates ?? []).includes(todayStr) ? 1 : 0;
                const bOn = b.published && (b.dates ?? []).includes(todayStr) ? 1 : 0;
                return bOn - aOn;
              });
              if (sortedItems.length === 0) return (
                <div style={{ padding: '40px 16px', textAlign: 'center', fontFamily: f, fontSize: 13, color: '#9A9490' }}>등록된 아이템이 없습니다</div>
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
                        <div key={item.id}>
                        <div style={{
                          boxSizing: 'border-box',
                          display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                          padding: '20px 24px 0px',
                          position: 'relative',
                          width: '100%',
                          background: '#FFFFFF',
                          border: '1px solid #E5E5E5',
                          isolation: 'isolate',
                          flexShrink: 0,
                        }}>
                          {/* 라임 배지 — 우상단 -3도 회전 */}
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

                          {/* 이미지 영역 */}
                          <div style={{ width: '100%', height: 487, background: '#F3F3F4', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, zIndex: 0, position: 'relative' }}>
                            {item.imageUrl
                              ? <img src={item.imageUrl} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                              : <span style={{ fontSize: 220, opacity: 0.5, lineHeight: 1 }}>{item.emoji || (isMakeup ? '💄' : '👗')}</span>
                            }
                            {isOnToday && (
                              <div style={{ position: 'absolute', bottom: 12, left: 12, background: '#0C0C0A', color: '#fff', fontFamily: f, fontSize: 16, fontWeight: 800, letterSpacing: '.12em', padding: '6px 14px', borderRadius: 9999, border: '1.5px solid #C5FF00', zIndex: 4 }}>TODAY</div>
                            )}
                          </div>

                          {/* 제목 */}
                          <div style={{ fontFamily: f, fontSize: 20, fontWeight: 600, color: '#000', lineHeight: '18px', marginTop: 12, width: '100%', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const, zIndex: 1 }}>{item.name}</div>
                          {/* 서브 */}
                          <div style={{ fontFamily: f, fontSize: 16, fontWeight: 400, color: '#000', lineHeight: '18px', marginTop: 6, marginBottom: 20, width: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, zIndex: 2 }}>{item.tpo?.join(' · ') || (isMakeup ? 'makeup' : 'lookbook')}</div>
                        </div>

                        {/* 제품 영역 — 카드 밖 하단, 가로 스크롤 */}
                        {prodItems.length > 0 && (
                          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '12px 0 4px', width: '100%', scrollbarWidth: 'none' as const }}>
                            {prodItems.map((it, idx) => {
                              const p = products.get(it.id);
                              const imgSrc = p?.imageUrl || p?.storageUrl;
                              return (
                                <div key={idx} style={{ flexShrink: 0, width: 120, display: 'flex', flexDirection: 'column', gap: 5 }}>
                                  <div style={{ width: 120, height: 160, borderRadius: 10, background: '#F3F3F4', border: '1px solid #E5E5E5', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    {imgSrc ? <img src={imgSrc} alt={p?.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: 24, opacity: 0.2 }}>🧴</span>}
                                  </div>
                                  <span style={{ fontFamily: f, fontSize: 11, fontWeight: 600, color: '#525252', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{p?.name ?? ''}</span>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* Today ON/OFF + 편집 버튼 */}
                        <div style={{ display: 'flex', gap: 6, marginTop: 12, marginBottom: 4 }}>
                          <button onClick={() => handleToggleToday(item)} disabled={!!togglingId} style={{ flex: 1, padding: '8px 0', background: isOnToday ? '#0C0C0A' : 'rgba(12,12,10,.06)', color: isOnToday ? '#C5FF00' : '#0C0C0A', border: 'none', borderRadius: 8, fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase' as const, cursor: togglingId ? 'default' : 'pointer', opacity: togglingId === item.id ? 0.6 : 1, transition: 'all .15s' }}>
                            {togglingId === item.id ? '...' : isOnToday ? 'Today ON' : 'Today OFF'}
                          </button>
                          <button onClick={() => triggerCollectionEdit(item)} style={{ padding: '8px 10px', background: '#EEEDE9', color: '#4A4846', border: 'none', borderRadius: 8, fontFamily: f, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>편집</button>
                        </div>
                      </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>
        ) : (
          /* LIBRARY 탭 — 스킨케어 캘린더 상단 + 컨셉 아카이브 하단 */
          <div>
            {/* 스킨케어 기록 섹션 — 상단 */}
            <div style={{ paddingTop: 8 }}>
              <div style={{ padding: '12px 16px 8px', fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase' as const, color: '#9A9490' }}>SKINCARE RECORD</div>
              <RecentStrip dayLogs={dayLogs} selectedDate={selectedDate} onSelectDate={handleSelectDate} />
              <div style={{ height: 1, background: 'rgba(12,12,10,.07)', margin: '16px 16px 0' }} />
              <MonthCalendar
                currentMonth={currentMonth} dayLogs={dayLogs} selectedDate={selectedDate} onSelectDate={handleSelectDate}
                onPrevMonth={() => { setCurrentMonth(m => subMonths(m, 1)); setSelectedDate(null); }}
                onNextMonth={() => { setCurrentMonth(m => addMonths(m, 1)); setSelectedDate(null); }}
              />
              {selectedDate ? (
                <DayDetail dateStr={selectedDate} dayLog={selectedDayLog} products={products} sessions={sessions} onClose={() => setSelectedDate(null)} />
              ) : (
                dayLogs.size === 0 && <EmptyState isLoading={dataLoading || authLoading} />
              )}
            </div>

            {/* 컨셉 카드 섹션 — 하단 */}
            <div style={{ margin: '8px 0 0', borderTop: '1px solid rgba(12,12,10,.07)', padding: '16px 16px 0' }}>
              <div style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase' as const, color: '#9A9490', marginBottom: 12 }}>CONCEPT ARCHIVE</div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
                {(['makeup', 'lookbook'] as const).map((f) => {
                  const todayStr = format(new Date(), 'yyyy-MM-dd');
                  const cnt = (f === 'makeup' ? makeupItems : lookItems).filter(i => i.published && (i.dates ?? []).includes(todayStr)).length;
                  return (
                    <button key={f} onClick={() => setLibFilter(f)} style={{ height: 30, padding: '0 14px', borderRadius: 9999, border: `1.5px solid ${libFilter === f ? '#0C0C0A' : 'rgba(12,12,10,.14)'}`, background: libFilter === f ? '#0C0C0A' : 'transparent', fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 12, fontWeight: 700, color: libFilter === f ? '#fff' : '#9A9490', cursor: 'pointer', transition: 'all .15s', display: 'flex', alignItems: 'center', gap: 5 }}>
                      {f === 'makeup' ? 'Makeup' : 'Lookbook'}
                      {cnt > 0 && <span style={{ width: 16, height: 16, borderRadius: 9999, background: '#C5FF00', color: '#0C0C0A', fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{cnt}</span>}
                    </button>
                  );
                })}
              </div>
              {(libFilter === 'makeup' ? makeupItems : lookItems).length === 0 ? (
                <div style={{ padding: '32px 20px', textAlign: 'center', border: '1.5px dashed rgba(12,12,10,.14)', borderRadius: 16, background: '#F4F4F0', marginBottom: 20 }}>
                  <div style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 13, color: '#9A9490' }}>LOG 탭에서 등록한 아이템이 여기에 표시됩니다</div>
                </div>
              ) : (
                (() => {
                  const todayStr = format(new Date(), 'yyyy-MM-dd');
                  const sorted = [...(libFilter === 'makeup' ? makeupItems : lookItems)].sort((a, b) => {
                    const aOn = a.published && (a.dates ?? []).includes(todayStr) ? 1 : 0;
                    const bOn = b.published && (b.dates ?? []).includes(todayStr) ? 1 : 0;
                    return bOn - aOn;
                  });
                  return sorted.map(item => (
                    <LogLibraryCard key={item.id} item={item} products={products} />
                  ));
                })()
              )}
            </div>
          </div>
        )}

      </div>

      {/* FAB — LOG 탭에서만 노출 (design/log.html .fab 패턴) */}
      {mainTab === 'log' && (
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
    </div>
  );
}
