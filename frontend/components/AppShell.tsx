'use client';

// AppShell.tsx — 레이아웃 셸
// TopNav(상단) + main(콘텐츠) + BottomNav(하단)을 하나로 관리
// /onboarding에서는 두 네비게이션 모두 숨김

import { useState, useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import TopNav from './TopNav';
import BottomNav from './BottomNav';
import { useAppContext } from '@/lib/AppContext';
import type { ReactNode } from 'react';

// 네비게이션을 숨길 경로
const NAV_HIDDEN = ['/onboarding'];

const F = "'Plus Jakarta Sans','Space Grotesk',sans-serif";

// ── 저장 완료 토스트 ────────────────────────────────────────────────────────────
function GlobalToast() {
  const { toastMsg } = useAppContext();
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (toastMsg) {
      setExiting(false);
      setVisible(true);
      // 2.3초 뒤 exit 애니메이션 시작 (AppContext가 2.8초에 null로 변경)
      exitTimer.current = setTimeout(() => setExiting(true), 2300);
    } else {
      setVisible(false);
      setExiting(false);
    }
    return () => { if (exitTimer.current) clearTimeout(exitTimer.current); };
  }, [toastMsg]);

  if (!visible || !toastMsg) return null;

  return (
    <div
      className={exiting ? 'toast-exit' : 'toast-enter'}
      style={{
        position: 'fixed',
        bottom: 80,          // 하단 BottomNav 위
        left: '50%',         // translateX(-50%)는 CSS 애니메이션에서 처리
        zIndex: 9998,
        background: '#0C0C0A',
        borderRadius: 14,
        padding: '12px 20px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        boxShadow: '0 8px 32px rgba(0,0,0,.28)',
        pointerEvents: 'none',
        minWidth: 160,
        maxWidth: 300,
      }}
    >
      {/* 체크 아이콘 */}
      <div style={{
        width: 24, height: 24, borderRadius: '50%',
        background: '#C5FF00',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        <svg width="13" height="13" viewBox="0 0 12 12" fill="none">
          <polyline points="2,6 5,9 10,3" stroke="#0C0C0A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      {/* 메시지 */}
      <span style={{
        fontFamily: F, fontSize: 13, fontWeight: 700,
        color: '#fff', letterSpacing: '.01em',
      }}>
        {toastMsg}
      </span>
    </div>
  );
}

// ── 글로벌 알람 배너 ────────────────────────────────────────────────────────────
// 어느 페이지에 있든 타이머 종료 시 화면 최상단에 오버레이
function GlobalAlarmBanner() {
  const { alarmVisible, alarmLabel, timerRemainMs, dismissAlarm } = useAppContext().timer;
  if (!alarmVisible || !alarmLabel) return null;

  return (
    <div
      className="alarm-banner-enter"
      style={{
        position: 'fixed', top: 0,
        left: 'max(0px, calc(50vw - 215px))',
        right: 'max(0px, calc(50vw - 215px))',
        zIndex: 9999,
        background: '#0C0C0A',
        borderBottom: '2.5px solid #C5FF00',
        boxShadow: '0 8px 40px rgba(0,0,0,.9)',
      }}
    >
      {/* 상단 컨텍스트 바 */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 16px 0',
      }}>
        {/* OnStep 로고 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="OnStep" style={{ width: 20, height: 20, objectFit: 'contain', filter: 'brightness(10)' }} />
          <span style={{ fontFamily: F, fontSize: 10, fontWeight: 800, letterSpacing: '.16em', color: 'rgba(255,255,255,.45)', textTransform: 'uppercase' }}>
            ONSTEP TIMER
          </span>
        </div>
        {/* 닫기 */}
        <button
          type="button"
          onClick={dismissAlarm}
          style={{ background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.15)', borderRadius: 6, color: 'rgba(255,255,255,.6)', fontSize: 13, fontWeight: 700, padding: '3px 10px', cursor: 'pointer', fontFamily: F, lineHeight: 1.4 }}
        >
          닫기
        </button>
      </div>

      {/* 메인 내용 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 16px 14px' }}>
        {/* 타이머 완료 아이콘 — 시계 + C5FF00 링 */}
        <div style={{
          position: 'relative', flexShrink: 0,
          width: 56, height: 56,
        }}>
          {/* 외부 링 */}
          <svg width="56" height="56" viewBox="0 0 56 56" style={{ position: 'absolute', top: 0, left: 0 }}>
            <circle cx="28" cy="28" r="25" fill="none" stroke="#C5FF00" strokeWidth="3" strokeDasharray="157" strokeDashoffset="0" strokeLinecap="round" />
          </svg>
          {/* 내부 원 배경 */}
          <div style={{
            position: 'absolute', top: 4, left: 4, width: 48, height: 48,
            borderRadius: '50%', background: '#1A1A0F',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {/* 시계 SVG */}
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#C5FF00" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
        </div>

        {/* 텍스트 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: F, fontSize: 10, fontWeight: 800, letterSpacing: '.12em', textTransform: 'uppercase', color: '#C5FF00', marginBottom: 3 }}>
            ✓ 대기 완료
          </div>
          <div style={{ fontFamily: F, fontSize: 17, fontWeight: 700, color: '#fff', lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {alarmLabel}
          </div>
          <div style={{ fontFamily: F, fontSize: 11, fontWeight: 500, color: 'rgba(255,255,255,.4)', marginTop: 2 }}>
            탭하여 닫기
          </div>
        </div>

        {/* 벨 아이콘 — 오른쪽 */}
        <div
          className="alarm-banner-pulse"
          style={{
            width: 44, height: 44, borderRadius: '50%',
            background: '#C5FF00',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, cursor: 'pointer',
          }}
          onClick={dismissAlarm}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0C0C0A" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
          </svg>
        </div>
      </div>
    </div>
  );
}

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const hideNav = NAV_HIDDEN.includes(pathname);

  return (
    <>
      {/* 글로벌 알람 배너 — 어느 페이지든 타이머 종료 시 표시 */}
      <GlobalAlarmBanner />
      {/* 저장 완료 토스트 */}
      <GlobalToast />

      {/* 상단 네비게이션 */}
      {!hideNav && <TopNav />}

      {/* 페이지 콘텐츠 — 스크롤 컨테이너 */}
      <main style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {children}
      </main>

      {/* 하단 네비게이션 */}
      {!hideNav && <BottomNav />}
    </>
  );
}
