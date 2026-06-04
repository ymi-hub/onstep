'use client';

// 공용 사용자 메뉴 버튼 — 로그인/로그아웃 + 계정 정보 바텀시트
// 모든 페이지의 Appbar right 슬롯에서 사용

import { useState } from 'react';
import type { User } from 'firebase/auth';

export default function UserMenuButton({
  user,
  onLogin,
  onLogout,
}: {
  user: User | null;
  onLogin: () => void;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);

  // 비로그인: "로그인" 버튼
  // 💡 height 44px — iOS HIG 권장 최소 터치 타깃
  if (!user) {
    return (
      <button
        onClick={onLogin}
        style={{
          height: 44, padding: '0 24px', borderRadius: 9999,
          background: '#0C0C0A', border: 'none', cursor: 'pointer',
          color: '#C5FF00',
          fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif",
          fontSize: 11, fontWeight: 700, letterSpacing: '.04em',
        }}
      >
        로그인
      </button>
    );
  }

  // 로그인: 프로필 아바타 → 탭하면 바텀시트
  // 💡 버튼은 44×44 터치 영역, 내부 아바타 원은 시각적으로 32px 유지
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        style={{
          width: 44, height: 44,
          background: 'transparent', border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 0, flexShrink: 0,
        }}
        aria-label="계정 메뉴"
      >
        <span style={{
          width: 32, height: 32, borderRadius: '50%',
          background: '#EEEDE9',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden', flexShrink: 0,
        }}>
          {user.photoURL ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.photoURL} alt="프로필" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" style={{ opacity: 0.5 }}>
              <path d="M12 12c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm0 2c-3.33 0-10 1.67-10 5v2h20v-2c0-3.33-6.67-5-10-5z" />
            </svg>
          )}
        </span>
      </button>

      {/* 바텀시트 오버레이 */}
      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 500 }}
          />
          <div
            style={{
              position: 'fixed', bottom: 0,
              left: 'max(0px,calc(50vw - 215px))',
              right: 'max(0px,calc(50vw - 215px))',
              zIndex: 510,
              background: '#FAFAF8', borderRadius: '20px 20px 0 0',
              padding: '12px 20px calc(env(safe-area-inset-bottom, 0px) + 40px)',
              boxShadow: '0 -4px 40px rgba(0,0,0,.12)',
            }}
          >
            {/* 핸들 */}
            <div style={{ width: 32, height: 3, background: 'rgba(12,12,10,.14)', borderRadius: 2, margin: '0 auto 20px' }} />

            {/* 유저 정보 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#EEEDE9', overflow: 'hidden', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {user.photoURL ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={user.photoURL} alt="프로필" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" style={{ opacity: 0.4 }}>
                    <path d="M12 12c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm0 2c-3.33 0-10 1.67-10 5v2h20v-2c0-3.33-6.67-5-10-5z" />
                  </svg>
                )}
              </div>
              <div>
                <div style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 15, fontWeight: 700, color: '#0C0C0A' }}>
                  {user.displayName ?? '사용자'}
                </div>
                <div style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 12, color: '#9A9490', marginTop: 2 }}>
                  {user.email}
                </div>
              </div>
            </div>

            {/* 동기화 상태 */}
            <div style={{ background: '#F4F4F0', borderRadius: 10, padding: '10px 14px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 14, flexShrink: 0 }}>☁️</span>
              <span style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 12, color: '#4A4846', lineHeight: 1.5 }}>
                Firebase로 기기 간 자동 동기화 중
              </span>
            </div>

            {/* 로그아웃 버튼 */}
            <button
              onClick={() => { setOpen(false); onLogout(); }}
              style={{
                width: '100%', height: 48, borderRadius: 12,
                background: 'rgba(186,26,26,.06)',
                border: '1.5px solid rgba(186,26,26,.2)',
                fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif",
                fontSize: 14, fontWeight: 700, color: '#BA1A1A',
                cursor: 'pointer',
              }}
            >
              로그아웃
            </button>
          </div>
        </>
      )}
    </>
  );
}
