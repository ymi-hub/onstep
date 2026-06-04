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
import type { Product } from '@/types/product';
import PageHeader from '@/components/PageHeader';


// ─── BOX 설정 타입 ────────────────────────────────────────────────────────────
type SubTypeConfig = { id: string; label: string; cats: string[] };
type DomainConfig  = { id: string; label: string; subTypes?: SubTypeConfig[]; cats?: string[] };
type BoxConfig     = { domains: DomainConfig[] };

// 최초 접속 시 사용할 기본 설정값
const DEFAULT_BOX_CONFIG: BoxConfig = {
  domains: [
    {
      id: 'beauty', label: 'Beauty',
      subTypes: [
        { id: 'skincare', label: 'Skincare', cats: ['토너','에센스','세럼','크림','클렌저','선크림','마스크팩','아이크림','기타'] },
        { id: 'makeup',   label: 'Makeup',   cats: ['파운데이션','립','아이','블러셔','컨실러','기타'] },
      ],
    },
    { id: 'fashion', label: 'Fashion',  cats: ['상의','하의','아우터','신발','가방','모자','스카프','기타'] },
    { id: 'health',  label: '약·비타민', cats: ['비타민','영양제','미네랄','오메가3','프로바이오틱스','한약','건강기능식품','기타'] },
    { id: 'acc',     label: 'ACC',      cats: ['귀걸이','목걸이','팔찌','반지','시계','선글라스','기타'] },
  ],
};

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
    ? `약 ₩${cost.toFixed(1)}`
    : `약 ₩${Math.round(cost).toLocaleString()}`;
}

