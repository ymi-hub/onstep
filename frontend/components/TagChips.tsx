// components/TagChips.tsx
// 태그 pill 칩 — 라이브러리·라이프팁·수집 등 전 화면 공용

import { FONT } from '@/lib/constants';

export default function TagChips({
  tags,
  style,
}: {
  tags: string[];
  style?: React.CSSProperties;
}) {
  if (!tags?.length) return null;
  return (
    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', ...style }}>
      {tags.map(tag => (
        <span
          key={tag}
          style={{
            fontFamily: FONT,
            fontSize: 10,
            fontWeight: 600,
            padding: '3px 8px',
            borderRadius: 9999,
            background: 'rgba(12,12,10,.06)',
            border: '1px solid rgba(12,12,10,.1)',
            color: '#6A6866',
          }}
        >
          #{tag.replace(/^#/, '')}
        </span>
      ))}
    </div>
  );
}
