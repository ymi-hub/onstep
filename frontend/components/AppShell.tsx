'use client';

// AppShell.tsx — 레이아웃 셸
// TopNav(상단) + main(콘텐츠) + BottomNav(하단)을 하나로 관리
// /onboarding에서는 두 네비게이션 모두 숨김

import { usePathname } from 'next/navigation';
import TopNav from './TopNav';
import BottomNav from './BottomNav';
import type { ReactNode } from 'react';

// 네비게이션을 숨길 경로
const NAV_HIDDEN = ['/onboarding'];

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const hideNav = NAV_HIDDEN.includes(pathname);

  return (
    <>
      {/* 상단 네비게이션 */}
      {!hideNav && <TopNav />}

      {/* 페이지 콘텐츠 — 스크롤 컨테이너 */}
      <main style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {/* key={pathname}으로 페이지 전환마다 fade-in 재생 */}
        <div key={pathname} className="page-enter">
          {children}
        </div>
      </main>

      {/* 하단 네비게이션 */}
      {!hideNav && <BottomNav />}
    </>
  );
}
