// components/RotatedBadge.tsx
// 라이브러리 카드에 붙는 회전 뱃지 스티커 — 도메인/타입별 문구·컬러 공용 정의

import { FONT } from '@/lib/constants';

// ── 카테고리별 뱃지 설정 ──────────────────────────────────────────────────────
export type BadgeKey = 'beauty' | 'fashion' | 'acc' | 'interior' | 'lifetip' | 'ootd';

export const BADGE_CONFIG: Record<BadgeKey, { bg: string; text: string; label: string }> = {
  beauty:   { bg: '#C5FF00', text: '#3A6000', label: '#MAKEUP'    },
  fashion:  { bg: '#FF8C42', text: '#7A3000', label: '#LOOKBOOK'  },
  acc:      { bg: '#FFD700', text: '#7A5A00', label: '#ACCESSORY' },
  interior: { bg: '#69DB7C', text: '#1E6B30', label: '#INTERIOR'  },
  lifetip:  { bg: '#93C5FD', text: '#1E3A8A', label: '#LIFETIP'   },
  ootd:     { bg: '#C6F432', text: '#525252', label: '#OOTD'       },
};

// ── 컴포넌트 ─────────────────────────────────────────────────────────────────
export default function RotatedBadge({
  badgeKey,
  bg,
  textColor,
  label,
}: (
  | { badgeKey: BadgeKey; bg?: never; textColor?: never; label?: never }
  | { badgeKey?: never; bg: string; textColor: string; label: string }
)) {
  const cfg = badgeKey ? BADGE_CONFIG[badgeKey] : { bg: bg!, text: textColor!, label: label! };
  return (
    <div style={{
      position: 'absolute', right: 7, top: 42,
      width: 113, height: 32,
      background: cfg.bg, border: '1px solid #18181B',
      transform: 'rotate(-3deg)',
      display: 'flex', alignItems: 'center', padding: '0 12px', zIndex: 3,
    }}>
      <span style={{ fontFamily: FONT, fontSize: 14, fontWeight: 700, color: cfg.text, transform: 'rotate(-3deg)' }}>
        {cfg.label}
      </span>
    </div>
  );
}
