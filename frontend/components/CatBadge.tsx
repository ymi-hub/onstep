'use client';

// 고양이 뱃지 SVG — TODAY 체크/LOG 달성 표시 공통 컴포넌트
// color     : 몸통·귀 fill 색
// stroke    : 몸통·귀 외곽선 색 (기본 #4E382F)
// faceColor : 눈·코·입 선 색 — 지정 안 하면 색상 밝기에 따라 자동 결정
//             어두운 색(브라운·블랙 등) → 흰색, 밝은 색 → stroke 색

/** hex 색상이 어두운지 판단 (perceived luminance 기준) */
function isDark(hex: string): boolean {
  const h = hex.replace('#', '');
  if (h.length !== 6) return false;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return 0.299 * r + 0.587 * g + 0.114 * b < 0.5;
}

export default function CatBadge({
  color,
  size = 20,
  stroke = '#4E382F',
  faceColor,
}: {
  color: string;
  size?: number;
  stroke?: string;
  faceColor?: string;
}) {
  const fc = faceColor ?? (isDark(color) ? '#FFFFFF' : stroke);
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" fill="none">
      {/* 귀 */}
      <polygon points="9,16 5,3 17,12" fill={color} stroke={stroke} strokeWidth="1.3"/>
      <polygon points="27,16 31,3 19,12" fill={color} stroke={stroke} strokeWidth="1.3"/>
      {/* 귀 안쪽 핑크 */}
      <polygon points="10,15 7,6 15,11" fill="#FFB3C6" opacity="0.7"/>
      <polygon points="26,15 29,6 21,11" fill="#FFB3C6" opacity="0.7"/>
      {/* 얼굴 */}
      <circle cx="18" cy="22" r="13" fill={color} stroke={stroke} strokeWidth="1.5"/>
      {/* 눈 */}
      <path d="M10 20 Q13 25 16 20" stroke={fc} strokeWidth="2.2" strokeLinecap="round" fill="none"/>
      <path d="M20 20 Q23 25 26 20" stroke={fc} strokeWidth="2.2" strokeLinecap="round" fill="none"/>
      {/* 볼터치 */}
      <ellipse cx="10" cy="25" rx="3.2" ry="2" fill="#FF8FA3" opacity="0.45"/>
      <ellipse cx="26" cy="25" rx="3.2" ry="2" fill="#FF8FA3" opacity="0.45"/>
      {/* 입 */}
      <path d="M13.5 28 Q15.5 31.5 18 29.5 Q20.5 31.5 22.5 28" stroke={fc} strokeWidth="1.6" strokeLinecap="round" fill="none"/>
    </svg>
  );
}
