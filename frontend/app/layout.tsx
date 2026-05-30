import type { Metadata } from 'next';
import './globals.css';
import AppShell from '@/components/AppShell';

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
        {/* PC에서도 앱 사이즈(430px)로 가운데 표시 */}
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
          {/* AppShell: TopNav(상단) + main(콘텐츠) + BottomNav(하단) */}
          <AppShell>{children}</AppShell>
        </div>
      </body>
    </html>
  );
}
