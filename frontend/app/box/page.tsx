// app/box/page.tsx — BOX 페이지 (제품 인벤토리)
// Stage 3: 제품 목록 표시 + 추가/삭제 + Firestore CRUD
//
// 💡 이 파일의 구조:
//   1. 상수 정의 (카테고리 목록)
//   2. 작은 UI 컴포넌트 (Appbar, ProductCard, EmptyState)
//   3. 메인 BoxPage — 상태 관리 + Firestore 연동
//   4. AddProductPage — 제품 등록 전체 화면 폼

'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  collection,
  query,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  orderBy,
  getDoc,
  getDocs,
} from 'firebase/firestore';
import {
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  type User,
} from 'firebase/auth';
import { db, auth } from '@/lib/firebase';
import type { Product } from '@/types/product';
import UserMenuButton from '@/components/UserMenuButton';

const FALLBACK_USER_ID = 'demo-user';

// ─── 카테고리 상수 ────────────────────────────────────────────────────────────
// design/box.html의 카테고리 구조를 그대로 반영
const BEAUTY_CATS: Record<'skincare' | 'makeup', string[]> = {
  skincare: ['토너', '에센스', '세럼', '크림', '클렌저', '선크림', '마스크팩', '아이크림', '기타'],
  makeup:   ['파운데이션', '립', '아이', '블러셔', '컨실러', '기타'],
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
  packageCount: number;    // 패키지 수 (박스)
  unitPerPackage: number;  // 패키지당 수량
  usesPerDay: number;      // 하루 사용 횟수
  daysPerWeek: number;     // 사용 주기 (주당 일수)
  purchaseDate: string;    // 구매일 (YYYY-MM-DD)
  expiryDate: string;      // 유통기한
  startDate: string;       // 사용 시작일
};

const INITIAL_FORM: FormState = {
  name: '',
  brand: '',
  category: '',
  packageCount: 1,
  unitPerPackage: 1,
  usesPerDay: 1,
  daysPerWeek: 7,
  purchaseDate: '',
  expiryDate: '',
  startDate: '',
};

