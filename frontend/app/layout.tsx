import type { Metadata } from 'next';
import './globals.css';
import NavWrapper from '@/components/NavWrapper';

export const metadata: Metadata = {
  title: 'OnStep — Life OS',
  description: 'Zero Setting · Life 관리는 리스트에서 즉시.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body style={{ fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif" }}>
        {/* PC에서도 앱 사이즈(430px)로 가운데 표시 — 바깥은 body의 #E8E6E0 배경 */}
        <div
          style={{
            maxWidth: 430,
            margin: '0 auto',
            minHeight: '100dvh',
            display: 'flex',
            flexDirection: 'column',
            background: '#FAFAF8',
            overflowX: 'hidden',
            boxShadow: '0 0 60px rgba(0,0,0,0.12)',
          }}
        >
          {/* main이 스크롤 컨테이너 — BottomNav는 항상 하단 고정 */}
          <main style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
            {children}
          </main>
          {/* NavWrapper: /onboarding에선 BottomNav 숨김 */}
          <NavWrapper />
        </div>
      </body>
    </html>
  );
}
