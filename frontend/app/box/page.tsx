// app/box/page.tsx — BOX 페이지 (제품 인벤토리)
// Stage 3: 제품 목록 표시 + 추가/삭제 + Firestore CRUD
//
// 💡 이 파일의 구조:
//   1. 상수 정의 (카테고리 목록)
//   2. 작은 UI 컴포넌트 (Appbar, ProductCard, EmptyState)
//   3. 메인 BoxPage — 상태 관리 + Firestore 연동
//   4. AddProductPage — 제품 등록 전체 화면 폼

'use client';

import { useState, useEffect, useRef } from 'react';
import {
  collection,
  query,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  orderBy,
  getDoc,
  getDocs,
  setDoc,
} from 'firebase/firestore';
import {
  onAuthStateChanged,
  type User,
} from 'firebase/auth';
import { db, auth } from '@/lib/firebase';
import { useAppContext } from '@/lib/AppContext';
import { FALLBACK_USER_ID } from '@/lib/constants';
import { imageFileToBase64 } from '@/lib/imageUtils';
import type { Product, ProductDomain } from '@/types/product';
import PageHeader from '@/components/PageHeader';
import ImagePicker from '@/components/ImagePicker';


// ─── BOX 설정 타입 ────────────────────────────────────────────────────────────
type SubTypeConfig = { id: string; label: string; cats: string[] };
type DomainConfig  = { id: string; label: string; subTypes?: SubTypeConfig[]; cats?: string[] };
type BoxConfig     = {
  domains: DomainConfig[];
  storageLocations?: string[];                          // legacy (beauty 공통 fallback)
  domainStorageLocations?: Record<string, string[]>;   // 도메인별 보관 위치
};

// 최초 접속 시 사용할 기본 설정값
const DEFAULT_BOX_CONFIG: BoxConfig = {
  domains: [
    {
      id: 'beauty', label: 'Beauty',
      subTypes: [
        { id: 'skincare', label: 'Skincare', cats: ['토너','에센스','세럼','앰플','크림','클렌저','선크림','마스크팩','아이크림','기타'] },
        { id: 'makeup',   label: 'Makeup',   cats: ['파운데이션','립','아이','블러셔','컨실러','기타'] },
      ],
    },
    { id: 'fashion', label: 'Fashion',  cats: ['상의','하의','아우터','신발','가방','모자','스카프','기타'] },
    { id: 'health',  label: '약·비타민', cats: ['비타민','영양제','미네랄','오메가3','프로바이오틱스','한약','건강기능식품','기타'] },
    { id: 'acc',     label: 'ACC',      cats: ['귀걸이','목걸이','팔찌','반지','시계','선글라스','기타'] },
  ],
};

// 도메인 ID → 보관 위치 저장 키 결정
// beauty(skincare·makeup) 공통 사용 → 키 'beauty'
// fashion / health / acc → 도메인 id 그대로
function storageLocKey(domainId: string): string {
  return domainId; // beauty·fashion·health·acc 모두 그대로 사용
}

// boxConfig에서 도메인별 보관 위치 목록 반환 (legacy storageLocations 포함 fallback)
function getStorageLocs(config: BoxConfig, domainId: string): string[] {
  const key = storageLocKey(domainId);
  if (config.domainStorageLocations?.[key]?.length) return config.domainStorageLocations[key];
  // beauty fallback: 기존 storageLocations
  if (domainId === 'beauty' && config.storageLocations?.length) return config.storageLocations;
  return [];
}

// boxConfig에서 특정 도메인/서브타입의 카테고리 목록 추출
function getDomainCats(domain: DomainConfig, subTypeId?: string): string[] {
  if (domain.subTypes?.length) {
    return domain.subTypes.find(st => st.id === subTypeId)?.cats ?? domain.subTypes[0]?.cats ?? [];
  }
  return domain.cats ?? [];
}

// 가격 문자열("₩45,000", "45000", "45,000") → 숫자
function parsePrice(price: string | null | undefined): number | null {
  if (!price) return null;
  const n = parseFloat(price.replace(/[^0-9.]/g, ''));
  return isNaN(n) ? null : n;
}

// 1회 사용 비용 계산 (원 단위)
// price / totalAmount * dosePerUse
function calcCostPerUse(product: Product): string | null {
  const price = parsePrice(product.price);
  if (!price || !product.totalAmount || !product.dosePerUse) return null;
  const cost = (price / product.totalAmount) * product.dosePerUse;
  if (!isFinite(cost) || cost <= 0) return null;
  return cost < 10
    ? `약 ${cost.toFixed(1)}원`
    : `약 ${Math.round(cost).toLocaleString()}원`;
}

// 실시간 경과 시간에 따른 가상 잔량 및 퍼센트 계산
function getVirtualRemaining(product: Product): { remaining: number; pct: number; fillRate: number } {
  const isSkincare = product.domain === 'beauty' && product.subCategory !== 'makeup';
  const isCountMode = product.itemUnit === '개' || product.itemUnit === 'ea';
  const divisor = (isSkincare && isCountMode && product.packageCount > 0)
    ? product.packageCount
    : product.totalAmount;

  const baseRemaining = product.currentRemaining ?? divisor;

  // 자동 소진 계산 조건: 뷰티-스킨케어, 시작일이 있고, 사용 패턴이 "불규칙"이 아닌 경우
  const dailyUsage = (product.dosePerUse ?? 0) * (product.usesPerDay ?? 1) * ((product.frequencyValue ?? 7) / 7);
  const hasRegularPattern = product.frequencyValue !== 0 && dailyUsage > 0;

  if (isSkincare && product.startDate && hasRegularPattern && product.updatedAt) {
    const updateDate = new Date(product.updatedAt);
    const today = new Date();
    
    // 순수 날짜(일수) 단위로 차이 연산
    const diffTime = today.setHours(0,0,0,0) - updateDate.setHours(0,0,0,0);
    const daysSinceUpdate = Math.max(0, Math.floor(diffTime / (1000 * 60 * 60 * 24)));

    if (daysSinceUpdate > 0) {
      if (isCountMode) {
        const dailyCountUsage = dailyUsage / (product.unitPerPackage || 1);
        const virtualRemaining = Math.max(0, baseRemaining - (daysSinceUpdate * dailyCountUsage));
        const roundedRemaining = Math.round(virtualRemaining * 100) / 100;
        const fillRate = Math.min(1, roundedRemaining / divisor);
        return {
          remaining: roundedRemaining,
          pct: Math.round(fillRate * 100),
          fillRate
        };
      } else {
        const virtualRemaining = Math.max(0, baseRemaining - (daysSinceUpdate * dailyUsage));
        const roundedRemaining = Math.round(virtualRemaining * 10) / 10;
        const fillRate = Math.min(1, roundedRemaining / divisor);
        return {
          remaining: roundedRemaining,
          pct: Math.round(fillRate * 100),
          fillRate
        };
      }
    }
  }

  const fillRate = divisor > 0 ? Math.min(1, baseRemaining / divisor) : 1;
  return {
    remaining: baseRemaining,
    pct: Math.round(fillRate * 100),
    fillRate
  };
}

// 카테고리별 기본 1회 사용량 (벤치마킹 데이터 기반 표준값)
const CATEGORY_DOSE_DEFAULTS: Record<string, { dose: number; unit: string }> = {
  '세럼':     { dose: 0.3,  unit: 'ml' },
  '에센스':   { dose: 0.3,  unit: 'ml' },
  '앰플':     { dose: 0.3,  unit: 'ml' },
  '크림':     { dose: 0.45, unit: 'g' },
  '아이크림': { dose: 0.12, unit: 'g' },
  '토너':     { dose: 2.0,  unit: 'ml' },
  '선크림':   { dose: 1.25, unit: 'ml' },
  '클렌저':   { dose: 0.6,  unit: 'ml' },
  '마스크팩': { dose: 1,    unit: '개' },
};

// 사용 주기 옵션 (주당 몇 회)
const FREQ_OPTIONS = [
  { label: '매일',   daysPerWeek: 7   },
  { label: '주중',   daysPerWeek: 5   },
  { label: '격일',   daysPerWeek: 3.5 },
  { label: '주3회',  daysPerWeek: 3   },
  { label: '불규칙', daysPerWeek: 0   },
];

// ─── 제품 추가 폼 상태 타입 ───────────────────────────────────────────────────
type FormState = {
  name: string;
  brand: string;
  category: string;
  formDomain: string;    // 폼 내부 도메인 ID (편집 시 product.domain 사용)
  formSubType: string;   // 폼 내부 서브타입 ID (편집 시 product.subCategory 사용)
  packageCount: number;
  unitPerPackage: number;
  usesPerDay: number;
  dosePerUse: number;
  daysPerWeek: number;
  purchaseDate: string;
  expiryDate: string;
  startDate: string;
  // 신규 필드
  price: string;             // 가격 (예: "₩45,000")
  source: string;            // 구매처
  purchaseUrl: string;       // 구매 링크
  currentRemaining: number;    // 현재 잔량 / 남은 개수 (편집 및 신규에서 입력)
  imageFile: File | null;
  imagePreview: string;
  imageUrl: string;
  itemUnit: string;            // 용량 단위: 'ml' | 'g' | '개'
  usageDurationMonths: number; // 총 사용 기간(개월) — '개' 단위일 때만 사용, 0=미입력
  // Fashion / Acc 전용
  material: string;            // 소재 (예: 코튼, 린넨)
  careGuide: string;           // 케어 방법 (예: 손세탁)
  specialNote: string;         // 특이사항 (Acc)
  materialType: string;        // Acc 재질 칩 (금/은/가죽/패브릭/플라스틱/기타)
  boxLocation: string;         // 보관 위치 이름 (예: 안방 드레스룸, 욕실 선반)
  storageImagePreview: string; // 보관 장소 이미지 base64 미리보기
  storageImageUrl: string;     // 기존 보관 장소 이미지 URL
};

const INITIAL_FORM: FormState = {
  name: '',
  brand: '',
  category: '',
  formDomain: 'beauty',
  formSubType: 'skincare',
  packageCount: 1,
  unitPerPackage: 1,
  usesPerDay: 2,
  dosePerUse: 0.3,
  daysPerWeek: 0,
  purchaseDate: '',
  expiryDate: '',
  startDate: '',
  price: '',
  source: '',
  purchaseUrl: '',
  currentRemaining: 0,
  imageFile: null,
  imagePreview: '',
  imageUrl: '',
  itemUnit: '개',
  usageDurationMonths: 0,
  material: '',
  careGuide: '',
  specialNote: '',
  materialType: '',
  boxLocation: '',
  storageImagePreview: '',
  storageImageUrl: '',
};

// ─── 매거진 뷰 (design/box.html magazine 뷰 참고) ────────────────────────────
// 히어로(최신 등록, 전폭 260px) + 나머지 3열 소형 카드
function MagazineView({ products, onEdit }: { products: Product[]; onEdit: (p: Product) => void }) {
  if (!products.length) return null;

  // 히어로: createdAt 기준 가장 최신 제품
  const heroIdx = products.reduce((best, p, i) =>
    (p.createdAt || '') > (products[best].createdAt || '') ? i : best, 0);
  const hero = products[heroIdx];
  const rest = products.filter((_, i) => i !== heroIdx);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', paddingBottom: 100 }}>
      {/* ── 히어로 카드 (design/box.html .mag-hero-card) ── */}
      <div
        onClick={() => onEdit(hero)}
        style={{ padding: '16px 26px 0', cursor: 'pointer' }}
      >
        <MagImg product={hero} borderRadius={20} isHero />
        <div style={{ padding: '12px 0 4px' }}>
          {hero.brand && (
            <div style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 14, fontStyle: 'italic', color: '#0C0C0A', marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {hero.brand}
            </div>
          )}
          <div style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 14, fontWeight: 500, color: '#0C0C0A', lineHeight: 1.3, marginBottom: hero.boxLocation ? 6 : 8 }}>
            {hero.name}
          </div>
          {hero.boxLocation && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 10, fontWeight: 600, color: '#4A4846', background: '#EEEDE9', padding: '2px 8px', borderRadius: 9999, marginBottom: 8, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
              📍 {hero.boxLocation}
            </div>
          )}
          <MagResBar product={hero} />
        </div>
      </div>

      {/* ── 3열 소형 카드 (design/box.html .mag-3col) ── */}
      {rest.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, padding: '12px 26px 0' }}>
          {rest.map((p) => (
            <div key={p.id} onClick={() => onEdit(p)} style={{ cursor: 'pointer' }}>
              <MagImg product={p} borderRadius={12} />
              <div style={{ padding: '6px 0 0' }}>
                {p.brand && (
                  <div style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 11, fontStyle: 'italic', color: '#0C0C0A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.brand}
                  </div>
                )}
                <div style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 12, fontWeight: 500, color: '#0C0C0A', lineHeight: 1.3, marginBottom: p.boxLocation ? 4 : 6, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const }}>
                  {p.name}
                </div>
                {p.boxLocation && (
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 9, fontWeight: 600, color: '#4A4846', background: '#EEEDE9', padding: '2px 6px', borderRadius: 9999, marginBottom: 4, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                    📍 {p.boxLocation}
                  </div>
                )}
                <MagResBar product={p} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── 적응형 이미지: 좌우 여백이 10px 미만이면 contain→cover 자동 전환 ────────
function AdaptiveImg({ src, style }: { src: string; style?: React.CSSProperties }) {
  const [fit, setFit] = useState<'contain' | 'cover'>('contain');

  function handleLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const img = e.currentTarget;
    const parent = img.parentElement;
    if (!parent) return;
    const cW = parent.clientWidth;
    const cH = parent.clientHeight;
    if (!cW || !cH) return;
    const imgRatio = img.naturalWidth / img.naturalHeight;
    const containerRatio = cW / cH;
    // 이미지가 컨테이너보다 세로로 더 긴 경우(portrait) → 좌우 여백 발생
    if (imgRatio < containerRatio) {
      const whitespacePerSide = (cW - cH * imgRatio) / 2;
      if (whitespacePerSide < 10) setFit('cover');
    }
  }

  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" onLoad={handleLoad} style={{ ...style, objectFit: fit }} />;
}

// 매거진 이미지 블록 (히어로: 전폭 / 소형: 3:4 비율)
function MagImg({ product, borderRadius, isHero }: { product: Product; borderRadius: number; isHero?: boolean }) {
  const imgUrl = product.imageUrl ?? (product as Product & { storageUrl?: string }).storageUrl;
  // 잔량 바: beauty skincare + 개 단위 제품 모두 표시
  const isCountMode = product.itemUnit === '개' || product.itemUnit === 'ea';
  const isSkincare = product.domain === 'beauty' && product.subCategory !== 'makeup';
  const hasRemaining = product.totalAmount > 0 && product.currentRemaining != null;
  const { fillRate } = getVirtualRemaining(product);
  const showBar = (product.domain === 'beauty' && product.subCategory !== 'makeup') || product.itemUnit === '개';
  return (
    <div
      style={{
        width: '100%', aspectRatio: '3/4', borderRadius, background: '#EEEDE9',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        position: 'relative', overflow: 'hidden',
      }}
    >
      {imgUrl
        // 히어로는 AdaptiveImg(비율 적응), 3열 소형은 cover로 고정
        ? isHero
          ? <AdaptiveImg src={imgUrl} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
          // eslint-disable-next-line @next/next/no-img-element
          : <img src={imgUrl} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        : <span style={{ fontSize: isHero ? 48 : 24, opacity: 0.15 }}>✦</span>}
      {isHero && (
        <div style={{ position: 'absolute', top: 14, left: 14, background: '#fff', color: '#0C0C0A', fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: '5px 12px', borderRadius: 9999, boxShadow: '0 2px 8px rgba(0,0,0,.12)', zIndex: 1 }}>
          NEW ARRIVAL
        </div>
      )}
      {/* 하단 잔량 바 — skincare + 개 단위 */}
      {showBar && hasRemaining && (
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 3, background: 'rgba(12,12,10,.08)', zIndex: 1 }}>
          <div style={{ height: '100%', width: `${fillRate * 100}%`, background: '#C5FF00' }} />
        </div>
      )}
    </div>
  );
}

// 매거진 잔량 바 (얇은 바 + 퍼센트 + D-N)
function MagResBar({ product }: { product: Product }) {
  const isCountMode = product.itemUnit === '개' || product.itemUnit === 'ea';
  const isSkincare = product.domain === 'beauty' && product.subCategory !== 'makeup';
  // 표시 조건: beauty skincare 또는 개 단위 제품
  if (!isSkincare && !isCountMode) return null;
  if (!product.totalAmount || product.currentRemaining == null) return null;

  const divisor = (isSkincare && isCountMode && product.packageCount > 0)
    ? product.packageCount
    : product.totalAmount;

  const { remaining, pct, fillRate } = getVirtualRemaining(product);

  // D-N 계산: 뷰티-스킨케어 제품이고 사용 시작일이 있는 경우에만 소진 디데이 노출
  const dailyUsage = (product.dosePerUse ?? 0) * (product.usesPerDay ?? 1) * ((product.frequencyValue ?? 7) / 7);
  
  // 개수 모드이면서 스킨케어인 경우, 남은 개수에 개당 용량을 곱해 용량(ml)으로 환산하여 디데이 계산
  const remainingVolumeForDDay = (isSkincare && isCountMode)
    ? remaining * (product.unitPerPackage ?? 1)
    : remaining;

  const daysLeft = (isSkincare && product.startDate && dailyUsage > 0 && remainingVolumeForDDay > 0)
    ? Math.floor(remainingVolumeForDDay / dailyUsage)
    : null;

  const formattedRemaining = remaining % 1 === 0 ? remaining : remaining.toFixed(1);

  return (
    <>
      <div style={{ height: 3, background: '#EEEDE9', borderRadius: 2, overflow: 'hidden', marginBottom: 4 }}>
        <div style={{ height: '100%', width: `${pct}%`, background: '#C5FF00', borderRadius: 2 }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 10, color: '#9A9490', gap: 2, flexWrap: 'nowrap' as const }}>
        <span style={{ whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 1, minWidth: 0 }}>
          {isCountMode
            ? `${formattedRemaining}/${isSkincare ? product.packageCount : product.totalAmount}개`
            : `${formattedRemaining}${product.itemUnit === 'ea' ? '개' : (product.itemUnit || 'ml')}`}
        </span>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0, whiteSpace: 'nowrap' as const }}>
          {daysLeft !== null && (
            <span style={{ fontWeight: 700, color: daysLeft <= 7 ? '#E94F6B' : daysLeft <= 14 ? '#F97316' : '#9A9490' }}>
              D-{daysLeft}
            </span>
          )}
          <span>{pct}%</span>
        </div>
      </div>
    </>
  );
}

// ─── 제품 카드 (갤러리 3열 그리드) ──────────────────────────────────────────
// design/box.html .gallery-item 구조를 Next.js 컴포넌트로 변환
function ProductCard({
  product,
  onClick,
}: {
  product: Product;
  onClick: () => void;
}) {
  const isCountMode = product.itemUnit === '개' || product.itemUnit === 'ea';
  const isSkincare = product.domain === 'beauty' && product.subCategory !== 'makeup';
  
  const { remaining, pct, fillRate } = getVirtualRemaining(product);
  const formattedRemaining = remaining % 1 === 0 ? remaining : remaining.toFixed(1);

  // Firebase Storage URL 또는 구 box.html Cloudinary URL
  const imgUrl = product.imageUrl ?? (product as Product & { storageUrl?: string }).storageUrl;

  return (
    <div
      onClick={onClick}
      style={{
        aspectRatio: '3/4',
        position: 'relative',
        cursor: 'pointer',
        overflow: 'hidden',
        background: '#EEEDE9',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* 배경 이미지 (있을 때만) — 갤러리 셀은 항상 cover로 꽉 채움 */}
      {imgUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imgUrl} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
      )}

      {/* 상단 잔량 바 — 스킨케어(beauty)만 표시 */}
      {isSkincare && (
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'rgba(0,0,0,.12)', zIndex: 1 }}>
          <div style={{ height: '100%', width: `${fillRate * 100}%`, background: '#C5FF00' }} />
        </div>
      )}

      {/* 제품 플레이스홀더 (이미지 없을 때만) */}
      {!imgUrl && <span style={{ fontSize: 24, opacity: 0.15 }}>✦</span>}

      {/* 하단 제품명 바 (그라데이션 오버레이) */}
      <div
        style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 1,
          padding: '22px 8px 6px',
          background: 'linear-gradient(transparent, rgba(0,0,0,.78))',
          fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
          display: 'flex', flexDirection: 'column', gap: 2,
        }}
      >
        <div
          style={{
            fontSize: 11, fontWeight: 700, color: '#fff', letterSpacing: '.04em',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >
          {product.name}
        </div>
        {product.totalAmount > 0 && product.currentRemaining != null && (
          <div
            style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              fontSize: 9, fontWeight: 700, letterSpacing: '.02em',
            }}
          >
            <span style={{ color: '#C5FF00' }}>
              {product.itemUnit === '개' || product.itemUnit === 'ea'
                ? `${formattedRemaining}/${isSkincare ? product.packageCount : product.totalAmount}개`
                : `${formattedRemaining}/${product.totalAmount}${product.itemUnit || 'ml'}`}
            </span>
          </div>
        )}
      </div>

      {/* 잔량 낮음 경고 뱃지 — beauty만 */}
      {isSkincare && fillRate < 0.2 && (
        <div
          style={{
            position: 'absolute', top: 6, right: 4, zIndex: 2,
            background: '#D93025', color: '#fff',
            borderRadius: 3, fontSize: 10, fontWeight: 700, padding: '2px 4px',
          }}
        >
          LOW
        </div>
      )}
    </div>
  );
}

