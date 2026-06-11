// components/ProductThumbnailStrip.tsx
// BOX 제품 연결 썸네일 가로 스크롤 스트립 — 라이브러리·OOTD·TODAY 등 공용

import { FONT } from '@/lib/constants';
import type { Product } from '@/types/product';

export default function ProductThumbnailStrip({
  productIds,
  products,
}: {
  productIds: string[];
  products: Map<string, Product>;
}) {
  if (!productIds.length) return null;
  return (
    <div style={{
      display: 'flex', gap: 8, overflowX: 'auto',
      padding: '12px 8px 8px', width: '100%',
      scrollbarWidth: 'none', borderTop: '1px solid #000000',
      boxSizing: 'border-box',
    }}>
      {productIds.map((pid, idx) => {
        const p = products.get(pid);
        const imgSrc = p?.imageUrl ?? (p as (Product & { storageUrl?: string }) | undefined)?.storageUrl;
        return (
          <div key={idx} style={{ flexShrink: 0, width: 120, display: 'flex', flexDirection: 'column', gap: 5 }}>
            <div style={{
              width: 120, height: 160,
              background: '#F3F3F4', border: '1px solid #000000',
              overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {imgSrc
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={imgSrc} alt={p?.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                : <span style={{ fontSize: 24, opacity: 0.2 }}>🧴</span>
              }
            </div>
            <span style={{
              fontFamily: FONT, fontSize: 11, fontWeight: 600, color: '#525252',
              textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {p?.name ?? ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}
