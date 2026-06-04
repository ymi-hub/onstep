'use client';

// SubPageHeader.tsx — SETUP 서브페이지 공통 상단 헤더
// HABITS EDIT MODE 스타일 기준:
//   ✕ 버튼 | 라임 뱃지 타이틀 | (선택) 우측 슬롯
//
// 사용처:
//   - SessionsView   ("ROUTINE SETUP")
//   - EditorView     ("ROUTINE EDIT")
//   - TrackerView    ("HABITS")
//   - CtPanel care   ("집중케어")
//   - CtPanel makeup ("메이크업북")
//   - CtPanel lookbook ("룩북")

import type { ReactNode } from 'react';

interface SubPageHeaderProps {
  title: string;
  onClose: () => void;
  /** 헤더 오른쪽 슬롯 (옵션) — 예: 저장 버튼 */
  right?: ReactNode;
}

const F = "'Plus Jakarta Sans', 'Space Grotesk', sans-serif";

export default function SubPageHeader({ title, onClose, right }: SubPageHeaderProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 26px',
        height: 56,
        background: 'rgba(250,250,248,.92)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(12,12,10,.07)',
        flexShrink: 0,
      }}
    >
      {/* 좌: ✕ 닫기 버튼 */}
      <button
        onClick={onClose}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          padding: 0, color: '#0C0C0A', fontSize: 18, fontWeight: 400, lineHeight: 1,
          width: 44, display: 'flex', alignItems: 'center',
        }}
        aria-label="닫기"
      >
        ✕
      </button>

      {/* 중앙: 라임 뱃지 타이틀 */}
      <div
        style={{
          background: '#C5FF00',
          color: '#0C0C0A',
          fontFamily: F,
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: '.12em',
          textTransform: 'uppercase',
          padding: '5px 14px',
          borderRadius: 9999,
        }}
      >
        {title}
      </div>

      {/* 우: 슬롯 (없으면 균형용 빈 공간) */}
      <div style={{ width: 44, display: 'flex', justifyContent: 'flex-end' }}>
        {right ?? null}
      </div>
    </div>
  );
}
