'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// design/shared.js _NAV_SVG 와 동일한 아이콘
const NAV_ITEMS = [
  {
    id: 'today',
    href: '/',
    label: 'Today',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    ),
  },
  {
    id: 'log',
    href: '/log',
    label: 'Log',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 4H4a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
      </svg>
    ),
  },
  {
    id: 'box',
    href: '/box',
    label: 'Box',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="21 8 21 21 3 21 3 8" />
        <rect x="1" y="3" width="22" height="5" />
        <line x1="10" y1="12" x2="14" y2="12" />
      </svg>
    ),
  },
  {
    id: 'setup',
    href: '/setup',
    label: 'Setup',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  },
] as const;

export default function BottomNav() {
  const pathname = usePathname();

  // 현재 경로로 활성 탭 판별
  // /log → log, /box → box, /setup → setup, / → today
  const activeId = (() => {
    if (pathname.startsWith('/log')) return 'log';
    if (pathname.startsWith('/box')) return 'box';
    if (pathname.startsWith('/setup')) return 'setup';
    if (pathname.startsWith('/import')) return 'setup';
    return 'today';
  })();

  return (
    <nav
      style={{
        background: 'var(--color-bg, #FAFAF8)',
        borderTop: '1px solid rgba(0,0,0,0.06)',
        display: 'flex',
      }}
    >
      {NAV_ITEMS.map((item) => {
        const isActive = activeId === item.id;
        return (
          <Link
            key={item.id}
            href={item.href}
            prefetch={true}
            aria-current={isActive ? 'page' : undefined}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '5px',
              cursor: 'pointer',
              padding: '12px 6px 20px',
              textDecoration: 'none',
              borderRadius: '20px 20px 0 0',
              background: isActive ? '#0A0A0A' : 'transparent',
              paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 14px)',
            }}
          >
            <span
              style={{
                width: 24,
                height: 24,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: isActive ? '#FFFFFF' : '#AAAAAA',
              }}
            >
              {item.icon}
            </span>
            <span
              style={{
                fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: isActive ? '#FFFFFF' : '#AAAAAA',
              }}
            >
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
