'use client';

// ExpertTipField.tsx — 공통 EXPERT TIP 입력 컴포넌트
//
// 동작:
//   - 클릭(포커스) → textarea 편집 모드
//   - 블러(포커스 해제) → HTML 디스플레이 모드: BOX 제품명 인라인 하이라이팅
//
// 사용처:
//   - setup/page.tsx EditorView (스킨케어 루틴 설정 / 슬롯별 DAY)
//   - setup/page.tsx CtPanel (집중케어·메이크업북·룩북 설계 시트)

import { useState } from 'react';

interface ExpertTipFieldProps {
  value: string;
  onChange: (v: string) => void;
  /** 제품명 하이라이팅용 — name 필드만 필요 */
  products: Array<{ name: string }>;
  placeholder?: string;
}

const F = "'Plus Jakarta Sans', 'Space Grotesk', sans-serif";

/** 텍스트 내 BOX 제품명 → 파스텔 블루 <mark> 태그로 변환 */
export function buildExpertTipHtml(text: string, products: Array<{ name: string }>): string {
  if (!text.trim()) return '';
  let html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // 이름 길이 내림차순 정렬 → 긴 이름 우선 매칭 (부분 매칭 방지)
  [...products]
    .sort((a, b) => b.name.length - a.name.length)
    .forEach((p) => {
      if (!p.name.trim()) return;
      const esc = p.name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      html = html.replace(
        new RegExp(esc, 'gi'),
        (m) =>
          `<mark style="background:rgba(33,150,243,0.12);color:#1976D2;border-radius:3px;padding:0 2px">${m}</mark>`
      );
    });
  return html.replace(/\n/g, '<br>');
}

export default function ExpertTipField({
  value,
  onChange,
  products,
  placeholder,
}: ExpertTipFieldProps) {
  const [focused, setFocused] = useState(false);

  const ph = placeholder ?? '전용 팁 설명 입력... (탭하여 입력)';

  const baseStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    borderRadius: 10,
    fontFamily: F,
    fontSize: 13,
    lineHeight: 1.65,
    color: '#4A4846',
    background: 'rgba(197,255,0,.04)',
    boxSizing: 'border-box',
  };

  return (
    <div>
      {/* 라벨 */}
      <div
        style={{
          fontFamily: F,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '.08em',
          color: '#4E7D00',
          marginBottom: 6,
          display: 'flex',
          alignItems: 'center',
          gap: 5,
        }}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
        </svg>
        EXPERT TIP
      </div>

      {focused ? (
        /* 편집 모드 */
        <textarea
          autoFocus
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => setFocused(false)}
          placeholder={ph}
          rows={4}
          style={{
            ...baseStyle,
            border: '1.5px solid rgba(132,176,0,.5)',
            outline: 'none',
            resize: 'none',
          }}
        />
      ) : (
        /* 디스플레이 모드 — 제품명 인라인 하이라이팅 */
        <div
          onClick={() => setFocused(true)}
          style={{
            ...baseStyle,
            minHeight: 48,
            border: '1.5px solid rgba(132,176,0,.2)',
            cursor: 'text',
          }}
          dangerouslySetInnerHTML={{
            __html: value.trim()
              ? buildExpertTipHtml(value, products)
              : `<span style="color:#BCBAB6">${ph}</span>`,
          }}
        />
      )}
    </div>
  );
}
