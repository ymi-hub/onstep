// app/loading.tsx
// Next.js App Router의 로딩 UI — 페이지 전환 및 첫 로딩 시 main 영역에 표시됨
// TopNav · BottomNav는 AppShell이 유지하므로 여기선 본문 스켈레톤만 렌더링

const f = "'Plus Jakarta Sans','Space Grotesk',sans-serif";

// 반짝이는 shimmer 애니메이션 keyframes
const SHIMMER_CSS = `
  @keyframes shimmer {
    0%   { background-position: -400px 0; }
    100% { background-position:  400px 0; }
  }
`;

// 단일 shimmer 블록
function Skeleton({ width = '100%', height = 16, radius = 8, style = {} }: {
  width?: string | number;
  height?: number;
  radius?: number;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        width,
        height,
        borderRadius: radius,
        background: 'linear-gradient(90deg, #F0EFED 25%, #E8E7E4 50%, #F0EFED 75%)',
        backgroundSize: '800px 100%',
        animation: 'shimmer 1.4s infinite linear',
        flexShrink: 0,
        ...style,
      }}
    />
  );
}

// 카드 형태 스켈레톤
function SkeletonCard({ lines = 2 }: { lines?: number }) {
  return (
    <div
      style={{
        margin: '0 26px',
        padding: '20px 20px',
        background: '#FFFFFF',
        border: '1px solid rgba(12,12,10,.07)',
        borderRadius: 20,
        boxShadow: '0 1px 2px rgba(0,0,0,.04)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <Skeleton width="40%" height={11} radius={4} />
      <Skeleton width="65%" height={18} radius={6} />
      {lines > 1 && <Skeleton width="85%" height={13} radius={4} />}
      {lines > 2 && <Skeleton width="50%" height={13} radius={4} />}
    </div>
  );
}

export default function Loading() {
  return (
    <>
      <style>{SHIMMER_CSS}</style>

      {/* 페이지 헤더 영역 */}
      <div style={{ padding: '20px 26px 16px', borderBottom: '1px solid rgba(12,12,10,.07)' }}>
        <Skeleton width="25%" height={10} radius={4} style={{ marginBottom: 8 }} />
        <Skeleton width="45%" height={28} radius={6} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 20 }}>
        {/* 섹션 레이블 */}
        <div style={{ padding: '0 26px' }}>
          <Skeleton width="20%" height={11} radius={4} />
        </div>

        {/* 메인 카드 */}
        <SkeletonCard lines={3} />

        {/* 섹션 레이블 */}
        <div style={{ padding: '4px 26px 0' }}>
          <Skeleton width="25%" height={11} radius={4} />
        </div>

        {/* 보조 카드 2개 */}
        <SkeletonCard lines={2} />
        <SkeletonCard lines={2} />
      </div>
    </>
  );
}
