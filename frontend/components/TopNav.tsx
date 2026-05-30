'use client';

// TopNav.tsx — 모든 페이지에 공통 적용되는 상단 네비게이션
// Firebase Auth를 직접 관리 (각 페이지 Appbar를 대체)
// layout.tsx의 AppShell에서 렌더링됨

import { useEffect, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  type User,
} from 'firebase/auth';
import { auth } from '@/lib/firebase';
import UserMenuButton from './UserMenuButton';

export default function TopNav() {
  const [user, setUser] = useState<User | null>(null);

  // Firebase Auth 상태 감지
  useEffect(() => {
    if (!auth) return;
    const unsub = onAuthStateChanged(auth, setUser);
    return () => unsub();
  }, []);

  const handleLogin = async () => {
    if (!auth) return;
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, provider);
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
    <div
      style={{
        padding: '0 16px',
        height: 64,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: 'rgba(250,250,248,.96)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(12,12,10,.07)',
        flexShrink: 0,
        position: 'relative',
        zIndex: 10,
      }}
    >
      {/* 햄버거 메뉴 (좌) */}
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

      {/* 로고 (중앙) — 킹받은 귀요미 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
      </div>

      {/* 사용자 메뉴 (우) */}
      <UserMenuButton user={user} onLogin={handleLogin} onLogout={handleLogout} />
    </div>
  );
}
