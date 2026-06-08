'use client';

const F = "'Plus Jakarta Sans','Space Grotesk',sans-serif";

export default function MoreButton({
  visible,
  total,
  onMore,
}: {
  visible: number;
  total: number;
  onMore: () => void;
}) {
  if (visible >= total) return null;
  return (
    <button
      onClick={onMore}
      style={{
        width: '100%',
        padding: '16px 0',
        border: 'none',
        borderTop: '1px solid rgba(12,12,10,.07)',
        background: 'none',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
        marginTop: 8,
      }}
    >
      <span style={{
        fontFamily: F,
        fontSize: 13,
        fontWeight: 700,
        color: '#0C0C0A',
        letterSpacing: '.06em',
      }}>
        MORE {visible}/{total}
      </span>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0C0C0A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="6 9 12 15 18 9"/>
      </svg>
    </button>
  );
}