// ─── 리스트 뷰 행 (design/box.html .list-item 구조) ──────────────────────────
function ListRow({ product, onClick }: { product: Product; onClick: () => void }) {
  const isCountMode = product.itemUnit === '개' || product.itemUnit === 'ea';
  const isSkincare = product.domain === 'beauty' && product.subCategory !== 'makeup';
  
  const { remaining, pct, fillRate } = getVirtualRemaining(product);
  const formattedRemaining = remaining % 1 === 0 ? remaining : remaining.toFixed(1);
  const imgUrl = product.imageUrl ?? (product as Product & { storageUrl?: string }).storageUrl;

  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '10px 26px',
        borderBottom: '1px solid rgba(12,12,10,.07)', cursor: 'pointer',
        background: '#fff', transition: 'background .12s',
      }}
    >
      {/* 썸네일 — design/box.html .list-thumb */}
      <div style={{ width: 44, aspectRatio: '3/4', borderRadius: 6, flexShrink: 0, background: '#EEEDE9', overflow: 'hidden', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {imgUrl
          ? <AdaptiveImg src={imgUrl} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
          : <span style={{ fontSize: 18, opacity: 0.15 }}>✦</span>}
      </div>

      {/* 제품 정보 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {product.brand && (
          <div style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 11, fontWeight: 500, letterSpacing: '.06em', textTransform: 'uppercase', color: '#9A9490' }}>
            {product.brand}
          </div>
        )}
        <div style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 13, fontWeight: 600, color: '#0C0C0A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {product.name}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 3 }}>
          {product.category && (
            <div style={{ display: 'inline-block', fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase' as const, color: '#9A9490', background: '#F4F4F0', padding: '2px 5px', borderRadius: 3 }}>
              {resolveCategory(product.category)}
            </div>
          )}
        </div>
      </div>

      {/* 📍 보관 위치 — 오른쪽 정렬 */}
      {product.boxLocation && (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2, flexShrink: 0, fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 10, fontWeight: 600, color: '#4A4846', background: '#EEEDE9', padding: '3px 8px', borderRadius: 9999, maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
          📍 {product.boxLocation}
        </div>
      )}

      {/* 잔량 바 + 퍼센트 + 수량 — 수량 정보가 있는 모든 제품 표시 */}
      {product.totalAmount > 0 && product.currentRemaining != null && (
        <div style={{ width: 75, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}>
          <div style={{ height: 3, background: '#EEEDE9', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pct}%`, background: '#C5FF00', borderRadius: 2 }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 9, color: '#9A9490', marginTop: 3, gap: 2 }}>
            <span>{pct}%</span>
            <span style={{ fontWeight: 700, color: '#4A4846' }}>
              {product.itemUnit === '개' || product.itemUnit === 'ea'
                ? `${formattedRemaining}/${isSkincare ? product.packageCount : product.totalAmount}개`
                : `${formattedRemaining}/${product.totalAmount}${product.itemUnit || 'ml'}`}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 빈 상태 카드 ─────────────────────────────────────────────────────────────
function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div
      style={{
        padding: '48px 32px',
        textAlign: 'center',
        border: '1.5px dashed rgba(12,12,10,.14)',
        borderRadius: 16,
        margin: '16px',
      }}
    >
      <div style={{ fontSize: 40, opacity: 0.3, marginBottom: 12, lineHeight: 1 }}>□</div>
      <div
        style={{
          fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
          fontSize: 14, fontWeight: 600, color: '#4A4846', lineHeight: 1.55, marginBottom: 6,
        }}
      >
        아직 등록된 제품이 없어요
      </div>
      <div
        style={{
          fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
          fontSize: 11, fontWeight: 600, letterSpacing: '.06em', color: '#9A9490', marginBottom: 20,
        }}
      >
        + 버튼으로 첫 제품을 추가해보세요
      </div>
      <button
        onClick={onAdd}
        style={{
          padding: '10px 26px', background: '#0C0C0A', color: '#fff',
          border: 'none', borderRadius: 9999, cursor: 'pointer',
          fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
          fontSize: 12, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase',
        }}
      >
        제품 추가
      </button>
    </div>
  );
}

// ─── 구 box.html catKey → 한국어 카테고리 매핑 ─────────────────────────────
const CAT_KEY_MAP: Record<string, string> = {
  // 스킨케어
  toner: '토너', essence: '에센스', serum: '세럼', ampoule: '앰플',
  cream: '크림', lotion: '에멀전', emulsion: '에멀전', amulsion: '에멀전',
  // 이미 '로션'으로 저장된 값도 에멀전으로 재변환
  '로션': '에멀전',
  cleanser: '클렌저', suncare: '선크림', sunscreen: '선크림', spf: '선크림',
  mask: '마스크팩', eye: '아이크림', mist: '미스트', oil: '오일',
  peeling: '필링', exfoliant: '필링', scrub: '스크럽', toner_pad: '토너',
  // 메이크업
  foundation: '파운데이션', lip: '립', eye_makeup: '아이', blush: '블러셔',
  concealer: '컨실러', primer: '프라이머', powder: '파우더',
  highlighter: '하이라이터', contour: '컨투어',
  // 패션/악세사리
  acc: '기타', accessory: '기타', jewelry: '기타',
  // 영문 전체 표기 (소문자)
  'eye cream': '아이크림', 'sun care': '선크림', 'sun cream': '선크림',
  'mask pack': '마스크팩', 'sheet mask': '마스크팩',
  'lip balm': '립', 'lip gloss': '립', 'lip tint': '립',
  'face wash': '클렌저', 'foam cleanser': '클렌저', 'cleansing': '클렌저',
  'moisturizer': '크림', 'moisturizing': '크림',
};

// 자동생성 ID 여부 판별
// - cat_1778572255317  : cat_ + 타임스탬프 (키워드 없음, 복원 불가)
// - c_keyword_68006    : c_ + 키워드 + 랜덤숫자 (키워드 추출 가능)
function isAutoId(cat: string): boolean {
  return /^cat_\d+$/.test(cat) || /^c_[a-z]+_\d+$/i.test(cat);
}

// 저장된 category 값을 한국어로 변환
// 처리 순서:
//   1) CAT_KEY_MAP 직접/소문자 매칭
//   2) c_keyword_숫자 → keyword 추출 후 CAT_KEY_MAP 매칭
//   3) cat_타임스탬프 또는 매핑 불가 auto-ID → '' (빈 문자열, 화면에 배지 미표시)
//   4) 일반 문자열 → 원본 반환
function resolveCategory(cat: string | undefined | null): string {
  if (!cat) return '';

  // 1) 직접·소문자 매칭
  if (CAT_KEY_MAP[cat]) return CAT_KEY_MAP[cat];
  if (CAT_KEY_MAP[cat.toLowerCase()]) return CAT_KEY_MAP[cat.toLowerCase()];

  // 2) c_keyword_숫자 패턴
  const kwMatch = cat.match(/^c_([a-z]+)_\d+$/i);
  if (kwMatch) {
    const kw = kwMatch[1].toLowerCase();
    return CAT_KEY_MAP[kw] || ''; // 매핑 없으면 빈 문자열
  }

  // 3) cat_타임스탬프 패턴 → 빈 문자열
  if (/^cat_\d+$/.test(cat)) return '';

  // 4) 일반 문자열 (한글 커스텀 등) → 원본 유지
  return cat;
}

// 모든 제품 category를 현재 boxConfig 기준으로 정리
// 마이그레이션된 제품 중 imageUrl이 없는 항목에 구 box/data.assets의 storageUrl을 채워넣기
// 제품명으로 매칭 (한 번만 실행, localStorage 플래그로 관리)
async function syncMissingImages(uid: string): Promise<void> {
  if (!db) return;
  const flagKey = `onstep_img_sync_v2_${uid}`;
  if (typeof localStorage !== 'undefined' && localStorage.getItem(flagKey)) return;

  try {
    const oldSnap = await getDoc(doc(db, 'users', uid, 'box', 'data'));
    if (!oldSnap.exists()) {
      if (typeof localStorage !== 'undefined') localStorage.setItem(flagKey, 'done');
      return;
    }

    const assets: Record<string, unknown>[] = oldSnap.data().assets ?? [];
    // 제품명 → Cloudinary URL 매핑 (storageUrl이 있는 것만)
    const nameToUrl: Record<string, string> = {};
    for (const a of assets) {
      const url = (a.storageUrl as string) || '';
      if (a.name && url) nameToUrl[a.name as string] = url;
    }

    if (Object.keys(nameToUrl).length === 0) {
      if (typeof localStorage !== 'undefined') localStorage.setItem(flagKey, 'done');
      return;
    }

    const productsSnap = await getDocs(collection(db, 'users', uid, 'products'));
    const patches: Promise<void>[] = [];
    for (const d of productsSnap.docs) {
      const data = d.data();
      // imageUrl이 없거나 null인 제품만 패치
      if (!data.imageUrl) {
        const url = nameToUrl[data.name as string];
        if (url) {
          patches.push(updateDoc(doc(db, 'users', uid, 'products', d.id), { imageUrl: url }));
        }
      }
    }

    if (patches.length > 0) {
      await Promise.all(patches);
      console.log(`[OnStep] 이미지 ${patches.length}개 동기화 완료`);
    }

    if (typeof localStorage !== 'undefined') localStorage.setItem(flagKey, 'done');
  } catch (e) {
    console.error('[OnStep] 이미지 동기화 오류:', e);
  }
}

// 구 box.html의 users/{uid}/box/data.assets 배열을
// 신 users/{uid}/products 컬렉션으로 마이그레이션
// force=true 이면 localStorage 플래그 무시하고 재실행
async function migrateOldBoxAssets(uid: string, force = false): Promise<{ count: number; error?: string }> {
  if (!db) return { count: 0, error: 'Firebase 미설정' };

  // 이미 이 기기에서 마이그레이션 완료한 경우 스킵 (강제 실행 아니면)
  const flagKey = `onstep_migrated_${uid}`;
  if (!force && typeof localStorage !== 'undefined' && localStorage.getItem(flagKey)) {
    return { count: 0 };
  }

  try {
    // products가 이미 1개 이상 있으면 마이그레이션 스킵 (중복 방지)
    if (!force) {
      const existingSnap = await getDocs(collection(db, 'users', uid, 'products'));
      if (!existingSnap.empty) {
        if (typeof localStorage !== 'undefined') localStorage.setItem(flagKey, 'done');
        return { count: 0 };
      }
    }

    // 구 box/data 문서 읽기
    const oldSnap = await getDoc(doc(db, 'users', uid, 'box', 'data'));
    if (!oldSnap.exists()) {
      // 이전 데이터 없음 — 플래그 세팅해서 다음 로그인에 또 시도 안 함
      if (typeof localStorage !== 'undefined') localStorage.setItem(flagKey, 'done');
      return { count: 0, error: 'Firestore에 이전 데이터가 없습니다. box.html에서 먼저 로그인해주세요.' };
    }

    const assets: Record<string, unknown>[] = (oldSnap.data().assets ?? []);
    if (!assets.length) {
      if (typeof localStorage !== 'undefined') localStorage.setItem(flagKey, 'done');
      return { count: 0, error: '이전 제품이 0개입니다.' };
    }

    const now = new Date().toISOString();
    await Promise.all(
      assets.map((a) =>
        addDoc(collection(db!, 'users', uid, 'products'), {
          name:            (a.name as string) || '',
          brand:           (a.brand as string) || null,
          domain:          (a.domain as string) || 'beauty',
          subCategory:     (a.type as string) || null,
          category:        CAT_KEY_MAP[a.catKey as string] ?? (a.catKey as string) ?? null,
          packageCount:    Number(a.packageCount) || 1,
          unitPerPackage:  Number(a.unitPerPackage) || 1,
          itemUnit:        (a.itemUnit as string) === 'ea' ? '개' : ((a.itemUnit as string) || '개'),
          totalAmount:     Number(a.totalAmount) || 1,
          dosePerUse:      Number(a.dosePerUse) || 1,
          usesPerDay:      Number(a.usesPerDay) || 1,
          frequencyType:   Number(a.frequencyValue) === 7 ? 'daily' : 'per_week',
          frequencyValue:  Number(a.frequencyValue) || 7,
          currentRemaining: a.currentRemaining != null
            ? Number(a.currentRemaining)
            : Number(a.totalAmount) || 1,
          purchaseDate:    (a.purchaseDate as string) || null,
          startDate:       (a.startDate as string) || null,
          expiryDate:      (a.expiryDate as string) || (a.endDate as string) || null,
          imageUrl:        (a.storageUrl as string) || null,
          price:           (a.price as string) || null,
          source:          (a.source as string) || null,
          purchaseUrl:     (a.purchaseUrl as string) || null,
          createdAt:       (a.addedDate as string) || now,
          updatedAt:       now,
        })
      )
    );

    if (typeof localStorage !== 'undefined') localStorage.setItem(flagKey, 'done');
    return { count: assets.length };
  } catch (e) {
    const msg = (e as { message?: string }).message ?? String(e);
    console.error('[OnStep] 마이그레이션 오류:', e);
    return { count: 0, error: msg };
  }
}

// ─── 이미지 리사이즈 유틸 ────────────────────────────────────────────────────
// 업로드 전 Canvas로 클라이언트에서 리사이즈 → Firebase Storage 트래픽 절감
// 💡 maxPx: 긴 변 기준 최대 픽셀 (800px 이상 사진은 줄여서 저장)
//    quality: JPEG 압축률 0~1 (0.82 ≈ 용량/화질 균형)
function resizeImage(file: File, maxPx = 800, quality = 0.82): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      const { naturalWidth: w, naturalHeight: h } = img;
      // 이미 충분히 작으면 그대로 반환
      if (w <= maxPx && h <= maxPx) { resolve(file); return; }

      const scale = maxPx / Math.max(w, h);
      const tw = Math.round(w * scale);
      const th = Math.round(h * scale);

      const canvas = document.createElement('canvas');
      canvas.width = tw;
      canvas.height = th;
      canvas.getContext('2d')!.drawImage(img, 0, 0, tw, th);

      canvas.toBlob(
        (blob) => {
          if (!blob) { reject(new Error('Canvas toBlob 실패')); return; }
          // 확장자 .jpg로 통일 (JPEG 파일명)
          const name = file.name.replace(/\.[^.]+$/, '.jpg');
          resolve(new File([blob], name, { type: 'image/jpeg' }));
        },
        'image/jpeg',
        quality,
      );
    };

    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('이미지 로드 실패')); };
    img.src = objectUrl;
  });
}

// ─── 메인 BOX 페이지 ─────────────────────────────────────────────────────────
export default function BoxPage() {
  // ── 공유 컨텍스트 ──
  const { user, userId, authLoading, products } = useAppContext();
  const loading = authLoading;

  // 필터 상태
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<string>('all'); // 기본: 전체 보기
  const [subType, setSubType] = useState<string>('skincare');
  const [boxConfig, setBoxConfig] = useState<BoxConfig>(DEFAULT_BOX_CONFIG);
  const [manageOpen, setManageOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState('ALL');

  // 제품 추가/편집 폼 열림/닫힘
  const [isAddOpen, setIsAddOpen] = useState(false);

  // 편집 중인 제품 (null = 신규 추가)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  // 폼 상태
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [saving, setSaving] = useState(false);

  // 마이그레이션 알림 토스트
  const [migrationToast, setMigrationToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [migrating, setMigrating] = useState(false);

  // BOX 최상위 뷰: 제품 목록 vs 지출 분석 vs 보관장소
  const [boxView, setBoxView] = useState<'products' | 'spending' | 'storage'>('products');
  // 지출 분석 도메인 필터
  const [spendingFilter, setSpendingFilter] = useState<string>('all');

  // 보관장소 추가 및 편집 상태
  const [addingStorageLoc, setAddingStorageLoc] = useState(false);
  const [newStorageLocName, setNewStorageLocName] = useState('');
  const [locEditOpen, setLocEditOpen] = useState(false);
  const [editTargetLocName, setEditTargetLocName] = useState('');
  const [editTargetLocDomain, setEditTargetLocDomain] = useState('');
  const [editLocNewNameVal, setEditLocNewNameVal] = useState('');
  const [editLocNewPhotoVal, setEditLocNewPhotoVal] = useState('');
  const [locEditSaving, setLocEditSaving] = useState(false);

  // 뷰 모드 (매거진 / 갤러리 3열 / 리스트)
  const [viewMode, setViewMode] = useState<'magazine' | 'gallery' | 'list'>('magazine');
  // 정렬 모드
  const [sortMode, setSortMode] = useState<'added' | 'name' | 'uses' | 'brand'>('added');

  // products / auth → AppContext에서 공유 (탭 전환 시 재로딩 없음)

  // ── boxConfig 로드 / 저장 ─────────────────────────────────────────────────
  useEffect(() => {
    if (!user || !db) return;
    const ref = doc(db, 'users', user.uid, 'settings', 'boxConfig');
    getDoc(ref).then((snap) => {
      if (snap.exists()) {
        const cfg = snap.data() as BoxConfig;
        let changed = false;

        // 1. 약·비타민 도메인 없으면 자동 추가
        const hasHealth = cfg.domains?.some(d => d.id === 'health');
        if (!hasHealth) {
          const healthDomain = DEFAULT_BOX_CONFIG.domains.find(d => d.id === 'health');
          if (healthDomain) {
            cfg.domains = [...(cfg.domains ?? []), healthDomain];
            changed = true;
          }
        }

        // 2. skincare 카테고리에 '앰플'이 없으면 자동 추가
        const beautyDomain = cfg.domains?.find(d => d.id === 'beauty');
        const skincareSubType = beautyDomain?.subTypes?.find(st => st.id === 'skincare');
        if (skincareSubType && Array.isArray(skincareSubType.cats) && !skincareSubType.cats.includes('앰플')) {
          const catsList = [...skincareSubType.cats];
          const serumIndex = catsList.indexOf('세럼');
          if (serumIndex !== -1) {
            catsList.splice(serumIndex + 1, 0, '앰플');
          } else {
            const etcIndex = catsList.indexOf('기타');
            if (etcIndex !== -1) {
              catsList.splice(etcIndex, 0, '앰플');
            } else {
              catsList.push('앰플');
            }
          }
          skincareSubType.cats = catsList;
          changed = true;
        }

        if (changed) {
          const updated = { ...cfg };
          setBoxConfig(updated);
          setDoc(ref, updated);
        } else {
          setBoxConfig(cfg);
        }
      } else {
        setDoc(ref, DEFAULT_BOX_CONFIG);
      }
    }).catch(() => {/* 설정 로드 실패 시 기본값 유지 */});
  }, [user]);

  async function saveBoxConfig(config: BoxConfig) {
    if (!user || !db) return;
    setBoxConfig(config);
    await setDoc(doc(db, 'users', user.uid, 'settings', 'boxConfig'), config);
  }

  // ── 구 box.html → 신 products 마이그레이션 + 이미지 동기화 ─────────────────
  // 로그인 시 localStorage 플래그 확인 후 마이그레이션 시도, 이후 이미지 패치
  useEffect(() => {
    if (!user) return;
    migrateOldBoxAssets(user.uid).then(({ count, error }) => {
      if (count > 0) {
        const toast = { msg: `이전 제품 ${count}개 가져오기 완료 ✓`, ok: true };
        setMigrationToast(toast);
        setTimeout(() => setMigrationToast(null), 5000);
      } else if (error) {
        // 조용한 실패는 콘솔에만 (첫 로그인 시 에러 메시지 안 띄움)
        console.log('[OnStep] 마이그레이션:', error);
      }
      // 마이그레이션 완료 여부와 관계없이 이미지 동기화 실행
      syncMissingImages(user.uid);
    });
  }, [user]);


  // 수동 마이그레이션 실행 (버튼 클릭 시)
  async function handleManualMigrate() {
    if (!user || migrating) return;
    setMigrating(true);
    const { count, error } = await migrateOldBoxAssets(user.uid, true);
    if (count > 0) {
      setMigrationToast({ msg: `이전 제품 ${count}개 가져오기 완료 ✓`, ok: true });
    } else if (error) {
      setMigrationToast({ msg: `가져오기 실패: ${error}`, ok: false });
    } else {
      setMigrationToast({ msg: '가져올 이전 데이터가 없습니다', ok: false });
    }
    setMigrating(false);
    setTimeout(() => setMigrationToast(null), 6000);
  }

  // ── 필터링된 제품 목록 ────────────────────────────────────────────────────
  const filtered = products.filter((p) => {
    // 도메인 필터 — 'all'이면 전체 표시
    if (activeTab !== 'all' && p.domain !== activeTab) return false;
    // 서브타입 필터 (서브타입이 있는 도메인만, 전체 보기 시 스킵)
    const activeDomainCfg = boxConfig.domains.find(d => d.id === activeTab);
    if (activeDomainCfg?.subTypes?.length && p.subCategory && p.subCategory !== subType) return false;
    // 카테고리 필터 — resolveCategory로 변환 후 비교
    if (activeCategory === '미분류') {
      // category가 null/undefined/빈문자열인 제품만 표시
      if (resolveCategory(p.category) !== '') return false;
    } else if (activeCategory !== 'ALL' && resolveCategory(p.category) !== activeCategory) {
      return false;
    }
    // 검색어 필터
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const nameMatch = p.name.toLowerCase().includes(q);
      const brandMatch = (p.brand ?? '').toLowerCase().includes(q);
      if (!nameMatch && !brandMatch) return false;
    }
    return true;
  });

  // ── 현재 탭의 카테고리 칩 목록 (boxConfig에서 동적 계산) ────────────────
  const activeDomain = boxConfig.domains.find(d => d.id === activeTab);
  const cats = activeDomain ? getDomainCats(activeDomain, subType) : [];
  // 카테고리 없는(null/빈) 제품이 있으면 '미분류' 칩을 마지막에 추가
  const hasUncategorized = filtered.some(p => !resolveCategory(p.category));
  const allCats = hasUncategorized ? [...cats, '미분류'] : cats;

  // ── 정렬 적용 ────────────────────────────────────────────────────────────
  // 사용 빈도순: 하루 사용횟수 × (주당 사용일/7) = 하루 평균 소비 횟수
  const sortedFiltered = [...filtered].sort((a, b) => {
    switch (sortMode) {
      case 'name':
        return (a.name || '').localeCompare(b.name || '', 'ko');
      case 'uses':
        return (b.usesPerDay * (b.frequencyValue ?? 7)) - (a.usesPerDay * (a.frequencyValue ?? 7));
      case 'brand':
        return (a.brand || '기타').localeCompare(b.brand || '기타', 'ko');
      default: // 'added' — 최신 등록순 (createdAt 내림차순)
        return (b.createdAt || '').localeCompare(a.createdAt || '');
    }
  });

  // ── 브랜드별 그룹화 (리스트 뷰 + 브랜드순일 때만) ───────────────────────
  const brandGroups: Array<{ brand: string; items: Product[] }> = (() => {
    if (viewMode !== 'list' || sortMode !== 'brand') return [];
    const map: Record<string, Product[]> = {};
    sortedFiltered.forEach((p) => {
      const key = (p.brand || '기타').toUpperCase();
      if (!map[key]) map[key] = [];
      map[key].push(p);
    });
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b, 'ko'))
      .map(([brand, items]) => ({ brand, items }));
  })();

  // ── 총 수량 자동 계산 ────────────────────────────────────────────────────
  const totalAmount = form.packageCount * form.unitPerPackage;

  // ── 제품 저장 (신규 추가 or 기존 수정) ──────────────────────────────────
  async function handleSave() {
    if (!String(form.name || '').trim()) return;
    if (!db) { alert('.env.local에 Firebase 설정을 먼저 입력해주세요.'); return; }

    // 중복 이름 체크 (신규 등록 시, 전체 도메인 대상)
    if (!editingProduct) {
      const normInput = String(form.name || '').trim().normalize('NFC').toLowerCase()
        .replace(/\s+/g, ' ').replace(/[^\p{L}\p{N} ]/gu, '');
      const normProd = (n: string) =>
        String(n || '').trim().normalize('NFC').toLowerCase()
          .replace(/\s+/g, ' ').replace(/[^\p{L}\p{N} ]/gu, '');

      const dup = products.find(p => normProd(p.name) === normInput);
      if (dup) {
        // 중복 발견 → 저장 차단 + 상세 안내
        alert(
          `⚠️ 이미 등록된 제품입니다.\n\n` +
          `기존: "${dup.name}"` +
          (dup.category ? ` [${dup.category}]` : '') +
          ` / ${dup.domain}\n\n` +
          `제품명을 다르게 입력하거나, 기존 제품을 편집해주세요.`
        );
        return; // 저장 중단
      }
    }

    setSaving(true);
    try {
      const now = new Date().toISOString();
      // 뷰티-스킨케어 도메인 제품인지 확인
      const isSkincareSave = form.formDomain === 'beauty' && form.formSubType === 'skincare';
      const isCountModeSave = form.itemUnit === '개';
      
      const derivedDosePerUse = isSkincareSave
        ? form.dosePerUse
        : (isCountModeSave ? 1 : (form.dosePerUse || 1));
      const derivedUsesPerDay = isSkincareSave ? form.usesPerDay : 1;
      const derivedFreqValue  = isSkincareSave ? form.daysPerWeek : 7;
      const derivedFreqType   = isSkincareSave
        ? (form.daysPerWeek === 7 ? 'daily' : 'per_week')
        : 'daily';

      const commonFields = {
        name: String(form.name || '').trim(),
        brand: String(form.brand || '').trim() || null,
        category: form.category || null,
        packageCount: form.packageCount,
        unitPerPackage: form.unitPerPackage,
        itemUnit: form.itemUnit,
        totalAmount,
        dosePerUse: derivedDosePerUse,
        usesPerDay: derivedUsesPerDay,
        frequencyType: derivedFreqType,
        frequencyValue: derivedFreqValue,
        usageDurationMonths: form.usageDurationMonths > 0 ? form.usageDurationMonths : null,
        purchaseDate: form.purchaseDate || null,
        startDate: form.startDate || null,
        expiryDate: form.expiryDate || null,
        price: String(form.price || '').trim() || null,
        source: String(form.source || '').trim() || null,
        purchaseUrl: String(form.purchaseUrl || '').trim() || null,
        ...(form.imagePreview ? { imageUrl: form.imagePreview } : {}),
        // Fashion / Acc 전용 필드
        ...(String(form.material || '').trim() ? { material: String(form.material || '').trim() } : {}),
        ...(String(form.careGuide || '').trim() ? { careGuide: String(form.careGuide || '').trim() } : {}),
        ...(String(form.specialNote || '').trim() ? { specialNote: String(form.specialNote || '').trim() } : {}),
        ...(form.materialType ? { materialType: form.materialType } : {}),
        boxLocation: String(form.boxLocation || '').trim() || null,
        ...(form.storageImagePreview ? { storageImageUrl: form.storageImagePreview } : form.storageImageUrl ? { storageImageUrl: form.storageImageUrl } : {}),
        updatedAt: now,
      };

      let productId: string;

      // 현재 도메인에 서브타입이 있는지 확인
      const savedDomainCfg = boxConfig.domains.find(d => d.id === form.formDomain);
      const hasSubTypes = (savedDomainCfg?.subTypes?.length ?? 0) > 0;

      if (editingProduct) {
        productId = editingProduct.id;
        await updateDoc(doc(db, 'users', userId, 'products', productId), {
          ...commonFields,
          domain: form.formDomain,
          subCategory: hasSubTypes ? form.formSubType : null,
          currentRemaining: form.currentRemaining,
        });
      } else {
        const docRef = await addDoc(collection(db, 'users', userId, 'products'), {
          ...commonFields,
          domain: form.formDomain,
          subCategory: hasSubTypes ? form.formSubType : null,
          // '개' 모드: 폼에 입력한 남은 개수 사용, 미입력이면 총 개수(새 것)
          currentRemaining: (form.itemUnit === '개' && form.currentRemaining > 0)
            ? form.currentRemaining
            : totalAmount,
          createdAt: now,
        });
        productId = docRef.id;
      }

      // 이미지는 Base64로 commonFields.imageUrl에 포함됐으므로 별도 업로드 불필요

      setForm(INITIAL_FORM);
      setEditingProduct(null);
      setIsAddOpen(false);
    } catch (err) {
      console.error('제품 저장 실패:', err);
      alert('저장에 실패했습니다. Firebase 설정을 확인해주세요.');
    } finally {
      setSaving(false);
    }
  }

  // ── 제품 편집 열기 ────────────────────────────────────────────────────────
  function openEdit(p: Product) {
    // 구 catKey(영문) → 한국어로 변환 (대소문자 무관)
    const resolvedCategory = resolveCategory(p.category);

    // subType 결정: subCategory 있으면 그대로, 없으면 boxConfig에서 역추론
    let resolvedSubType: string = subType;
    if (p.subCategory) {
      resolvedSubType = p.subCategory;
    } else if (p.domain && resolvedCategory) {
      const domainCfg = boxConfig.domains.find(d => d.id === p.domain);
      if (domainCfg?.subTypes) {
        for (const st of domainCfg.subTypes) {
          if (st.cats.includes(resolvedCategory)) { resolvedSubType = st.id; break; }
        }
      }
    }
    setSubType(resolvedSubType);
    setForm({
      name: String(p.name ?? ''),
      brand: String(p.brand ?? ''),
      category: String(resolvedCategory ?? ''),
      formDomain: String(p.domain || boxConfig.domains[0]?.id || 'beauty'),
      formSubType: String(resolvedSubType ?? ''),
      packageCount: p.packageCount ?? 1,
      unitPerPackage: p.unitPerPackage ?? 1,
      usesPerDay: p.usesPerDay ?? 1,
      dosePerUse: p.dosePerUse ?? 1,
      daysPerWeek: p.frequencyValue ?? 7,
      purchaseDate: String(p.purchaseDate ?? ''),
      expiryDate: String(p.expiryDate ?? ''),
      startDate: String(p.startDate ?? ''),
      price: String(p.price ?? ''),
      source: String(p.source ?? ''),
      purchaseUrl: String(p.purchaseUrl ?? ''),
      currentRemaining: getVirtualRemaining(p).remaining,
      imageFile: null,
      imagePreview: '',
      imageUrl: String(p.imageUrl ?? (p as Product & { storageUrl?: string }).storageUrl ?? ''),
      itemUnit: String(p.itemUnit || 'ml'),
      usageDurationMonths: p.usageDurationMonths ?? 0,
      material: String((p as Product & { material?: string }).material ?? ''),
      careGuide: String((p as Product & { careGuide?: string }).careGuide ?? ''),
      specialNote: String((p as Product & { specialNote?: string }).specialNote ?? ''),
      materialType: String((p as Product & { materialType?: string }).materialType ?? ''),
      boxLocation: String(p.boxLocation ?? ''),
      storageImagePreview: '',
      storageImageUrl: String((p as Product & { storageImageUrl?: string }).storageImageUrl ?? ''),
    });
    setEditingProduct(p);
    setIsAddOpen(true);
  }

  // ── 제품 삭제 ─────────────────────────────────────────────────────────────
  async function handleDelete(productId: string) {
    if (!db || !confirm('이 제품을 삭제하시겠어요?')) return;
    try {
      await deleteDoc(doc(db, 'users', userId, 'products', productId));
    } catch (err) {
      console.error('삭제 실패:', err);
    }
  }

  // ── 탭 변경 시 카테고리 초기화 ──────────────────────────────────────────
  function handleTabChange(tab: string) {
    setActiveTab(tab);
    setActiveCategory('ALL');
    // 새 탭의 첫 번째 서브타입으로 초기화
    const domain = boxConfig.domains.find(d => d.id === tab);
    if (domain?.subTypes?.length) setSubType(domain.subTypes[0].id);
  }

  // ── 보관장소 관련 핸들러 ──────────────────────────────────────────────────
  async function handleAddStorageLoc() {
    const trimmed = newStorageLocName.trim();
    if (!trimmed) return;
    if (activeTab === 'all') return;
    
    const locKey = activeTab;
    const currentLocs = getStorageLocs(boxConfig, activeTab);
    if (currentLocs.includes(trimmed)) {
      alert('이미 등록된 보관장소 이름입니다.');
      return;
    }
    
    const updated = {
      ...boxConfig,
      domainStorageLocations: {
        ...boxConfig.domainStorageLocations,
        [locKey]: [...currentLocs, trimmed],
      },
    };
    await saveBoxConfig(updated);
    setNewStorageLocName('');
    setAddingStorageLoc(false);
  }

  function openAddForLocation(locName: string, domainId: string) {
    const locProducts = products.filter(p => p.boxLocation === locName);
    const existingPhoto = locProducts.find(p => p.storageImageUrl)?.storageImageUrl || '';
    
    setForm({
      ...INITIAL_FORM,
      formDomain: domainId,
      boxLocation: locName,
      storageImageUrl: existingPhoto,
    });
    setEditingProduct(null);
    setIsAddOpen(true);
  }

  function openLocEditor(locName: string, domain: string) {
    setEditTargetLocName(locName);
    setEditTargetLocDomain(domain);
    setEditLocNewNameVal(locName);
    
    const locProducts = products.filter(p => p.boxLocation === locName);
    const existingPhoto = locProducts.find(p => p.storageImageUrl)?.storageImageUrl || '';
    setEditLocNewPhotoVal(existingPhoto);
    
    setLocEditOpen(true);
  }

  function handleSubTypeChange(type: string) {
    setSubType(type);
    setActiveCategory('ALL');
  }

  return (
    <div style={{ background: '#FAFAF8', minHeight: '100%', position: 'relative' }}>
      {/* 비로그인 안내 */}
      {!authLoading && !user && (
        <div style={{ background: '#FEF3C7', color: '#92400E', padding: '8px 26px', fontSize: 13, borderBottom: '1px solid #FDE68A', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>Google 로그인 후 제품을 관리할 수 있습니다.</span>
        </div>
      )}

      {/* 페이지 헤더 — 공통 PageHeader 컴포넌트 */}
      <PageHeader
        label="Box"
        title="Box"
        subtitle="화장대와 옷장 아이템 정리"
        right={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* 제품 수 */}
            <span style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 12, fontWeight: 600, color: '#9A9490' }}>
              {products.length} assets
            </span>
          </div>
        }
      />

      {/* ── 제품 / 지출 분석 / 보관장소 상위 탭 ── */}
      <div style={{ display: 'flex', borderBottom: '1px solid rgba(12,12,10,.07)', background: 'rgba(255,255,255,.97)' }}>
        {(['products', 'spending', 'storage'] as const).map(v => (
          <button key={v} onClick={() => setBoxView(v)}
            style={{
              flex: 1, height: 42, border: 'none', background: 'none', cursor: 'pointer',
              fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif",
              fontSize: 12, fontWeight: 800, letterSpacing: '.02em',
              color: boxView === v ? '#0C0C0A' : '#9A9490',
              borderBottom: boxView === v ? '2px solid #C5FF00' : '2px solid transparent',
              transition: 'all .18s',
            }}
          >
            {v === 'products' ? '제품' : v === 'spending' ? '지출 분석' : '보관장소'}
          </button>
        ))}
      </div>

      {/* ── 지출 분석 뷰 ── */}
      {boxView === 'spending' && (() => {
        const f = "'Plus Jakarta Sans','Space Grotesk',sans-serif";

        const domainLabels: Record<string, string> = {
          beauty: 'Beauty',
          fashion: 'Fashion',
          health: '약·비타민',
          acc: 'ACC',
        };
        const domainColors: Record<string, string> = {
          beauty: '#C5FF00',  // Lime
          fashion: '#0C0C0A', // Black
          health: '#B45309',  // Amber
          acc: '#9A9490',     // Silver
        };

        // 가격 있는 전체 제품 분석 대상
        const priced = products
          .filter(p => parsePrice(p.price) !== null)
          .map(p => {
            const price = parsePrice(p.price)!;
            const isSkincare = p.domain === 'beauty' && p.subCategory === 'skincare';
            const dailyUsage = (p.dosePerUse ?? 0) * (p.usesPerDay ?? 0) * ((p.frequencyValue ?? 7) / 7);
            
            let cpd = 0;
            let totalDays = 0;

            if (p.totalAmount && dailyUsage > 0) {
              // 사용 패턴이 존재하면 정밀 계산
              cpd = (price / p.totalAmount) * dailyUsage;
              totalDays = Math.round(p.totalAmount / dailyUsage);
            } else if (isSkincare && p.totalAmount && p.dosePerUse) {
              // 스킨케어이면서 사용 패턴이 불규칙인 경우: 하루 1회 펌핑(사용)을 가상으로 가정하여 CPD 계산
              const virtualDailyUsage = p.dosePerUse;
              cpd = (price / p.totalAmount) * virtualDailyUsage;
              totalDays = Math.round(p.totalAmount / virtualDailyUsage);
            } else {
              // 사용 패턴 정보가 없는 경우 도메인별 사용 기간(일수) 가정 적용 (스킨케어 외 도메인)
              // - 뷰티 메이크업: 180일 (6개월)
              // - 약/비타민 (health): 60일 (2개월)
              // - 패션/ACC (fashion/acc): 365일 (1년)
              let defaultDays = 180;
              if (p.domain === 'health') {
                defaultDays = 60;
              } else if (p.domain === 'fashion' || p.domain === 'acc') {
                defaultDays = 365;
              }
              
              cpd = price / defaultDays;
              totalDays = defaultDays;
            }

            return { ...p, price, cpd, totalDays };
          })
          .sort((a, b) => b.cpd - a.cpd);

        // 가격 정보가 아예 없는 경우
        if (priced.length === 0) {
          return (
            <div style={{ padding: '60px 26px', textAlign: 'center' }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>💰</div>
              <div style={{ fontFamily: f, fontSize: 14, fontWeight: 700, color: '#0C0C0A', marginBottom: 6 }}>가격 정보가 없어요</div>
              <div style={{ fontFamily: f, fontSize: 12, color: '#9A9490' }}>제품 편집에서 가격을 입력하면 분석이 시작됩니다</div>
            </div>
          );
        }

        // 선택한 필터(spendingFilter)에 맞게 데이터 필터링
        const filteredPriced = spendingFilter === 'all'
          ? priced
          : priced.filter(p => p.domain === spendingFilter);

        // 선택 도메인의 통계
        const filteredPurchaseTotal = filteredPriced.reduce((sum, p) => sum + p.price, 0);
        const filteredMonthlyTotal = filteredPriced.reduce((sum, p) => sum + p.cpd * 30, 0);

        return (
          <div style={{ padding: '16px 26px calc(env(safe-area-inset-bottom,0px) + 100px)' }}>
            
            {/* 전체/도메인 요약 카드 */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
              {/* 월 추정 지출 */}
              <div style={{ flex: 1, background: '#0C0C0A', borderRadius: 14, padding: '14px 14px 12px' }}>
                <div style={{ fontFamily: f, fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,.5)', letterSpacing: '.06em', marginBottom: 4 }}>
                  {spendingFilter === 'all' ? '전체 월 추정 지출' : `${domainLabels[spendingFilter]} 월 추정 지출`}
                </div>
                <div style={{ fontFamily: f, fontSize: 20, fontWeight: 800, color: '#C5FF00', lineHeight: 1 }}>
                  {Math.round(filteredMonthlyTotal).toLocaleString()}원
                </div>
                <div style={{ fontFamily: f, fontSize: 10, color: 'rgba(255,255,255,.4)', marginTop: 4 }}>
                  {spendingFilter === 'all' ? 'CPD 합산 × 30일' : '해당 도메인 30일분'}
                </div>
              </div>
              {/* 총 구매가 */}
              <div style={{ flex: 1, background: '#F5F4F2', borderRadius: 14, padding: '14px 14px 12px', border: '1px solid rgba(12,12,10,.08)' }}>
                <div style={{ fontFamily: f, fontSize: 10, fontWeight: 700, color: '#9A9490', letterSpacing: '.06em', marginBottom: 4 }}>
                  {spendingFilter === 'all' ? '전체 총 구매 금액' : `${domainLabels[spendingFilter]} 총 구매 금액`}
                </div>
                <div style={{ fontFamily: f, fontSize: 20, fontWeight: 800, color: '#0C0C0A', lineHeight: 1 }}>
                  {Math.round(filteredPurchaseTotal).toLocaleString()}원
                </div>
                <div style={{ fontFamily: f, fontSize: 10, color: '#BCBAB6', marginTop: 4 }}>{filteredPriced.length}개 제품</div>
              </div>
            </div>

            {/* 도메인 필터 칩 */}
            <div style={{ display: 'flex', gap: 8, overflowX: 'auto', scrollbarWidth: 'none', marginBottom: 16, paddingBottom: 4 }} className="hide-scrollbar">
              <button
                onClick={() => setSpendingFilter('all')}
                style={{
                  padding: '6px 14px', borderRadius: 9999,
                  border: `1.5px solid ${spendingFilter === 'all' ? '#0C0C0A' : 'rgba(12,12,10,.14)'}`,
                  background: spendingFilter === 'all' ? '#0C0C0A' : 'transparent',
                  color: spendingFilter === 'all' ? '#C5FF00' : '#0C0C0A',
                  fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.02em',
                  cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all .15s',
                }}
              >
                전체
              </button>
              {boxConfig.domains.map(({ id, label }) => (
                <button
                  key={id}
                  onClick={() => setSpendingFilter(id)}
                  style={{
                    padding: '6px 14px', borderRadius: 9999,
                    border: `1.5px solid ${spendingFilter === id ? '#0C0C0A' : 'rgba(12,12,10,.14)'}`,
                    background: spendingFilter === id ? '#0C0C0A' : 'transparent',
                    color: spendingFilter === id ? '#C5FF00' : '#0C0C0A',
                    fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.02em',
                    cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all .15s',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* CPD 섹션 헤더 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontFamily: f, fontSize: 12, fontWeight: 800, color: '#0C0C0A', letterSpacing: '.04em' }}>
                {spendingFilter === 'all' ? '지출 순위 (하루 소비 비용)' : `${domainLabels[spendingFilter]} 지출 순위`}
              </span>
              <span style={{ fontFamily: f, fontSize: 10, color: '#9A9490' }}>높은 순</span>
            </div>

            {/* 제품별 CPD 카드 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {filteredPriced.map((p, idx) => {
                // 이 제품의 CPD가 총합에서 차지하는 비율 (바 너비용)
                const maxCpd = filteredPriced[0]?.cpd || 1;
                const barWidth = maxCpd > 0 ? (p.cpd / maxCpd) * 100 : 0;
                return (
                  <div key={p.id} style={{ background: '#fff', borderRadius: 12, padding: '12px 14px', border: '1px solid rgba(12,12,10,.07)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                      <div style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                          <span style={{ fontFamily: f, fontSize: 10, fontWeight: 800, color: '#BCBAB6' }}>#{idx + 1}</span>
                          <span style={{ fontFamily: f, fontSize: 13, fontWeight: 700, color: '#0C0C0A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                            {p.name}
                          </span>
                          {/* 도메인 배지 */}
                          {spendingFilter === 'all' && (
                            <span style={{ fontFamily: f, fontSize: 9, fontWeight: 700, color: domainColors[p.domain] === '#0C0C0A' ? '#9A9490' : domainColors[p.domain], background: domainColors[p.domain] === '#0C0C0A' ? '#EEEDE9' : 'rgba(0,0,0,.04)', padding: '1px 5px', borderRadius: 4 }}>
                              {domainLabels[p.domain]}
                            </span>
                          )}
                        </div>
                        {p.brand && (
                          <span style={{ fontFamily: f, fontSize: 11, color: '#9A9490' }}>{p.brand}</span>
                        )}
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontFamily: f, fontSize: 16, fontWeight: 800, color: '#0C0C0A' }}>
                          {p.cpd < 10 ? p.cpd.toFixed(1) : Math.round(p.cpd).toLocaleString()}원
                          <span style={{ fontSize: 10, fontWeight: 600, color: '#9A9490' }}>/일</span>
                        </div>
                        <div style={{ fontFamily: f, fontSize: 10, color: '#BCBAB6', marginTop: 1 }}>
                          {Math.round(p.price).toLocaleString()}원 · {p.domain === 'beauty' && p.subCategory === 'skincare' && calcCostPerUse({ ...p, price: String(p.price) } as Product) ? `1회 ${calcCostPerUse({ ...p, price: String(p.price) } as Product)}` : (p.totalDays > 0 ? `${p.totalDays}일분` : '-')}
                        </div>
                      </div>
                    </div>
                    {/* CPD 상대 바 */}
                    <div style={{ height: 4, background: 'rgba(12,12,10,.07)', borderRadius: 9999, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${barWidth}%`, background: idx === 0 ? '#C5FF00' : '#0C0C0A', opacity: idx === 0 ? 1 : 0.25 + (0.6 * (1 - idx / filteredPriced.length)), borderRadius: 9999 }} />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 미분석 제품 안내 */}
            {products.filter(p => !parsePrice(p.price)).length > 0 && (
              <div style={{ marginTop: 16, padding: '10px 14px', background: '#F5F4F2', borderRadius: 10, fontFamily: f, fontSize: 12, color: '#9A9490' }}>
                💡 가격 미입력 제품 {products.filter(p => !parsePrice(p.price)).length}개는 분석에서 제외됩니다.
              </div>
            )}
          </div>
        );
      })()}

      {/* 아래는 boxView === 'products' 또는 'storage' 일 때만 표시 */}
      {(boxView === 'products' || boxView === 'storage') && (
        <div
          style={{
            display: 'flex',
            borderBottom: '1px solid rgba(12,12,10,.07)',
            position: 'sticky', top: 0, zIndex: 8,
            background: 'rgba(255,255,255,.94)', backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
          }}
        >
          {boxConfig.domains.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => handleTabChange(id)}
              style={{
                flex: 1, textAlign: 'center', padding: '11px 6px 10px',
                fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
                fontSize: 11, fontWeight: 700, letterSpacing: '.02em',
                color: activeTab === id ? '#0C0C0A' : '#9A9490',
                background: 'none', border: 'none', cursor: 'pointer',
                borderBottom: activeTab === id ? '3px solid #C5FF00' : '3px solid transparent',
                transition: 'all .18s', whiteSpace: 'nowrap',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
              }}
            >
              <span>{activeTab === id ? `#${label}` : label}</span>
              <span style={{
                fontSize: 9, fontWeight: 800,
                color: activeTab === id ? '#4E7D00' : '#BCBAB6',
                letterSpacing: '.02em',
              }}>
                {products.filter(p => p.domain === id).length}
              </span>
            </button>
          ))}
          {/* ⊞ 전체 보기 버튼 */}
          <button
            onClick={() => handleTabChange('all')}
            title="전체 보기"
            style={{
              padding: '8px 14px 9px',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
              fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
              color: activeTab === 'all' ? '#0C0C0A' : '#9A9490',
              background: 'none', border: 'none', cursor: 'pointer',
              borderBottom: activeTab === 'all' ? '3px solid #C5FF00' : '3px solid transparent',
              transition: 'all .18s', lineHeight: 1,
            }}
          >
            <span style={{ fontSize: 15, fontWeight: 700, lineHeight: 1 }}>⊞</span>
            <span style={{ fontSize: 9, fontWeight: 800, color: activeTab === 'all' ? '#4E7D00' : '#BCBAB6', letterSpacing: '.02em' }}>
              {products.length}
            </span>
          </button>
        </div>
      )}

      {/* 아래는 boxView === 'products' 일 때만 표시 */}
      {boxView === 'products' && (
        <>

      {/* 검색 바 */}
      {/* design/box.html .box-search-bar */}
      <div
        style={{
          position: 'sticky', top: 55, zIndex: 7,
          background: 'rgba(255,255,255,.95)', backdropFilter: 'blur(14px)',
          WebkitBackdropFilter: 'blur(14px)',
          padding: '8px 26px', borderBottom: '1px solid rgba(12,12,10,.07)',
        }}
      >
        <div style={{ position: 'relative' }}>
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="제품명 · 브랜드 검색..."
            style={{
              width: '100%', padding: '9px 40px 9px 14px',
              border: '1.5px solid rgba(12,12,10,.07)', borderRadius: 9999,
              fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
              fontSize: 13, color: '#0C0C0A', background: '#F4F4F0', outline: 'none',
            }}
          />
          {/* 검색 아이콘 */}
          <svg
            style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: '#9A9490', pointerEvents: 'none' }}
            width="14" height="14" viewBox="0 0 24 24" fill="currentColor"
          >
            <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
          </svg>
        </div>
      </div>

      {/* 서브타입 탭 (서브타입 있는 도메인만 표시, 전체 보기 시 숨김) */}
      {activeTab !== 'all' && activeDomain?.subTypes?.length ? (
        <div
          style={{
            display: 'flex',
            borderBottom: '1px solid rgba(12,12,10,.07)',
            background: 'rgba(255,255,255,.94)', backdropFilter: 'blur(14px)',
            WebkitBackdropFilter: 'blur(14px)',
            position: 'sticky', top: 103, zIndex: 6,
          }}
        >
          {activeDomain.subTypes.map((st) => (
            <button
              key={st.id}
              onClick={() => handleSubTypeChange(st.id)}
              style={{
                padding: '9px 18px 8px',
                fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
                fontSize: 12, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase',
                color: subType === st.id ? '#0C0C0A' : '#9A9490',
                background: 'none', border: 'none', cursor: 'pointer',
                borderBottom: subType === st.id ? '2px solid #C5FF00' : '2px solid transparent',
                transition: 'all .18s',
              }}
            >
              {st.label}
            </button>
          ))}
        </div>
      ) : null}

      {/* 카테고리 칩 (전체 보기 시 숨김) */}
      {activeTab !== 'all' && cats.length > 0 && (
        <div
          style={{
            display: 'flex', gap: 6, padding: '10px 26px 8px',
            overflowX: 'auto', scrollbarWidth: 'none',
            borderBottom: '1px solid rgba(12,12,10,.07)',
          }}
        >
          {/* 'ALL' 칩 + 카테고리 칩 목록 */}
          {['ALL', ...allCats].map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              style={{
                flexShrink: 0, padding: '5px 12px', borderRadius: 9999,
                border: `1.5px solid ${activeCategory === cat ? (cat === '미분류' ? '#B45309' : '#0C0C0A') : (cat === '미분류' ? 'rgba(180,83,9,.3)' : 'rgba(12,12,10,.14)')}`,
                background: activeCategory === cat ? (cat === '미분류' ? '#B45309' : '#0C0C0A') : 'transparent',
                fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
                fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase',
                color: activeCategory === cat ? '#fff' : (cat === '미분류' ? '#B45309' : '#4A4846'),
                cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all .18s',
              }}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {/* ── 소진 임박 배너 (D-7 이하 beauty 제품) ── */}
      {(() => {
        // 시작일 있고, 소비량 계산 가능하고, 잔량 7일 이하인 제품만
        const urgent = products
          .filter(p => p.domain === 'beauty')
          .map(p => {
            if (!p.startDate) return null; // 시작일 없으면 미개봉 → 제외
            const dailyUsage = (p.dosePerUse ?? 0) * (p.usesPerDay ?? 0) * ((p.frequencyValue ?? 7) / 7);
            if (dailyUsage <= 0 || (p.currentRemaining ?? 0) <= 0) return null;
            const daysLeft = Math.floor((p.currentRemaining ?? 0) / dailyUsage);
            if (daysLeft > 7) return null;
            return { ...p, daysLeft };
          })
          .filter((x): x is Product & { daysLeft: number } => x !== null)
          .sort((a, b) => a.daysLeft - b.daysLeft);

        if (urgent.length === 0) return null;

        const f = "'Plus Jakarta Sans','Space Grotesk',sans-serif";
        return (
          <div style={{ padding: '10px 26px 2px' }}>
            {/* 헤더 */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 13 }}>⚠️</span>
                <span style={{ fontFamily: f, fontSize: 11, fontWeight: 800, color: '#B45309', letterSpacing: '.06em' }}>
                  소진 임박 — {urgent.length}개
                </span>
              </div>
              {/* 전체 불규칙 일괄 적용 */}
              <button
                onClick={async () => {
                  if (!db || !confirm(`소진 임박 ${urgent.length}개 제품을 모두 "불규칙"으로 변경할까요?`)) return;
                  await Promise.all(
                    urgent.map(p => updateDoc(doc(db!, 'users', userId, 'products', p.id), {
                      frequencyValue: 0,
                      frequencyType: 'as_needed',
                      dosePerUse: p.dosePerUse ?? 1,
                      usesPerDay: p.usesPerDay ?? 1,
                      updatedAt: new Date().toISOString(),
                    }))
                  );
                }}
                style={{ fontFamily: f, fontSize: 11, fontWeight: 700, color: '#B45309', background: 'rgba(180,83,9,.08)', border: '1px solid rgba(180,83,9,.2)', borderRadius: 9999, padding: '4px 10px', cursor: 'pointer' }}
              >
                전체 불규칙 적용
              </button>
            </div>

            {/* 가로 스크롤 카드 */}
            <div style={{ display: 'flex', gap: 8, overflowX: 'auto', scrollbarWidth: 'none', paddingBottom: 6 }}>
              {urgent.map(p => {
                const isRed = p.daysLeft <= 3;
                const color = isRed ? '#E94F6B' : '#F97316';
                const bg = isRed ? 'rgba(233,79,107,.07)' : 'rgba(249,115,22,.07)';
                return (
                  <button
                    key={p.id}
                    onClick={() => openEdit(p)}
                    style={{
                      flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                      padding: '8px 12px', borderRadius: 10, border: `1.5px solid ${color}20`,
                      background: bg, cursor: 'pointer', textAlign: 'left', minWidth: 100, maxWidth: 140,
                    }}
                  >
                    <span style={{ fontFamily: f, fontSize: 18, fontWeight: 800, color, lineHeight: 1, marginBottom: 3 }}>
                      D-{p.daysLeft}
                    </span>
                    <span style={{ fontFamily: f, fontSize: 11, fontWeight: 700, color: '#0C0C0A', lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const, overflow: 'hidden' }}>
                      {p.name}
                    </span>
                    {p.brand && (
                      <span style={{ fontFamily: f, fontSize: 10, color: '#9A9490', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, maxWidth: '100%' }}>
                        {p.brand}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <div style={{ height: 1, background: 'rgba(12,12,10,.07)', margin: '8px 0 0' }} />
          </div>
        );
      })()}

      {/* 뷰/정렬 바 — design/box.html .view-sort-bar */}
      {!loading && products.length > 0 && (
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '8px 26px 6px',
            borderBottom: '1px solid rgba(12,12,10,.07)',
            background: 'rgba(255,255,255,.95)',
          }}
        >
          {/* 뷰 전환 버튼 — 매거진 / 갤러리 / 리스트 */}
          <div style={{ display: 'flex', gap: 4 }}>
            {/* 매거진 아이콘 (2분할 레이아웃) */}
            <button
              onClick={() => setViewMode('magazine')}
              title="매거진"
              style={{
                width: 30, height: 30, border: `1.5px solid ${viewMode === 'magazine' ? '#0C0C0A' : 'rgba(12,12,10,.14)'}`,
                borderRadius: 6, background: viewMode === 'magazine' ? '#0C0C0A' : 'transparent',
                cursor: 'pointer', color: viewMode === 'magazine' ? '#fff' : '#9A9490',
                display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, transition: 'all .15s',
              }}
              aria-label="매거진 뷰"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                <path d="M3 3h8v5H3zm10 0h8v5h-8zM3 10h8v11H3zm10 0h8v11h-8z" />
              </svg>
            </button>
            {/* 갤러리 (3열 그리드) 아이콘 */}
            <button
              onClick={() => setViewMode('gallery')}
              title="갤러리"
              style={{
                width: 30, height: 30, border: `1.5px solid ${viewMode === 'gallery' ? '#0C0C0A' : 'rgba(12,12,10,.14)'}`,
                borderRadius: 6, background: viewMode === 'gallery' ? '#0C0C0A' : 'transparent',
                cursor: 'pointer', color: viewMode === 'gallery' ? '#fff' : '#9A9490',
                display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, transition: 'all .15s',
              }}
              aria-label="갤러리 뷰"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                <path d="M3 3h5v5H3zm8 0h5v5h-5zm8 0h2v5h-2zm-16 7h5v5H3zm8 0h5v5h-5zm8 0h2v5h-2zm-16 7h5v4H3zm8 0h5v4h-5zm8 0h2v4h-2z" />
              </svg>
            </button>
            {/* 리스트 아이콘 */}
            <button
              onClick={() => setViewMode('list')}
              title="리스트"
              style={{
                width: 30, height: 30, border: `1.5px solid ${viewMode === 'list' ? '#0C0C0A' : 'rgba(12,12,10,.14)'}`,
                borderRadius: 6, background: viewMode === 'list' ? '#0C0C0A' : 'transparent',
                cursor: 'pointer', color: viewMode === 'list' ? '#fff' : '#9A9490',
                display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, transition: 'all .15s',
              }}
              aria-label="리스트 뷰"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                <path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z" />
              </svg>
            </button>
          </div>

          {/* 정렬 셀렉트 */}
          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as typeof sortMode)}
            style={{
              fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
              fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase',
              color: '#4A4846', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 6,
              background: '#fff', padding: '5px 10px', cursor: 'pointer', outline: 'none',
              WebkitAppearance: 'none', appearance: 'none',
            }}
          >
            <option value="added">최신 추가순</option>
            <option value="name">제품명</option>
            <option value="uses">사용 빈도순</option>
            <option value="brand">브랜드순</option>
          </select>
        </div>
      )}

      {/* 제품 목록 영역 */}
      {loading ? (
        // shimmer 스켈레톤
        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[['100%', 44], ['80%', 20], ['60%', 20], ['100%', 120], ['100%', 120]].map(([w, h], i) => (
            <div key={i} className="shimmer" style={{ width: w as string, height: h as number }} />
          ))}
        </div>
      ) : sortedFiltered.length === 0 ? (
        // 빈 상태 — 제품이 없을 때
        <EmptyState onAdd={() => { setForm((f) => ({ ...f, formDomain: activeTab, formSubType: subType })); setIsAddOpen(true); }} />
      ) : viewMode === 'magazine' ? (
        // 매거진 뷰 — 히어로(최신) + 3열 소형 카드
        <MagazineView products={sortedFiltered} onEdit={openEdit} />
      ) : viewMode === 'gallery' ? (
        // 갤러리 그리드 (3열) — design/box.html .gallery-grid
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 1.5, paddingBottom: 100 }}>
          {sortedFiltered.map((p) => (
            <ProductCard key={p.id} product={p} onClick={() => openEdit(p)} />
          ))}
        </div>
      ) : sortMode === 'brand' ? (
        // 리스트 뷰 + 브랜드순 — 브랜드별 그룹 헤더 포함
        <div style={{ paddingBottom: 100 }}>
          {brandGroups.map(({ brand, items }) => (
            <div key={brand}>
              {/* 브랜드 그룹 헤더 — design/box.html .list-group-hd */}
              <div
                style={{
                  padding: '8px 26px 6px',
                  fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
                  fontSize: 11, fontWeight: 700, letterSpacing: '.16em', textTransform: 'uppercase',
                  color: '#9A9490', background: '#FAFAF8',
                  borderBottom: '1px solid rgba(12,12,10,.07)',
                  borderTop: '1px solid rgba(12,12,10,.04)',
                }}
              >
                {brand} · {items.length}개
              </div>
              {items.map((p) => <ListRow key={p.id} product={p} onClick={() => openEdit(p)} />)}
            </div>
          ))}
        </div>
      ) : (
        // 리스트 뷰 — 단순 목록
        <div style={{ paddingBottom: 100 }}>
          {sortedFiltered.map((p) => <ListRow key={p.id} product={p} onClick={() => openEdit(p)} />)}
        </div>
      )}

      {/* FAB — 우측 하단 고정 + 버튼 */}
      {/* design/box.html .fab: position absolute bottom 88px right 18px */}
      {!isAddOpen && (
        <button
          onClick={() => { setForm((f) => ({ ...f, formDomain: activeTab, formSubType: subType })); setIsAddOpen(true); }}
          style={{
            position: 'fixed', bottom: 88, right: 'max(18px, calc(50vw - 215px + 18px))', zIndex: 40,
            width: 52, height: 52, borderRadius: 9999,
            background: '#C5FF00', color: '#0C0C0A',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 22, fontWeight: 700, cursor: 'pointer', border: 'none',
            boxShadow: '0 4px 20px rgba(197,255,0,.4)',
            transition: 'transform .18s',
          }}
          aria-label="제품 추가"
        >
          ＋
        </button>
      )}

      {/* 이전 데이터 가져오기 버튼 (로그인 상태이고 products가 비었을 때) */}
      {user && !loading && products.length === 0 && !isAddOpen && (
        <div style={{ padding: '0 26px 16px', textAlign: 'center' }}>
          <button
            onClick={handleManualMigrate}
            disabled={migrating}
            style={{
              padding: '8px 18px', borderRadius: 9999, border: '1.5px dashed rgba(12,12,10,.2)',
              background: 'transparent', cursor: migrating ? 'default' : 'pointer',
              fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif",
              fontSize: 12, fontWeight: 600, color: '#9A9490',
            }}
          >
            {migrating ? '가져오는 중...' : '이전 박스 데이터 가져오기'}
          </button>
        </div>
      )}

      {/* 하단 — 카테고리 편집 (항상 표시) */}
      {!isAddOpen && (
        <div style={{ padding: '20px 26px 120px', display: 'flex', justifyContent: 'center' }}>
          <button
            onClick={() => setManageOpen(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '10px 20px', borderRadius: 12,
              border: '1.5px solid rgba(12,12,10,.14)',
              background: '#F0EFEA',
              fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif",
              fontSize: 12, fontWeight: 700, letterSpacing: '.04em',
              color: '#4A4846', cursor: 'pointer',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7.01 7.01 0 0 0-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84a.484.484 0 0 0-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.48.48 0 0 0-.59.22L2.74 8.87a.47.47 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.37 1.04.7 1.62.94l.36 2.54c.05.24.27.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.57 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.47.47 0 0 0-.12-.61l-2.01-1.58zM12 15.6a3.6 3.6 0 1 1 0-7.2 3.6 3.6 0 0 1 0 7.2z"/>
            </svg>
            도메인 · 카테고리 편집
          </button>
        </div>
      )}
    </>
  )}

      {/* ── 보관장소 뷰 ── */}
      {boxView === 'storage' && (() => {
        const f = "'Plus Jakarta Sans','Space Grotesk',sans-serif";
        const targetDomains = activeTab === 'all'
          ? boxConfig.domains.map(d => d.id)
          : [activeTab];

        const configLocs = targetDomains.flatMap(dId => getStorageLocs(boxConfig, dId));
        const productLocs = products
          .filter(p => targetDomains.includes(p.domain) && p.boxLocation)
          .map(p => p.boxLocation!);
        const uniqueLocs = Array.from(new Set([...configLocs, ...productLocs]));

        const storageList = uniqueLocs.map(locName => {
          const locProducts = products.filter(p => p.boxLocation === locName && targetDomains.includes(p.domain));
          const coverProduct = locProducts.find(p => p.storageImageUrl);
          const domainId = (locProducts[0]?.domain || (boxConfig.domains.find(d => getStorageLocs(boxConfig, d.id).includes(locName))?.id) || targetDomains[0] || 'beauty') as ProductDomain;
          return {
            name: locName,
            products: locProducts,
            coverUrl: coverProduct?.storageImageUrl || null,
            domain: domainId,
          };
        });

        const unassignedProducts = products.filter(p => !p.boxLocation && targetDomains.includes(p.domain));
        if (unassignedProducts.length > 0) {
          storageList.push({
            name: '위치 미지정',
            products: unassignedProducts,
            coverUrl: null,
            domain: (targetDomains[0] || 'beauty') as ProductDomain,
          });
        }

        const domainLabels: Record<string, string> = {
          beauty: 'Beauty',
          fashion: 'Fashion',
          health: '약·비타민',
          acc: 'ACC',
        };
        const domainColors: Record<string, string> = {
          beauty: '#C5FF00',
          fashion: '#0C0C0A',
          health: '#B45309',
          acc: '#9A9490',
        };

        return (
          <div style={{ padding: '16px 26px calc(env(safe-area-inset-bottom,0px) + 100px)' }}>
            {/* 보관장소 추가 바 (전체 보기 아닐 때만 표시) */}
            {activeTab !== 'all' && (
              <div style={{ marginBottom: 20, background: '#fff', borderRadius: 14, padding: 16, border: '1px solid rgba(12,12,10,.07)' }}>
                {!addingStorageLoc ? (
                  <button
                    onClick={() => setAddingStorageLoc(true)}
                    style={{
                      width: '100%', padding: '10px 0', border: '1.5px dashed rgba(12,12,10,.14)',
                      borderRadius: 10, background: 'transparent', cursor: 'pointer',
                      fontFamily: f, fontSize: 12, fontWeight: 700, color: '#9A9490',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    }}
                  >
                    <span>+ 새 보관장소 추가</span>
                  </button>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ fontFamily: f, fontSize: 12, fontWeight: 800, color: '#0C0C0A' }}>새 보관장소 이름</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        autoFocus
                        value={newStorageLocName}
                        onChange={e => setNewStorageLocName(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') handleAddStorageLoc();
                          if (e.key === 'Escape') { setAddingStorageLoc(false); setNewStorageLocName(''); }
                        }}
                        placeholder="예: 안방 화장대, 드레스룸 A"
                        style={{
                          flex: 1, padding: '0 14px', height: 38,
                          border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 8,
                          fontFamily: f, fontSize: 13, outline: 'none',
                        }}
                      />
                      <button
                        onClick={handleAddStorageLoc}
                        style={{
                          height: 38, padding: '0 16px', background: '#0C0C0A', color: '#fff',
                          border: 'none', borderRadius: 8, fontFamily: f, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                        }}
                      >
                        추가
                      </button>
                      <button
                        onClick={() => { setAddingStorageLoc(false); setNewStorageLocName(''); }}
                        style={{
                          height: 38, padding: '0 12px', background: 'transparent',
                          border: '1px solid rgba(12,12,10,.14)', borderRadius: 8,
                          fontFamily: f, fontSize: 12, color: '#9A9490', cursor: 'pointer',
                        }}
                      >
                        취소
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {storageList.length === 0 ? (
              <div style={{ padding: '60px 16px', textAlign: 'center' }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>📍</div>
                <div style={{ fontFamily: f, fontSize: 14, fontWeight: 700, color: '#0C0C0A', marginBottom: 6 }}>보관장소가 없습니다</div>
                <div style={{ fontFamily: f, fontSize: 12, color: '#9A9490' }}>새 보관장소를 추가하거나 제품 편집에서 위치를 등록해보세요</div>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 20 }}>
                {storageList.map((item) => {
                  const isUnassigned = item.name === '위치 - 미지정' || item.name === '위치 미지정';
                  return (
                    <div
                      key={item.name}
                      style={{
                        background: '#fff', borderRadius: 20, padding: 16,
                        border: '1px solid rgba(12,12,10,.07)',
                        boxShadow: '0 4px 18px rgba(0,0,0,.02)',
                        display: 'flex', flexDirection: 'column', gap: 12,
                      }}
                    >
                      {/* 헤더 */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                          <span style={{ fontFamily: f, fontSize: 15, fontWeight: 700, color: '#0C0C0A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {item.name}
                          </span>
                          {activeTab === 'all' && !isUnassigned && (
                            <span style={{ fontFamily: f, fontSize: 9, fontWeight: 800, color: domainColors[item.domain] === '#0C0C0A' ? '#9A9490' : domainColors[item.domain], letterSpacing: '.06em', textTransform: 'uppercase' }}>
                              {domainLabels[item.domain]}
                            </span>
                          )}
                        </div>
                        <span style={{ fontFamily: f, fontSize: 11, fontWeight: 800, color: '#0C0C0A', background: '#EEEDE9', padding: '3px 8px', borderRadius: 9999 }}>
                          {item.products.length}개
                        </span>
                      </div>

                      {/* 이미지 영역 */}
                      <div style={{ width: '100%', height: 140, background: '#F4F4F0', borderRadius: 12, overflow: 'hidden', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {item.coverUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={item.coverUrl} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                            <span style={{ fontSize: 24, opacity: 0.35 }}>📍</span>
                            {!isUnassigned && (
                              <span style={{ fontFamily: f, fontSize: 9, fontWeight: 700, color: '#9A9490', letterSpacing: '.06em' }}>
                                사진 미등록
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* 가로 상품 리스트 */}
                      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, scrollbarWidth: 'none' }} className="hide-scrollbar">
                        {item.products.map(p => {
                          const pImg = p.imageUrl ?? (p as any).storageUrl;
                          return (
                            <button
                              key={p.id}
                              onClick={() => openEdit(p)}
                              style={{
                                width: 44, height: 44, borderRadius: 8, flexShrink: 0,
                                background: '#EEEDE9', overflow: 'hidden', position: 'relative',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                border: '1px solid rgba(12,12,10,.07)', cursor: 'pointer', padding: 0,
                              }}
                              title={p.name}
                            >
                              {pImg ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={pImg} alt={p.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                              ) : (
                                <span style={{ fontSize: 12, opacity: 0.3 }}>✦</span>
                              )}
                            </button>
                          );
                        })}
                      </div>

                      {/* 푸터 액션 */}
                      {!isUnassigned && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 4, borderTop: '1px solid rgba(12,12,10,.05)', paddingTop: 10 }}>
                          <button
                            onClick={() => openLocEditor(item.name, item.domain)}
                            style={{
                              flex: 1, padding: '7px 0', border: '1px solid rgba(12,12,10,.08)',
                              borderRadius: 8, background: 'transparent', cursor: 'pointer',
                              fontFamily: f, fontSize: 11, fontWeight: 700, color: '#4A4846',
                              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                            }}
                          >
                            <span>📍 관리</span>
                          </button>
                          <button
                            onClick={() => openAddForLocation(item.name, item.domain)}
                            style={{
                              flex: 1, padding: '7px 0', border: 'none',
                              borderRadius: 8, background: '#0C0C0A', cursor: 'pointer',
                              fontFamily: f, fontSize: 11, fontWeight: 700, color: '#fff',
                              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                            }}
                          >
                            <span>+ 제품 추가</span>
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

      {/* Bottom Toast — 마이그레이션 결과 알림 */}
      {migrationToast && (
        <div
          style={{
            position: 'fixed',
            bottom: 80,
            left: 'max(16px,calc(50vw - 199px))',
            right: 'max(16px,calc(50vw - 199px))',
            zIndex: 200,
            background: migrationToast.ok ? '#0C0C0A' : '#991B1B',
            color: '#fff',
            borderRadius: 12,
            padding: '12px 26px',
            fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif",
            fontSize: 13, fontWeight: 600,
            boxShadow: '0 4px 24px rgba(0,0,0,.18)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
          }}
        >
          <span>{migrationToast.msg}</span>
          <button
            onClick={() => setMigrationToast(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,.7)', fontSize: 16, padding: 0, flexShrink: 0 }}
          >
            ✕
          </button>
        </div>
      )}

      {/* 제품 추가/편집 전체 화면 오버레이 */}
      <AddProductPage
        isOpen={isAddOpen}
        onClose={() => { setIsAddOpen(false); setEditingProduct(null); setForm(INITIAL_FORM); }}
        form={form}
        setForm={setForm}
        totalAmount={totalAmount}
        onSave={handleSave}
        saving={saving}
        editingProduct={editingProduct}
        boxConfig={boxConfig}
        onSaveBoxConfig={saveBoxConfig}
        onDelete={editingProduct ? () => { handleDelete(editingProduct.id); setIsAddOpen(false); setEditingProduct(null); } : undefined}
        onOpenCatEditor={() => setManageOpen(true)}
      />

      {/* BOX 관리 시트 */}
      <ManageSheet
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        config={boxConfig}
        onConfigChange={saveBoxConfig}
      />

      {/* 보관장소 편집 시트 */}
      <LocationEditSheet
        open={locEditOpen}
        onClose={() => setLocEditOpen(false)}
        config={boxConfig}
        onConfigChange={saveBoxConfig}
        locName={editTargetLocName}
        domain={editTargetLocDomain}
        products={products}
        userId={userId}
      />
    </div>
  );
}

// ─── BOX 관리 시트 ────────────────────────────────────────────────────────────
function ManageSheet({
  open, onClose, config, onConfigChange,
}: {
  open: boolean;
  onClose: () => void;
  config: BoxConfig;
  onConfigChange: (c: BoxConfig) => void;
}) {
  const f = "'Plus Jakarta Sans','Space Grotesk',sans-serif";
  type View = 'domains' | 'cats';
  const [view, setView] = useState<View>('domains');
  const [editDomainId, setEditDomainId] = useState<string | null>(null);
  const [editSubTypeId, setEditSubTypeId] = useState<string | null>(null);
  const [renamingDomainId, setRenamingDomainId] = useState<string | null>(null);
  const [renamingSubTypeId, setRenamingSubTypeId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState('');
  const [newDomainLabel, setNewDomainLabel] = useState('');
  const [newCatLabel, setNewCatLabel] = useState('');
  const [newSubTypeLabel, setNewSubTypeLabel] = useState('');

  // 드래그 상태 (도메인 순서)
  const [dragDomIdx, setDragDomIdx] = useState<number | null>(null);
  const [dragDomOver, setDragDomOver] = useState<number | null>(null);
  // 드래그 상태 (카테고리 순서)
  const [dragCatIdx, setDragCatIdx] = useState<number | null>(null);
  const [dragCatOver, setDragCatOver] = useState<number | null>(null);
  // 드래그 상태 (서브타입 순서)
  const [dragStIdx, setDragStIdx] = useState<number | null>(null);
  const [dragStOver, setDragStOver] = useState<number | null>(null);

  // 현재 편집 중인 도메인
  const editingDomain = config.domains.find(d => d.id === editDomainId) ?? null;
  // 편집 도메인 내 현재 서브타입
  const editingSubType = editingDomain?.subTypes?.find(st => st.id === editSubTypeId) ?? editingDomain?.subTypes?.[0] ?? null;
  const activeSt = editSubTypeId ?? editingSubType?.id ?? null;

  function updateConfig(domains: DomainConfig[]) {
    onConfigChange({ ...config, domains });
  }

  // ── 도메인 CRUD ──────────────────────────────────────────────────────────
  function addDomain() {
    const label = newDomainLabel.trim();
    if (!label) return;
    const id = `d_${Date.now()}`;
    updateConfig([...config.domains, { id, label, cats: [] }]);
    setNewDomainLabel('');
  }
  function deleteDomain(id: string) {
    if (!confirm(`'${config.domains.find(d => d.id === id)?.label}' 도메인을 삭제할까요?`)) return;
    updateConfig(config.domains.filter(d => d.id !== id));
  }
  function renameDomain(id: string, label: string) {
    updateConfig(config.domains.map(d => d.id === id ? { ...d, label } : d));
    setRenamingDomainId(null);
  }
  function moveDomain(from: number, to: number) {
    const arr = [...config.domains];
    const [moved] = arr.splice(from, 1);
    arr.splice(to, 0, moved);
    updateConfig(arr);
  }

  // ── 서브타입 CRUD ────────────────────────────────────────────────────────
  function addSubType() {
    const label = newSubTypeLabel.trim();
    if (!label || !editDomainId) return;
    const id = `st_${Date.now()}`;
    updateConfig(config.domains.map(d => d.id !== editDomainId ? d : {
      ...d, subTypes: [...(d.subTypes ?? []), { id, label, cats: [] }],
    }));
    setNewSubTypeLabel('');
    setEditSubTypeId(id);
  }
  function deleteSubType(stId: string) {
    if (!editDomainId) return;
    if (!confirm('이 서브타입을 삭제할까요?')) return;
    updateConfig(config.domains.map(d => d.id !== editDomainId ? d : {
      ...d, subTypes: (d.subTypes ?? []).filter(st => st.id !== stId),
    }));
    if (activeSt === stId) setEditSubTypeId(null);
  }
  function renameSubType(stId: string, label: string) {
    if (!editDomainId) return;
    updateConfig(config.domains.map(d => d.id !== editDomainId ? d : {
      ...d, subTypes: (d.subTypes ?? []).map(st => st.id === stId ? { ...st, label } : st),
    }));
    setRenamingSubTypeId(null);
  }
  function moveSubType(from: number, to: number) {
    if (!editDomainId || !editingDomain?.subTypes) return;
    const arr = [...editingDomain.subTypes];
    const [moved] = arr.splice(from, 1);
    arr.splice(to, 0, moved);
    updateConfig(config.domains.map(d => d.id !== editDomainId ? d : { ...d, subTypes: arr }));
  }

  // ── 카테고리 CRUD ────────────────────────────────────────────────────────
  function currentCats(): string[] {
    if (!editingDomain) return [];
    if (editingDomain.subTypes?.length) {
      return editingDomain.subTypes.find(st => st.id === activeSt)?.cats ?? [];
    }
    return editingDomain.cats ?? [];
  }
  function setCats(cats: string[]) {
    if (!editDomainId || !editingDomain) return;
    if (editingDomain.subTypes?.length && activeSt) {
      updateConfig(config.domains.map(d => d.id !== editDomainId ? d : {
        ...d, subTypes: (d.subTypes ?? []).map(st => st.id === activeSt ? { ...st, cats } : st),
      }));
    } else {
      updateConfig(config.domains.map(d => d.id !== editDomainId ? d : { ...d, cats }));
    }
  }
  function addCat() {
    const label = newCatLabel.trim();
    if (!label) return;
    setCats([...currentCats(), label]);
    setNewCatLabel('');
  }
  function deleteCat(idx: number) {
    setCats(currentCats().filter((_, i) => i !== idx));
  }
  function moveCat(from: number, to: number) {
    const arr = [...currentCats()];
    const [moved] = arr.splice(from, 1);
    arr.splice(to, 0, moved);
    setCats(arr);
  }

  if (!open) return null;

  const chipBtn = (selected: boolean) => ({
    padding: '6px 14px', borderRadius: 9999,
    border: `1.5px solid ${selected ? '#0C0C0A' : 'rgba(12,12,10,.18)'}`,
    background: selected ? '#0C0C0A' : 'transparent',
    fontFamily: f, fontSize: 12, fontWeight: 700,
    color: selected ? '#fff' : '#9A9490',
    cursor: 'pointer', transition: 'all .15s',
  } as React.CSSProperties);

  return (
    <>
      {/* 백드롭 */}
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 200 }} />

      {/* 시트 */}
      <div style={{ position: 'fixed', bottom: 0, left: 'max(0px,calc(50vw - 215px))', right: 'max(0px,calc(50vw - 215px))', zIndex: 201, background: '#FAFAF8', borderRadius: '20px 20px 0 0', maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 -4px 40px rgba(0,0,0,.12)' }}>

        {/* 핸들 + 헤더 */}
        <div style={{ padding: '12px 26px 0', flexShrink: 0 }}>
          <div style={{ width: 32, height: 3, background: 'rgba(12,12,10,.14)', borderRadius: 2, margin: '0 auto 14px' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            {view === 'cats' && (
              <button onClick={() => { setView('domains'); setEditDomainId(null); setEditSubTypeId(null); }} style={{ width: 28, height: 28, borderRadius: 8, background: '#F0EFEA', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4A4846', flexShrink: 0 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 18l-6-6 6-6"/></svg>
              </button>
            )}
            <div style={{ fontFamily: f, fontSize: 17, fontWeight: 800, color: '#0C0C0A' }}>
              {view === 'domains' ? 'BOX 관리' : `${editingDomain?.label ?? ''} 카테고리`}
            </div>
            <button onClick={onClose} style={{ marginLeft: 'auto', width: 28, height: 28, borderRadius: 8, background: '#F0EFEA', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4A4846', flexShrink: 0 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
        </div>

        {/* 스크롤 영역 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 26px calc(env(safe-area-inset-bottom, 0px) + 40px)' }}>

          {/* ── VIEW: 도메인 목록 ── */}
          {view === 'domains' && (
            <div>
              <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, color: '#9A9490', letterSpacing: '.08em', marginBottom: 10 }}>도메인 순서 · 이름 · 카테고리 편집</div>

              {config.domains.map((d, idx) => (
                <div
                  key={d.id}
                  draggable
                  onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; setDragDomIdx(idx); }}
                  onDragOver={(e) => { e.preventDefault(); setDragDomOver(idx); }}
                  onDrop={(e) => { e.preventDefault(); if (dragDomIdx != null) moveDomain(dragDomIdx, idx); setDragDomIdx(null); setDragDomOver(null); }}
                  onDragEnd={() => { setDragDomIdx(null); setDragDomOver(null); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 0', borderBottom: '1px solid rgba(12,12,10,.07)', opacity: dragDomIdx === idx ? 0.4 : 1, outline: dragDomOver === idx ? '2px dashed #C5FF00' : 'none', outlineOffset: 2, borderRadius: 4 }}
                >
                  {/* 드래그 핸들 */}
                  <span style={{ cursor: 'grab', color: '#C4C2BE', fontSize: 20, userSelect: 'none', paddingRight: 20 }}>⠿</span>

                  {/* 이름 편집 */}
                  {renamingDomainId === d.id ? (
                    <input
                      autoFocus
                      value={renameVal}
                      onChange={(e) => setRenameVal(e.target.value)}
                      onBlur={() => { if (renameVal.trim()) renameDomain(d.id, renameVal.trim()); else setRenamingDomainId(null); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') { if (renameVal.trim()) renameDomain(d.id, renameVal.trim()); } else if (e.key === 'Escape') setRenamingDomainId(null); }}
                      style={{ flex: 1, fontFamily: f, fontSize: 15, fontWeight: 700, color: '#0C0C0A', border: 'none', borderBottom: '2px solid #C5FF00', outline: 'none', background: 'transparent', padding: '2px 0' }}
                    />
                  ) : (
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontFamily: f, fontSize: 15, fontWeight: 700, color: '#0C0C0A' }}>{d.label}</span>
                      <button
                        onClick={() => { setRenamingDomainId(d.id); setRenameVal(d.label); }}
                        title="이름 수정"
                        style={{ width: 22, height: 22, borderRadius: 6, border: '1px solid rgba(12,12,10,.14)', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9A9490', flexShrink: 0 }}
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                      </button>
                    </div>
                  )}

                  {/* 카테고리 편집 */}
                  <button
                    onClick={() => { setEditDomainId(d.id); setEditSubTypeId(d.subTypes?.[0]?.id ?? null); setView('cats'); setNewCatLabel(''); setNewSubTypeLabel(''); }}
                    style={{ padding: '5px 10px', borderRadius: 8, border: '1.5px solid rgba(12,12,10,.14)', background: 'transparent', fontFamily: f, fontSize: 11, fontWeight: 700, color: '#4A4846', cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >
                    카테고리 &gt;
                  </button>

                  {/* 삭제 */}
                  <button onClick={() => deleteDomain(d.id)} style={{ width: 24, height: 24, borderRadius: 6, border: 'none', background: 'rgba(186,26,26,.08)', color: '#BA1A1A', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>×</button>
                </div>
              ))}

              {/* 새 도메인 추가 */}
              <div style={{ display: 'flex', gap: 8, marginTop: 16, alignItems: 'center' }}>
                <input
                  value={newDomainLabel}
                  onChange={(e) => setNewDomainLabel(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') addDomain(); }}
                  placeholder="새 도메인 이름..."
                  style={{ flex: 1, border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 10, padding: '9px 12px', fontFamily: f, fontSize: 13, color: '#0C0C0A', background: '#fff', outline: 'none' }}
                />
                <button onClick={addDomain} style={{ padding: '9px 26px', borderRadius: 10, border: 'none', background: '#0C0C0A', color: '#C5FF00', fontFamily: f, fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>+ 추가</button>
              </div>
            </div>
          )}

          {/* ── VIEW: 카테고리 편집 ── */}
          {view === 'cats' && editingDomain && (
            <div>
              {/* 서브타입 탭 (있을 때만) */}
              {editingDomain.subTypes?.length ? (
                <div>
                  <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, color: '#9A9490', letterSpacing: '.08em', marginBottom: 8 }}>서브타입</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
                    {editingDomain.subTypes.map((st, idx) => (
                      <div
                        key={st.id}
                        draggable
                        onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; setDragStIdx(idx); }}
                        onDragOver={(e) => { e.preventDefault(); setDragStOver(idx); }}
                        onDrop={(e) => { e.preventDefault(); if (dragStIdx != null) moveSubType(dragStIdx, idx); setDragStIdx(null); setDragStOver(null); }}
                        onDragEnd={() => { setDragStIdx(null); setDragStOver(null); }}
                        style={{ display: 'flex', alignItems: 'center', gap: 4, opacity: dragStIdx === idx ? 0.4 : 1, outline: dragStOver === idx ? '2px dashed #C5FF00' : 'none', outlineOffset: 2, borderRadius: 9999 }}
                      >
                        {renamingSubTypeId === st.id ? (
                          <input
                            autoFocus
                            value={renameVal}
                            onChange={(e) => setRenameVal(e.target.value)}
                            onBlur={() => { if (renameVal.trim()) renameSubType(st.id, renameVal.trim()); else setRenamingSubTypeId(null); }}
                            onKeyDown={(e) => { if (e.key === 'Enter') { if (renameVal.trim()) renameSubType(st.id, renameVal.trim()); } else if (e.key === 'Escape') setRenamingSubTypeId(null); }}
                            style={{ width: 80, border: 'none', borderBottom: '2px solid #C5FF00', outline: 'none', fontFamily: f, fontSize: 12, fontWeight: 700, background: 'transparent', padding: '2px 4px' }}
                          />
                        ) : (
                          <button
                            onClick={() => setEditSubTypeId(st.id)}
                            onDoubleClick={() => { setRenamingSubTypeId(st.id); setRenameVal(st.label); }}
                            style={chipBtn(activeSt === st.id)}
                          >
                            {st.label}
                          </button>
                        )}
                        <button onClick={() => deleteSubType(st.id)} style={{ width: 18, height: 18, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,.12)', color: '#4A4846', cursor: 'pointer', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>×</button>
                      </div>
                    ))}
                    {/* 서브타입 추가 */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <input value={newSubTypeLabel} onChange={(e) => setNewSubTypeLabel(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addSubType(); }} placeholder="서브타입..." style={{ width: 80, border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 9999, padding: '5px 10px', fontFamily: f, fontSize: 11, color: '#0C0C0A', background: '#fff', outline: 'none' }} />
                      <button onClick={addSubType} style={{ padding: '5px 10px', borderRadius: 9999, border: 'none', background: '#0C0C0A', color: '#C5FF00', fontFamily: f, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>+</button>
                    </div>
                  </div>
                </div>
              ) : null}

              {/* 카테고리 목록 */}
              <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, color: '#9A9490', letterSpacing: '.08em', marginBottom: 8 }}>
                카테고리
                {editingDomain.subTypes?.length && activeSt ? ` — ${editingDomain.subTypes.find(st => st.id === activeSt)?.label}` : ''}
              </div>

              {currentCats().length === 0 && (
                <div style={{ padding: '20px 0', textAlign: 'center', color: '#C4C2BE', fontFamily: f, fontSize: 13 }}>카테고리가 없습니다</div>
              )}

              {currentCats().map((cat, idx) => (
                <div
                  key={`${activeSt}-${idx}`}
                  draggable
                  onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; setDragCatIdx(idx); }}
                  onDragOver={(e) => { e.preventDefault(); setDragCatOver(idx); }}
                  onDrop={(e) => { e.preventDefault(); if (dragCatIdx != null) moveCat(dragCatIdx, idx); setDragCatIdx(null); setDragCatOver(null); }}
                  onDragEnd={() => { setDragCatIdx(null); setDragCatOver(null); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid rgba(12,12,10,.07)', opacity: dragCatIdx === idx ? 0.4 : 1, outline: dragCatOver === idx ? '2px dashed #C5FF00' : 'none', outlineOffset: 2, borderRadius: 4 }}
                >
                  <span style={{ cursor: 'grab', color: '#C4C2BE', fontSize: 20, userSelect: 'none', paddingRight: 20 }}>⠿</span>
                  <span style={{ flex: 1, fontFamily: f, fontSize: 14, color: '#0C0C0A' }}>{cat}</span>
                  <button onClick={() => deleteCat(idx)} style={{ width: 24, height: 24, borderRadius: 6, border: 'none', background: 'rgba(186,26,26,.08)', color: '#BA1A1A', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>×</button>
                </div>
              ))}

              {/* 카테고리 추가 */}
              <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center' }}>
                <input
                  value={newCatLabel}
                  onChange={(e) => setNewCatLabel(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') addCat(); }}
                  placeholder="카테고리 이름..."
                  style={{ flex: 1, border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 10, padding: '9px 12px', fontFamily: f, fontSize: 13, color: '#0C0C0A', background: '#fff', outline: 'none' }}
                />
                <button onClick={addCat} style={{ padding: '9px 26px', borderRadius: 10, border: 'none', background: '#0C0C0A', color: '#C5FF00', fontFamily: f, fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>+ 추가</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ─── 제품 추가/편집 전체 화면 폼 ─────────────────────────────────────────────
// design/box.html .add-page 구조 — 아래에서 위로 슬라이드 업 애니메이션
function AddProductPage({
  isOpen,
  onClose,
  form,
  setForm,
  totalAmount,
  onSave,
  saving,
  editingProduct,
  boxConfig,
  onSaveBoxConfig,
  onDelete,
  onOpenCatEditor,
}: {
  isOpen: boolean;
  onClose: () => void;
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  totalAmount: number;
  onSave: () => void;
  saving: boolean;
  editingProduct: Product | null;
  boxConfig: BoxConfig;
  onSaveBoxConfig: (config: BoxConfig) => Promise<void>;
  onDelete?: () => void;
  onOpenCatEditor?: () => void;
}) {
  const isEditing = !!editingProduct;
  const isNameEmpty = !form.name.trim();
  const [saveAttempted, setSaveAttempted] = useState(false);
  const [addingLoc, setAddingLoc] = useState(false);
  const [newLocName, setNewLocName] = useState('');
  // 보관 위치 편집·드래그 상태
  const [editLocIdx, setEditLocIdx] = useState<number | null>(null);
  const [editLocName, setEditLocName] = useState('');
  const [dragLocIdx, setDragLocIdx] = useState<number | null>(null);
  const [dragLocOverIdx, setDragLocOverIdx] = useState<number | null>(null);

  // 스킨케어 개수 모드 시 목표 사용 기간에 따른 1회 사용량(dosePerUse) 자동 역산 연동
  useEffect(() => {
    const isCountMode = form.itemUnit === '개';
    const isSkincare = form.formDomain === 'beauty' && form.formSubType === 'skincare';
    
    // 불규칙인 경우 사용 기간 초기화 및 계산 건너뜀
    if (form.daysPerWeek === 0) {
      if (form.usageDurationMonths !== 0) {
        setForm((f) => ({ ...f, usageDurationMonths: 0 }));
      }
      return;
    }

    if (isSkincare && isCountMode && form.usageDurationMonths > 0) {
      if (form.usesPerDay > 0 && form.daysPerWeek > 0) {
        const totalDays = form.usageDurationMonths * 30;
        const daysPerWeekRate = form.daysPerWeek / 7;
        const totalUses = totalDays * form.usesPerDay * daysPerWeekRate;
        const totalVolume = form.packageCount * form.unitPerPackage;
        const calculatedDose = totalVolume / totalUses;
        
        // 소수점 4자리까지 반올림
        const roundedDose = Math.round(calculatedDose * 10000) / 10000;
        
        if (Math.abs(form.dosePerUse - roundedDose) > 0.0001) {
          setForm((f) => ({ ...f, dosePerUse: roundedDose }));
        }
      }
    }
  }, [
    form.usageDurationMonths,
    form.packageCount,
    form.unitPerPackage,
    form.usesPerDay,
    form.daysPerWeek,
    form.formDomain,
    form.formSubType,
    form.itemUnit,
    form.dosePerUse,
    setForm
  ]);

  const isSkincare = form.formDomain === 'beauty' && form.formSubType === 'skincare';

  // 현재 카테고리의 기본 단위 (ml 또는 g, 기본값은 ml)
  const categoryDefault = form.category ? CATEGORY_DOSE_DEFAULTS[form.category] : null;
  const baseUnit = categoryDefault ? categoryDefault.unit : 'ml';

  // ── 스킨케어 카테고리 변경 시 단독 단위(ml / g) 보정 ──
  useEffect(() => {
    if (!isSkincare) return;
    if (form.itemUnit !== '개' && baseUnit !== '개') {
      if (form.itemUnit !== baseUnit) {
        setForm((f) => ({ ...f, itemUnit: baseUnit }));
      }
    }
  }, [isSkincare, baseUnit, form.itemUnit, setForm]);

  // 소진 예측 계산
  // 기준 잔량: 편집 모드는 현재 잔량, 신규 등록은 총 용량
  const isCountMode = form.itemUnit === '개';
  
  // 현재 남은 수량: 편집이면 form 값, 신규+개수모드면 form 값(입력한 경우) 또는 총 수량
  const currentCount = isEditing
    ? form.currentRemaining
    : (isCountMode && form.currentRemaining > 0 ? form.currentRemaining : totalAmount);

  // 하루 소모량 계산 (스킨케어 제품은 항상 ml 기준으로 소모되므로 dosePerUse를 곱함. 그 외 도메인의 개수 모드는 1회당 1개 소모로 계산)
  const dailyUsage = (isSkincare || !isCountMode)
    ? form.dosePerUse * form.usesPerDay * (form.daysPerWeek / 7)
    : (form.daysPerWeek > 0 ? form.usesPerDay * (form.daysPerWeek / 7) : 0);

  const countDailyRate = isCountMode && dailyUsage > 0 
    ? (isSkincare ? dailyUsage / form.unitPerPackage : dailyUsage)
    : null;
  const countWeeklyRate = countDailyRate !== null ? countDailyRate * 7 : null;

  const baseForEstimate = isEditing ? form.currentRemaining : totalAmount;

  // 디데이 계산 시 개수 모드이면서 스킨케어인 경우 남은 개수에 개당 용량을 곱해 ml로 환산
  const remainingVolumeForEstimate = (isSkincare && isCountMode)
    ? currentCount * form.unitPerPackage
    : (isCountMode ? currentCount : baseForEstimate);

  // 예상 소진일
  const estimatedDays = dailyUsage > 0
    ? Math.round(remainingVolumeForEstimate / dailyUsage)
    : null;

  // form state에서 domain/subType/cats 동적 계산
  const domain = form.formDomain;
  const subType = form.formSubType;
  const domainCfg = boxConfig.domains.find(d => d.id === domain);
  const cats = domainCfg ? getDomainCats(domainCfg, subType) : [];
  // 현재 표시할 이미지 (새로 선택한 미리보기 > 기존 URL)
  const displayImg = form.imagePreview || form.imageUrl;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0, bottom: 0,
        left: 'max(0px,calc(50vw - 215px))',
        right: 'max(0px,calc(50vw - 215px))',
        zIndex: 60,
        background: '#FFFFFF',
        transform: isOpen ? 'translateY(0)' : 'translateY(100%)',
        transition: 'transform .38s cubic-bezier(.4,0,.2,1)',
        overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
      }}
    >
      {/* ── 상단 앱바 ── */}
      <div
        style={{
          height: 56, background: 'rgba(255,255,255,.95)',
          backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
          borderBottom: '1px solid rgba(12,12,10,.07)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 26px', flexShrink: 0,
        }}
      >
        <button
          onClick={onClose}
          style={{ width: 36, height: 36, border: 'none', background: 'none', cursor: 'pointer', color: '#0C0C0A', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
        </button>
        <span style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: '#44474A' }}>
          {isEditing ? 'EDIT PRODUCT' : 'ADD PRODUCT'}
        </span>
        <div style={{ width: 36 }} />
      </div>

      {/* ── 스크롤 콘텐츠 영역 ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 0 96px', display: 'flex', flexDirection: 'column' }}>

        {/* ── 제품 이미지 ── */}
        <ImagePicker
          preview={displayImg}
          onChange={(file, base64) => setForm(f => ({ ...f, imageFile: file, imagePreview: base64 }))}
          height={220}
          placeholderLabel="ADD PRODUCT IMAGE"
          isOpen={isOpen}
        />

        {/* ── 폼 콘텐츠 ── */}
        <div style={{ padding: '24px 26px', display: 'flex', flexDirection: 'column', gap: 32 }}>

          {/* ── Purchase history 섹션 ── */}
          <div>
            <div style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontStyle: 'italic', fontWeight: 400, fontSize: 28, lineHeight: '36px', color: '#1A1C1C', marginBottom: 8 }}>
              Purchase history
            </div>
            <div style={{ borderTop: '1px solid #C5C6CA', paddingTop: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>

              {/* 구매일 + 유통기한 */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div>
                  <div style={labelStyle}>구매일</div>
                  <input type="date" value={form.purchaseDate} onChange={(e) => setForm((f) => ({ ...f, purchaseDate: e.target.value }))} style={dateInputStyle} />
                </div>
                <div>
                  <div style={labelStyle}>유통기한</div>
                  <input type="date" value={form.expiryDate} onChange={(e) => setForm((f) => ({ ...f, expiryDate: e.target.value }))} style={dateInputStyle} />
                </div>
              </div>

              {/* 제품명 (필수) */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <div style={labelStyle}>PRODUCT NAME</div>
                  <div style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 11, color: '#9A9490' }}>*필수</div>
                </div>
                <input
                  id="add-product-name"
                  value={form.name}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, name: e.target.value }));
                    if (saveAttempted && e.target.value.trim()) setSaveAttempted(false);
                  }}
                  placeholder="제품명을 입력하세요"
                  style={{
                    ...underlineInputStyle, fontSize: 18,
                    borderBottomColor: saveAttempted && isNameEmpty ? '#E94F6B' : isNameEmpty ? '#C5C6CA' : '#6B7280',
                    borderBottomWidth: saveAttempted && isNameEmpty ? 2 : 1,
                  }}
                />
                {saveAttempted && isNameEmpty && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 6 }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#E94F6B" strokeWidth="2.5" strokeLinecap="round">
                      <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                    </svg>
                    <span style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 12, fontWeight: 600, color: '#E94F6B' }}>
                      제품명은 필수 항목입니다
                    </span>
                  </div>
                )}
              </div>

              {/* 브랜드 + 구매처 */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div>
                  <div style={labelStyle}>BRAND</div>
                  <input value={form.brand} onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))} placeholder="브랜드명" style={{ ...underlineInputStyle, fontSize: 14 }} />
                </div>
                <div>
                  <div style={labelStyle}>구매처</div>
                  <input value={form.source} onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))} placeholder="구매처명" style={{ ...underlineInputStyle, fontSize: 14 }} />
                </div>
              </div>

              {/* DOMAIN 선택 버튼 (boxConfig 기반) */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={labelStyle}>DOMAIN</div>
                  <button
                    onClick={() => onOpenCatEditor?.()}
                    style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 11, fontWeight: 700, color: '#4A4846', background: '#EEEDE9', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', letterSpacing: '.04em' }}
                  >
                    카테고리 편집
                  </button>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const, marginTop: 0 }}>
                  {boxConfig.domains.map((d) => (
                    <button
                      key={d.id}
                      onClick={() => {
                        const firstSub = d.subTypes?.[0]?.id ?? '';
                        setForm((f) => ({ ...f, formDomain: d.id, formSubType: firstSub, category: '' }));
                      }}
                      style={{
                        padding: '6px 14px', borderRadius: 9999,
                        border: `1.5px solid ${domain === d.id ? '#0C0C0A' : 'rgba(12,12,10,.18)'}`,
                        background: domain === d.id ? '#0C0C0A' : 'transparent',
                        fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif",
                        fontSize: 11, fontWeight: 700, letterSpacing: '.04em',
                        color: domain === d.id ? '#fff' : '#9A9490',
                        cursor: 'pointer', transition: 'all .15s', whiteSpace: 'nowrap' as const,
                      }}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 서브타입 탭 (서브타입이 있는 도메인만) — 도메인 필과 구분되는 탭+언더라인 스타일 */}
              {domainCfg?.subTypes?.length ? (
                <div style={{ marginTop: -4 }}>
                  {/* 라벨 */}
                  <div style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 10, fontWeight: 700, letterSpacing: '.12em', color: '#B0AEA9', marginBottom: 2, textTransform: 'uppercase' as const }}>
                    TYPE
                  </div>
                  {/* 탭 행 — 언더라인 스타일 */}
                  <div style={{ display: 'flex', borderBottom: '1.5px solid rgba(12,12,10,.08)' }}>
                    {domainCfg.subTypes.map((st) => (
                      <button
                        key={st.id}
                        onClick={() => setForm((f) => ({ ...f, formSubType: st.id, category: '' }))}
                        style={{
                          padding: '7px 26px 7px 0',
                          marginRight: 4,
                          background: 'none', border: 'none',
                          borderBottom: subType === st.id ? '2.5px solid #C5FF00' : '2.5px solid transparent',
                          marginBottom: -1.5,
                          fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif",
                          fontSize: 13, fontWeight: subType === st.id ? 700 : 500,
                          letterSpacing: '.01em',
                          color: subType === st.id ? '#0C0C0A' : '#9A9490',
                          cursor: 'pointer', transition: 'all .15s',
                          whiteSpace: 'nowrap' as const,
                        }}
                      >
                        {st.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* PRIMARY CLASSIFICATION 카테고리 칩 */}
              {cats.length > 0 && (
                <div>
                  <div style={{ borderBottom: '1px solid #C5C6CA', paddingBottom: 4, marginBottom: 10 }}>
                    <div style={labelStyle}>PRIMARY CLASSIFICATION</div>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {cats.map((cat) => (
                      <button
                        key={cat}
                        onClick={() => {
                          const def = CATEGORY_DOSE_DEFAULTS[cat];
                          setForm((f) => ({
                            ...f,
                            category: f.category === cat ? '' : cat,
                            // 카테고리 선택 시 해당 카테고리의 기본 사용량·단위 자동 적용
                            // 단, 기존 단위가 '개'(결합 모드)였을 때는 결합 모드 상태를 유지하기 위해 '개'로 남김
                            ...(f.category !== cat && def
                              ? { dosePerUse: def.dose, itemUnit: f.itemUnit === '개' ? '개' : def.unit }
                              : {}),
                          }));
                        }}
                        style={{
                          height: 26, padding: '0 14px',
                          border: `1.5px solid ${form.category === cat ? '#000' : '#C5C6CA'}`,
                          background: form.category === cat ? '#000' : 'transparent',
                          fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif",
                          fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase' as const,
                          color: form.category === cat ? '#fff' : '#44474A',
                          cursor: 'pointer', borderRadius: 4, transition: 'all .15s',
                        }}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── 구매 정보 (가격 + 링크) ── */}
          <div>
            <div style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 18, fontWeight: 600, color: '#1A1C1C', marginBottom: 12 }}>Purchase Info</div>
            <div style={{ borderTop: '1px solid #C5C6CA', paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <div style={labelStyle}>PRICE</div>
                <input
                  value={form.price}
                  onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                  placeholder="₩"
                  style={{ ...underlineInputStyle, fontSize: 15 }}
                />
              </div>
              <div>
                <div style={labelStyle}>PURCHASE URL</div>
                <input
                  value={form.purchaseUrl}
                  onChange={(e) => setForm((f) => ({ ...f, purchaseUrl: e.target.value }))}
                  placeholder="https://..."
                  inputMode="url"
                  style={{ ...underlineInputStyle, fontSize: 13 }}
                />
              </div>
            </div>
          </div>

          {/* ── Fashion 섹션 ── */}
          {domain === 'fashion' && (
            <div>
              <div style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 22, fontWeight: 400, letterSpacing: '-0.02em', color: '#1A1C1C', marginBottom: 12 }}>
                Fashion Info
              </div>
              <div style={{ borderTop: '1px solid #C5C6CA', paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 20 }}>
                <div>
                  <div style={labelStyle}>Material</div>
                  <input
                    value={form.material}
                    onChange={e => setForm(f => ({ ...f, material: e.target.value }))}
                    placeholder="예: 코튼, 린넨, 울"
                    style={{ ...underlineInputStyle, fontSize: 15 }}
                  />
                </div>
                <div>
                  <div style={labelStyle}>Care Guide</div>
                  <input
                    value={form.careGuide}
                    onChange={e => setForm(f => ({ ...f, careGuide: e.target.value }))}
                    placeholder="예: 손세탁, 드라이 클리닝"
                    style={{ ...underlineInputStyle, fontSize: 15 }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* ── Acc 섹션 ── */}
          {domain === 'acc' && (
            <div>
              <div style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 22, fontWeight: 400, letterSpacing: '-0.02em', color: '#1A1C1C', marginBottom: 12 }}>
                Acc Info
              </div>
              <div style={{ borderTop: '1px solid #C5C6CA', paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 20 }}>
                <div>
                  <div style={{ ...labelStyle, marginBottom: 10 }}>Material Type</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const }}>
                    {['금', '은', '가죽', '패브릭', '플라스틱', '기타'].map(m => (
                      <button key={m} onClick={() => setForm(f => ({ ...f, materialType: f.materialType === m ? '' : m }))} style={pillStyle(form.materialType === m)}>
                        {m}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div style={labelStyle}>Special Note</div>
                  <input
                    value={form.specialNote}
                    onChange={e => setForm(f => ({ ...f, specialNote: e.target.value }))}
                    placeholder="보존 상태, 수선 이력 등…"
                    style={{ ...underlineInputStyle, fontSize: 14 }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* ── Asset Count 섹션 (Beauty 전용) ── */}
          {domain === 'beauty' && <div>
              <div style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 22, fontWeight: 400, letterSpacing: '-0.02em', color: '#1A1C1C', marginBottom: 12 }}>
                Asset Count
              </div>
              <div style={{ borderTop: '1px solid #C5C6CA', paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 20 }}>

                {/* ── 수량 구조: 박스 수 × 박스당 개수 (개 모드) / 패키지 × ml (ml 모드) ── */}
                <div>
                  <div style={{ ...labelStyle, marginBottom: 10 }}>수량 구조</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                    <div>
                      <div style={{ ...labelStyle, marginBottom: 4, fontSize: 10 }}>
                        {isSkincare && isCountMode ? '총 구매 개수 (병/개)' : (isCountMode ? '박스 수' : '패키지 수')}
                      </div>
                      <div style={{ borderBottom: '1.5px solid #C5C6CA', paddingBottom: 4 }}>
                        <input
                          type="number" min={1}
                          value={form.packageCount || ''}
                          onChange={(e) => {
                            const n = parseInt(e.target.value, 10);
                            const pkgCount = isNaN(n) ? 0 : n;
                            setForm((f) => {
                              const defaultRem = (isSkincare && isCountMode) ? pkgCount : pkgCount * f.unitPerPackage;
                              return {
                                ...f,
                                packageCount: pkgCount,
                                ...(!isEditing ? { currentRemaining: defaultRem } : {})
                              };
                            });
                          }}
                          onBlur={() => {
                            setForm((f) => {
                              const pkgCount = Math.max(1, f.packageCount || 1);
                              const defaultRem = (isSkincare && isCountMode) ? pkgCount : pkgCount * f.unitPerPackage;
                              return {
                                ...f,
                                packageCount: pkgCount,
                                ...(!isEditing ? { currentRemaining: defaultRem } : {})
                              };
                            });
                          }}
                          style={countInputStyle}
                        />
                      </div>
                    </div>
                    <span style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 18, color: '#C5C6CA', paddingTop: 14 }}>×</span>
                    <div>
                      <div style={{ ...labelStyle, marginBottom: 4, fontSize: 10 }}>
                        {isSkincare && isCountMode ? (baseUnit === 'g' ? '개당 중량 (g)' : '개당 용량 (ml)') : (isCountMode ? '박스당 개수' : `패키지 용량 (${form.itemUnit})`)}
                      </div>
                      <div style={{ borderBottom: '1.5px solid #C5C6CA', paddingBottom: 4 }}>
                        <input
                          type="number" min={0.1} step="any"
                          value={form.unitPerPackage || ''}
                          onChange={(e) => {
                            const n = parseFloat(e.target.value);
                            const unitVal = isNaN(n) ? 0 : n;
                            setForm((f) => {
                              const defaultRem = (isSkincare && isCountMode) ? f.packageCount : f.packageCount * unitVal;
                              return {
                                ...f,
                                unitPerPackage: unitVal,
                                ...(!isEditing ? { currentRemaining: defaultRem } : {})
                              };
                            });
                          }}
                          onBlur={() => {
                            setForm((f) => {
                              const unitVal = Math.max(0.1, f.unitPerPackage || 1);
                              const defaultRem = (isSkincare && isCountMode) ? f.packageCount : f.packageCount * unitVal;
                              return {
                                ...f,
                                unitPerPackage: unitVal,
                                ...(!isEditing ? { currentRemaining: defaultRem } : {})
                              };
                            });
                          }}
                          style={countInputStyle}
                        />
                      </div>
                    </div>
                  </div>
                  {/* 단위 선택 */}
                  <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                    {(() => {
                      const unitOptions = (() => {
                        if (!isSkincare) return ['개', 'ml', 'g'];
                        if (baseUnit === 'ml') return ['개', 'ml'];
                        if (baseUnit === 'g') return ['개', 'g'];
                        if (baseUnit === '개') return ['개'];
                        return ['개', 'ml'];
                      })();
                      return unitOptions.map((u) => {
                        let label = u;
                        if (isSkincare) {
                          if (u === '개') {
                            label = baseUnit === 'g' ? '개수 + 중량(g) 결합' : (baseUnit === '개' ? '개수 단독' : '개수 + 용량(ml) 결합');
                          } else if (u === 'ml') {
                            label = '용량(ml) 단독';
                          } else if (u === 'g') {
                            label = '중량(g) 단독';
                          }
                        }
                        return (
                          <button
                            key={u}
                            onClick={() => setForm((f) => ({ ...f, itemUnit: u, usageDurationMonths: 0 }))}
                            style={{
                              ...pillStyle(form.itemUnit === u),
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {label}
                          </button>
                        );
                      });
                    })()}
                  </div>
                  {/* 총량 요약 */}
                  <div style={{ display: 'flex', alignItems: 'center', background: '#F5F5F3', borderRadius: 6, padding: '8px 12px' }}>
                    <span style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: '.08em', color: '#9CA3AF', textTransform: 'uppercase' }}>
                      {isSkincare && isCountMode ? (baseUnit === 'g' ? '총 중량 (환산)' : '총 용량 (환산)') : (isCountMode ? '총 개수' : '총 용량')}
                    </span>
                    <span style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 16, fontWeight: 700, color: '#0C1014', marginLeft: 'auto' }}>
                      {isSkincare && isCountMode ? `${totalAmount}${baseUnit}` : `${totalAmount}${form.itemUnit}`}
                    </span>
                  </div>
                </div>

                {/* 시작일 */}
                <div>
                  <div style={labelStyle}>사용 시작일</div>
                  <input type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} style={dateInputStyle} />
                </div>

                {/* ── 현재 남은 수량 ── */}
                {(isCountMode || isEditing) && (
                  <div>
                    <div style={{ ...labelStyle, marginBottom: 6 }}>
                      {isSkincare && isCountMode ? '현재 남은 개수' : (isCountMode ? '현재 남은 개수' : '현재 잔량')}
                    </div>
                    {isCountMode && !isEditing && (
                      <div style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 11, color: '#9CA3AF', marginBottom: 8 }}>
                        {isSkincare
                          ? `새 것이면 그대로 두세요 (총 ${form.packageCount}개). 이미 쓰던 것이면 남은 개수를 입력하세요 (예: 1.5).`
                          : `새 것이면 그대로 두세요 (총 ${totalAmount}개). 이미 쓰던 것이면 남은 개수를 입력하세요.`}
                      </div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={
                          isCountMode && !isEditing && form.currentRemaining === 0
                            ? (isSkincare ? form.packageCount : totalAmount)
                            : form.currentRemaining || ''
                        }
                        onChange={(e) => {
                          const n = parseFloat(e.target.value);
                          setForm((f) => ({ ...f, currentRemaining: isNaN(n) ? 0 : Math.max(0, n) }));
                        }}
                        onBlur={() => setForm((f) => ({ ...f, currentRemaining: f.currentRemaining || 0 }))}
                        style={{ ...countInputStyle, textAlign: 'left', fontSize: 22, width: 80 }}
                      />
                      <span style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 12, color: '#9A9490' }}>
                        {isSkincare && isCountMode
                          ? `개 / 총 ${form.packageCount}개 (남은 ${baseUnit === 'g' ? '중량' : '용량'}: ${currentCount * form.unitPerPackage}${baseUnit} / ${totalAmount}${baseUnit})`
                          : `${form.itemUnit} / ${totalAmount}${form.itemUnit}`}
                      </span>
                    </div>
                    <div style={{ marginTop: 6, height: 4, background: '#EEEDE9', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{
                        height: '100%',
                        width: `${Math.min(100, (currentCount / Math.max(1, (isSkincare && isCountMode ? form.packageCount : totalAmount))) * 100)}%`,
                        background: '#C5FF00', transition: 'width .3s',
                      }} />
                    </div>
                  </div>
                )}

                {/* ── 소비 패턴 섹션: 개 모드 vs ml 모드 (뷰티-스킨케어에만 노출) ── */}
                {domain === 'beauty' && subType === 'skincare' && (
                  isCountMode ? (
                    /* 개수 모드: 하루 횟수 + 사용 주기 직접 입력 */
                    <div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 2 }}>
                        <div style={labelStyle}>사용 패턴</div>
                      </div>
                      <div style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 11, color: '#9CA3AF', marginBottom: 14 }}>소진 예측에 사용됩니다</div>

                      {/* 하루 횟수 */}
                      <div style={{ marginBottom: 14 }}>
                        <div style={{ ...labelStyle, marginBottom: 8 }}>하루 횟수</div>
                        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' as const }}>
                          {[1, 2, 3, 4].map((n) => (
                            <button key={n} onClick={() => setForm((f) => ({ ...f, usesPerDay: n }))} style={pillStyle(form.usesPerDay === n)}>
                              {n === 4 ? '4+회' : `${n}회`}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* 사용 주기 */}
                      <div style={{ marginBottom: 14 }}>
                        <div style={{ ...labelStyle, marginBottom: 8 }}>사용 주기</div>
                        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' as const }}>
                          {FREQ_OPTIONS.map((opt) => (
                            <button key={opt.label} onClick={() => setForm((f) => ({ ...f, daysPerWeek: opt.daysPerWeek }))} style={pillStyle(form.daysPerWeek === opt.daysPerWeek)}>
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* 목표 사용 기간 */}
                      <div style={{ marginBottom: 14 }}>
                        <div style={{ ...labelStyle, marginBottom: 8 }}>목표 사용 기간</div>
                        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' as const, marginBottom: 8 }}>
                          {[1, 2, 3, 4, 6].map((m) => {
                            const isSelected = form.usageDurationMonths === m;
                            const isDisabled = form.daysPerWeek === 0;
                            return (
                              <button
                                key={m}
                                disabled={isDisabled}
                                onClick={() => setForm((f) => ({ ...f, usageDurationMonths: m }))}
                                style={{
                                  ...pillStyle(isSelected),
                                  opacity: isDisabled ? 0.5 : 1,
                                  cursor: isDisabled ? 'not-allowed' : 'pointer'
                                }}
                              >
                                {m}개월
                              </button>
                            );
                          })}
                          <button
                            disabled={form.daysPerWeek === 0}
                            onClick={() => setForm((f) => {
                              const isCustom = ![1, 2, 3, 4, 6].includes(f.usageDurationMonths) && f.usageDurationMonths > 0;
                              return {
                                ...f,
                                usageDurationMonths: isCustom ? f.usageDurationMonths : 5
                              };
                            })}
                            style={{
                              ...pillStyle(![1, 2, 3, 4, 6].includes(form.usageDurationMonths) && form.usageDurationMonths > 0),
                              opacity: form.daysPerWeek === 0 ? 0.5 : 1,
                              cursor: form.daysPerWeek === 0 ? 'not-allowed' : 'pointer'
                            }}
                          >
                            직접 입력
                          </button>
                        </div>

                        {/* 직접 입력 시 상세 입력 필드 */}
                        {![1, 2, 3, 4, 6].includes(form.usageDurationMonths) && form.usageDurationMonths > 0 && form.daysPerWeek > 0 && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1.5px solid #C5C6CA', paddingBottom: 4, width: 120 }}>
                            <input
                              type="number"
                              min={1}
                              max={60}
                              value={form.usageDurationMonths || ''}
                              onChange={(e) => {
                                const n = parseInt(e.target.value, 10);
                                setForm((f) => ({ ...f, usageDurationMonths: isNaN(n) ? 0 : n }));
                              }}
                              style={{ ...countInputStyle, textAlign: 'left', width: 60 }}
                            />
                            <span style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 14, color: '#44474A' }}>개월</span>
                          </div>
                        )}
                      </div>

                      {/* 1회 사용량 */}
                      <div style={{ marginBottom: 14 }}>
                        <div style={{ ...labelStyle, marginBottom: 8 }}>1회 사용량</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1.5px solid #C5C6CA', paddingBottom: 4 }}>
                          <input
                            type="number" min={0.01} step="any"
                            value={form.dosePerUse || ''}
                            onChange={(e) => {
                              const n = parseFloat(e.target.value);
                              setForm((f) => ({
                                ...f,
                                dosePerUse: isNaN(n) ? 0 : n,
                                usageDurationMonths: 0 // 수동 편집 시 목표 개월 칩 해제
                              }));
                            }}
                            onBlur={() => setForm((f) => ({ ...f, dosePerUse: Math.max(0.01, f.dosePerUse || 0.01) }))}
                            style={{ ...countInputStyle, textAlign: 'left', width: 80 }}
                          />
                          <span style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 14, color: '#44474A' }}>{baseUnit}</span>
                          {form.unitPerPackage > 0 && form.dosePerUse > 0 && (
                            <span style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 12, color: '#9CA3AF', marginLeft: 8 }}>
                              (약 {(form.dosePerUse / form.unitPerPackage).toFixed(2)}개 소모)
                            </span>
                          )}
                        </div>
                      </div>

                      {/* 자동 계산 결과 */}
                      {countDailyRate !== null && (
                        <div style={{ background: '#F5F5F3', borderRadius: 8, padding: '10px 14px', display: 'flex', gap: 0, marginBottom: 8 }}>
                          <div style={{ flex: 1, textAlign: 'center', borderRight: '1px solid #E5E4E2' }}>
                            <div style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 10, fontWeight: 700, color: '#9CA3AF', letterSpacing: '.06em', marginBottom: 2 }}>하루 소모</div>
                            <div style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 16, fontWeight: 700, color: '#0C1014' }}>
                              {countDailyRate < 1 ? countDailyRate.toFixed(2) : countDailyRate.toFixed(1)}개
                            </div>
                          </div>
                          <div style={{ flex: 1, textAlign: 'center' }}>
                            <div style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 10, fontWeight: 700, color: '#9CA3AF', letterSpacing: '.06em', marginBottom: 2 }}>주간 소모</div>
                            <div style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 16, fontWeight: 700, color: '#0C1014' }}>
                              {countWeeklyRate !== null ? (countWeeklyRate < 1 ? countWeeklyRate.toFixed(2) : countWeeklyRate.toFixed(1)) : '—'}개
                            </div>
                          </div>
                        </div>
                      )}

                      {/* 예상 소진 */}
                      <div style={{ background: '#F5F5F3', borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: '.08em', color: '#9CA3AF', textTransform: 'uppercase' }}>예상 소진</span>
                        <span style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 15, fontWeight: 700, color: estimatedDays !== null ? '#0C1014' : '#C5C6CA' }}>
                          {estimatedDays !== null ? `약 ${estimatedDays}일 후` : '불규칙'}
                        </span>
                      </div>
                    </div>
                  ) : (
                    /* ml/g 모드: 기존 사용 패턴 UI */
                    <div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 2 }}>
                        <div style={labelStyle}>사용 패턴</div>
                        {form.category && CATEGORY_DOSE_DEFAULTS[form.category] && (
                          <span style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 10, color: '#9CA3AF' }}>
                            ({form.category} 기본값 자동 적용)
                          </span>
                        )}
                      </div>
                      <div style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 11, color: '#9CA3AF', marginBottom: 14 }}>소진 예측에 사용됩니다</div>

                      <div style={{ marginBottom: 14 }}>
                        <div style={{ ...labelStyle, marginBottom: 8 }}>1회 사용량</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1.5px solid #C5C6CA', paddingBottom: 4 }}>
                          <input
                            type="number" min={0.01} step="any"
                            value={form.dosePerUse || ''}
                            onChange={(e) => { const n = parseFloat(e.target.value); setForm((f) => ({ ...f, dosePerUse: isNaN(n) ? 0 : n })); }}
                            onBlur={() => setForm((f) => ({ ...f, dosePerUse: Math.max(0.01, f.dosePerUse || 0.01) }))}
                            style={{ ...countInputStyle, textAlign: 'left', width: 80 }}
                          />
                          <span style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 14, color: '#44474A' }}>{form.itemUnit}</span>
                        </div>
                      </div>

                      <div style={{ marginBottom: 14 }}>
                        <div style={{ ...labelStyle, marginBottom: 8 }}>하루 횟수</div>
                        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' as const }}>
                          {[1, 2, 3, 4].map((n) => (
                            <button key={n} onClick={() => setForm((f) => ({ ...f, usesPerDay: n }))} style={pillStyle(form.usesPerDay === n)}>
                              {n === 4 ? '4+회' : `${n}회`}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div style={{ marginBottom: 14 }}>
                        <div style={{ ...labelStyle, marginBottom: 8 }}>사용 주기</div>
                        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' as const }}>
                          {FREQ_OPTIONS.map((opt) => (
                            <button key={opt.label} onClick={() => setForm((f) => ({ ...f, daysPerWeek: opt.daysPerWeek }))} style={pillStyle(form.daysPerWeek === opt.daysPerWeek)}>
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div style={{ background: '#F5F5F3', borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: '.08em', color: '#9CA3AF', textTransform: 'uppercase' }}>예상 소진</span>
                        <span style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 15, fontWeight: 700, color: estimatedDays !== null ? '#0C1014' : '#C5C6CA' }}>
                          {estimatedDays !== null ? `약 ${estimatedDays}일 후` : '불규칙'}
                        </span>
                      </div>
                    </div>
                  )
                )}
              </div>
          </div>}

          {/* ── Storage View — 보관 위치 이미지 + 장소 태그 ── */}
          {(() => {
            const f2 = "'Plus Jakarta Sans','Space Grotesk',sans-serif";
            // 현재 폼 도메인 기준 보관 위치 목록
            const locKey = storageLocKey(domain);
            const locs: string[] = getStorageLocs(boxConfig, domain);

            // 변경된 locs 배열을 domainStorageLocations에 저장하는 헬퍼
            function buildUpdated(next: string[]): BoxConfig {
              return {
                ...boxConfig,
                domainStorageLocations: {
                  ...boxConfig.domainStorageLocations,
                  [locKey]: next,
                },
              };
            }

            async function addLocation() {
              if (!newLocName.trim()) return;
              await onSaveBoxConfig(buildUpdated([...locs, newLocName.trim()]));
              setForm(f => ({ ...f, boxLocation: newLocName.trim() }));
              setNewLocName('');
              setAddingLoc(false);
            }

            async function removeLocation(idx: number) {
              const loc = locs[idx];
              await onSaveBoxConfig(buildUpdated(locs.filter((_, i) => i !== idx)));
              if (form.boxLocation === loc) setForm(f => ({ ...f, boxLocation: '' }));
            }

            async function saveEditLoc(idx: number) {
              const trimmed = editLocName.trim();
              if (!trimmed) { setEditLocIdx(null); return; }
              await onSaveBoxConfig(buildUpdated(locs.map((l, i) => i === idx ? trimmed : l)));
              if (form.boxLocation === locs[idx]) setForm(f => ({ ...f, boxLocation: trimmed }));
              setEditLocIdx(null);
              setEditLocName('');
            }

            async function moveLoc(from: number, to: number) {
              if (from === to) return;
              const next = [...locs];
              const [moved] = next.splice(from, 1);
              next.splice(to, 0, moved);
              await onSaveBoxConfig(buildUpdated(next));
            }

            // 도메인 레이블 (헤더 표시용)
            const domainLabel = boxConfig.domains.find(d => d.id === domain)?.label ?? domain;

            return (
              <div>
                <div style={{ fontFamily: f2, fontSize: 22, fontWeight: 400, letterSpacing: '-0.02em', color: '#1A1C1C', marginBottom: 12 }}>
                  Storage View
                </div>
                <div style={{ borderTop: '1px solid #C5C6CA', paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>

                  {/* 보관 장소 이미지 */}
                  <div style={{ border: '1px solid #C5C6CA', background: '#F9F9F9', borderRadius: 4, overflow: 'hidden' }}>
                    <ImagePicker
                      preview={form.storageImagePreview || form.storageImageUrl}
                      onChange={(_, b64) => setForm(f => ({ ...f, storageImagePreview: b64 }))}
                      onClear={() => setForm(f => ({ ...f, storageImagePreview: '', storageImageUrl: '' }))}
                      height={192}
                      placeholderLabel="ADD STORAGE PHOTO"
                      isOpen={isOpen}
                    />
                    <div style={{ display: 'flex', alignItems: 'center', padding: 14, gap: 12, borderTop: '1px solid #E5E5E5' }}>
                      <svg width="16" height="20" viewBox="0 0 24 24" fill="#44474A" style={{ flexShrink: 0 }}><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
                      <div>
                        <div style={{ fontFamily: f2, fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' as const, color: '#9CA3AF', marginBottom: 2 }}>CURRENT LOCATION</div>
                        <div style={{ fontFamily: f2, fontSize: 15, color: form.boxLocation.trim() ? '#1A1C1C' : '#9CA3AF' }}>
                          {form.boxLocation.trim() || '위치를 선택하세요'}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 보관 위치 목록 — 편집 + 드래그 재배치 */}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                      <div style={{ fontFamily: f2, fontSize: 12, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase' as const, color: '#44474A' }}>보관 위치</div>
                      <span style={{ fontFamily: f2, fontSize: 10, fontWeight: 800, background: '#0C0C0A', color: '#C5FF00', padding: '2px 8px', borderRadius: 9999, letterSpacing: '.06em' }}>{domainLabel.toUpperCase()}</span>
                    </div>

                    {/* 위치 행 목록 */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
                      {locs.map((loc, idx) => (
                        <div
                          key={idx}
                          draggable
                          onDragStart={() => setDragLocIdx(idx)}
                          onDragOver={e => { e.preventDefault(); setDragLocOverIdx(idx); }}
                          onDrop={e => { e.preventDefault(); if (dragLocIdx != null) moveLoc(dragLocIdx, idx); setDragLocIdx(null); setDragLocOverIdx(null); }}
                          onDragEnd={() => { setDragLocIdx(null); setDragLocOverIdx(null); }}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                            padding: '8px 10px', borderRadius: 10,
                            border: `1.5px solid ${dragLocOverIdx === idx ? '#C5FF00' : form.boxLocation === loc ? '#0C0C0A' : 'rgba(12,12,10,.12)'}`,
                            background: dragLocOverIdx === idx ? '#F5FFD4' : form.boxLocation === loc ? '#0C0C0A' : '#fff',
                            opacity: dragLocIdx === idx ? 0.4 : 1,
                            transition: 'border-color .15s, background .15s',
                            cursor: 'grab',
                          }}
                        >
                          {/* 드래그 핸들 */}
                          <span style={{ color: form.boxLocation === loc ? 'rgba(255,255,255,.4)' : '#C4C2BE', fontSize: 16, lineHeight: 1, userSelect: 'none' as const, flexShrink: 0 }}>⠿</span>

                          {/* 이름 — 더블클릭 또는 편집 아이콘으로 편집 모드 */}
                          {editLocIdx === idx ? (
                            <input
                              autoFocus
                              value={editLocName}
                              onChange={e => setEditLocName(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') saveEditLoc(idx); if (e.key === 'Escape') { setEditLocIdx(null); setEditLocName(''); } }}
                              onBlur={() => saveEditLoc(idx)}
                              style={{ flex: 1, height: 28, padding: '0 8px', border: '1.5px solid #0C0C0A', borderRadius: 6, fontFamily: f2, fontSize: 13, fontWeight: 600, outline: 'none', background: '#fff', color: '#0C0C0A' }}
                            />
                          ) : (
                            <span
                              onDoubleClick={() => { setEditLocIdx(idx); setEditLocName(loc); setAddingLoc(false); }}
                              style={{ flex: 1, fontFamily: f2, fontSize: 13, fontWeight: 600, color: form.boxLocation === loc ? '#fff' : '#0C0C0A', cursor: 'text', userSelect: 'none' as const }}
                            >
                              {loc}
                            </span>
                          )}

                          {/* 편집 버튼 */}
                          {editLocIdx !== idx && (
                            <button
                              onClick={() => { setEditLocIdx(idx); setEditLocName(loc); setAddingLoc(false); }}
                              style={{ width: 26, height: 26, background: 'none', border: 'none', cursor: 'pointer', color: form.boxLocation === loc ? 'rgba(255,255,255,.5)' : '#BCBAB6', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, flexShrink: 0 }}
                              title="이름 편집"
                            >✎</button>
                          )}

                          {/* 선택 토글 */}
                          {editLocIdx !== idx && (
                            <button
                              onClick={() => setForm(f => ({ ...f, boxLocation: f.boxLocation === loc ? '' : loc }))}
                              style={{ width: 26, height: 26, background: form.boxLocation === loc ? 'rgba(255,255,255,.15)' : 'rgba(12,12,10,.06)', border: 'none', borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                              title="선택"
                            >
                              {form.boxLocation === loc
                                ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                                : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9A9490" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                              }
                            </button>
                          )}

                          {/* 삭제 */}
                          {editLocIdx !== idx && (
                            <button
                              onClick={() => removeLocation(idx)}
                              style={{ width: 26, height: 26, background: 'none', border: 'none', cursor: 'pointer', color: form.boxLocation === loc ? 'rgba(255,255,255,.5)' : '#BCBAB6', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, flexShrink: 0 }}
                              title="삭제"
                            >×</button>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* 위치 추가 */}
                    {!addingLoc ? (
                      <button
                        onClick={() => { setAddingLoc(true); setEditLocIdx(null); }}
                        style={{ width: '100%', padding: '9px 12px', borderRadius: 10, border: '1.5px dashed rgba(12,12,10,.18)', background: 'transparent', fontFamily: f2, fontSize: 12, fontWeight: 700, color: '#9CA3AF', cursor: 'pointer', letterSpacing: '.04em' }}
                      >+ 위치 추가</button>
                    ) : (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input
                          autoFocus
                          value={newLocName}
                          onChange={e => setNewLocName(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') addLocation(); if (e.key === 'Escape') { setAddingLoc(false); setNewLocName(''); } }}
                          placeholder="위치 이름 (예: 욕실 선반)"
                          style={{ flex: 1, height: 38, padding: '0 12px', border: '1.5px solid #0C0C0A', borderRadius: 10, fontFamily: f2, fontSize: 13, outline: 'none' }}
                        />
                        <button onClick={addLocation} style={{ height: 38, padding: '0 14px', background: '#0C0C0A', color: '#fff', border: 'none', borderRadius: 10, fontFamily: f2, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>저장</button>
                        <button onClick={() => { setAddingLoc(false); setNewLocName(''); }} style={{ height: 38, padding: '0 10px', background: 'transparent', border: '1px solid rgba(12,12,10,.2)', borderRadius: 10, fontFamily: f2, fontSize: 12, cursor: 'pointer', color: '#9A9490' }}>취소</button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* ── 취소 / 저장 ── */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={onClose}
              style={{ flex: 1, height: 52, background: '#fff', color: '#0C1014', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 12, fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 15, cursor: 'pointer' }}
            >
              취소
            </button>
            <button
              onClick={() => {
                if (isNameEmpty) {
                  setSaveAttempted(true);
                  // 제품명 입력란으로 스크롤
                  document.getElementById('add-product-name')?.focus();
                  document.getElementById('add-product-name')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  return;
                }
                onSave();
              }}
              disabled={saving}
              style={{
                flex: 1, height: 52,
                background: '#0C0C0A',
                color: '#fff', border: 'none', borderRadius: 12,
                fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif",
                fontSize: 15, fontWeight: 700, cursor: 'pointer',
                opacity: saving ? 0.5 : 1,
              }}
            >
              {saving ? '저장 중...' : '저장'}
            </button>
          </div>

          {/* ── 편집 모드: 삭제 버튼 ── */}
          {isEditing && onDelete && (
            <button
              onClick={onDelete}
              style={{ width: '100%', height: 48, background: 'rgba(186,26,26,.06)', border: '1.5px solid rgba(186,26,26,.2)', borderRadius: 12, fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 14, fontWeight: 700, color: '#BA1A1A', cursor: 'pointer' }}
            >
              이 제품 삭제
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 공통 스타일 헬퍼 ─────────────────────────────────────────────────────────
// 반복적으로 사용되는 스타일을 객체로 정의해 코드 중복을 줄임

const labelStyle: React.CSSProperties = {
  fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
  fontSize: 11, fontWeight: 600, letterSpacing: '0.6px',
  textTransform: 'uppercase', color: '#44474A',
};

// underline 스타일 input (하단 테두리만)
const underlineInputStyle: React.CSSProperties = {
  width: '100%', border: 'none', borderBottom: '1px solid #C5C6CA',
  background: '#FFFFFF', outline: 'none',
  fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
  fontSize: 16, color: '#0C1014', padding: '8px 0 4px', height: 42,
};

// 날짜 input 스타일
const dateInputStyle: React.CSSProperties = {
  width: '100%', border: 'none', borderBottom: '1px solid #6B7280',
  background: '#FFFFFF', outline: 'none',
  fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
  fontSize: 14, color: '#0C1014', padding: '6px 0', height: 41,
};

// 수량 input 스타일 (중앙 정렬, 큰 폰트)
const countInputStyle: React.CSSProperties = {
  width: '100%', border: 'none', background: 'transparent',
  fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
  fontSize: 20, color: '#1A1C1C', outline: 'none',
  padding: '4px 0', textAlign: 'center',
};

// 선택형 pill 버튼 스타일 생성 함수
function pillStyle(isActive: boolean): React.CSSProperties {
  return {
    padding: '6px 12px', borderRadius: 9999,
    border: `1.5px solid ${isActive ? '#0C1014' : '#C5C6CA'}`,
    background: isActive ? '#0C1014' : 'transparent',
    fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
    fontSize: 12, fontWeight: 700, letterSpacing: '.04em',
    color: isActive ? '#fff' : '#44474A',
    cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all .18s',
  };
}

// ─── 보관장소 편집 시트 ────────────────────────────────────────────────────────
interface LocationEditSheetProps {
  open: boolean;
  onClose: () => void;
  config: BoxConfig;
  onConfigChange: (c: BoxConfig) => void;
  locName: string;
  domain: string;
  products: Product[];
  userId: string;
}

function LocationEditSheet({
  open,
  onClose,
  config,
  onConfigChange,
  locName,
  domain,
  products,
  userId,
}: LocationEditSheetProps) {
  const f = "'Plus Jakarta Sans','Space Grotesk',sans-serif";
  const [nameVal, setNameVal] = useState('');
  const [photoVal, setPhotoVal] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Sync state with props when opened
  useEffect(() => {
    if (open) {
      setNameVal(locName);
      const locProducts = products.filter(p => p.boxLocation === locName);
      const existingPhoto = locProducts.find(p => p.storageImageUrl)?.storageImageUrl || '';
      setPhotoVal(existingPhoto);
    }
  }, [open, locName, products]);

  if (!open) return null;

  async function handleSave() {
    const trimmed = nameVal.trim();
    if (!trimmed) {
      alert('보관장소 이름을 입력해주세요.');
      return;
    }
    setSaving(true);
    try {
      const isNameChanged = trimmed !== locName;
      const existingProducts = products.filter(p => p.boxLocation === locName);

      // 1. Update name on all products in this location
      if (isNameChanged) {
        const batch = existingProducts.map(p =>
          updateDoc(doc(db!, 'users', userId, 'products', p.id), {
            boxLocation: trimmed,
            updatedAt: new Date().toISOString(),
          })
        );
        await Promise.all(batch);
      }

      // 2. Update photo on all products in this location (if photo changed or cleared)
      const currentPhoto = existingProducts.find(p => p.storageImageUrl)?.storageImageUrl || '';
      if (photoVal !== currentPhoto) {
        const targetProducts = products.filter(p => p.boxLocation === (isNameChanged ? trimmed : locName));
        const batch = targetProducts.map(p =>
          updateDoc(doc(db!, 'users', userId, 'products', p.id), {
            storageImageUrl: photoVal || null,
            updatedAt: new Date().toISOString(),
          })
        );
        await Promise.all(batch);
      }

      // 3. Update name in config
      if (isNameChanged) {
        const updatedConfig = { ...config };
        const locKey = domain;
        const currentLocs = getStorageLocs(config, locKey);
        const nextLocs = currentLocs.map(l => l === locName ? trimmed : l);

        updatedConfig.domainStorageLocations = {
          ...config.domainStorageLocations,
          [locKey]: nextLocs,
        };
        onConfigChange(updatedConfig);
      }

      onClose();
    } catch (err) {
      console.error('보관장소 수정 실패:', err);
      alert('보관장소 저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`"${locName}" 보관장소를 삭제하시겠습니까?\n이 위치에 저장된 제품들은 "위치 미지정" 상태로 변경됩니다.`)) return;
    setDeleting(true);
    try {
      // 1. Clear boxLocation and storageImageUrl on all products in this location
      const existingProducts = products.filter(p => p.boxLocation === locName);
      const batch = existingProducts.map(p =>
        updateDoc(doc(db!, 'users', userId, 'products', p.id), {
          boxLocation: null,
          storageImageUrl: null,
          updatedAt: new Date().toISOString(),
        })
      );
      await Promise.all(batch);

      // 2. Remove location from boxConfig
      const updatedConfig = { ...config };
      const locKey = domain;
      const currentLocs = getStorageLocs(config, locKey);
      const nextLocs = currentLocs.filter(l => l !== locName);

      updatedConfig.domainStorageLocations = {
        ...config.domainStorageLocations,
        [locKey]: nextLocs,
      };
      onConfigChange(updatedConfig);

      onClose();
    } catch (err) {
      console.error('보관장소 삭제 실패:', err);
      alert('보관장소 삭제에 실패했습니다.');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 110,
        background: 'rgba(0,0,0,.5)', backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%', maxWidth: 440, background: '#fff',
          borderRadius: '24px 24px 0 0', padding: '20px 26px calc(env(safe-area-inset-bottom,0px) + 24px)',
          display: 'flex', flexDirection: 'column', gap: 20,
          boxShadow: '0 -8px 32px rgba(0,0,0,.12)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* 상단 바 */}
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <div style={{ width: 36, height: 4, background: '#E5E7EB', borderRadius: 2 }} />
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontFamily: f, fontSize: 16, fontWeight: 800, color: '#0C0C0A' }}>📍 보관장소 관리</span>
          <button
            onClick={onClose}
            style={{ width: 30, height: 30, borderRadius: '50%', background: '#F4F4F0', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}
          >✕</button>
        </div>

        {/* 위치 이름 입력 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={labelStyle}>보관장소 이름</label>
          <input
            value={nameVal}
            onChange={e => setNameVal(e.target.value)}
            style={underlineInputStyle}
            placeholder="위치 이름 입력..."
          />
        </div>

        {/* 위치 사진 관리 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={labelStyle}>보관장소 사진</label>
          <ImagePicker
            preview={photoVal}
            onChange={(_, b64) => setPhotoVal(b64)}
            onClear={() => setPhotoVal('')}
            height={160}
            placeholderLabel="ADD LOCATION PHOTO"
          />
        </div>

        {/* 액션 버튼 */}
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button
            onClick={onClose}
            style={{ flex: 1, height: 48, background: '#fff', color: '#4A4846', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 10, fontFamily: f, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
          >
            취소
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{ flex: 1, height: 48, background: '#0C0C0A', color: '#fff', border: 'none', borderRadius: 10, fontFamily: f, fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: saving ? 0.5 : 1 }}
          >
            {saving ? '저장 중...' : '저장'}
          </button>
        </div>

        {/* 삭제 버튼 */}
        <button
          onClick={handleDelete}
          disabled={deleting}
          style={{ width: '100%', height: 44, background: 'transparent', border: '1.5px solid #EF4444', borderRadius: 10, fontFamily: f, fontSize: 12, fontWeight: 700, color: '#EF4444', cursor: 'pointer', opacity: deleting ? 0.5 : 1 }}
        >
          {deleting ? '삭제 중...' : '보관장소 삭제'}
        </button>
      </div>
    </div>
  );
}
