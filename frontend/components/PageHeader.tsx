'use client';

// PageHeader.tsx — 모든 메인 페이지 공통 상단 헤더
//
// 구조:
//   label  (소문자 또는 대문자 뱃지 — 화면 식별자)
//   title  (큰 폰트 타이틀 — 화면별 동적 텍스트)
//   subtitle (선택 — 날짜/세션 정보/설명 등)
//   right  (선택 — 우측 슬롯: 버튼, 카운트 등)
//
// 사용 화면:
//   TODAY  → label="Today",  title="스킨케어 루틴",  subtitle="2회차 · Day 3"
//   LOG    → label="Log",    title="사용 기록",      right=<월 네비>
//   BOX    → label="Box",    title="제품 인벤토리",  subtitle="화장대와 옷장 아이템 정리", right=<제품 수>
//   SETUP  → label="Setup",  title="케어 플랜",      subtitle="루틴 · 습관 · 케어"

import type { ReactNode } from 'react';

interface PageHeaderProps {
  /** 화면 식별 레이블 — 예: "Today" / "Log" / "Box" / "Setup" */
  label: string;
  /** 대형 타이틀 — 화면별 메인 텍스트 */
  title: string;
  /** 서브 텍스트 (선택) — 날짜, 세션 정보, 설명 등 */
  subtitle?: string;
  /** 우측 슬롯 (선택) — 버튼, 카운트 배지 등 */
  right?: ReactNode;
}

const F = "'Plus Jakarta Sans', 'Space Grotesk', sans-serif";

export default function PageHeader({ label, title, subtitle, right }: PageHeaderProps) {
  return (
    // 전체 헤더 영역 — 좌우 패딩 16px, 위 20px, 아래 14px
    <div style={{ padding: '20px 26px 14px' }}>

      {/* 상단 행: 레이블(좌) + 우측 슬롯(우) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          marginBottom: 2,
        }}
      >
        {/* 레이블 — 소문자 트래킹 스타일 */}
        <span
          style={{
            fontFamily: F,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '.16em',
            textTransform: 'uppercase',
            color: '#9A9490',
          }}
        >
          {label}
        </span>

        {/* 우측 슬롯: 있을 때만 렌더링 */}
        {right && (
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {right}
          </div>
        )}
      </div>

      {/* 대형 타이틀 */}
      <h1
        style={{
          fontFamily: F,
          fontSize: 52,
          fontWeight: 900,
          color: '#0C0C0A',
          lineHeight: 0.92,
          letterSpacing: '-.03em',
          margin: '4px 0 0',
        }}
      >
        {title}
      </h1>

      {/* 서브타이틀 — 있을 때만 렌더링 */}
      {subtitle && (
        <p
          style={{
            fontFamily: F,
            fontSize: 12,
            fontWeight: 500,
            color: '#9A9490',
            margin: '8px 0 0',
            lineHeight: 1.5,
          }}
        >
          {subtitle}
        </p>
      )}
    </div>
  );
}