// ─── Appbar ──────────────────────────────────────────────────────────────────
function Appbar({ user, onLogin, onLogout }: { user: User | null; onLogin: () => void; onLogout: () => void }) {
  return (
    <div
      style={{
        padding: '0 16px',
        height: 56,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: 'rgba(250,250,248,.92)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        position: 'sticky',
        top: 0,
        zIndex: 10,
        borderBottom: '1px solid rgba(12,12,10,.07)',
      }}
    >
      {/* 햄버거 메뉴 */}
      <button
        style={{ width: 22, display: 'flex', flexDirection: 'column', gap: 5, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        aria-label="메뉴"
      >
        <span style={{ display: 'block', height: 1.5, background: '#0C0C0A', borderRadius: 2 }} />
        <span style={{ display: 'block', height: 1.5, background: '#0C0C0A', borderRadius: 2, width: '68%' }} />
        <span style={{ display: 'block', height: 1.5, background: '#0C0C0A', borderRadius: 2 }} />
      </button>

      {/* 로고 (홈 링크) */}
      <Link
        href="/"
        style={{
          fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
          fontSize: 15, fontWeight: 700, letterSpacing: '0.01em', color: '#0C0C0A',
          display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none',
        }}
      >
        <span
          style={{
            width: 24, height: 24, borderRadius: 8, background: '#0C0C0A',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#C5FF00', fontSize: 10, fontWeight: 800,
          }}
        >
          OS
        </span>
        OnStep
      </Link>

      <UserMenuButton user={user} onLogin={onLogin} onLogout={onLogout} />
    </div>
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
  // 잔량 비율 계산 (0~1): 총량 대비 현재 잔량
  const fillRate =
    product.totalAmount > 0
      ? Math.min(1, product.currentRemaining / product.totalAmount)
      : 1;

  // 잔량 상태에 따라 색상 변경
  // fresh(>50%) = 라임 그린, mid(20~50%) = 주황, low(<20%) = 빨강
  const fillColor =
    fillRate > 0.5 ? '#C5FF00' : fillRate > 0.2 ? '#B45309' : '#D93025';

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
      {/* 상단 잔량 바 */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'rgba(255,255,255,.15)' }}>
        <div style={{ height: '100%', width: `${fillRate * 100}%`, background: fillColor }} />
      </div>

      {/* 제품 플레이스홀더 (이미지 없을 때) */}
      <span style={{ fontSize: 24, opacity: 0.15 }}>✦</span>

      {/* 하단 제품명 바 (그라데이션 오버레이) */}
      <div
        style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          padding: '22px 5px 4px',
          background: 'linear-gradient(transparent, rgba(0,0,0,.65))',
          fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
          fontSize: 11, fontWeight: 700, color: '#fff', letterSpacing: '.04em',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}
      >
        {product.name}
      </div>

      {/* 잔량 낮음 경고 뱃지 */}
      {fillRate < 0.2 && (
        <div
          style={{
            position: 'absolute', top: 4, right: 4,
            background: '#D93025', color: '#fff',
            borderRadius: 3, fontSize: 11, fontWeight: 700, padding: '2px 4px',
          }}
        >
          LOW
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

// ─── 구 box.html catKey → 한국어 카테고리 매핑 ───────────────────────────────
const CAT_KEY_MAP: Record<string, string> = {
  toner: '토너', essence: '에센스', serum: '세럼', cream: '크림',
  cleanser: '클렌저', suncare: '선크림', mask: '마스크팩', eye: '아이크림',
  foundation: '파운데이션', lip: '립', eye_makeup: '아이',
  blush: '블러셔', concealer: '컨실러',
};

// 구 box.html의 users/{uid}/box/data.assets 배열을
// 신 users/{uid}/products 컬렉션으로 마이그레이션
async function migrateOldBoxAssets(uid: string): Promise<number> {
  if (!db) return 0;
  try {
    // 이미 신규 products가 있으면 마이그레이션 스킵
    const existing = await getDocs(collection(db, 'users', uid, 'products'));
    if (!existing.empty) return 0;

    // 구 box/data 문서 읽기
    const oldSnap = await getDoc(doc(db, 'users', uid, 'box', 'data'));
    if (!oldSnap.exists()) return 0;

    const assets: Record<string, unknown>[] = (oldSnap.data().assets ?? []);
    if (!assets.length) return 0;

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
          createdAt:       (a.addedDate as string) || now,
          updatedAt:       now,
        })
      )
    );
    return assets.length;
  } catch (e) {
    console.error('[OnStep] 마이그레이션 오류:', e);
    return 0;
  }
}

