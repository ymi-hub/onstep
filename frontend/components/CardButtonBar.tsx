// components/CardButtonBar.tsx
// 라이브러리 카드 하단 버튼 바 — Today ON/OFF + 편집 공용

import { FONT } from '@/lib/constants';

export default function CardButtonBar({
  isOnToday,
  onToggleToday,
  onEdit,
  disabled = false,
  editLabel = '편집',
}: {
  isOnToday: boolean;
  onToggleToday: () => void;
  onEdit: () => void;
  disabled?: boolean;
  editLabel?: string;
}) {
  return (
    <div style={{ display: 'flex', borderTop: '1px solid #000000' }}>
      <button
        onClick={onToggleToday}
        disabled={disabled}
        style={{
          flex: 1, padding: '12px 0',
          background: isOnToday ? '#0C0C0A' : '#F3F3F1',
          color: isOnToday ? '#6F4E37' : '#0C0C0A',
          border: 'none', borderRight: '1px solid #000000', borderRadius: 0,
          fontFamily: FONT, fontSize: 12, fontWeight: 700,
          letterSpacing: '.06em', textTransform: 'uppercase',
          cursor: disabled ? 'default' : 'pointer',
          opacity: disabled ? 0.6 : 1,
          transition: 'all .15s',
        }}
      >
        {disabled ? '...' : isOnToday ? 'Today ON' : 'Today OFF'}
      </button>
      <button
        onClick={onEdit}
        style={{
          flex: 1, padding: '12px 0',
          background: '#F3F3F1', color: '#0C0C0A',
          border: 'none', borderRadius: 0,
          fontFamily: FONT, fontSize: 12, fontWeight: 700,
          letterSpacing: '.06em', textTransform: 'uppercase',
          cursor: 'pointer',
        }}
      >
        {editLabel}
      </button>
    </div>
  );
}
