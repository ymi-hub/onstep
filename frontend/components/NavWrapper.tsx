'use client';

// NavWrapper.tsx
// BottomNav를 조건부로 렌더링하는 클라이언트 컴포넌트.
// 온보딩 화면(/onboarding)에서는 BottomNav를 숨겨서
// 앱 화면 전체를 온보딩 슬라이드가 채울 수 있게 한다.
//
// layout.tsx는 서버 컴포넌트라서 usePathname()을 직접 쓸 수 없기 때문에
// 이 클라이언트 래퍼 컴포넌트를 통해 경로를 읽는다.

import { usePathname } from 'next/navigation';
import BottomNav from './BottomNav';

const HIDDEN_ROUTES = ['/onboarding'];

export default function NavWrapper() {
  const pathname = usePathname();

  // 숨김 대상 경로면 null 반환
  if (HIDDEN_ROUTES.includes(pathname)) return null;

  return <BottomNav />;
}
