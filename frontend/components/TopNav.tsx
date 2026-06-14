'use client';

// TopNav.tsx — 모든 페이지에 공통 적용되는 상단 네비게이션
// Firebase Auth를 직접 관리 (각 페이지 Appbar를 대체)
// layout.tsx의 AppShell에서 렌더링됨

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  onAuthStateChanged,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
  signOut,
  type User,
} from 'firebase/auth';
import { auth } from '@/lib/firebase';
import UserMenuButton from './UserMenuButton';

export default function TopNav() {
  const [user, setUser] = useState<User | null>(null);

  // Firebase Auth 상태 감지 + 리다이렉트 로그인 결과 처리
  // 💡 signInWithRedirect 후 앱으로 돌아왔을 때 getRedirectResult가 오류를 잡아줌
  //    실제 로그인 상태는 onAuthStateChanged가 자동으로 업데이트함
  useEffect(() => {
    if (!auth) return;
    getRedirectResult(auth).catch((err) => {
      console.error('[TopNav] 리다이렉트 로그인 오류:', err);
    });
    const unsub = onAuthStateChanged(auth, setUser);
    return () => unsub();
  }, []);

  const handleLogin = async () => {
    if (!auth) return;
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      // 💡 signInWithRedirect: 모바일에서도 차단되지 않는 방식
      //    팝업(signInWithPopup)은 iOS Safari / Android WebView에서 막힘
      //    리다이렉트 방식은 Google 로그인 페이지로 이동 후 앱으로 돌아옴
      await signInWithRedirect(auth, provider);
    } catch (err) {
      console.error('[TopNav] 로그인 실패:', err);
    }
  };

  const handleLogout = async () => {
    if (!auth) return;
    try { await signOut(auth); } catch (err) {
      console.error('[TopNav] 로그아웃 실패:', err);
    }
  };

  return (
    // 💡 safe-area 구조: 외부 div가 노치/Dynamic Island 영역을 paddingTop으로 흡수
    //    내부 div는 항상 64px — 아이콘/로고가 노치에 가리지 않음
    //    env(safe-area-inset-top, 0px): 노치 없는 기기에서는 0px, 노치 있는 기기에서는 실제 높이(보통 44~59px)
    <div
      style={{
        paddingTop: 'env(safe-area-inset-top, 0px)',
        background: '#F5EDE0',
        borderBottom: '1px solid rgba(12,12,10,.07)',
        flexShrink: 0,
        position: 'relative',
        zIndex: 10,
      }}
    >
      <div
        style={{
          padding: '0 26px',
          height: 64,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
      {/* 햄버거 메뉴 (좌) */}
      {/* 💡 시각적으로는 22px 너비 선 3개이지만, 버튼 자체는 44×44 — 모바일 터치 표준 최소 크기 */}
      <button
        style={{
          width: 44,
          height: 44,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 5,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
          flexShrink: 0,
        }}
        aria-label="메뉴"
      >
        <span style={{ display: 'block', width: 22, height: 1.5, background: '#0C0C0A', borderRadius: 2 }} />
        <span style={{ display: 'block', width: 15, height: 1.5, background: '#0C0C0A', borderRadius: 2, alignSelf: 'flex-start', marginLeft: 11 }} />
        <span style={{ display: 'block', width: 22, height: 1.5, background: '#0C0C0A', borderRadius: 2 }} />
      </button>

      {/* 로고 (중앙) — today 화면으로 이동 */}
      <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo.png"
          alt="OnStep"
          style={{ width: 32, height: 32, borderRadius: 10, objectFit: 'cover' }}
        />
        <span
          style={{
            fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
            fontSize: 15,
            fontWeight: 800,
            color: '#0C0C0A',
            letterSpacing: '-0.01em',
          }}
        >
          OnStep
        </span>
      </Link>

      {/* 사용자 메뉴 (우) */}
      <UserMenuButton user={user} onLogin={handleLogin} onLogout={handleLogout} />
      </div>
    </div>
  );
}
