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
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import {
  onAuthStateChanged,
  signInWithRedirect,
  GoogleAuthProvider,
  type User,
} from 'firebase/auth';
import { db, auth, storage } from '@/lib/firebase';
import type { Product } from '@/types/product';
import { EXPERT_TIP_HIGHLIGHT } from '@/components/ExpertTipField';
import PageHeader from '@/components/PageHeader';
import SectionHeader from '@/components/SectionHeader';

// ─── 타입 정의 ────────────────────────────────────────────────────────────────
// setup/page.tsx에서 사용하는 Firestore 데이터 구조와 동일하게 맞춤

// 칩 스트립 아이템 타입
type RoutineItem =
  | { type: 'product'; id: string }
  | { type: 'desc'; text: string }
  | { type: 'tip'; text: string }
  | { type: 'plus' }
  | { type: 'minus' };

// 슬롯의 단일 DAY
type SlotDay = {
  id: number;
  items: RoutineItem[];
  tipItems: RoutineItem[];
  expertTip: string;
};

// 아침/저녁 슬롯
type Slot = {
  days: SlotDay[];
};

// 데이터 없는 슬롯 폴백 (나이트 미등록 시에도 탭 표시용)
const EMPTY_SLOT_DAY: SlotDay = { id: 0, items: [], tipItems: [], expertTip: '' };

// 하루(DAY N) 루틴
// Firestore에 저장된 루틴 세션 (1개 = 1회차)
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

// 오늘 아침/저녁 각각 체크됐는지 여부
type CheckState = { morning: boolean; evening: boolean; };

// 습관 트래커 타입 (setup/page.tsx와 동일 구조)
type RepeatType = 'allday' | 'once' | 'daily' | 'scheduled';
type Habit = {
  id: string;
  icon: string;
  name: string;
  repeatType: RepeatType;
  time: string;
  alarm: boolean;
  date?: string;
  weekdays?: number[];
  showInToday?: boolean;
};

// 집중케어 / 메이크업 CT 아이템 타입 (setup/page.tsx CtItem과 동일)
type CtItem = {
  id: string;
  ctType: 'care' | 'makeup' | 'lookbook';
  emoji: string;
  name: string;
  desc: string;
  items: RoutineItem[];
  tipItems: RoutineItem[];
  expertTip?: string;
  imageUrl?: string;
  sourceUrl?: string;
  periodStart?: string;
  periodEnd?: string;
  dates?: string[];
  published: boolean;
};

// OOTD 오늘의 룩 기록 타입
type OOTDLog = {
  id: string;
  date: string;
  theme: string;
  note: string;
  photoUrl: string;
  createdAt: string;
};

const OOTD_THEMES = ['캐주얼', '오피스룩', '스트릿', '미니멀', '빈티지', '스포티', '포멀', '로맨틱'];

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
function migrateRawSlot(raw: unknown): SlotDay[] {
  const s = raw as Record<string, unknown>;
  if (Array.isArray(s.days)) return s.days as SlotDay[];
  const items: RoutineItem[] = Array.isArray(s.items) ? s.items as RoutineItem[] : [];
  if (Array.isArray(s.phases)) {
    const ph = s.phases as Array<{ productIds?: string[]; instruction?: string }>;
    ph.forEach((p, i) => {
      (p.productIds ?? []).forEach((id) => items.push({ type: 'product', id }));
      if (p.instruction) items.push({ type: 'desc', text: p.instruction });
      if (i < ph.length - 1) items.push({ type: 'plus' });
    });
  }
  return [{ id: 1, items, tipItems: [], expertTip: (s.expertTip as string) ?? '' }];
}

// Firestore 문서 → Session (구버전 포맷 자동 변환)
function migrateSession(raw: Record<string, unknown>, id: string): Session {
  const r = raw;
  // 최신 포맷: morning.days, evening.days
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
    morning: { days: [{ id: 1, items: [], tipItems: [], expertTip: '' }] },
    evening: { days: [{ id: 1, items: [], tipItems: [], expertTip: '' }] },
    createdAt: (r.createdAt as string) ?? '',
    updatedAt: (r.updatedAt as string) ?? '',
  };
}

// 오늘(YYYY-MM-DD) 날짜 문자열 반환
function getTodayDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 오늘 수행해야 하는 습관인지 판별
function isHabitToday(h: Habit): boolean {
  const todayWD = new Date().getDay();
  const todayStr = getTodayDateStr();
  if (h.repeatType === 'allday' || h.repeatType === 'daily') return true;
  if (h.repeatType === 'once') return h.date === todayStr;
  if (h.repeatType === 'scheduled') return (h.weekdays ?? []).includes(todayWD);
  return false;
}

// ─── 날씨 위젯 ────────────────────────────────────────────────────────────────
// Open-Meteo API: 무료, API 키 불필요, 위치 권한으로 현재 날씨 표시

type WeatherData = { temp: number; desc: string; emoji: string };

const WMO_MAP: Record<number, [string, string]> = {
  0: ['맑음', '☀️'], 1: ['대체로 맑음', '🌤'], 2: ['구름 조금', '⛅️'], 3: ['흐림', '☁️'],
  45: ['안개', '🌫'], 48: ['안개', '🌫'],
  51: ['가는 이슬비', '🌦'], 53: ['이슬비', '🌦'], 55: ['짙은 이슬비', '🌦'],
  61: ['약한 비', '🌧'], 63: ['비', '🌧'], 65: ['강한 비', '🌧'],
  71: ['약한 눈', '🌨'], 73: ['눈', '🌨'], 75: ['강한 눈', '❄️'],
  80: ['소나기', '🌦'], 81: ['소나기', '🌧'], 82: ['강한 소나기', '⛈'],
  95: ['뇌우', '⛈'], 96: ['뇌우+우박', '⛈'], 99: ['강한 뇌우', '⛈'],
};

