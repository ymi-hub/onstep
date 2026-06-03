import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans, Space_Grotesk, Nanum_Pen_Script } from 'next/font/google';
import './globals.css';
import AppShell from '@/components/AppShell';
import { AppProvider } from '@/lib/AppContext';

// next/font 자체 호스팅 — Google CDN 호출 없이 빌드 시 폰트 파일 포함
// display: 'swap' → 폰트 로드 중에도 시스템 폰트로 즉시 텍스트 표시 (FOIT 방지)
const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
  variable: '--font-jakarta',
});

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-grotesk',
});

const nanumPenScript = Nanum_Pen_Script({
  subsets: ['latin'],
  weight: ['400'],
  display: 'swap',
  variable: '--font-nanum',
});

export const metadata: Metadata = {
  title: 'OnStep — Life OS',
  description: 'Zero Setting · Life 관리는 리스트에서 즉시.',
  // PWA — 홈화면 추가 시 앱 이름·아이콘 지정
  manifest: '/manifest.json',
  // iOS 홈화면 추가 시 상태바 색상 (흰 배경에 어울리는 기본)
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'OnStep',
  },
  // 파비콘 (브라우저 탭)
  icons: {
    icon: '/logo.png',
    apple: '/icon-192.png',
  },
};

// 💡 viewport 설정 — Next.js의 공식 방법 (<meta viewport> 직접 쓰는 것보다 권장)
//   - viewportFit: 'cover' → iPhone 노치/Dynamic Island 영역까지 앱이 채움
//     (BottomNav의 env(safe-area-inset-bottom)과 함께 사용해야 의미 있음)
//   - maximumScale: 1 / userScalable: false → 사용자 핀치줌 방지 (앱처럼 느껴지게)
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className={`${plusJakartaSans.variable} ${spaceGrotesk.variable} ${nanumPenScript.variable}`}>
      <body style={{ fontFamily: "var(--font-jakarta), var(--font-grotesk), sans-serif" }}>
        {/* PC에서도 앱 사이즈(430px)로 가운데 표시 */}
        <div
          style={{
            maxWidth: 430,
            margin: '0 auto',
            height: '100dvh',
            display: 'flex',
            flexDirection: 'column',
            background: '#FAFAF8',
            overflowX: 'hidden',
            boxShadow: '0 0 60px rgba(0,0,0,0.12)',
          }}
        >
          {/* AppProvider: Auth + 공유 데이터 구독 (탭 전환 시 재로딩 없음) */}
          <AppProvider>
            {/* AppShell: TopNav(상단) + main(콘텐츠) + BottomNav(하단) */}
            <AppShell>{children}</AppShell>
          </AppProvider>
        </div>
      </body>
    </html>
  );
}
