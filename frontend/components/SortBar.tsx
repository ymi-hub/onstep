'use client';

const F = "'Plus Jakarta Sans','Space Grotesk',sans-serif";

export type SortOption<K extends string = string> = { key: K; label: string };

export default function SortBar<K extends string>({
  value,
  onChange,
  options,
  style,
}: {
  value: K;
  onChange: (key: K) => void;
  options: SortOption<K>[];
  style?: React.CSSProperties;
}) {
  return (
    <div style={{ display: 'flex', gap: 6, overflowX: 'auto', scrollbarWidth: 'none', ...style }}>
      {options.map(opt => {
        const active = value === opt.key;
        return (
          <button
            key={opt.key}
            onClick={() => onChange(opt.key)}
            style={{
              flexShrink: 0,
              height: 28,
              padding: '0 12px',
              borderRadius: 9999,
              border: `1.5px solid ${active ? '#0C0C0A' : 'rgba(12,12,10,.14)'}`,
              background: active ? '#0C0C0A' : 'transparent',
              fontFamily: F,
              fontSize: 11,
              fontWeight: 700,
              color: active ? '#fff' : '#9A9490',
              cursor: 'pointer',
              transition: 'all .15s',
              whiteSpace: 'nowrap' as const,
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