function WeatherWidget() {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [locName, setLocName] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // requested: 캐시 복원 또는 버튼 클릭으로 이미 요청한 상태
  const [requested, setRequested] = useState(false);

  useEffect(() => {
    // 캐시된 날씨 복원 (30분 이내)
    const cached = typeof localStorage !== 'undefined' ? localStorage.getItem('onstep_weather_v5') : null;
    if (cached) {
      try {
        const d = JSON.parse(cached);
        if (Date.now() - d.ts < 30 * 60 * 1000) {
          setWeather(d.weather);
          setLocName(d.locName);
          setRequested(true);
          return; // 캐시 유효 → 재요청 불필요
        }
      } catch { /* ignore */ }
    }
    // 캐시 없거나 만료 → 자동으로 위치 요청
    fetchWeather();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchWeather = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setError('위치 정보를 지원하지 않는 브라우저입니다.');
      return;
    }
    setLoading(true);
    setRequested(true);
    setError('');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lon } = pos.coords;
        try {
          // weather_code (언더스코어) 가 현재 Open-Meteo API 표준 필드명
          const res = await fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&current=temperature_2m,weather_code&timezone=auto`
          );
          const data = await res.json();
          // weather_code 와 weathercode(구버전) 모두 대응
          const code: number = data.current?.weather_code ?? data.current?.weathercode ?? 0;
          const temp: number = Math.round(data.current?.temperature_2m ?? 0);
          const [desc, emoji] = WMO_MAP[code] ?? ['알 수 없음', '🌡'];
          const w: WeatherData = { temp, desc, emoji };

          let name = '';
          try {
            const geo = await fetch(
              `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=ko`
            );
            const gd = await geo.json();
            name = gd.address?.city || gd.address?.town || gd.address?.county || gd.address?.state || '';
          } catch { /* 위치명은 없어도 날씨는 표시 */ }

          setWeather(w);
          setLocName(name);
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem('onstep_weather_v5', JSON.stringify({ ts: Date.now(), weather: w, locName: name }));
          }
        } catch (e) {
          console.error('[OnStep] 날씨 fetch 실패:', e);
          setError('날씨 정보를 가져오지 못했습니다.');
        }
        setLoading(false);
      },
      (err) => {
        console.error('[OnStep] 위치 권한 오류:', err.code, err.message);
        setError(err.code === 1 ? 'denied' : '위치 정보를 가져오지 못했습니다.');
        setLoading(false);
      },
      { timeout: 10000 }
    );
  };

  const f = "'Plus Jakarta Sans', 'Space Grotesk', sans-serif";

  if (loading || !requested) {
    return (
      <div style={{ padding: '10px 16px 4px' }}>
        <div style={{ fontFamily: f, fontSize: 12, color: '#BCBAB6' }}>날씨 불러오는 중…</div>
      </div>
    );
  }

  if (error) {
    // 위치 권한 거부 → 시스템 설정으로 안내
    if (error === 'denied') {
      return (
        <div style={{ padding: '10px 16px 4px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontFamily: f, fontSize: 12, color: '#9A9490' }}>📍 위치 권한 필요</span>
          <a
            href="app-settings:"
            onClick={(e) => {
              e.preventDefault();
              // iOS: app-settings, Android/Desktop: permissions API
              if (/iPhone|iPad|iPod/.test(navigator.userAgent)) {
                window.location.href = 'app-settings:';
              } else {
                // 브라우저 설정 안내
                alert('브라우저 주소창 왼쪽 자물쇠(🔒) 아이콘 → 위치 → 허용으로 변경해주세요.');
              }
            }}
            style={{ fontFamily: f, fontSize: 11, fontWeight: 700, color: '#0C0C0A', textDecoration: 'underline', cursor: 'pointer' }}
          >
            설정 열기
          </a>
          <button onClick={() => { setError(''); fetchWeather(); }} style={{ background: 'none', border: 'none', fontFamily: f, fontSize: 11, color: '#9A9490', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>재시도</button>
        </div>
      );
    }
    return (
      <div style={{ padding: '10px 16px 4px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontFamily: f, fontSize: 12, color: '#9A9490' }}>날씨 정보 없음</span>
        <button onClick={() => { setError(''); fetchWeather(); }} style={{ background: 'none', border: 'none', fontFamily: f, fontSize: 11, color: '#9A9490', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>재시도</button>
      </div>
    );
  }

  if (!weather) return null;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px 4px' }}>
      <div style={{ width: 40, height: 40, background: '#C5FF00', borderRadius: 10, border: '2px solid #91C000', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, lineHeight: 1 }}>
        {weather.emoji}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {locName && (
          <div style={{ fontFamily: f, fontSize: 11, fontWeight: 600, color: '#9A9490', letterSpacing: '.04em', lineHeight: 1 }}>{locName}</div>
        )}
        <div style={{ fontFamily: f, fontSize: 13, fontWeight: 500, color: '#0C0C0A', lineHeight: 1 }}>
          {weather.temp}°C · {weather.desc}
        </div>
      </div>
    </div>
  );
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

      {/* DAY 진행 도트 */}
      <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
        {session ? (
          // 루틴 있음 — DAY 수만큼 도트 표시
          // 지나간 날: 라임색 / 오늘: 긴 라임 / 앞으로: 회색
          Array.from({ length: Math.max(session.morning.days.length, session.evening.days.length) }, (_, i) => i + 1).map((dayNum) => (
            <span
              key={dayNum}
              style={{
                width: dayNum === todayDayNumber ? 20 : 10,
                height: 10,
                borderRadius: 9999,
                background:
                  dayNum < todayDayNumber
                    ? '#C5FF00'
                    : dayNum === todayDayNumber
                    ? '#C5FF00'
                    : '#D8D6CF',
                boxShadow:
                  dayNum === todayDayNumber
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

// ─── 루틴 플로우 카드 ─────────────────────────────────────────────────────────
// today.html .flow-step-card: 아침/저녁 탭 + 제품 스트립 + 체크 버튼

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
      {/* ① 최상단: MORNING / NIGHT 탭 */}
      <div style={{ display: 'flex', padding: '12px 16px 0', gap: 6 }}>
        {(['morning', 'evening'] as const).map((t) => (
          <button
            key={t}
            onClick={() => onTabChange(t)}
            style={{
              height: 32,
              padding: '0 16px',
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
            {(t === 'morning' ? checked.morning : checked.evening) && (
              <span
                style={{
                  position: 'absolute', top: -3, right: -3,
                  width: 12, height: 12,
                  background: '#C5FF00', borderRadius: 9999,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 7, fontWeight: 900, color: '#0C0C0A',
                }}
              >✓</span>
            )}
          </button>
        ))}
      </div>

      {/* ② 칩 스트립 + EXPERT TIP */}
      {slot.items.length > 0 ? (
        <div style={{ padding: '10px 16px 0' }}>
          <div style={{ display: 'flex', overflowX: 'auto', scrollbarWidth: 'none', gap: 8, alignItems: 'flex-end', paddingBottom: 4 }}>
            {slot.items.map((item, idx) => {
              if (item.type === 'product') {
                const p = products.get(item.id);
                return (
                  <div key={idx} style={{ flexShrink: 0, width: 90, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0, opacity: isChecked ? 0.45 : 1, transition: 'opacity .2s' }}>
                    <div style={{ width: 90, height: 90, background: '#EEEDE9', borderRadius: 12, border: '1px solid rgba(0,0,0,.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>
                      {(p?.imageUrl || p?.storageUrl)
                        ? <img src={p!.imageUrl || p!.storageUrl} alt={p!.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : <span style={{ fontSize: 24, opacity: 0.4 }}>🧴</span>
                      }
                      {isChecked && (
                        <div style={{ position: 'absolute', inset: 0, background: 'rgba(12,12,10,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 12, zIndex: 3 }}>
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                        </div>
                      )}
                    </div>
                    <div style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 12, fontWeight: 700, color: '#0C0C0A', marginTop: 6, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, width: '100%', textAlign: 'center' as const }}>
                      {p?.name ?? '?'}
                    </div>
                  </div>
                );
              }
              if (item.type === 'desc') return (
                <div key={idx} style={{ flexShrink: 0, alignSelf: 'center', padding: '5px 10px', background: '#2185fd', borderRadius: 16, border: '1px solid rgba(0,0,0,.06)', fontSize: 12, fontWeight: 400, color: '#fff', whiteSpace: 'nowrap', lineHeight: 1, opacity: isChecked ? 0.45 : 1, fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif" }}>
                  {item.text}
                </div>
              );
              if (item.type === 'tip') return (
                <div key={idx} style={{ flexShrink: 0, alignSelf: 'center', padding: '0 8px', minWidth: 36, height: 22, background: 'rgba(197,255,0,.22)', borderRadius: 12, fontSize: 12, fontWeight: 800, color: '#4E7D00', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', whiteSpace: 'nowrap', opacity: isChecked ? 0.45 : 1, fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif" }}>
                  {item.text || 'TIP'}
                </div>
              );
              if (item.type === 'plus') return (
                <div key={idx} style={{ flexShrink: 0, alignSelf: 'center', width: 36, height: 22, borderRadius: 12, background: 'rgba(33,150,243,.12)', color: '#1976D2', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, opacity: isChecked ? 0.45 : 1 }}>+</div>
              );
              return (
                <div key={idx} style={{ flexShrink: 0, alignSelf: 'center', width: 36, height: 22, borderRadius: 12, background: 'rgba(255,152,0,.2)', color: '#E65100', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, opacity: isChecked ? 0.45 : 1 }}>→</div>
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

          {/* EXPERT TIP */}
          {slot.expertTip && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 16, background: '#F5FDD4', border: '1px solid rgba(198,244,50,.5)', borderRadius: 16, marginTop: 8, marginBottom: 12 }}>
              <div style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 13, fontWeight: 600, color: '#0C0C0A', display: 'flex', alignItems: 'center', gap: 6 }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/></svg>
                EXPERT TIP
              </div>
              <div style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 13, color: '#4A4846', lineHeight: 1.6 }}>
                {highlightProductNames(slot.expertTip, products)}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div style={{ padding: '28px 20px', textAlign: 'center', fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 13, color: '#9A9490', border: '1.5px dashed rgba(12,12,10,.14)', borderRadius: 20, lineHeight: 1.6, margin: '16px' }}>
          이 시간대에 등록된 제품이 없습니다.<br />SETUP에서 아이템을 추가해보세요.
        </div>
      )}

      {/* ④ 체크 버튼 — 제품이 없으면 비활성 */}
      <div style={{ padding: '12px 16px 14px' }}>
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
                background: !hasProducts ? '#F4F4F0' : isChecked ? '#C5FF00' : '#F4F4F0',
                color: !hasProducts ? '#BCBAB6' : isChecked ? '#0C0C0A' : '#4A4846',
                border: !hasProducts ? '1.5px solid rgba(12,12,10,.07)' : isChecked ? '1.5px solid #84B000' : '1.5px solid rgba(12,12,10,.1)',
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
              {saving ? '저장 중...' : !hasProducts ? '제품을 먼저 등록해주세요' : isChecked ? (
                <>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  스킨케어 체크 완료
                </>
              ) : (
                '스킨케어 체크'
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

      {/* 습관 목록 */}
      <div style={{ margin: '0 16px', background: '#FFFFFF', border: '1px solid rgba(12,12,10,.07)', borderRadius: 20, overflow: 'hidden', boxShadow: '0 1px 2px rgba(0,0,0,.04)' }}>
        {todayHabits.map((h, idx) => {
          const isDone = habitChecked.has(h.id);
          return (
            <div
              key={h.id}
              onClick={() => onToggle(h.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '14px 16px',
                borderTop: idx > 0 ? '1px solid rgba(12,12,10,.07)' : 'none',
                cursor: 'pointer',
                background: isDone ? 'rgba(197,255,0,.08)' : 'transparent',
                transition: 'background .18s',
              }}
            >
              {/* 좌: 체크 + 아이콘 + 이름 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {/* 체크박스 */}
                <div style={{
                  width: 22, height: 22, borderRadius: 6,
                  border: `2px solid ${isDone ? '#8AB000' : 'rgba(12,12,10,.2)'}`,
                  background: isDone ? '#C5FF00' : '#fff',
                  flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all .2s',
                }}>
                  {isDone && (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#0C0C0A" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </div>
                {/* 이모지 아이콘 */}
                <span style={{ fontSize: 18, lineHeight: 1, width: 24, textAlign: 'center', flexShrink: 0 }}>
                  {h.icon || '✦'}
                </span>
                {/* 습관 이름 */}
                <span style={{
                  fontFamily: f, fontSize: 15, fontWeight: 400,
                  color: isDone ? '#9A9490' : '#0C0C0A',
                  textDecoration: isDone ? 'line-through' : 'none',
                  transition: 'all .18s',
                }}>
                  {h.name}
                </span>
              </div>

              {/* 우: 알람 시각 (종일/비종일) */}
              {h.time && h.repeatType !== 'allday' && (
                <div style={{
                  fontFamily: f, fontSize: 12, fontWeight: 700,
                  color: isDone ? '#BCBAB6' : '#5A7000',
                  background: isDone ? 'rgba(12,12,10,.06)' : 'rgba(197,255,0,.2)',
                  padding: '3px 10px', borderRadius: 9999,
                  whiteSpace: 'nowrap' as const,
                  display: 'flex', alignItems: 'center', gap: 4,
                }}>
                  🔔 {h.time}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 하단 List → 링크 (HABITS 화면으로 이동) */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8, padding: '0 16px' }}>
        <Link
          href="/setup#tracker"
          style={{
            fontFamily: f, fontSize: 12, fontWeight: 700,
            color: '#9A9490', textDecoration: 'none',
            letterSpacing: '.04em',
          }}
        >
          List →
        </Link>
      </div>
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

// ─── 로그인 필요 카드 ────────────────────────────────────────────────────────

function LoginRequiredCard({ onLogin }: { onLogin: () => void }) {
  return (
    <div
      style={{
        margin: '0 16px',
        background: '#FFFFFF',
        border: '1px solid rgba(12,12,10,.07)',
        boxShadow: '0 1px 2px rgba(0,0,0,.04), 0 0 0 1px rgba(0,0,0,.03)',
        borderRadius: 20,
        padding: '32px 24px',
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
          padding: '10px 24px',
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
  user,
  activeLookItems,
  products,
}: {
  ootdLog: OOTDLog | null;
  onRecord: () => void;
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

      <div style={{ padding: '0 16px' }}>

        {/* ── MOTD와 동일한 흰 카드 — 제목 + 제품 ── */}
        {heroLook && (
          <div style={{ background: '#fff', borderRadius: 20, overflow: 'hidden', boxShadow: '0 2px 16px rgba(0,0,0,.07),0 0 0 1px rgba(0,0,0,.04)', marginBottom: 12 }}>

            {/* 이미지 있을 때: 3:4 portrait hero */}
            {heroLook.imageUrl ? (
              <div style={{ position: 'relative', width: '100%', aspectRatio: '3/4', background: '#1C1C1C', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={heroLook.imageUrl} alt={heroLook.name} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '60px 16px 18px', background: 'linear-gradient(to top,rgba(0,0,0,.56) 0%,transparent 55%)', pointerEvents: 'none' }}>
                  <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase' as const, color: 'rgba(255,255,255,.7)', marginBottom: 5 }}>TODAY&apos;S LOOK</div>
                  <div style={{ fontFamily: f, fontSize: 17, fontWeight: 700, color: '#fff', lineHeight: 1.25 }}>{heroLook.name}</div>
                  {heroLook.desc && <div style={{ fontFamily: f, fontSize: 12, color: 'rgba(255,255,255,.6)', marginTop: 3 }}>{heroLook.desc}</div>}
                </div>
              </div>
            ) : (
              /* 이미지 없을 때: 텍스트 제목 (집중케어 방식) */
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px 12px' }}>
                <span style={{ fontSize: 22, flexShrink: 0 }}>{heroLook.emoji || '👗'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: f, fontSize: 15, fontWeight: 800, color: '#0C0C0A', letterSpacing: '-.01em' }}>{heroLook.name}</div>
                  {heroLook.desc && <div style={{ fontFamily: f, fontSize: 12, color: '#9A9490', marginTop: 2 }}>{heroLook.desc}</div>}
                </div>
              </div>
            )}

            {/* 제품 가로 스크롤 — MOTD와 동일 스타일 */}
            {heroProdIds.length > 0 && (
              <div style={{ display: 'flex', overflowX: 'auto', scrollbarWidth: 'none' as const, gap: 8, padding: '16px 0 16px', scrollSnapType: 'x mandatory' as const, borderTop: heroLook.imageUrl ? 'none' : '1px solid rgba(12,12,10,.06)' }}>
                <div style={{ flexShrink: 0, width: 16 }} />
                {heroProdIds.map(pid => {
                  const p = products.get(pid);
                  const imgUrl = p?.imageUrl || p?.storageUrl;
                  return (
                    <div key={pid} style={{ flexShrink: 0, width: 90, scrollSnapAlign: 'start' as const, display: 'flex', flexDirection: 'column', gap: 0 }}>
                      <div style={{ width: 90, height: 90, background: '#EDECE9', borderRadius: 12, border: '1px solid rgba(0,0,0,.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                        {imgUrl
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={imgUrl} alt={p?.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          : <span style={{ fontSize: 24, opacity: 0.3 }}>👗</span>
                        }
                      </div>
                      <div style={{ fontFamily: f, fontSize: 12, fontWeight: 700, color: '#0C0C0A', marginTop: 6, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, textAlign: 'center' as const }}>{p?.name ?? '—'}</div>
                      {p?.brand && <div style={{ fontFamily: f, fontSize: 11, color: '#9A9490', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, textAlign: 'center' as const }}>{p.brand}</div>}
                    </div>
                  );
                })}
                <div style={{ flexShrink: 0, width: 16 }} />
              </div>
            )}

            {/* 참고 링크 — 카드 하단 */}
            <SourceLink url={heroLook.sourceUrl} />

            {/* 카드 하단: Edit → Log 화면 */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '10px 16px 12px', borderTop: '1px solid rgba(12,12,10,.06)' }}>
              <Link href="/log" style={{ fontFamily: f, fontSize: 12, fontWeight: 700, color: '#BCBAB6', textDecoration: 'none', letterSpacing: '.04em' }}>List →</Link>
            </div>
          </div>
        )}

        {/* ── RECORD LOOK / Logged 카드 ── */}
        {!user ? (
          <div style={{ padding: '20px', textAlign: 'center', fontFamily: f, fontSize: 13, color: '#9A9490', border: '1.5px dashed rgba(12,12,10,.14)', borderRadius: 20, lineHeight: 1.6 }}>
            로그인하면 오늘의 룩을 기록할 수 있어요
          </div>
        ) : ootdLog ? (
          <div onClick={onRecord} style={{ border: '1.5px solid #4caf78', borderRadius: 9999, minHeight: 52, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', background: '#fff', transition: 'background .2s' }}>
            <div style={{ width: 36, height: 36, borderRadius: 9999, background: '#E8E6E0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0, overflow: 'hidden' }}>
              {ootdLog.photoUrl
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={ootdLog.photoUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
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
          <div onClick={onRecord} style={{ border: '1.5px dashed rgba(12,12,10,.14)', borderRadius: 9999, minHeight: 52, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', background: '#fff', transition: 'background .2s' }}>
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
      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px', borderTop: '1px solid rgba(12,12,10,.07)', textDecoration: 'none', fontFamily: f, fontSize: 11, fontWeight: 700, color: '#4A4846', letterSpacing: '.04em', background: 'rgba(0,0,0,.02)' }}
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
// FlowCard 칩 스타일과 동일하게 구현 (제품·설명·TIP·+·→ 칩 + EXPERT TIP)

function CareSection({ items, products }: { items: CtItem[]; products: Map<string, Product> }) {
  if (items.length === 0) return null;
  const f = "'Plus Jakarta Sans', 'Space Grotesk', sans-serif";

  // FlowCard와 동일한 칩 렌더러
  function renderChip(item: RoutineItem, idx: number) {
    if (item.type === 'product') {
      const p = products.get(item.id);
      return (
        <div key={idx} style={{ flexShrink: 0, width: 90, display: 'flex', flexDirection: 'column', gap: 0 }}>
          <div style={{ width: 90, height: 90, background: '#EEEDE9', borderRadius: 12, border: '1px solid rgba(0,0,0,.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            {(p?.imageUrl || p?.storageUrl)
              ? <img src={p!.imageUrl || p!.storageUrl} alt={p!.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <span style={{ fontSize: 24, opacity: 0.4 }}>🧴</span>
            }
          </div>
          <div style={{ fontFamily: f, fontSize: 12, fontWeight: 700, color: '#0C0C0A', marginTop: 6, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, width: '100%', textAlign: 'center' as const }}>
            {p?.name ?? '?'}
          </div>
        </div>
      );
    }
    if (item.type === 'desc') return (
      <div key={idx} style={{ flexShrink: 0, alignSelf: 'center', padding: '5px 10px', background: '#2185fd', borderRadius: 16, fontSize: 12, fontWeight: 400, color: '#fff', whiteSpace: 'nowrap' as const, lineHeight: 1, fontFamily: f }}>
        {item.text}
      </div>
    );
    if (item.type === 'tip') return (
      <div key={idx} style={{ flexShrink: 0, alignSelf: 'center', padding: '0 8px', minWidth: 36, height: 22, background: 'rgba(197,255,0,.22)', borderRadius: 12, fontSize: 12, fontWeight: 800, color: '#4E7D00', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', whiteSpace: 'nowrap' as const, fontFamily: f }}>
        {item.text || 'TIP'}
      </div>
    );
    if (item.type === 'plus') return (
      <div key={idx} style={{ flexShrink: 0, alignSelf: 'center', width: 36, height: 22, borderRadius: 12, background: 'rgba(33,150,243,.12)', color: '#1976D2', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800 }}>+</div>
    );
    return (
      <div key={idx} style={{ flexShrink: 0, alignSelf: 'center', width: 36, height: 22, borderRadius: 12, background: 'rgba(255,152,0,.2)', color: '#E65100', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800 }}>→</div>
    );
  }

  return (
    <div>
      <SectionHeader title="#Intensive Care" />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '0 16px' }}>
        {items.map((item) => (
          <div key={item.id} style={{ background: '#fff', borderRadius: 20, overflow: 'hidden', boxShadow: '0 2px 16px rgba(0,0,0,.07),0 0 0 1px rgba(0,0,0,.04)' }}>

            {/* 헤더: 이미지 있으면 hero (4:3 landscape), 없으면 이모지+제목 */}
            {item.imageUrl ? (
              <div style={{ position: 'relative', width: '100%', aspectRatio: '4/3', background: '#1C1C1C', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={item.imageUrl} alt={item.name} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '65%', background: 'linear-gradient(to top, rgba(0,0,0,.72) 0%, transparent 100%)', pointerEvents: 'none' }} />
                <div style={{ position: 'absolute', bottom: 14, left: 16, right: 16, fontFamily: f, fontSize: 20, fontWeight: 800, color: '#fff', letterSpacing: '-.02em', lineHeight: 1.15, zIndex: 1 }}>
                  {item.emoji} {item.name}
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 16px 12px' }}>
                <span style={{ fontSize: 20 }}>{item.emoji}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: f, fontSize: 15, fontWeight: 800, color: '#0C0C0A', letterSpacing: '-.01em' }}>{item.name}</div>
                  {item.periodStart && (
                    <div style={{ fontFamily: f, fontSize: 11, color: '#9A9490', marginTop: 2 }}>
                      {item.periodStart}{item.periodEnd ? ` → ${item.periodEnd}` : ''}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 메인 칩 스트립 */}
            {item.items.length > 0 && (
              <div style={{ padding: '10px 16px 12px', borderTop: '1px solid rgba(12,12,10,.06)' }}>
                <div style={{ display: 'flex', overflowX: 'auto', scrollbarWidth: 'none', gap: 8, alignItems: 'flex-end', paddingBottom: 4 }}>
                  {item.items.map((r, i) => renderChip(r, i))}
                </div>
              </div>
            )}

            {/* TIP 칩 스트립 */}
            {(item.tipItems?.length ?? 0) > 0 && (
              <div style={{ padding: '8px 16px 12px', borderTop: '1px dashed rgba(12,12,10,.07)' }}>
                <div style={{ fontFamily: f, fontSize: 10, fontWeight: 800, letterSpacing: '.1em', color: '#4E7D00', marginBottom: 6 }}>TIP</div>
                <div style={{ display: 'flex', overflowX: 'auto', scrollbarWidth: 'none', gap: 8, alignItems: 'flex-end', paddingBottom: 4 }}>
                  {(item.tipItems ?? []).map((r, i) => renderChip(r, i))}
                </div>
              </div>
            )}

            {/* EXPERT TIP */}
            {item.expertTip && (
              <div style={{ padding: '8px 16px 12px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 16, background: '#F5FDD4', border: '1px solid rgba(198,244,50,.5)', borderRadius: 16 }}>
                  <div style={{ fontFamily: f, fontSize: 13, fontWeight: 600, color: '#0C0C0A', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/></svg>
                    EXPERT TIP
                  </div>
                  <div style={{ fontFamily: f, fontSize: 13, color: '#4A4846', lineHeight: 1.6 }}>
                    {highlightProductNames(item.expertTip, products)}
                  </div>
                </div>
              </div>
            )}

            {/* 참고 링크 */}
            <SourceLink url={item.sourceUrl} />

            {/* 카드 하단: List → 오른쪽 정렬 */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '10px 16px 12px', borderTop: '1px solid rgba(12,12,10,.06)' }}>
              <a href="/setup#care" style={{ fontFamily: f, fontSize: 12, fontWeight: 700, color: '#BCBAB6', textDecoration: 'none', letterSpacing: '.04em' }}>List →</a>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── MOTD 섹션 (#MOTD) ──────────────────────────────────────────────────────
// design/today.html #motd-editorial-section 구조 기반
// Hero: 1:1 square + "EDITORIAL CHOICE" 배지 / Products: ed-prod-grid (카테고리+이름)

function MakeupSection({ items, products }: { items: CtItem[]; products: Map<string, Product> }) {
  if (items.length === 0) return null;
  const f = "'Plus Jakarta Sans', 'Space Grotesk', sans-serif";
  return (
    <div>
      <SectionHeader title="#MOTD" action={<a href="/setup" style={{ fontFamily: f, fontSize: 13, fontWeight: 600, color: '#9A9490', textDecoration: 'none' }}>Edit →</a>} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '0 16px' }}>
        {items.map((item) => {
          const prodIds = item.items
            .filter((r): r is { type: 'product'; id: string } => r.type === 'product')
            .map((r) => r.id);
          return (
            <div key={item.id} style={{ background: '#fff', borderRadius: 20, overflow: 'hidden', boxShadow: '0 2px 16px rgba(0,0,0,.07),0 0 0 1px rgba(0,0,0,.04)' }}>

              {/* Hero — 이미지 있을 때만 1:1 square (today.html .editorial-hero 참고) */}
              {item.imageUrl ? (
                <div style={{ position: 'relative', width: '100%', aspectRatio: '1/1', background: '#1C1C1C', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.imageUrl} alt={item.name} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                  {/* "EDITORIAL CHOICE" 배지 (좌상단) */}
                  <div style={{ position: 'absolute', top: 14, left: 14, background: 'rgba(0,0,0,.55)', backdropFilter: 'blur(6px)', borderRadius: 6, padding: '4px 10px', fontFamily: f, fontSize: 10, fontWeight: 700, letterSpacing: '.12em', color: '#fff', textTransform: 'uppercase' as const }}>
                    EDITORIAL CHOICE
                  </div>
                  {/* 하단 그라데이션 + 이름 */}
                  <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '40px 14px 14px', background: 'linear-gradient(to top, rgba(0,0,0,.6) 0%, transparent 60%)', pointerEvents: 'none' }}>
                    <div style={{ fontFamily: f, fontSize: 18, fontWeight: 800, color: '#fff', letterSpacing: '-.02em', lineHeight: 1.2 }}>{item.name}</div>
                    {item.desc && <div style={{ fontFamily: f, fontSize: 12, color: 'rgba(255,255,255,.7)', marginTop: 3 }}>{item.desc}</div>}
                  </div>
                </div>
              ) : (
                /* 이미지 없을 때 — 집중케어 방식 텍스트 제목 */
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px 12px' }}>
                  <span style={{ fontSize: 22, flexShrink: 0 }}>{item.emoji || '💄'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: f, fontSize: 15, fontWeight: 800, color: '#0C0C0A', letterSpacing: '-.01em' }}>{item.name}</div>
                    {item.desc && <div style={{ fontFamily: f, fontSize: 12, color: '#9A9490', marginTop: 2 }}>{item.desc}</div>}
                  </div>
                </div>
              )}

              {/* 제품 그리드 (today.html .editorial-prod-grid / .ed-prod-card) */}
              {prodIds.length > 0 && (
                <div style={{ display: 'flex', overflowX: 'auto', scrollbarWidth: 'none' as const, gap: 8, padding: '16px 0 16px', scrollSnapType: 'x mandatory' as const, borderTop: item.imageUrl ? 'none' : '1px solid rgba(12,12,10,.06)' }}>
                  <div style={{ flexShrink: 0, width: 16 }} />
                  {prodIds.map((pid) => {
                    const p = products.get(pid);
                    const imgUrl = p?.imageUrl || p?.storageUrl;
                    return (
                      <div key={pid} style={{ flexShrink: 0, width: 90, scrollSnapAlign: 'start' as const, display: 'flex', flexDirection: 'column', gap: 0 }}>
                        {/* 제품 이미지 (.ed-prod-img) */}
                        <div style={{ width: 90, height: 90, background: '#EDECE9', borderRadius: 12, border: '1px solid rgba(0,0,0,.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                          {imgUrl
                            // eslint-disable-next-line @next/next/no-img-element
                            ? <img src={imgUrl} alt={p?.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            : <span style={{ fontSize: 24, opacity: 0.3 }}>💄</span>
                          }
                        </div>
                        {/* 제품명 (.ed-prod-name) */}
                        <div style={{ fontFamily: f, fontSize: 12, fontWeight: 700, color: '#0C0C0A', marginTop: 6, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, width: '100%', textAlign: 'center' as const }}>
                          {p?.name ?? '—'}
                        </div>
                        {/* 브랜드 (.ed-prod-brand) */}
                        {p?.brand && (
                          <div style={{ fontFamily: f, fontSize: 11, color: '#9A9490', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, textAlign: 'center' as const }}>
                            {p.brand}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <div style={{ flexShrink: 0, width: 16 }} />
                </div>
              )}

              {/* Expert tip */}
              {item.expertTip && (
                <div style={{ padding: '8px 16px 14px' }}>
                  <div style={{ padding: '12px 14px', background: '#F5FDD4', border: '1px solid rgba(198,244,50,.5)', borderRadius: 14 }}>
                    <div style={{ fontFamily: f, fontSize: 10, fontWeight: 800, letterSpacing: '.1em', color: '#4E7D00', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
                      <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/></svg>
                      EXPERT TIP
                    </div>
                    <div style={{ fontFamily: f, fontSize: 13, color: '#4A4846', lineHeight: 1.6 }}>
                      {highlightProductNames(item.expertTip, products)}
                    </div>
                  </div>
                </div>
              )}

              {/* 참고 링크 */}
              <SourceLink url={item.sourceUrl} />
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
  onPhotoChange,
  onPhotoFile,
  onSave,
  onDelete,
  saving,
}: {
  open: boolean;
  onClose: () => void;
  ootdLog: OOTDLog | null;
  theme: string;
  onThemeChange: (v: string) => void;
  note: string;
  onNoteChange: (v: string) => void;
  photoPreview: string;
  onPhotoChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onPhotoFile: (file: File) => void;
  onSave: () => void;
  onDelete: () => void;
  saving: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Ctrl/Cmd + V 클립보드 이미지 붙여넣기 (시트가 열려 있을 때만)
  useEffect(() => {
    if (!open) return;
    function onPaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const blob = item.getAsFile();
          if (blob) {
            onPhotoFile(new File([blob], 'pasted-image.png', { type: blob.type }));
            e.preventDefault();
            break;
          }
        }
      }
    }
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [open, onPhotoFile]);

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
        <div style={{ fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif", fontSize: 22, fontWeight: 800, color: '#0C1014', marginBottom: 16 }}>
          오늘의 룩 기록
        </div>

        {/* 테마 선택 */}
        <div style={{ fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif", fontSize: 13, fontWeight: 600, color: '#9A9490', marginBottom: 8 }}>룩 테마</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          {OOTD_THEMES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onThemeChange(t)}
              style={{ padding: '8px 16px', borderRadius: 9999, border: `1.5px solid ${theme === t ? '#0A0A0A' : 'rgba(12,12,10,.14)'}`, background: theme === t ? '#0A0A0A' : 'transparent', color: theme === t ? '#C5FF00' : '#0C0C0A', fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif", fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
            >
              {t}
            </button>
          ))}
        </div>

        {/* 사진 */}
        <div style={{ fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif", fontSize: 13, fontWeight: 600, color: '#9A9490', marginBottom: 8 }}>
          사진 <span style={{ fontWeight: 400 }}>선택</span>
        </div>
        <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onPhotoChange} />
        <div
          onClick={() => fileInputRef.current?.click()}
          style={{ width: '100%', height: 120, background: photoPreview ? 'none' : '#F4F4F0', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', marginBottom: 12, overflow: 'hidden', position: 'relative' }}
        >
          {photoPreview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoPreview} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 26, opacity: 0.3 }}>📷</span>
              <span style={{ fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif", fontSize: 13, color: '#9A9490' }}>탭하여 추가 · 붙여넣기(⌘V)</span>
            </div>
          )}
        </div>

        {/* 메모 */}
        <div style={{ fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif", fontSize: 13, fontWeight: 600, color: '#9A9490', marginBottom: 8 }}>
          메모 <span style={{ fontWeight: 400 }}>선택</span>
        </div>
        <textarea
          value={note}
          onChange={(e) => onNoteChange(e.target.value)}
          placeholder="오늘의 룩 메모…"
          style={{ width: '100%', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 12, padding: '11px 14px', fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif", fontSize: 14, color: '#0C1014', resize: 'none', height: 64, outline: 'none', boxSizing: 'border-box', marginBottom: 16 }}
        />

        {/* 삭제 버튼 (수정 모드) */}
        {ootdLog && (
          <button
            type="button"
            onClick={onDelete}
            style={{ width: '100%', height: 44, background: 'none', border: '1.5px solid #fee2e2', color: '#ef4444', borderRadius: 12, fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif", fontSize: 13, fontWeight: 700, cursor: 'pointer', marginBottom: 10 }}
          >
            기록 삭제
          </button>
        )}

        {/* 취소 / 저장 버튼 */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={onClose}
            style={{ flex: 1, height: 52, background: '#F4F4F0', color: '#0C0C0A', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 12, fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif", fontSize: 15, fontWeight: 600, cursor: 'pointer' }}
          >
            취소
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            style={{ flex: 2, height: 52, background: '#0A0A0A', color: '#fff', border: 'none', borderRadius: 12, fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif", fontSize: 15, fontWeight: 700, cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.7 : 1 }}
          >
            {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
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

  // ── 인증 상태 ──
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // ── 데이터 상태 ──
  const [sessions, setSessions] = useState<Session[]>([]);
  const [products, setProducts] = useState<Map<string, Product>>(new Map());
  const [dataLoading, setDataLoading] = useState(true);

  // ── UI 상태 ──
  // 04:00~17:59 → MORNING, 18:00~03:59 → NIGHT
  const [activeTab, setActiveTab] = useState<'morning' | 'evening'>(() => {
    const h = new Date().getHours();
    return h >= 4 && h < 18 ? 'morning' : 'evening';
  });
  const [checked, setChecked] = useState<CheckState>({ morning: false, evening: false });
  const [saving, setSaving] = useState(false);

  // ── 습관 상태 ──
  const [habits, setHabits] = useState<Habit[]>([]);
  const [habitChecked, setHabitChecked] = useState<Set<string>>(new Set());
  const [habitLogs, setHabitLogs] = useState<{ id: string; habitId: string }[]>([]);

  // ── 날짜 변경 감지 (자정 리셋) ──
  // visibilitychange: 앱이 백그라운드에서 돌아올 때 날짜가 바뀌었으면 키를 갱신
  // → 키가 바뀌면 날짜 의존 구독들이 새 날짜로 재실행됨
  const [todayKey, setTodayKey] = useState(() => getTodayDateStr());
  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState === 'visible') {
        const newDate = getTodayDateStr();
        setTodayKey(prev => prev !== newDate ? newDate : prev);
      }
    }
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  // ── OOTD 상태 ──
  const [ootdLog, setOotdLog] = useState<OOTDLog | null>(null);
  const [ootdSheetOpen, setOotdSheetOpen] = useState(false);
  const [ootdTheme, setOotdTheme] = useState('');
  const [ootdNote, setOotdNote] = useState('');
  const [ootdPhotoFile, setOotdPhotoFile] = useState<File | null>(null);
  const [ootdPhotoPreview, setOotdPhotoPreview] = useState('');
  const [ootdSaving, setOotdSaving] = useState(false);

  // ── CT 섹션 상태 ──
  const [careItems, setCareItems] = useState<CtItem[]>([]);
  const [makeupItems, setMakeupItems] = useState<CtItem[]>([]);
  const [lookItems, setLookItems] = useState<CtItem[]>([]);

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
  const activeCareItems = careItems.filter((item) => {
    if (!item.published) return false;
    if (item.periodStart && item.periodEnd) {
      return todayStr0 >= item.periodStart && todayStr0 <= item.periodEnd;
    }
    return true;
  });
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
      if (!firebaseUser) {
        setSessions([]);
        setProducts(new Map());
        setChecked({ morning: false, evening: false });
        setDataLoading(false);
      }
    });

    // 컴포넌트 언마운트 시 구독 해제
    return () => unsubscribe();
  }, []);

  // ── 실시간 구독 1: 루틴 세션 ──
  useEffect(() => {
    if (authLoading || !user || !db) return;
    const _db = db;
    setDataLoading(true);
    const q = query(collection(_db, 'users', userId, 'routines'), orderBy('sessionNumber', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      setSessions(snap.docs.map((d) => migrateSession(d.data() as Record<string, unknown>, d.id)));
      setDataLoading(false);
    }, (err) => {
      console.error('[OnStep] 루틴 로드 실패:', err);
      setDataLoading(false);
    });
    return () => unsub();
  }, [userId, authLoading, user]);

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

  // ── 실시간 구독 3: 오늘 체크 기록 (활성 세션이 결정된 후 구독 시작) ──
  const activeSessionId = activeSession?.id;
  useEffect(() => {
    if (authLoading || !user || !db || !activeSessionId) return;
    const _db = db;
    const todayStr = getTodayDateStr();
    const q = query(
      collection(_db, 'users', userId, 'usageLogs'),
      where('routineId', '==', activeSessionId),
      where('dateStr', '==', todayStr)
    );
    const unsub = onSnapshot(q, (snap) => {
      setChecked({
        morning: snap.docs.some((d) => d.data().timeSlot === 'morning'),
        evening: snap.docs.some((d) => d.data().timeSlot === 'evening'),
      });
    }, (err) => console.error('[OnStep] 체크 기록 로드 실패:', err));
    return () => unsub();
  }, [userId, authLoading, user, activeSessionId, todayKey]); // todayKey: 자정 리셋

  // ── 실시간 구독 4: 오늘 OOTD 기록 ──
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
  }, [userId, authLoading, user]);

  // ── 실시간 구독 5: 습관 목록 ──
  useEffect(() => {
    if (authLoading || !user || !db) return;
    const _db = db;
    const q = query(collection(_db, 'users', userId, 'habits'));
    const unsub = onSnapshot(q, (snap) => {
      setHabits(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Habit, 'id'>) })));
    }, (err) => console.error('[OnStep] 습관 로드 실패:', err));
    return () => unsub();
  }, [userId, authLoading, user]);

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

  // ── 집중케어 / 메이크업 CT 구독 ──
  useEffect(() => {
    const _db = db;
    if (authLoading || !_db) return;
    const makeUnsub = (col: string, setter: (v: CtItem[]) => void) => {
      const q = query(collection(_db, 'users', userId, col));
      return onSnapshot(q, (snap) => {
        setter(snap.docs.map((d) => ({ id: d.id, ...d.data() } as CtItem)));
      }, (err) => console.error(`[OnStep] ${col} 로드 실패:`, err));
    };
    const u1 = makeUnsub('careItems', setCareItems);
    const u2 = makeUnsub('makeupItems', setMakeupItems);
    const u3 = makeUnsub('lookItems', setLookItems);
    return () => { u1(); u2(); u3(); };
  }, [userId, authLoading]);

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

      const todayStr = getTodayDateStr();

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
            dateStr: todayStr,
            loggedAt: new Date().toISOString(),
            note: `${time === 'morning' ? '아침' : '저녁'} 루틴 완료 — Day ${todayDayNumber}`,
          });
        } else {
          // 각 제품별로 UsageLog 저장 + 잔량 차감
          await Promise.all(
            allProductIds.map(async (productId) => {
              const product = products.get(productId);
              const amount = product?.dosePerUse ?? 0;

              // 💡 dateStr 필드: 나중에 오늘 로그 복원 시 쿼리에 사용
              await addDoc(logsRef, {
                routineId: activeSession.id,
                productId,
                amount,
                type: 'use',
                timeSlot: time,
                dateStr: todayStr,
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

                setProducts((prev) => {
                  const next = new Map(prev);
                  next.set(productId, { ...product, currentRemaining: newRemaining });
                  return next;
                });
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

      const todayStr = getTodayDateStr();

      try {
        const q = query(
          collection(_db, 'users', userId, 'usageLogs'),
          where('routineId', '==', activeSession.id),
          where('dateStr', '==', todayStr),
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
                setProducts((prev) => {
                  const next = new Map(prev);
                  next.set(data.productId, { ...product, currentRemaining: newRemaining });
                  return next;
                });
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
      }
    },
    [user, userId, habitChecked, habitLogs]
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
      await signInWithRedirect(auth, provider);
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

  // ── OOTD 사진 적용 (파일 선택 + 붙여넣기 공통) ──
  const handleOOTDPhotoFile = useCallback((file: File) => {
    setOotdPhotoFile(file);
    setOotdPhotoPreview(URL.createObjectURL(file));
  }, []);

  const handleOOTDPhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleOOTDPhotoFile(file);
  };

  // ── OOTD 저장 ──
  const handleSaveOOTD = async () => {
    const _db = db;
    if (!_db || !user) return;
    setOotdSaving(true);
    try {
      let photoUrl = ootdLog?.photoUrl ?? '';
      // 새 파일이 선택된 경우에만 Storage 업로드
      if (ootdPhotoFile && storage) {
        const path = `users/${userId}/ootd/${getTodayDateStr()}_${Date.now()}`;
        const ref = storageRef(storage, path);
        await uploadBytes(ref, ootdPhotoFile);
        photoUrl = await getDownloadURL(ref);
      }
      const todayStr = getTodayDateStr();
      if (ootdLog) {
        // 기존 기록 수정
        await updateDoc(doc(_db, 'users', userId, 'ootdLogs', ootdLog.id), {
          theme: ootdTheme,
          note: ootdNote,
          photoUrl,
          updatedAt: new Date().toISOString(),
        });
      } else {
        // 새 기록 저장
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
        ) : !user && !authLoading ? (
          // 로그인 안 된 상태
          <LoginRequiredCard onLogin={handleLogin} />
        ) : (
          // 오늘 날짜에 해당하는 루틴 없음
          <RoutineEmptyCard />
        )}

        {/* 오늘의 습관 — 루틴 유무와 무관하게 항상 표시 */}
        <TodayHabitSection
          todayHabits={todayHabits}
          habitChecked={habitChecked}
          onToggle={handleToggleHabit}
        />

        {/* 집중케어 섹션 — 오늘 기간에 해당하는 published 아이템 */}
        <CareSection items={activeCareItems} products={products} />

        {/* 메이크업 섹션 — 오늘 날짜에 해당하는 published 아이템 */}
        <MakeupSection items={activeMakeupItems} products={products} />

        {/* OOTD 섹션 */}
        <OOTDSection
          ootdLog={ootdLog}
          onRecord={handleOpenOOTDSheet}
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
        onPhotoChange={handleOOTDPhotoChange}
        onPhotoFile={handleOOTDPhotoFile}
        onSave={handleSaveOOTD}
        onDelete={handleDeleteOOTD}
        saving={ootdSaving}
      />
    </div>
  );
}
