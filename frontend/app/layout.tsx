import type { Metadata } from 'next';
import './globals.css';
import BottomNav from '@/components/BottomNav';

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
    <html lang="ko" className="h-full">
      <body
        className="min-h-full flex flex-col"
        style={{ fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif" }}
      >
        <main className="flex-1">{children}</main>
        <BottomNav />
      </body>
    </html>
  );
}
