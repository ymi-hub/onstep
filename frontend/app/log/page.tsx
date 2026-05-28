// app/log/page.tsx — LOG 페이지
// Stage 6: 월별 캘린더 + 날짜별 루틴 수행 기록
//
// 💡 이 파일에서 구현하는 기능:
//   1. Firebase Auth — Google 로그인/로그아웃 (today 페이지와 동일한 패턴)
//   2. 월별 캘린더 뷰 — 루틴 수행한 날에 도트 표시
//   3. 날짜 클릭 → 그날 아침/저녁 사용 제품 상세 카드
//   4. 최근 7일 요약 스트립

'use client';

import { useState, useEffect } from 'react';
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
import UserMenuButton from '@/components/UserMenuButton';

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

// ─── 상수 ─────────────────────────────────────────────────────────────────────

const FALLBACK_USER_ID = 'demo-user';

// 요일 헤더 (일 ~ 토)
const WEEK_DAYS = ['일', '월', '화', '수', '목', '금', '토'];

// ─── 유틸 ─────────────────────────────────────────────────────────────────────

// Date → "YYYY-MM-DD" 문자열
function toDateStr(d: Date): string {
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

      <UserMenuButton user={user} onLogin={onLogin} onLogout={onLogout} />
    </div>
  );
}

// ─── 월별 캘린더 ─────────────────────────────────────────────────────────────
//
// 💡 캘린더 동작 방식:
//   - 해당 월의 1일이 몇 요일인지 계산 → 앞에 빈 칸 채우기
//   - 각 날짜 셀에 라임 도트를 표시 (아침 / 저녁 구분)
//   - 선택된 날짜는 블랙 원으로 하이라이트

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
  // 이번 달의 모든 날짜 배열
  const days = eachDayOfInterval({
    start: startOfMonth(currentMonth),
    end: endOfMonth(currentMonth),
  });

  // 1일의 요일 (0=일, 1=월, ... 6=토) → 앞에 채울 빈 셀 수
  const startBlank = getDay(days[0]);

  return (
    <div style={{ padding: '0 16px 16px' }}>
      {/* 월 네비게이션 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
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

              {/* 도트 영역 */}
              <div style={{ display: 'flex', gap: 2, height: 6, alignItems: 'center' }}>
                {/* 아침 도트 */}
                {log?.hasMorning && (
                  <span
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: 9999,
                      // 선택된 날은 흰색, 아닌 날은 라임색
                      background: isSelected ? '#FFFFFF' : '#C5FF00',
                      flexShrink: 0,
                    }}
                  />
                )}
                {/* 저녁 도트 */}
                {log?.hasEvening && (
                  <span
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: 9999,
                      background: isSelected ? 'rgba(255,255,255,0.6)' : '#0C0C0A',
                      flexShrink: 0,
                    }}
                  />
                )}
                {/* 로그 없으면 빈 자리 유지 (레이아웃 안 흔들리도록) */}
                {!hasLog && <span style={{ width: 5, height: 5 }} />}
              </div>
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
          borderTop: '1px solid rgba(12,12,10,.07)',
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
  onClose,
}: {
  dateStr: string;
  dayLog: DayLog | undefined;
  products: Map<string, Product>;
  onClose: () => void;
}) {
  // dateStr → 읽기 좋은 날짜 텍스트로 변환
  const dateLabel = format(parseISO(dateStr), 'M월 d일 (EEE)', { locale: ko });

  const morningEntries = dayLog?.entries.filter((e) => e.timeSlot === 'morning') ?? [];
  const eveningEntries = dayLog?.entries.filter((e) => e.timeSlot === 'evening') ?? [];

  // 같은 제품이 여러 번 중복 기록될 수 있으므로, productId 기준으로 중복 제거
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

  // 시간대 섹션 렌더러
  const renderSlot = (
    label: string,
    icon: string,
    entries: LogEntry[],
    hasLog: boolean,
  ) => (
    <div
      style={{
        background: '#FFFFFF',
        border: '1px solid rgba(12,12,10,.07)',
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
          borderBottom: '1px solid rgba(12,12,10,.07)',
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
          <div
            style={{
              fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
              fontSize: 12,
              color: '#9A9490',
              textAlign: 'center',
              padding: '10px 0',
            }}
          >
            {hasLog ? '기록 없음' : '미완료'}
          </div>
        ) : (
          entries.map((entry) => {
            const product = products.get(entry.productId);
            return (
              <div
                key={entry.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                {/* 제품 아이콘 원 */}
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 9999,
                    background: '#EEEDE9',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 12,
                    flexShrink: 0,
                  }}
                >
                  🧴
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
                      fontSize: 13,
                      fontWeight: 600,
                      color: '#0C0C0A',
                      overflow: 'hidden',
                      whiteSpace: 'nowrap',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {product?.name ?? '알 수 없는 제품'}
                  </div>
                  {entry.amount != null && entry.amount > 0 && (
                    <div
                      style={{
                        fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
                        fontSize: 11,
                        color: '#9A9490',
                        marginTop: 1,
                      }}
                    >
                      {entry.amount}
                      {product?.itemUnit ? ` ${product.itemUnit}` : ''} 사용
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );

  return (
    <div
      style={{
        margin: '0 16px',
        background: '#FFFFFF',
        border: '1px solid rgba(12,12,10,.07)',
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
          borderBottom: '1px solid rgba(12,12,10,.07)',
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
        {renderSlot('MORNING', '☀', morningUniq, dayLog?.hasMorning ?? false)}
        {renderSlot('NIGHT', '🌙', eveningUniq, dayLog?.hasEvening ?? false)}
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
                }}
              >
                {format(day, 'd')}
              </span>

              {/* 상태 원 */}
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 9999,
                  background: bothDone
                    ? '#C5FF00'
                    : halfDone
                    ? 'rgba(197,255,0,0.5)'
                    : 'rgba(12,12,10,.1)',
                  flexShrink: 0,
                }}
              />
            </button>
          );
        })}
      </div>
    </div>
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
  // ── 인증 상태 ──
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // ── 캘린더 상태 ──
  const [currentMonth, setCurrentMonth] = useState(new Date()); // 현재 보여주는 달
  const [selectedDate, setSelectedDate] = useState<string | null>(null); // 선택된 날짜

  // ── 데이터 상태 ──
  // dayLogs: "YYYY-MM-DD" → DayLog 맵
  const [dayLogs, setDayLogs] = useState<Map<string, DayLog>>(new Map());
  const [products, setProducts] = useState<Map<string, Product>>(new Map());
  const [dataLoading, setDataLoading] = useState(false);

  // ── 현재 userId ──
  const userId = user?.uid ?? FALLBACK_USER_ID;

  // ── Firebase Auth 감지 ──
  useEffect(() => {
    if (!auth) {
      setAuthLoading(false);
      return;
    }
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
      if (!u) { setDayLogs(new Map()); setProducts(new Map()); setSelectedDate(null); }
    });
    return () => unsub();
  }, []);

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

  // ── 실시간 구독 2: 제품 목록 ──
  useEffect(() => {
    if (authLoading || !user || !db) return;
    const _db = db;
    const unsub = onSnapshot(collection(_db, 'users', userId, 'products'), (snap) => {
      const map = new Map<string, Product>();
      snap.docs.forEach((d) => map.set(d.id, { id: d.id, ...(d.data() as Omit<Product, 'id'>) }));
      setProducts(map);
    }, (err) => console.error('[OnStep] 제품 로드 실패:', err));
    return () => unsub();
  }, [userId, authLoading, user]);

  // ── 로그인 / 로그아웃 ──
  const handleLogin = async () => {
    if (!auth) { alert('Firebase가 설정되지 않았습니다. .env.local을 확인해주세요.'); return; }
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, provider);
    } catch (err) {
      console.error('[OnStep] 로그인 실패:', err);
    }
  };

  const handleLogout = async () => {
    if (!auth) return;
    try {
      await signOut(auth);
      setDayLogs(new Map());
      setSelectedDate(null);
    } catch (err) {
      console.error('[OnStep] 로그아웃 실패:', err);
    }
  };

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
    <div style={{ background: '#FAFAF8', minHeight: '100%' }}>
      <Appbar user={user} onLogin={handleLogin} onLogout={handleLogout} />

      <div style={{ paddingBottom: 32 }}>

        {/* 페이지 헤더 */}
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
            LOG
          </h1>
          <p
            style={{
              fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
              fontSize: 13,
              color: '#9A9490',
              marginTop: 4,
              marginBottom: 0,
            }}
          >
            {format(currentMonth, 'M월', { locale: ko })} · {completedDays}/{totalDaysInMonth}일 완료
          </p>
        </div>

        {/* 최근 7일 요약 스트립 */}
        <div style={{ padding: '20px 0 0' }}>
          <RecentStrip
            dayLogs={dayLogs}
            selectedDate={selectedDate}
            onSelectDate={handleSelectDate}
          />
        </div>

        {/* 구분선 */}
        <div style={{ height: 1, background: 'rgba(12,12,10,.07)', margin: '20px 16px' }} />

        {/* 월별 캘린더 */}
        <MonthCalendar
          currentMonth={currentMonth}
          dayLogs={dayLogs}
          selectedDate={selectedDate}
          onSelectDate={handleSelectDate}
          onPrevMonth={() => {
            setCurrentMonth((m) => subMonths(m, 1));
            setSelectedDate(null);
          }}
          onNextMonth={() => {
            setCurrentMonth((m) => addMonths(m, 1));
            setSelectedDate(null);
          }}
        />

        {/* 선택된 날짜 상세 or 빈 상태 */}
        {selectedDate ? (
          <DayDetail
            dateStr={selectedDate}
            dayLog={selectedDayLog}
            products={products}
            onClose={() => setSelectedDate(null)}
          />
        ) : (
          // 로그가 아예 없을 때만 빈 상태 표시
          dayLogs.size === 0 && (
            <EmptyState isLoading={dataLoading || authLoading} />
          )
        )}

      </div>
    </div>
  );
}
