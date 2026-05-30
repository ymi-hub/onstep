'use client';

// SectionHeader.tsx — 페이지 내 섹션 구분 헤더 (공통)
//
// 구조:
//   title  (22px 볼드 — 섹션 이름, 예: "#Flow" / "#Habits" / "#OOTD")
//   action (선택 — 우측 슬롯: 카운트 배지, 링크 등)
//
// 사용 화면:
//   TODAY  → #Flow / #Habits / #Intensive Care / #Makeup / #OOTD
//   LOG    → (필요 시 추가)
//   BOX    → (필요 시 추가)

import type { ReactNode } from 'react';

interface SectionHeaderProps {
  /** 섹션 제목 — 예: "#Flow", "#Habits", "#OOTD" */
  title: string;
  /** 우측 슬롯 (선택) — 카운트 텍스트, 링크 등 */
  action?: ReactNode;
}

const F = "'Plus Jakarta Sans', 'Space Grotesk', sans-serif";

export default function SectionHeader({ title, action }: SectionHeaderProps) {
  return (
    // 섹션 상단 여백(24px) + 좌우 패딩(16px) + 하단은 0 (콘텐츠가 직접 결정)
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        padding: '24px 16px 10px',
      }}
    >
      {/* 섹션 타이틀 */}
      <span
        style={{
          fontFamily: F,
          fontSize: 22,
          fontWeight: 800,
          color: '#0C0C0A',
          letterSpacing: '-.01em',
        }}
      >
        {title}
      </span>

      {/* 우측 슬롯: 있을 때만 렌더링 */}
      {action && (
        <span
          style={{
            fontFamily: F,
            fontSize: 13,
            fontWeight: 600,
            color: '#9A9490',
          }}
        >
          {action}
        </span>
      )}
    </div>
  );
}
