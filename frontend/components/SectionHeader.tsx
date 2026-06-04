'use client';

import type { ReactNode } from 'react';

interface SectionHeaderProps {
  title: string;
  action?: ReactNode;
  /** 컬러 바 모드 — 배경색 지정 시 전체 너비 색상 바로 렌더링 */
  barColor?: string;
  /** 바 텍스트 색상 (기본 #0C0C0A) */
  textColor?: string;
}

const F = "'Plus Jakarta Sans', 'Space Grotesk', sans-serif";

export default function SectionHeader({ title, action, barColor, textColor }: SectionHeaderProps) {
  if (barColor) {
    // 컬러 바 모드
    const tc = textColor ?? '#0C0C0A';
    return (
      <div style={{ margin: '16px 26px 8px', borderRadius: 14, background: barColor, padding: '13px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontFamily: F, fontSize: 15, fontWeight: 800, color: tc, letterSpacing: '.04em' }}>
          {title}
        </span>
        {action && (
          <span style={{ fontFamily: F, fontSize: 13, fontWeight: 700, color: tc, opacity: 0.75 }}>
            {action}
          </span>
        )}
      </div>
    );
  }

  // 기본 모드 (기존 스타일 유지)
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '24px 26px 10px' }}>
      <span style={{ fontFamily: F, fontSize: 18, fontWeight: 800, color: '#0C0C0A', letterSpacing: '-.01em' }}>
        {title}
      </span>
      {action && (
        <span style={{ fontFamily: F, fontSize: 13, fontWeight: 600, color: '#9A9490' }}>
          {action}
        </span>
      )}
    </div>
  );
}
