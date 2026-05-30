'use client';

// SearchBar.tsx — SETUP 목록 상단 공통 검색 입력
// 사용처: SessionsView / TrackerView / CtPanel (care·makeup·lookbook)

interface SearchBarProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}

const F = "'Plus Jakarta Sans', 'Space Grotesk', sans-serif";

export default function SearchBar({ value, onChange, placeholder = '검색...' }: SearchBarProps) {
  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 5,
        background: 'rgba(250,250,248,.96)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        padding: '8px 16px',
        borderBottom: '1px solid rgba(12,12,10,.07)',
      }}
    >
      <div style={{ position: 'relative' }}>
        {/* 검색 아이콘 */}
        <svg
          style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#9A9490', pointerEvents: 'none' }}
          width="14" height="14" viewBox="0 0 24 24" fill="currentColor"
        >
          <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
        </svg>

        <input
          type="search"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          style={{
            width: '100%',
            padding: '9px 36px 9px 36px',
            border: '1.5px solid rgba(12,12,10,.1)',
            borderRadius: 9999,
            fontFamily: F,
            fontSize: 13,
            color: '#0C0C0A',
            background: '#F4F4F0',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />

        {/* 지우기 버튼 */}
        {value && (
          <button
            onClick={() => onChange('')}
            style={{
              position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
              width: 18, height: 18, borderRadius: '50%',
              background: 'rgba(12,12,10,.18)', color: '#fff',
              border: 'none', cursor: 'pointer', fontSize: 10, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            aria-label="검색어 지우기"
          >✕</button>
        )}
      </div>
    </div>
  );
}