// ─── 메인 BOX 페이지 ─────────────────────────────────────────────────────────
export default function BoxPage() {
  // ── 인증 상태 ──
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  // 제품 데이터 상태
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  // 필터 상태
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'beauty' | 'fashion' | 'acc'>('beauty');
  const [subType, setSubType] = useState<'skincare' | 'makeup'>('skincare');
  const [activeCategory, setActiveCategory] = useState('ALL');

  // 제품 추가/편집 폼 열림/닫힘
  const [isAddOpen, setIsAddOpen] = useState(false);
  // 편집 중인 제품 (null = 신규 추가)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  // 폼 상태
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [saving, setSaving] = useState(false);

  // 마이그레이션 완료 알림
  const [migratedCount, setMigratedCount] = useState(0);

  // 현재 userId: 로그인된 UID, 없으면 fallback
  const userId = user?.uid ?? FALLBACK_USER_ID;

  // ── Firebase Auth 감지 ──
  useEffect(() => {
    if (!auth) { setAuthLoading(false); return; }
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
      if (!u) setProducts([]);
    });
    return () => unsub();
  }, []);

  // ── Firestore 실시간 구독 ──────────────────────────────────────────────────
  // 로그인된 상태에서만 구독 (비로그인 시 Firestore 접근 차단)
  useEffect(() => {
    if (authLoading || !user) {
      setLoading(false);
      return;
    }
    if (!db) {
      setLoading(false);
      return;
    }

    const q = query(
      collection(db, 'users', userId, 'products'),
      orderBy('createdAt', 'desc')
    );

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<Product, 'id'>),
        }));
        setProducts(data);
        setLoading(false);
      },
      (err) => {
        console.error('Firestore 구독 오류:', err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [userId, authLoading]);

  // ── 구 box.html → 신 products 마이그레이션 ────────────────────────────────
  // 로그인 후 products 컬렉션이 비어있으면 한 번만 실행
  useEffect(() => {
    if (!user) return;
    migrateOldBoxAssets(user.uid).then((count) => {
      if (count > 0) setMigratedCount(count);
    });
  }, [user]);

  // ── 필터링된 제품 목록 ────────────────────────────────────────────────────
  const filtered = products.filter((p) => {
    // 도메인 필터
    if (p.domain !== activeTab) return false;
    // 뷰티 서브타입 필터
    if (activeTab === 'beauty' && p.subCategory && p.subCategory !== subType) return false;
    // 카테고리 필터
    if (activeCategory !== 'ALL' && p.category !== activeCategory) return false;
    // 검색어 필터
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const nameMatch = p.name.toLowerCase().includes(q);
      const brandMatch = (p.brand ?? '').toLowerCase().includes(q);
      if (!nameMatch && !brandMatch) return false;
    }
    return true;
  });

  // ── 현재 탭의 카테고리 칩 목록 ──────────────────────────────────────────
  const cats = activeTab === 'beauty' ? BEAUTY_CATS[subType] : [];

  // ── 총 수량 자동 계산 ────────────────────────────────────────────────────
  const totalAmount = form.packageCount * form.unitPerPackage;

  // ── 제품 저장 (신규 추가 or 기존 수정) ──────────────────────────────────
  async function handleSave() {
    if (!form.name.trim()) return;
    if (!db) { alert('.env.local에 Firebase 설정을 먼저 입력해주세요.'); return; }
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const commonFields = {
        name: form.name.trim(),
        brand: form.brand.trim() || null,
        category: form.category || null,
        packageCount: form.packageCount,
        unitPerPackage: form.unitPerPackage,
        itemUnit: '개',
        totalAmount,
        dosePerUse: 1,
        usesPerDay: form.usesPerDay,
        frequencyType: form.daysPerWeek === 7 ? 'daily' : 'per_week',
        frequencyValue: form.daysPerWeek,
        purchaseDate: form.purchaseDate || null,
        startDate: form.startDate || null,
        expiryDate: form.expiryDate || null,
        updatedAt: now,
      };

      if (editingProduct) {
        // 기존 제품 수정 — currentRemaining·createdAt은 유지
        await updateDoc(doc(db, 'users', userId, 'products', editingProduct.id), commonFields);
      } else {
        // 신규 제품 추가
        await addDoc(collection(db, 'users', userId, 'products'), {
          ...commonFields,
          domain: activeTab,
          subCategory: activeTab === 'beauty' ? subType : null,
          currentRemaining: totalAmount,
          createdAt: now,
        });
      }

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
    setForm({
      name: p.name,
      brand: p.brand ?? '',
      category: p.category ?? '',
      packageCount: p.packageCount ?? 1,
      unitPerPackage: p.unitPerPackage ?? 1,
      usesPerDay: p.usesPerDay ?? 1,
      daysPerWeek: p.frequencyValue ?? 7,
      purchaseDate: p.purchaseDate ?? '',
      expiryDate: p.expiryDate ?? '',
      startDate: p.startDate ?? '',
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
  function handleTabChange(tab: 'beauty' | 'fashion' | 'acc') {
    setActiveTab(tab);
    setActiveCategory('ALL');
  }

  function handleSubTypeChange(type: 'skincare' | 'makeup') {
    setSubType(type);
    setActiveCategory('ALL');
  }

  const handleLogin = async () => {
    if (!auth) { alert('Firebase가 설정되지 않았습니다.'); return; }
    setAuthError(null);
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, provider);
    } catch (err: unknown) {
      const error = err as { code?: string; message?: string };
      console.error('[OnStep] 로그인 실패:', error);
      // 에러를 화면에 표시해 원인 파악
      setAuthError(`로그인 실패: ${error.code ?? error.message}`);
    }
  };
  const handleLogout = async () => {
    if (!auth) return;
    try { await signOut(auth); setProducts([]); }
    catch (err) { console.error('[OnStep] 로그아웃 실패:', err); }
  };

  return (
    <div style={{ background: '#FAFAF8', minHeight: '100%', position: 'relative' }}>
      {/* 앱바 */}
      <Appbar user={user} onLogin={handleLogin} onLogout={handleLogout} />

      {/* 로그인 에러 표시 */}
      {authError && (
        <div style={{ background: '#FEE2E2', color: '#991B1B', padding: '10px 16px', fontSize: 13, borderBottom: '1px solid #FCA5A5' }}>
          {authError}
          <button onClick={() => setAuthError(null)} style={{ marginLeft: 12, background: 'none', border: 'none', cursor: 'pointer', color: '#991B1B', fontWeight: 700 }}>✕</button>
        </div>
      )}

      {/* 마이그레이션 완료 배너 */}
      {migratedCount > 0 && (
        <div style={{ background: '#D1FAE5', color: '#065F46', padding: '8px 16px', fontSize: 13, borderBottom: '1px solid #6EE7B7', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>이전에 등록한 제품 {migratedCount}개를 가져왔어요 ✓</span>
          <button onClick={() => setMigratedCount(0)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#065F46', fontWeight: 700 }}>✕</button>
        </div>
      )}

      {/* 비로그인 안내 */}
      {!authLoading && !user && (
        <div style={{ background: '#FEF3C7', color: '#92400E', padding: '8px 16px', fontSize: 13, borderBottom: '1px solid #FDE68A', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>Google 로그인 후 제품을 관리할 수 있습니다.</span>
        </div>
      )}

      {/* 페이지 히어로 (design/box.html .page-hero 참고) */}
      <div style={{ padding: '20px 16px 6px' }}>
        {/* 상위 레이블 */}
        <div
          style={{
            fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
            fontSize: 11, fontWeight: 600, letterSpacing: '.16em',
            textTransform: 'uppercase', color: '#9A9490', marginBottom: 4,
          }}
        >
          Inventory
        </div>

        {/* 타이틀 + 제품 수 */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 6 }}>
          {/* "Box" 대형 타이틀 — design에서 fontSize 60, fontWeight 900 */}
          <div
            style={{
              fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
              fontSize: 60, fontWeight: 900, color: '#0C0C0A',
              lineHeight: 0.9, letterSpacing: '-.02em',
            }}
          >
            Box
          </div>
          <div
            style={{
              fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
              fontSize: 12, fontWeight: 600, color: '#9A9490', paddingBottom: 6,
            }}
          >
            {products.length} assets
          </div>
        </div>

        {/* 서브 텍스트 */}
        <div
          style={{
            fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
            fontSize: 12, color: '#9A9490', paddingBottom: 18,
          }}
        >
          화장대와 옷장 아이템 정리
        </div>
      </div>

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
        {(['beauty', 'fashion', 'acc'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => handleTabChange(tab)}
            style={{
              flex: 1, textAlign: 'center', padding: '11px 14px 10px',
              fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
              fontSize: 13, fontWeight: 700, letterSpacing: '.02em', textTransform: 'uppercase',
              color: activeTab === tab ? '#0C0C0A' : '#9A9490',
              background: 'none', border: 'none', cursor: 'pointer',
              borderBottom: activeTab === tab ? '3px solid #C5FF00' : '3px solid transparent',
              transition: 'all .18s',
            }}
          >
            {/* 활성 탭에는 '#' 접두사 (design의 .domain-tab.active::before{content:'#'} 구현) */}
            {activeTab === tab ? `#${tab}` : tab}
          </button>
        ))}
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

      {/* Beauty 서브타입 탭 (Skincare / Makeup) */}
      {/* design/box.html .subtype-row — Beauty 탭일 때만 표시 */}
      {activeTab === 'beauty' && (
        <div
          style={{
            display: 'flex',
            borderBottom: '1px solid rgba(12,12,10,.07)',
            background: 'rgba(255,255,255,.94)', backdropFilter: 'blur(14px)',
            WebkitBackdropFilter: 'blur(14px)',
            position: 'sticky', top: 145, zIndex: 6,
          }}
        >
          {(['skincare', 'makeup'] as const).map((type) => (
            <button
              key={type}
              onClick={() => handleSubTypeChange(type)}
              style={{
                padding: '9px 18px 8px',
                fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
                fontSize: 12, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase',
                color: subType === type ? '#0C0C0A' : '#9A9490',
                background: 'none', border: 'none', cursor: 'pointer',
                borderBottom: subType === type ? '2px solid #C5FF00' : '2px solid transparent',
                transition: 'all .18s',
              }}
            >
              {type === 'skincare' ? 'Skincare' : 'Makeup'}
            </button>
          ))}
        </div>
      )}

      {/* 카테고리 칩 (Beauty 탭일 때만 표시) */}
      {activeTab === 'beauty' && (
        <div
          style={{
            display: 'flex', gap: 6, padding: '10px 16px 8px',
            overflowX: 'auto', scrollbarWidth: 'none',
            borderBottom: '1px solid rgba(12,12,10,.07)',
          }}
        >
          {/* 'ALL' 칩 + 카테고리 칩 목록 */}
          {['ALL', ...cats].map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              style={{
                flexShrink: 0, padding: '5px 12px', borderRadius: 9999,
                border: `1.5px solid ${activeCategory === cat ? '#0C0C0A' : 'rgba(12,12,10,.14)'}`,
                background: activeCategory === cat ? '#0C0C0A' : 'transparent',
                fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
                fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase',
                color: activeCategory === cat ? '#fff' : '#4A4846',
                cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all .18s',
              }}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {/* 제품 목록 영역 */}
      {loading ? (
        // 로딩 중 표시
        <div
          style={{
            padding: '48px 16px', textAlign: 'center', color: '#9A9490',
            fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif", fontSize: 13,
          }}
        >
          로딩 중...
        </div>
      ) : filtered.length === 0 ? (
        // 빈 상태 — 제품이 없을 때
        <EmptyState onAdd={() => setIsAddOpen(true)} />
      ) : (
        // 갤러리 그리드 (3열)
        // design/box.html .gallery-grid: grid-template-columns repeat(3,1fr), gap 1.5px
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 1.5,
            paddingBottom: 100,
          }}
        >
          {filtered.map((p) => (
            <ProductCard
              key={p.id}
              product={p}
              onClick={() => openEdit(p)}
            />
          ))}
        </div>
      )}

      {/* FAB — 우측 하단 고정 + 버튼 */}
      {/* design/box.html .fab: position absolute bottom 88px right 18px */}
      {!isAddOpen && (
        <button
          onClick={() => setIsAddOpen(true)}
          style={{
            position: 'fixed', bottom: 88, right: 18, zIndex: 40,
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

      {/* 제품 추가/편집 전체 화면 오버레이 */}
      <AddProductPage
        isOpen={isAddOpen}
        onClose={() => { setIsAddOpen(false); setEditingProduct(null); setForm(INITIAL_FORM); }}
        domain={activeTab}
        subType={subType}
        form={form}
        setForm={setForm}
        totalAmount={totalAmount}
        cats={cats}
        onSave={handleSave}
        saving={saving}
        editingProduct={editingProduct}
        onDelete={editingProduct ? () => { handleDelete(editingProduct.id); setIsAddOpen(false); setEditingProduct(null); } : undefined}
      />
    </div>
  );
}

// ─── 제품 추가 전체 화면 폼 ───────────────────────────────────────────────────
// design/box.html .add-page 구조 — 아래에서 위로 슬라이드 업 애니메이션
function AddProductPage({
  isOpen,
  onClose,
  domain,
  subType,
  form,
  setForm,
  totalAmount,
  cats,
  onSave,
  saving,
  editingProduct,
  onDelete,
}: {
  isOpen: boolean;
  onClose: () => void;
  domain: 'beauty' | 'fashion' | 'acc';
  subType: 'skincare' | 'makeup';
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  totalAmount: number;
  cats: string[];
  onSave: () => void;
  saving: boolean;
  editingProduct: Product | null;
  onDelete?: () => void;
}) {
  const isEditing = !!editingProduct;
  const isNameEmpty = !form.name.trim();

  return (
    <div
      style={{
        // 앱 컨테이너(430px) 안에 고정
        position: 'fixed',
        top: 0, bottom: 0,
        left: 'max(0px,calc(50vw - 215px))',
        right: 'max(0px,calc(50vw - 215px))',
        zIndex: 60,
        background: '#FFFFFF',
        // translateY(100%) = 화면 밖 (아래), translateY(0) = 화면 안
        transform: isOpen ? 'translateY(0)' : 'translateY(100%)',
        transition: 'transform .38s cubic-bezier(.4,0,.2,1)',
        overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
      }}
    >
      {/* ── 상단 앱바 ── */}
      <div
        style={{
          height: 65, background: 'rgba(255,255,255,.92)',
          backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
          borderBottom: '1px solid rgba(12,12,10,.07)',
          display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
          padding: '0 16px 12px', flexShrink: 0,
        }}
      >
        {/* 뒤로 가기 버튼 */}
        <button
          onClick={onClose}
          style={{
            width: 36, height: 36, border: 'none', background: 'none',
            cursor: 'pointer', color: '#0C0C0A',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {/* 왼쪽 화살표 아이콘 */}
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
        </button>

        {/* 제목 */}
        <span
          style={{
            fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
            fontSize: 11, fontWeight: 700, letterSpacing: '.14em',
            textTransform: 'uppercase', color: '#44474A',
          }}
        >
          {isEditing ? 'EDIT PRODUCT' : 'ADD PRODUCT'}
        </span>

        {/* 우측 빈 공간 (대칭 맞추기) */}
        <div style={{ width: 36 }} />
      </div>

      {/* ── 스크롤 콘텐츠 영역 ── */}
      <div
        style={{
          flex: 1, overflowY: 'auto',
          padding: '24px 16px 96px',
          display: 'flex', flexDirection: 'column', gap: 32,
        }}
      >

        {/* 헤더 */}
        <div>
          {/* design의 .add-page-title 스타일 */}
          <div
            style={{
              fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
              fontSize: 32, fontWeight: 600, letterSpacing: '-0.02em',
              color: '#0C1014', lineHeight: '38px', marginBottom: 4,
            }}
          >
            {isEditing ? 'EDIT PRODUCT' : 'ADD PRODUCT'}
          </div>
          <div
            style={{
              fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
              fontSize: 14, color: '#44474A',
            }}
          >
            {isEditing ? `"${editingProduct!.name}" 정보를 수정하세요.` : '제품 정보를 입력해 인벤토리에 등록하세요.'}
          </div>
        </div>

        {/* ── 구매 내역 섹션 ── */}
        {/* design의 "Purchase history" Newsreader italic 스타일 */}
        <div>
          <div
            style={{
              fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
              fontStyle: 'italic', fontWeight: 400,
              fontSize: 32, lineHeight: '38px', color: '#1A1C1C', marginBottom: 8,
            }}
          >
            Purchase history
          </div>

          <div
            style={{
              borderTop: '1px solid #C5C6CA', paddingTop: 25,
              display: 'flex', flexDirection: 'column', gap: 16,
            }}
          >
            {/* 구매일 + 유통기한 (2열) */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div>
                <div style={labelStyle}>구매일</div>
                <input
                  type="date"
                  value={form.purchaseDate}
                  onChange={(e) => setForm((f) => ({ ...f, purchaseDate: e.target.value }))}
                  style={dateInputStyle}
                />
              </div>
              <div>
                <div style={labelStyle}>유통기한</div>
                <input
                  type="date"
                  value={form.expiryDate}
                  onChange={(e) => setForm((f) => ({ ...f, expiryDate: e.target.value }))}
                  style={dateInputStyle}
                />
              </div>
            </div>

            {/* 제품명 (필수) */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={labelStyle}>PRODUCT NAME</div>
                <div
                  style={{
                    fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
                    fontSize: 11, color: '#44474A', opacity: 0.7,
                  }}
                >
                  *필수
                </div>
              </div>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="제품명"
                style={{
                  ...underlineInputStyle,
                  fontSize: 18,
                  borderBottomColor: isNameEmpty ? '#C5C6CA' : '#6B7280',
                }}
              />
            </div>

            {/* 브랜드 + 도메인 (2열) */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div>
                <div style={labelStyle}>BRAND NAME</div>
                <input
                  value={form.brand}
                  onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))}
                  placeholder="브랜드명"
                  style={{ ...underlineInputStyle, fontSize: 15 }}
                />
              </div>
              <div>
                <div style={labelStyle}>DOMAIN</div>
                {/* 현재 선택된 도메인 표시 (BOX 탭 기준으로 이미 선택됨) */}
                <div
                  style={{
                    paddingTop: 10,
                    fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
                    fontSize: 13, fontWeight: 700, color: '#0C0C0A', textTransform: 'uppercase',
                  }}
                >
                  {domain === 'beauty' ? `Beauty · ${subType}` : domain}
                </div>
              </div>
            </div>

            {/* 카테고리 (Beauty 탭일 때만 표시) */}
            {domain === 'beauty' && cats.length > 0 && (
              <div>
                <div
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    borderBottom: '1px solid #C5C6CA', paddingBottom: 4, marginBottom: 12,
                  }}
                >
                  <div style={labelStyle}>PRIMARY CLASSIFICATION</div>
                </div>
                {/* 카테고리 칩 (선택/해제 토글) */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {cats.map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setForm((f) => ({ ...f, category: f.category === cat ? '' : cat }))}
                      style={{
                        height: 22, padding: '0 16px',
                        border: `1px solid ${form.category === cat ? '#000' : '#C5C6CA'}`,
                        background: form.category === cat ? '#000000' : 'transparent',
                        fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
                        fontSize: 12, fontWeight: 600, letterSpacing: '.6px', textTransform: 'uppercase',
                        color: form.category === cat ? '#FFFFFF' : '#44474A',
                        cursor: 'pointer', display: 'flex', alignItems: 'center', transition: 'all .15s',
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

        {/* ── 재고 / 수량 섹션 (Beauty Skincare 전용) ── */}
        {/* 뷰티 스킨케어에서만 수량/사용 패턴 입력 */}
        {domain === 'beauty' && subType === 'skincare' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {/* 섹션 제목 */}
            <div
              style={{
                fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
                fontSize: 24, fontWeight: 400, lineHeight: '31px',
                letterSpacing: '-0.48px', color: '#1A1C1C', marginBottom: 16,
              }}
            >
              Asset Count
            </div>

            {/* 수량 구조 (패키지 수 × 수량 = 총량) */}
            <div style={{ marginBottom: 24 }}>
              <div style={{ ...labelStyle, marginBottom: 14 }}>수량 구조</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
                {/* 패키지 수 */}
                <div>
                  <div style={{ ...labelStyle, marginBottom: 6 }}>패키지 수 · 박스</div>
                  <div style={{ borderBottom: '1.5px solid #C5C6CA', paddingBottom: 4 }}>
                    <input
                      type="number"
                      min={1}
                      value={form.packageCount}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, packageCount: Math.max(1, Number(e.target.value)) }))
                      }
                      style={countInputStyle}
                    />
                  </div>
                </div>
                {/* 패키지당 수량 */}
                <div>
                  <div style={{ ...labelStyle, marginBottom: 6 }}>수량 · 개</div>
                  <div style={{ borderBottom: '1.5px solid #C5C6CA', paddingBottom: 4 }}>
                    <input
                      type="number"
                      min={1}
                      value={form.unitPerPackage}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, unitPerPackage: Math.max(1, Number(e.target.value)) }))
                      }
                      style={countInputStyle}
                    />
                  </div>
                </div>
              </div>

              {/* 총 수량 자동 계산 미리보기 */}
              {/* design: #qty-calc-preview 카드 */}
              <div
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: '#F5F5F3', borderRadius: 6, padding: '9px 12px',
                }}
              >
                <span
                  style={{
                    fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
                    fontSize: 11, fontWeight: 700, letterSpacing: '.1em',
                    textTransform: 'uppercase', color: '#9CA3AF',
                  }}
                >
                  총 수량
                </span>
                <span
                  style={{
                    fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
                    fontSize: 16, fontWeight: 700, color: '#0C1014', marginLeft: 'auto',
                  }}
                >
                  {totalAmount}개
                </span>
              </div>
            </div>

            {/* 사용 시작일 */}
            <div style={{ marginBottom: 24 }}>
              <div style={{ ...labelStyle, marginBottom: 12 }}>사용 기간</div>
              <div>
                <div style={{ ...labelStyle, marginBottom: 4 }}>시작일</div>
                <input
                  type="date"
                  value={form.startDate}
                  onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                  style={{ ...dateInputStyle, borderBottomColor: '#C5C6CA' }}
                />
              </div>
            </div>

            {/* 사용 패턴 (하루 횟수 + 사용 주기) */}
            <div style={{ marginBottom: 24 }}>
              <div style={{ ...labelStyle, marginBottom: 2 }}>사용 패턴</div>
              <div
                style={{
                  fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
                  fontSize: 11, color: '#9CA3AF', marginBottom: 14,
                }}
              >
                소진 예측에 사용됩니다
              </div>

              {/* 하루 횟수 */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ ...labelStyle, marginBottom: 6 }}>하루 횟수</div>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {[1, 2, 3, 4].map((n) => (
                    <button
                      key={n}
                      onClick={() => setForm((f) => ({ ...f, usesPerDay: n }))}
                      style={pillStyle(form.usesPerDay === n)}
                    >
                      {n === 4 ? '4+회' : `${n}회`}
                    </button>
                  ))}
                </div>
              </div>

              {/* 사용 주기 */}
              <div>
                <div style={{ ...labelStyle, marginBottom: 6 }}>사용 주기</div>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {FREQ_OPTIONS.map((opt) => (
                    <button
                      key={opt.label}
                      onClick={() => setForm((f) => ({ ...f, daysPerWeek: opt.daysPerWeek }))}
                      style={pillStyle(form.daysPerWeek === opt.daysPerWeek)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── 저장 / 취소 버튼 ── */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={onSave}
            disabled={saving || isNameEmpty}
            style={{
              flex: 1, height: 52,
              background: isNameEmpty ? '#D8D6CF' : '#0C0C0A',
              color: '#fff', border: 'none', borderRadius: 12,
              fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
              fontSize: 15, fontWeight: 700, letterSpacing: '.02em',
              cursor: isNameEmpty ? 'default' : 'pointer',
              transition: 'opacity .2s',
            }}
          >
            {saving ? '저장 중...' : '저장'}
          </button>
          <button
            onClick={onClose}
            style={{
              flex: 1, height: 52, background: '#FFFFFF', color: '#0C1014',
              border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 12,
              fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
              fontSize: 15, fontWeight: 400, cursor: 'pointer',
            }}
          >
            취소
          </button>
        </div>

        {/* ── 편집 모드: 삭제 버튼 ── */}
        {isEditing && onDelete && (
          <button
            onClick={onDelete}
            style={{
              width: '100%', height: 48, background: 'rgba(186,26,26,.06)',
              border: '1.5px solid rgba(186,26,26,.2)', borderRadius: 12,
              fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
              fontSize: 14, fontWeight: 700, color: '#BA1A1A', cursor: 'pointer',
            }}
          >
            이 제품 삭제
          </button>
        )}
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
