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
import { db, auth, storage } from '@/lib/firebase';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
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
  currentRemaining: number;  // 현재 잔량 (편집 시 수동 조정)
  imageFile: File | null;    // 새로 선택한 이미지 파일
  imagePreview: string;      // base64 미리보기
  imageUrl: string;          // 기존 이미지 URL
};

const INITIAL_FORM: FormState = {
  name: '',
  brand: '',
  category: '',
  packageCount: 1,
  unitPerPackage: 1,
  usesPerDay: 1,
  dosePerUse: 1,
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
  const fillRate =
    product.totalAmount > 0
      ? Math.min(1, product.currentRemaining / product.totalAmount)
      : 1;

  const fillColor =
    fillRate > 0.5 ? '#C5FF00' : fillRate > 0.2 ? '#B45309' : '#D93025';

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
        <div
          style={{
            position: 'absolute', inset: 0,
            backgroundImage: `url(${imgUrl})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        />
      )}

      {/* 상단 잔량 바 */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'rgba(0,0,0,.12)', zIndex: 1 }}>
        <div style={{ height: '100%', width: `${fillRate * 100}%`, background: fillColor }} />
      </div>

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

      {/* 잔량 낮음 경고 뱃지 */}
      {fillRate < 0.2 && (
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
// force=true 이면 localStorage 플래그 무시하고 재실행
async function migrateOldBoxAssets(uid: string, force = false): Promise<{ count: number; error?: string }> {
  if (!db) return { count: 0, error: 'Firebase 미설정' };

  // 이미 이 기기에서 마이그레이션 완료한 경우 스킵 (강제 실행 아니면)
  const flagKey = `onstep_migrated_${uid}`;
  if (!force && typeof localStorage !== 'undefined' && localStorage.getItem(flagKey)) {
    return { count: 0 };
  }

  try {
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

  // 마이그레이션 알림 토스트
  const [migrationToast, setMigrationToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [migrating, setMigrating] = useState(false);

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
  // 로그인 시 localStorage 플래그 확인 후 미이그레이션 시도
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
        dosePerUse: form.dosePerUse,
        usesPerDay: form.usesPerDay,
        frequencyType: form.daysPerWeek === 7 ? 'daily' : 'per_week',
        frequencyValue: form.daysPerWeek,
        purchaseDate: form.purchaseDate || null,
        startDate: form.startDate || null,
        expiryDate: form.expiryDate || null,
        price: form.price.trim() || null,
        source: form.source.trim() || null,
        purchaseUrl: form.purchaseUrl.trim() || null,
        updatedAt: now,
      };

      let productId: string;

      if (editingProduct) {
        productId = editingProduct.id;
        await updateDoc(doc(db, 'users', userId, 'products', productId), {
          ...commonFields,
          currentRemaining: form.currentRemaining,
        });
      } else {
        const docRef = await addDoc(collection(db, 'users', userId, 'products'), {
          ...commonFields,
          domain: activeTab,
          subCategory: activeTab === 'beauty' ? subType : null,
          currentRemaining: totalAmount,
          createdAt: now,
        });
        productId = docRef.id;
      }

      // 새 이미지 파일이 선택된 경우 Firebase Storage에 업로드
      if (form.imageFile && storage) {
        const imgRef = storageRef(storage, `users/${userId}/products/${productId}.jpg`);
        await uploadBytes(imgRef, form.imageFile);
        const imageUrl = await getDownloadURL(imgRef);
        await updateDoc(doc(db, 'users', userId, 'products', productId), { imageUrl });
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

// ─── 제품 추가/편집 전체 화면 폼 ─────────────────────────────────────────────
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 이미지 파일 선택 처리
  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setForm((f) => ({ ...f, imageFile: file }));
    const reader = new FileReader();
    reader.onload = (ev) => {
      setForm((f) => ({ ...f, imagePreview: ev.target?.result as string }));
    };
    reader.readAsDataURL(file);
  }

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

        {/* ── 제품 이미지 (design/box.html .add-img-block) ── */}
        <div
          onClick={() => fileInputRef.current?.click()}
          style={{
            width: '100%', height: 220, cursor: 'pointer', position: 'relative',
            background: displayImg ? 'transparent' : '#F4F4F0',
            backgroundImage: displayImg ? `url(${displayImg})` : 'none',
            backgroundSize: 'cover', backgroundPosition: 'center',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {!displayImg && (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 28, opacity: 0.2, marginBottom: 8 }}>✦</div>
              <div style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: '.1em', color: '#9A9490' }}>
                ADD PRODUCT IMAGE
              </div>
              <div style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 11, color: '#C4C2BE', marginTop: 4 }}>
                탭하여 이미지 추가
              </div>
            </div>
          )}
          {displayImg && (
            <div style={{ position: 'absolute', bottom: 10, right: 10, background: 'rgba(0,0,0,.55)', color: '#fff', borderRadius: 6, padding: '5px 10px', fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 11, fontWeight: 700 }}>
              사진 변경
            </div>
          )}
          <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageChange} />
        </div>

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
                  <input value={form.source} onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))} placeholder="올리브영, 쿠팡..." style={{ ...underlineInputStyle, fontSize: 14 }} />
                </div>
              </div>

              {/* 도메인 표시 (읽기 전용) */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={labelStyle}>DOMAIN</div>
                <div style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 11, fontWeight: 700, color: '#0C0C0A', textTransform: 'uppercase', background: '#F4F4F0', borderRadius: 4, padding: '3px 8px' }}>
                  {domain === 'beauty' ? `Beauty · ${subType}` : domain}
                </div>
              </div>

              {/* 카테고리 칩 (Beauty만) */}
              {domain === 'beauty' && cats.length > 0 && (
                <div>
                  <div style={{ borderBottom: '1px solid #C5C6CA', paddingBottom: 4, marginBottom: 10 }}>
                    <div style={labelStyle}>PRIMARY CLASSIFICATION</div>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {cats.map((cat) => (
                      <button
                        key={cat}
                        onClick={() => setForm((f) => ({ ...f, category: f.category === cat ? '' : cat }))}
                        style={{
                          height: 26, padding: '0 14px',
                          border: `1.5px solid ${form.category === cat ? '#000' : '#C5C6CA'}`,
                          background: form.category === cat ? '#000' : 'transparent',
                          fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif",
                          fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase',
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
                  placeholder="₩45,000"
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

          {/* ── Asset Count 섹션 (Beauty Skincare 전용) ── */}
          {domain === 'beauty' && subType === 'skincare' && (
            <div>
              <div style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 22, fontWeight: 400, letterSpacing: '-0.02em', color: '#1A1C1C', marginBottom: 12 }}>
                Asset Count
              </div>
              <div style={{ borderTop: '1px solid #C5C6CA', paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 20 }}>

                {/* 패키지 수 × 수량 = 총량 */}
                <div>
                  <div style={{ ...labelStyle, marginBottom: 10 }}>수량 구조</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                    <div>
                      <div style={{ ...labelStyle, marginBottom: 4, fontSize: 10 }}>패키지 수</div>
                      <div style={{ borderBottom: '1.5px solid #C5C6CA', paddingBottom: 4 }}>
                        <input type="number" min={1} value={form.packageCount} onChange={(e) => setForm((f) => ({ ...f, packageCount: Math.max(1, Number(e.target.value)) }))} style={countInputStyle} />
                      </div>
                    </div>
                    <span style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 18, color: '#C5C6CA', paddingTop: 14 }}>×</span>
                    <div>
                      <div style={{ ...labelStyle, marginBottom: 4, fontSize: 10 }}>개당 수량</div>
                      <div style={{ borderBottom: '1.5px solid #C5C6CA', paddingBottom: 4 }}>
                        <input type="number" min={1} value={form.unitPerPackage} onChange={(e) => setForm((f) => ({ ...f, unitPerPackage: Math.max(1, Number(e.target.value)) }))} style={countInputStyle} />
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', background: '#F5F5F3', borderRadius: 6, padding: '8px 12px' }}>
                    <span style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: '.08em', color: '#9CA3AF', textTransform: 'uppercase' }}>총 수량</span>
                    <span style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 16, fontWeight: 700, color: '#0C1014', marginLeft: 'auto' }}>{totalAmount}개</span>
                  </div>
                </div>

                {/* 시작일 */}
                <div>
                  <div style={labelStyle}>사용 시작일</div>
                  <input type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} style={dateInputStyle} />
                </div>

                {/* 현재 잔량 (편집 모드에서만 표시) */}
                {isEditing && (
                  <div>
                    <div style={{ ...labelStyle, marginBottom: 6 }}>현재 잔량</div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                      <input
                        type="number"
                        min={0}
                        value={form.currentRemaining}
                        onChange={(e) => setForm((f) => ({ ...f, currentRemaining: Math.max(0, Number(e.target.value)) }))}
                        style={{ ...countInputStyle, textAlign: 'left', fontSize: 22, width: 80 }}
                      />
                      <span style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 13, color: '#9A9490' }}>개 / {totalAmount}개</span>
                    </div>
                    {/* 잔량 프로그레스 바 */}
                    <div style={{ marginTop: 6, height: 4, background: '#EEEDE9', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${Math.min(100, (form.currentRemaining / Math.max(1, totalAmount)) * 100)}%`, background: '#C5FF00', transition: 'width .3s' }} />
                    </div>
                  </div>
                )}

                {/* 사용 패턴 */}
                <div>
                  <div style={{ ...labelStyle, marginBottom: 2 }}>사용 패턴</div>
                  <div style={{ fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 11, color: '#9CA3AF', marginBottom: 14 }}>소진 예측에 사용됩니다</div>

                  {/* 1회 사용량 */}
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ ...labelStyle, marginBottom: 8 }}>1회 사용량</div>
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                      {[1, 2, 3, 4].map((n) => (
                        <button key={n} onClick={() => setForm((f) => ({ ...f, dosePerUse: n }))} style={pillStyle(form.dosePerUse === n)}>
                          {n === 4 ? '4+펌' : `${n}펌`}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 하루 횟수 */}
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ ...labelStyle, marginBottom: 8 }}>하루 횟수</div>
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                      {[1, 2, 3, 4].map((n) => (
                        <button key={n} onClick={() => setForm((f) => ({ ...f, usesPerDay: n }))} style={pillStyle(form.usesPerDay === n)}>
                          {n === 4 ? '4+회' : `${n}회`}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 사용 주기 */}
                  <div>
                    <div style={{ ...labelStyle, marginBottom: 8 }}>사용 주기</div>
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                      {FREQ_OPTIONS.map((opt) => (
                        <button key={opt.label} onClick={() => setForm((f) => ({ ...f, daysPerWeek: opt.daysPerWeek }))} style={pillStyle(form.daysPerWeek === opt.daysPerWeek)}>
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── 저장 / 취소 ── */}
          <div style={{ display: 'flex', gap: 8 }}>
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
            <button
              onClick={onClose}
              style={{ flex: 1, height: 52, background: '#fff', color: '#0C1014', border: '1.5px solid rgba(12,12,10,.14)', borderRadius: 12, fontFamily: "'Plus Jakarta Sans','Space Grotesk',sans-serif", fontSize: 15, cursor: 'pointer' }}
            >
              취소
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
