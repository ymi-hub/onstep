'use client';

// 고양이 뱃지 SVG — TODAY 체크/LOG 달성 표시 공통 컴포넌트
export default function CatBadge({ color, size = 20 }: { color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" fill="none">
      <polygon points="9,16 5,3 17,12" fill={color} stroke="#0C0C0A" strokeWidth="1.3"/>
      <polygon points="27,16 31,3 19,12" fill={color} stroke="#0C0C0A" strokeWidth="1.3"/>
      <polygon points="10,15 7,6 15,11" fill="#FFB3C6" opacity="0.7"/>
      <polygon points="26,15 29,6 21,11" fill="#FFB3C6" opacity="0.7"/>
      <circle cx="18" cy="22" r="13" fill={color} stroke="#0C0C0A" strokeWidth="1.5"/>
      <path d="M10 20 Q13 25 16 20" stroke="#0C0C0A" strokeWidth="2.2" strokeLinecap="round" fill="none"/>
      <path d="M20 20 Q23 25 26 20" stroke="#0C0C0A" strokeWidth="2.2" strokeLinecap="round" fill="none"/>
      <ellipse cx="10" cy="25" rx="3.2" ry="2" fill="#FF8FA3" opacity="0.45"/>
      <ellipse cx="26" cy="25" rx="3.2" ry="2" fill="#FF8FA3" opacity="0.45"/>
      <path d="M13.5 28 Q15.5 31.5 18 29.5 Q20.5 31.5 22.5 28" stroke="#0C0C0A" strokeWidth="1.6" strokeLinecap="round" fill="none"/>
    </svg>
  );
}