// 카테고리별 기본 1회 사용량 (벤치마킹 데이터 기반 표준값)
const CATEGORY_DOSE_DEFAULTS: Record<string, { dose: number; unit: string }> = {
  '세럼':     { dose: 0.3,  unit: 'ml' },
  '에센스':   { dose: 0.3,  unit: 'ml' },
  '크림':     { dose: 0.45, unit: 'ml' },
  '아이크림': { dose: 0.12, unit: 'ml' },
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
  daysPerWeek: 7,
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
  itemUnit: 'ml',
  usageDurationMonths: 0,
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
        style={{ padding: '16px 16px 0', cursor: 'pointer' }}
      >
        <MagImg product={hero} borderRadius={20} isHero />
        <div style={{ padding: '12px 0 4px' }}>
          {hero.brand && (
            <div style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 14, fontStyle: 'italic', color: '#0C0C0A', marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {hero.brand}
            </div>
          )}
          <div style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 14, fontWeight: 500, color: '#0C0C0A', marginBottom: 8, lineHeight: 1.3 }}>
            {hero.name}
          </div>
          <MagResBar product={hero} />
        </div>
      </div>

      {/* ── 3열 소형 카드 (design/box.html .mag-3col) ── */}
      {rest.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, padding: '12px 16px 0' }}>
          {rest.map((p) => (
            <div key={p.id} onClick={() => onEdit(p)} style={{ cursor: 'pointer' }}>
              <MagImg product={p} borderRadius={12} />
              <div style={{ padding: '6px 0 0' }}>
                {p.brand && (
                  <div style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 11, fontStyle: 'italic', color: '#0C0C0A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.brand}
                  </div>
                )}
                <div style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 12, fontWeight: 500, color: '#0C0C0A', lineHeight: 1.3, marginBottom: 6, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                  {p.name}
                </div>
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
  const hasRemaining = product.totalAmount > 0 && product.currentRemaining != null;
  const fillRate = hasRemaining ? Math.min(1, product.currentRemaining / product.totalAmount) : 1;
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
        ? <AdaptiveImg src={imgUrl} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
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
  const isCountMode = product.itemUnit === '개';
  const isSkincare = product.domain === 'beauty' && product.subCategory !== 'makeup';
  // 표시 조건: beauty skincare 또는 개 단위 제품
  if (!isSkincare && !isCountMode) return null;
  if (!product.totalAmount || product.currentRemaining == null) return null;

  const fillRate = Math.min(1, product.currentRemaining / product.totalAmount);
  const pct = Math.round(fillRate * 100);

  // D-N 계산: 하루 소모량이 있으면 남은 일수 표시
  const dailyUsage = (product.dosePerUse ?? 0) * (product.usesPerDay ?? 1) * ((product.frequencyValue ?? 7) / 7);
  const daysLeft = (dailyUsage > 0 && product.currentRemaining > 0)
    ? Math.floor(product.currentRemaining / dailyUsage)
    : null;

  return (
    <>
      <div style={{ height: 3, background: '#EEEDE9', borderRadius: 2, overflow: 'hidden', marginBottom: 4 }}>
        <div style={{ height: '100%', width: `${pct}%`, background: '#C5FF00', borderRadius: 2 }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 11, color: '#9A9490' }}>
        <span>
          {isCountMode
            ? `${product.currentRemaining}개 / ${product.totalAmount}개`
            : `${product.currentRemaining}${product.itemUnit || 'ml'} 남음`}
        </span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* D-N: 소모 주기가 있을 때만 */}
          {daysLeft !== null && (
            <span style={{ fontWeight: 700, color: daysLeft <= 7 ? '#E94F6B' : daysLeft <= 14 ? '#F97316' : '#9A9490' }}>
              D-{daysLeft}
            </span>
          )}
          {!isCountMode && calcCostPerUse(product) && <span>1회 {calcCostPerUse(product)}</span>}
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
  const isSkincare = product.domain === 'beauty' && product.subCategory !== 'makeup';
  const fillRate =
    product.totalAmount > 0
      ? Math.min(1, product.currentRemaining / product.totalAmount)
      : 1;

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
      {/* 배경 이미지 (있을 때만) */}
      {imgUrl && (
        <AdaptiveImg src={imgUrl} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
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
          padding: '22px 5px 4px',
          background: 'linear-gradient(transparent, rgba(0,0,0,.72))',
          fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
          fontSize: 11, fontWeight: 700, color: '#fff', letterSpacing: '.04em',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}
      >
        {product.name}
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
  const isSkincare = product.domain === 'beauty' && product.subCategory !== 'makeup';
  const fillRate = product.totalAmount > 0
    ? Math.min(1, product.currentRemaining / product.totalAmount)
    : 1;
  const pct = Math.round(fillRate * 100);
  const imgUrl = product.imageUrl ?? (product as Product & { storageUrl?: string }).storageUrl;

  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px',
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 3, flexWrap: 'wrap' }}>
          {product.category && (
            <div style={{ display: 'inline-block', fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: '#9A9490', background: '#F4F4F0', padding: '2px 5px', borderRadius: 3 }}>
              {resolveCategory(product.category)}
            </div>
          )}
          {isSkincare && calcCostPerUse(product) && (
            <div style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 10, color: '#9A9490' }}>
              1회 {calcCostPerUse(product)}
            </div>
          )}
        </div>
      </div>

      {/* 잔량 바 + 퍼센트 — 스킨케어(beauty)만 표시 */}
      {isSkincare && (
        <div style={{ width: 44, flexShrink: 0 }}>
          <div style={{ height: 3, background: '#EEEDE9', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pct}%`, background: '#C5FF00', borderRadius: 2 }} />
          </div>
          <div style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 11, color: '#9A9490', textAlign: 'right', marginTop: 2 }}>
            {pct}%
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
          padding: '10px 24px', background: '#0C0C0A', color: '#fff',
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
          itemUnit:        (a.itemUnit as string) || 'ea',
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

  // BOX 최상위 뷰: 제품 목록 vs 지출 분석
  const [boxView, setBoxView] = useState<'products' | 'spending'>('products');

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
        // 약·비타민 도메인 없으면 자동 추가
        const hasHealth = cfg.domains?.some(d => d.id === 'health');
        if (!hasHealth) {
          const healthDomain = DEFAULT_BOX_CONFIG.domains.find(d => d.id === 'health');
          if (healthDomain) {
            const updated = { ...cfg, domains: [...(cfg.domains ?? []), healthDomain] };
            setBoxConfig(updated);
            setDoc(ref, updated);
            return;
          }
        }
        setBoxConfig(cfg);
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
    if (!form.name.trim()) return;
    if (!db) { alert('.env.local에 Firebase 설정을 먼저 입력해주세요.'); return; }

    // 중복 이름 체크 (신규 등록 시, 전체 도메인 대상)
    if (!editingProduct) {
      const normInput = form.name.trim().normalize('NFC').toLowerCase()
        .replace(/\s+/g, ' ').replace(/[^\p{L}\p{N} ]/gu, '');
      const normProd = (n: string) =>
        n.trim().normalize('NFC').toLowerCase()
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
      // '개' 단위 + 총 사용 기간 입력 시: 기간에서 하루 소모량 역산 → 기존 urgency/CPD 로직과 호환
      const isCountMode = form.itemUnit === '개' && form.usageDurationMonths > 0;
      const derivedDosePerUse = isCountMode
        ? totalAmount / (form.usageDurationMonths * 30)   // 하루 소모량 (개/일)
        : form.dosePerUse;
      const derivedUsesPerDay  = isCountMode ? 1 : form.usesPerDay;
      const derivedFreqValue   = isCountMode ? 7 : form.daysPerWeek;
      const derivedFreqType    = isCountMode || form.daysPerWeek === 7 ? 'daily' : 'per_week';

      const commonFields = {
        name: form.name.trim(),
        brand: form.brand.trim() || null,
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
        price: form.price.trim() || null,
        source: form.source.trim() || null,
        purchaseUrl: form.purchaseUrl.trim() || null,
        ...(form.imagePreview ? { imageUrl: form.imagePreview } : {}),
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
      name: p.name,
      brand: p.brand ?? '',
      category: resolvedCategory,
      formDomain: (p.domain as string) || boxConfig.domains[0]?.id || 'beauty',
      formSubType: resolvedSubType,
      packageCount: p.packageCount ?? 1,
      unitPerPackage: p.unitPerPackage ?? 1,
      usesPerDay: p.usesPerDay ?? 1,
      dosePerUse: p.dosePerUse ?? 1,
      daysPerWeek: p.frequencyValue ?? 7,
      purchaseDate: p.purchaseDate ?? '',
      expiryDate: p.expiryDate ?? '',
      startDate: p.startDate ?? '',
      price: p.price ?? '',
      source: p.source ?? '',
      purchaseUrl: p.purchaseUrl ?? '',
      currentRemaining: p.currentRemaining ?? 0,
      imageFile: null,
      imagePreview: '',
      imageUrl: p.imageUrl ?? (p as Product & { storageUrl?: string }).storageUrl ?? '',
      itemUnit: (p.itemUnit as string) || 'ml',
      usageDurationMonths: p.usageDurationMonths ?? 0,
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

  function handleSubTypeChange(type: string) {
    setSubType(type);
    setActiveCategory('ALL');
  }

  return (
    <div style={{ background: '#FAFAF8', minHeight: '100%', position: 'relative' }}>
      {/* 비로그인 안내 */}
      {!authLoading && !user && (
        <div style={{ background: '#FEF3C7', color: '#92400E', padding: '8px 16px', fontSize: 13, borderBottom: '1px solid #FDE68A', display: 'flex', alignItems: 'center', gap: 8 }}>
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

      {/* ── 제품 / 지출 분석 상위 탭 ── */}
      <div style={{ display: 'flex', borderBottom: '1px solid rgba(12,12,10,.07)', background: 'rgba(255,255,255,.97)' }}>
        {(['products', 'spending'] as const).map(v => (
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
            {v === 'products' ? '제품' : '지출 분석'}
          </button>
        ))}
      </div>

      {/* ── 지출 분석 뷰 ── */}
      {boxView === 'spending' && (() => {
        const f = "'Plus Jakarta Sans','Space Grotesk',sans-serif";

        // 가격 있는 beauty 제품만 분석 대상
        const priced = products
          .filter(p => parsePrice(p.price) !== null)
          .map(p => {
            const price = parsePrice(p.price)!;
            const dailyUsage = (p.dosePerUse ?? 0) * (p.usesPerDay ?? 0) * ((p.frequencyValue ?? 7) / 7);
            // CPD: 하루 사용 비용
            const cpd = p.totalAmount && dailyUsage > 0
              ? (price / p.totalAmount) * dailyUsage
              : 0;
            // 총 사용 기간 (일)
            const totalDays = p.totalAmount && dailyUsage > 0
              ? Math.round(p.totalAmount / dailyUsage)
              : 0;
            return { ...p, price, cpd, totalDays };
          })
          .sort((a, b) => b.cpd - a.cpd);

        // 전체 월간 지출 합계 (CPD × 30)
        const monthlyTotal = priced.reduce((sum, p) => sum + p.cpd * 30, 0);

        // 전체 제품 총 구매가 합계
        const purchaseTotal = priced.reduce((sum, p) => sum + p.price, 0);

        if (priced.length === 0) {
          return (
            <div style={{ padding: '60px 16px', textAlign: 'center' }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>💰</div>
              <div style={{ fontFamily: f, fontSize: 14, fontWeight: 700, color: '#0C0C0A', marginBottom: 6 }}>가격 정보가 없어요</div>
              <div style={{ fontFamily: f, fontSize: 12, color: '#9A9490' }}>제품 편집에서 가격을 입력하면 분석이 시작됩니다</div>
            </div>
          );
        }

        return (
          <div style={{ padding: '16px 16px calc(env(safe-area-inset-bottom,0px) + 100px)' }}>
            {/* 요약 카드 */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
              {/* 월 추정 지출 */}
              <div style={{ flex: 1, background: '#0C0C0A', borderRadius: 14, padding: '14px 14px 12px' }}>
                <div style={{ fontFamily: f, fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,.5)', letterSpacing: '.06em', marginBottom: 4 }}>월 추정 지출</div>
                <div style={{ fontFamily: f, fontSize: 20, fontWeight: 800, color: '#C5FF00', lineHeight: 1 }}>
                  ₩{Math.round(monthlyTotal).toLocaleString()}
                </div>
                <div style={{ fontFamily: f, fontSize: 10, color: 'rgba(255,255,255,.4)', marginTop: 4 }}>CPD 합산 × 30일</div>
              </div>
              {/* 총 구매가 */}
              <div style={{ flex: 1, background: '#F5F4F2', borderRadius: 14, padding: '14px 14px 12px', border: '1px solid rgba(12,12,10,.08)' }}>
                <div style={{ fontFamily: f, fontSize: 10, fontWeight: 700, color: '#9A9490', letterSpacing: '.06em', marginBottom: 4 }}>제품 총 구매가</div>
                <div style={{ fontFamily: f, fontSize: 20, fontWeight: 800, color: '#0C0C0A', lineHeight: 1 }}>
                  ₩{Math.round(purchaseTotal).toLocaleString()}
                </div>
                <div style={{ fontFamily: f, fontSize: 10, color: '#BCBAB6', marginTop: 4 }}>{priced.length}개 제품</div>
              </div>
            </div>

            {/* CPD 섹션 헤더 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontFamily: f, fontSize: 12, fontWeight: 800, color: '#0C0C0A', letterSpacing: '.04em' }}>
                CPD 순위 (하루 소비 비용)
              </span>
              <span style={{ fontFamily: f, fontSize: 10, color: '#9A9490' }}>높은 순</span>
            </div>

            {/* 제품별 CPD 카드 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {priced.map((p, idx) => {
                // 이 제품의 CPD가 총합에서 차지하는 비율 (바 너비용)
                const maxCpd = priced[0].cpd;
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
                        </div>
                        {p.brand && (
                          <span style={{ fontFamily: f, fontSize: 11, color: '#9A9490' }}>{p.brand}</span>
                        )}
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontFamily: f, fontSize: 16, fontWeight: 800, color: '#0C0C0A' }}>
                          ₩{p.cpd < 10 ? p.cpd.toFixed(1) : Math.round(p.cpd).toLocaleString()}
                          <span style={{ fontSize: 10, fontWeight: 600, color: '#9A9490' }}>/일</span>
                        </div>
                        <div style={{ fontFamily: f, fontSize: 10, color: '#BCBAB6', marginTop: 1 }}>
                          ₩{Math.round(p.price).toLocaleString()} · {p.totalDays > 0 ? `${p.totalDays}일분` : '-'}
                        </div>
                      </div>
                    </div>
                    {/* CPD 상대 바 */}
                    <div style={{ height: 4, background: 'rgba(12,12,10,.07)', borderRadius: 9999, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${barWidth}%`, background: idx === 0 ? '#C5FF00' : '#0C0C0A', opacity: idx === 0 ? 1 : 0.25 + (0.6 * (1 - idx / priced.length)), borderRadius: 9999 }} />
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

      {/* 아래는 boxView === 'products' 일 때만 표시 */}
      {boxView === 'products' && <>

      {/* 도메인 탭 (Beauty / Fashion / Acc) */}
      {/* design/box.html .domain-tabs 구조 */}
      <div
        style={{
          display: 'flex',
          borderBottom: '1px solid rgba(12,12,10,.07)',
          position: 'sticky', top: 56, zIndex: 8,
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
            padding: '11px 14px 10px',
            fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
            fontSize: 15, fontWeight: 700,
            color: activeTab === 'all' ? '#0C0C0A' : '#9A9490',
            background: 'none', border: 'none', cursor: 'pointer',
            borderBottom: activeTab === 'all' ? '3px solid #C5FF00' : '3px solid transparent',
            transition: 'all .18s', lineHeight: 1,
          }}
        >
          ⊞
        </button>
      </div>

      {/* 검색 바 */}
      {/* design/box.html .box-search-bar */}
      <div
        style={{
          position: 'sticky', top: 97, zIndex: 7,
          background: 'rgba(255,255,255,.95)', backdropFilter: 'blur(14px)',
          WebkitBackdropFilter: 'blur(14px)',
          padding: '8px 16px', borderBottom: '1px solid rgba(12,12,10,.07)',
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
            position: 'sticky', top: 145, zIndex: 6,
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
            display: 'flex', gap: 6, padding: '10px 16px 8px',
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
        // beauty 도메인 제품 중 일일 소비량이 계산 가능하고 잔량이 7일 이하인 것만 필터
        const urgent = products
          .filter(p => p.domain === 'beauty')
          .map(p => {
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
          <div style={{ padding: '10px 16px 2px' }}>
            {/* 헤더 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <span style={{ fontSize: 13 }}>⚠️</span>
              <span style={{ fontFamily: f, fontSize: 11, fontWeight: 800, color: '#B45309', letterSpacing: '.06em' }}>
                소진 임박 — {urgent.length}개
              </span>
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
                    onClick={() => {
                      // 해당 제품의 도메인 탭으로 이동 + 편집 오픈
                      setActiveTab(p.domain ?? 'beauty');
                      setTimeout(() => {
                        const el = document.getElementById(`product-${p.id}`);
                        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      }, 100);
                    }}
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
            padding: '8px 16px 6px',
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1.5, paddingBottom: 100 }}>
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
                  padding: '8px 16px 6px',
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
        <div style={{ padding: '0 16px 16px', textAlign: 'center' }}>
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
        <div style={{ padding: '20px 16px 120px', display: 'flex', justifyContent: 'center' }}>
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

      {/* boxView === 'products' 블록 닫기 */}
      </>}

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
            padding: '12px 16px',
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
        <div style={{ padding: '12px 16px 0', flexShrink: 0 }}>
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
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px calc(env(safe-area-inset-bottom, 0px) + 40px)' }}>

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
                <button onClick={addDomain} style={{ padding: '9px 16px', borderRadius: 10, border: 'none', background: '#0C0C0A', color: '#C5FF00', fontFamily: f, fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>+ 추가</button>
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
                <button onClick={addCat} style={{ padding: '9px 16px', borderRadius: 10, border: 'none', background: '#0C0C0A', color: '#C5FF00', fontFamily: f, fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>+ 추가</button>
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
  onDelete?: () => void;
  onOpenCatEditor?: () => void;
}) {
  const isEditing = !!editingProduct;
  const isNameEmpty = !form.name.trim();

  // 소진 예측 계산
  // 기준 잔량: 편집 모드는 현재 잔량, 신규 등록은 총 용량
  const isCountMode = form.itemUnit === '개';
  // 현재 남은 수량: 편집이면 form 값, 신규+개수모드면 form 값(입력한 경우) 또는 총 수량
  const currentCount = isEditing
    ? form.currentRemaining
    : (isCountMode && form.currentRemaining > 0 ? form.currentRemaining : totalAmount);

  // 개수 모드 + 기간 입력: 총량/기간으로 하루 소모량 역산
  const countDailyRate = (isCountMode && form.usageDurationMonths > 0)
    ? totalAmount / (form.usageDurationMonths * 30)
    : null;
  const countWeeklyRate = countDailyRate !== null ? countDailyRate * 7 : null;

  // ml/g 모드 기존 계산 유지
  const baseForEstimate = isEditing ? form.currentRemaining : totalAmount;
  const dailyUsage = form.dosePerUse * form.usesPerDay * (form.daysPerWeek / 7);

  // 예상 소진일 (모드에 따라 분기)
  const estimatedDays = countDailyRate !== null
    ? (countDailyRate > 0 ? Math.round(currentCount / countDailyRate) : null)
    : (dailyUsage > 0 ? Math.round(baseForEstimate / dailyUsage) : null);

  // form state에서 domain/subType/cats 동적 계산
  const domain = form.formDomain;
  const subType = form.formSubType;
  const domainCfg = boxConfig.domains.find(d => d.id === domain);
  const cats = domainCfg ? getDomainCats(domainCfg, subType) : [];
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 파일 → Base64 변환 → 폼 상태 적용 (Storage 없이 Firestore에 직접 저장)
  async function applyImageFile(file: File) {
    try {
      const base64 = await imageFileToBase64(file);
      setForm((f) => ({ ...f, imageFile: file, imagePreview: base64 }));
    } catch (err) {
      console.error('[OnStep] imageFileToBase64 실패, FileReader 폴백:', err);
      if (file.size > 500 * 1024) {
        alert('이미지 파일이 너무 큽니다. 500KB 이하 파일을 선택해주세요.');
        return;
      }
      setForm((f) => ({ ...f, imageFile: file }));
      const reader = new FileReader();
      reader.onload = (ev) => {
        const r = ev.target?.result; if (typeof r === 'string') setForm((f) => ({ ...f, imagePreview: r }));
      };
      reader.onerror = () => { alert('이미지를 불러오지 못했습니다. 다른 파일을 선택해주세요.'); };
      reader.readAsDataURL(file);
    }
  }

  // 파일 input에서 선택
  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void applyImageFile(file);
  }

  // Ctrl/Cmd + V 클립보드 이미지 붙여넣기 (폼이 열려 있을 때만)
  useEffect(() => {
    if (!isOpen) return;
    function onPaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const blob = item.getAsFile();
          if (blob) {
            void applyImageFile(new File([blob], 'pasted-image.png', { type: blob.type }));
            e.preventDefault();
            break;
          }
        }
      }
    }
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [isOpen]);

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
          padding: '0 16px', flexShrink: 0,
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

        {/* ── 제품 이미지 — 220px 고정 영역 ── */}
        <div
          onClick={() => fileInputRef.current?.click()}
          style={{ width: '100%', height: 220, cursor: 'pointer', position: 'relative', background: '#F4F4F0', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' }}
        >
          {displayImg ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={displayImg} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
              <div style={{ position: 'absolute', bottom: 10, right: 10, display: 'flex', gap: 6 }}>
                <button
                  onClick={async (e) => { e.stopPropagation();
                    try {
                      const items = await navigator.clipboard.read();
                      for (const item of items) {
                        for (const type of item.types) {
                          if (type.startsWith('image/')) {
                            const blob = await item.getType(type);
                            void applyImageFile(new File([blob], 'pasted.png', { type }));
                            return;
                          }
                        }
                      }
                      alert('클립보드에 이미지가 없습니다.');
                    } catch { fileInputRef.current?.click(); }
                  }}
                  style={{ background: 'rgba(0,0,0,.55)', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 10px', fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                >📋 붙여넣기</button>
                <div style={{ background: 'rgba(0,0,0,.55)', color: '#fff', borderRadius: 6, padding: '5px 10px', fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 11, fontWeight: 700 }}>
                  사진 변경
                </div>
              </div>
            </>
          ) : (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 28, opacity: 0.2, marginBottom: 8 }}>✦</div>
              <div style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: '.1em', color: '#9A9490' }}>ADD PRODUCT IMAGE</div>
              <div style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 11, color: '#C4C2BE', marginTop: 4 }}>탭하여 갤러리/카메라 선택</div>
            </div>
          )}
          <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageChange} />
        </div>
        {/* 클립보드 붙여넣기 버튼 — 이미지 없을 때 */}
        {!displayImg && (
          <button
            onClick={async () => {
              try {
                const items = await navigator.clipboard.read();
                for (const item of items) {
                  for (const type of item.types) {
                    if (type.startsWith('image/')) {
                      const blob = await item.getType(type);
                      void applyImageFile(new File([blob], 'pasted.png', { type }));
                      return;
                    }
                  }
                }
                alert('클립보드에 이미지가 없습니다.');
              } catch { fileInputRef.current?.click(); }
            }}
            style={{ width: '100%', padding: '10px', border: '1.5px dashed rgba(12,12,10,.14)', background: 'transparent', fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 12, fontWeight: 700, color: '#9A9490', cursor: 'pointer' }}
          >📋 클립보드에서 붙여넣기</button>
        )}

        {/* ── 폼 콘텐츠 ── */}
        <div style={{ padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: 32 }}>

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
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="제품명"
                  style={{ ...underlineInputStyle, fontSize: 18, borderBottomColor: isNameEmpty ? '#C5C6CA' : '#6B7280' }}
                />
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
                          padding: '7px 16px 7px 0',
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
                            ...(f.category !== cat && def
                              ? { dosePerUse: def.dose, itemUnit: def.unit }
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

          {/* ── Asset Count 섹션 ── */}
          <div>
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
                        {isCountMode ? '박스 수' : '패키지 수'}
                      </div>
                      <div style={{ borderBottom: '1.5px solid #C5C6CA', paddingBottom: 4 }}>
                        <input
                          type="number" min={1}
                          value={form.packageCount || ''}
                          onChange={(e) => { const n = parseInt(e.target.value, 10); setForm((f) => ({ ...f, packageCount: isNaN(n) ? 0 : n })); }}
                          onBlur={() => setForm((f) => ({ ...f, packageCount: Math.max(1, f.packageCount || 1) }))}
                          style={countInputStyle}
                        />
                      </div>
                    </div>
                    <span style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 18, color: '#C5C6CA', paddingTop: 14 }}>×</span>
                    <div>
                      <div style={{ ...labelStyle, marginBottom: 4, fontSize: 10 }}>
                        {isCountMode ? '박스당 개수' : `패키지 용량 (${form.itemUnit})`}
                      </div>
                      <div style={{ borderBottom: '1.5px solid #C5C6CA', paddingBottom: 4 }}>
                        <input
                          type="number" min={0.1} step="any"
                          value={form.unitPerPackage || ''}
                          onChange={(e) => { const n = parseFloat(e.target.value); setForm((f) => ({ ...f, unitPerPackage: isNaN(n) ? 0 : n })); }}
                          onBlur={() => setForm((f) => ({ ...f, unitPerPackage: Math.max(0.1, f.unitPerPackage || 1) }))}
                          style={countInputStyle}
                        />
                      </div>
                    </div>
                  </div>
                  {/* 단위 선택 */}
                  <div style={{ display: 'flex', gap: 5, marginBottom: 8 }}>
                    {['ml', 'g', '개'].map((u) => (
                      <button key={u} onClick={() => setForm((f) => ({ ...f, itemUnit: u, usageDurationMonths: 0 }))} style={pillStyle(form.itemUnit === u)}>
                        {u}
                      </button>
                    ))}
                  </div>
                  {/* 총량 요약 */}
                  <div style={{ display: 'flex', alignItems: 'center', background: '#F5F5F3', borderRadius: 6, padding: '8px 12px' }}>
                    <span style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: '.08em', color: '#9CA3AF', textTransform: 'uppercase' }}>
                      {isCountMode ? '총 개수' : '총 용량'}
                    </span>
                    <span style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 16, fontWeight: 700, color: '#0C1014', marginLeft: 'auto' }}>
                      {totalAmount}{form.itemUnit}
                    </span>
                  </div>
                </div>

                {/* 시작일 */}
                <div>
                  <div style={labelStyle}>사용 시작일</div>
                  <input type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} style={dateInputStyle} />
                </div>

                {/* ── 현재 남은 수량: 개 모드는 신규도 표시 / ml 모드는 편집만 ── */}
                {(isCountMode || isEditing) && (
                  <div>
                    <div style={{ ...labelStyle, marginBottom: 6 }}>
                      {isCountMode ? '현재 남은 개수' : '현재 잔량'}
                    </div>
                    {isCountMode && !isEditing && (
                      <div style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 11, color: '#9CA3AF', marginBottom: 8 }}>
                        새 것이면 그대로 두세요 (총 {totalAmount}개). 이미 쓰던 것이면 남은 개수를 입력하세요.
                      </div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                      <input
                        type="number"
                        min={0}
                        value={isCountMode && !isEditing && form.currentRemaining === 0 ? totalAmount : form.currentRemaining}
                        onChange={(e) => setForm((f) => ({ ...f, currentRemaining: Math.max(0, Number(e.target.value)) }))}
                        style={{ ...countInputStyle, textAlign: 'left', fontSize: 22, width: 80 }}
                      />
                      <span style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 13, color: '#9A9490' }}>
                        {form.itemUnit} / {totalAmount}{form.itemUnit}
                      </span>
                    </div>
                    <div style={{ marginTop: 6, height: 4, background: '#EEEDE9', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{
                        height: '100%',
                        width: `${Math.min(100, (currentCount / Math.max(1, totalAmount)) * 100)}%`,
                        background: '#C5FF00', transition: 'width .3s',
                      }} />
                    </div>
                  </div>
                )}

                {/* ── 소비 패턴 섹션: 개 모드 vs ml 모드 ── */}
                {isCountMode ? (
                  /* 개수 모드: 총 사용 기간으로 역산 */
                  <div>
                    <div style={{ ...labelStyle, marginBottom: 2 }}>소진 예측 (선택)</div>
                    <div style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 11, color: '#9CA3AF', marginBottom: 14 }}>
                      총 기간을 알면 하루·주간 소모량이 자동 계산됩니다
                    </div>

                    {/* 총 사용 기간 입력 */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                      <span style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 13, color: '#44474A', whiteSpace: 'nowrap' as const }}>
                        총 {totalAmount}개로
                      </span>
                      <div style={{ borderBottom: '1.5px solid #C5C6CA', paddingBottom: 4, width: 70 }}>
                        <input
                          type="number" min={1}
                          placeholder="—"
                          value={form.usageDurationMonths || ''}
                          onChange={(e) => { const n = parseInt(e.target.value, 10); setForm((f) => ({ ...f, usageDurationMonths: isNaN(n) ? 0 : n })); }}
                          style={{ ...countInputStyle, width: '100%', textAlign: 'center' }}
                        />
                      </div>
                      <span style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 13, color: '#44474A', whiteSpace: 'nowrap' as const }}>
                        개월 사용
                      </span>
                    </div>

                    {/* 자동 계산 결과 */}
                    {form.usageDurationMonths > 0 && countDailyRate !== null && (
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
                    {estimatedDays !== null && (
                      <div style={{ background: '#F5F5F3', borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: '.08em', color: '#9CA3AF', textTransform: 'uppercase' }}>예상 소진</span>
                        <span style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 15, fontWeight: 700, color: '#0C1014' }}>
                          약 {estimatedDays}일 후
                        </span>
                      </div>
                    )}
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
                )}
              </div>
          </div>

          {/* ── 취소 / 저장 ── */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={onClose}
              style={{ flex: 1, height: 52, background: '#fff', color: '#0C1014', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 12, fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 15, cursor: 'pointer' }}
            >
              취소
            </button>
            <button
              onClick={onSave}
              disabled={saving || isNameEmpty}
              style={{
                flex: 1, height: 52,
                background: isNameEmpty ? '#D8D6CF' : '#0C0C0A',
                color: '#fff', border: 'none', borderRadius: 12,
                fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif",
                fontSize: 15, fontWeight: 700, cursor: isNameEmpty ? 'default' : 'pointer',
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
