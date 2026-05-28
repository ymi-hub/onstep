// app/import/page.tsx — AI 루틴 가져오기 (Stage 7)
//
// 💡 기능 흐름:
//   1. 사용자가 한글 루틴 텍스트를 텍스트 영역에 붙여넣기
//   2. "분석하기" 클릭 → Gemini API로 전송
//   3. AI가 JSON으로 변환 → 화면에 미리보기 표시
//   4. 제품명이 기존 Box 제품과 일치하면 자동 매핑
//   5. "루틴으로 저장" 클릭 → Firestore에 새 Session으로 저장
//
// 🔀 API 엔드포인트 전환:
//   - 개발 환경: /api/parse-routine (Next.js API Route)
//   - 프로덕션: NEXT_PUBLIC_PARSE_API_URL 환경변수 (Firebase Function URL)

'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  collection,
  getDocs,
  addDoc,
  serverTimestamp,
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

// ─── 타입 정의 ───────────────────────────────────────────────────────────────

// Gemini가 반환하는 파싱 결과 타입
type ParsedPhase = {
  order: number;
  products: string[];          // 제품명 (한국어 원문)
  instruction: string;
  waitMinutes: number;
};

type ParsedRoutine = {
  time: 'morning' | 'evening';
  label: string;               // 예: "아침1", "저녁2"
  phases: ParsedPhase[];
};

type ParsedResult = {
  session: number;
  date: string | null;         // "YYYY-MM-DD" 또는 null
  routines: ParsedRoutine[];
};

// 제품명 → Firestore 제품 매핑 결과
type ProductMatch = {
  name: string;                // 파싱된 제품명 (원문)
  matched: Product | null;     // 매핑된 Box 제품 (없으면 null)
};

// ─── 상수 ────────────────────────────────────────────────────────────────────

const FALLBACK_USER_ID = 'demo-user';

// 개발 환경: /api/parse-routine, 프로덕션: Firebase Function URL
const PARSE_API_URL =
  process.env.NEXT_PUBLIC_PARSE_API_URL ?? '/api/parse-routine';

// ─── 유틸 함수 ───────────────────────────────────────────────────────────────

// 제품명 매핑: 파싱된 이름 → Box에 등록된 제품 (대소문자 무관, 공백 무관)
function matchProductName(name: string, products: Product[]): Product | null {
  const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, '');
  const n = normalize(name);
  return (
    products.find((p) => normalize(p.name) === n) ??
    products.find((p) => normalize(p.name).includes(n) || n.includes(normalize(p.name))) ??
    null
  );
}

// 루틴에서 모든 제품명을 추출하고 매핑 결과 반환
function buildProductMatches(
  routines: ParsedRoutine[],
  products: Product[]
): Map<string, ProductMatch> {
  const map = new Map<string, ProductMatch>();
  routines.forEach((r) => {
    r.phases.forEach((p) => {
      p.products.forEach((name) => {
        if (!map.has(name)) {
          map.set(name, { name, matched: matchProductName(name, products) });
        }
      });
    });
  });
  return map;
}

// ─── Appbar 컴포넌트 ─────────────────────────────────────────────────────────

function Appbar({
  user,
  onLogin,
  onLogout,
}: {
  user: User | null;
  onLogin: () => void;
  onLogout: () => void;
}) {
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
      {/* 뒤로 가기 */}
      <Link
        href="/setup"
        style={{
          width: 32,
          height: 32,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(12,12,10,.06)',
          borderRadius: 9999,
          textDecoration: 'none',
          color: '#0C0C0A',
        }}
        aria-label="뒤로"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </Link>

      {/* 타이틀 */}
      <span
        style={{
          fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
          fontSize: 13,
          fontWeight: 800,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: '#0C0C0A',
        }}
      >
        AI 가져오기
      </span>

      {/* 유저 */}
      {user ? (
        <button
          onClick={onLogout}
          style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            background: '#EEEDE9',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            padding: 0,
          }}
          title={`${user.displayName ?? user.email} — 클릭하여 로그아웃`}
        >
          {user.photoURL ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.photoURL} alt="프로필" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" style={{ opacity: 0.4 }}>
              <path d="M12 12c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm0 2c-3.33 0-10 1.67-10 5v2h20v-2c0-3.33-6.67-5-10-5z" />
            </svg>
          )}
        </button>
      ) : (
        <button
          onClick={onLogin}
          style={{
            height: 28,
            padding: '0 10px',
            borderRadius: 9999,
            background: '#0C0C0A',
            border: 'none',
            cursor: 'pointer',
            color: '#C5FF00',
            fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
            fontSize: 11,
            fontWeight: 700,
          }}
        >
          로그인
        </button>
      )}
    </div>
  );
}

// ─── 텍스트 입력 섹션 ─────────────────────────────────────────────────────────

function InputSection({
  text,
  onChange,
  onParse,
  isParsing,
}: {
  text: string;
  onChange: (v: string) => void;
  onParse: () => void;
  isParsing: boolean;
}) {
  return (
    <div
      style={{
        margin: '16px',
        background: '#FFFFFF',
        border: '1px solid rgba(12,12,10,.07)',
        borderRadius: 20,
        overflow: 'hidden',
        boxShadow: '0 1px 2px rgba(0,0,0,.04)',
      }}
    >
      {/* 섹션 헤더 */}
      <div
        style={{
          padding: '14px 16px',
          borderBottom: '1px solid rgba(12,12,10,.07)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        {/* AI 아이콘 */}
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            background: 'linear-gradient(135deg, #f0ffe0 0%, #c5ff00 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 14,
            flexShrink: 0,
          }}
        >
          ✨
        </div>
        <div>
          <div
            style={{
              fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
              fontSize: 13,
              fontWeight: 800,
              color: '#0C0C0A',
              letterSpacing: '-0.01em',
            }}
          >
            루틴 텍스트 붙여넣기
          </div>
          <div
            style={{
              fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
              fontSize: 11,
              color: '#9A9490',
              marginTop: 1,
            }}
          >
            한글 파일의 루틴을 복사해서 붙여넣으세요
          </div>
        </div>
      </div>

      {/* 텍스트 영역 */}
      <textarea
        value={text}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`예시:\n20250712 1차\n아침1: 물마스크 -10분 뒤 러빙하여 흡수\n       델마크림+델마크림마스크를 섞어 바른 뒤\n저녁1: 토너 -가볍게 패팅`}
        rows={8}
        style={{
          width: '100%',
          padding: '14px 16px',
          border: 'none',
          outline: 'none',
          resize: 'vertical',
          fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', monospace",
          fontSize: 13,
          lineHeight: 1.7,
          color: '#0C0C0A',
          background: '#FAFAF8',
          boxSizing: 'border-box',
          minHeight: 180,
        }}
        disabled={isParsing}
      />

      {/* 하단 버튼 영역 */}
      <div
        style={{
          padding: '12px 16px',
          borderTop: '1px solid rgba(12,12,10,.07)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: '#FFFFFF',
        }}
      >
        {/* 글자 수 표시 */}
        <span
          style={{
            fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
            fontSize: 11,
            color: '#9A9490',
          }}
        >
          {text.length > 0 ? `${text.length}자` : '텍스트를 붙여넣어주세요'}
        </span>

        {/* 분석 버튼 */}
        <button
          onClick={onParse}
          disabled={isParsing || !text.trim()}
          style={{
            height: 36,
            padding: '0 18px',
            borderRadius: 9999,
            border: 'none',
            cursor: isParsing || !text.trim() ? 'not-allowed' : 'pointer',
            background: isParsing || !text.trim() ? 'rgba(12,12,10,.08)' : '#0C0C0A',
            color: isParsing || !text.trim() ? '#9A9490' : '#C5FF00',
            fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
            fontSize: 12,
            fontWeight: 800,
            letterSpacing: '0.04em',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            transition: 'all .15s',
          }}
        >
          {isParsing ? (
            <>
              <span
                style={{
                  width: 12,
                  height: 12,
                  border: '2px solid rgba(255,255,255,.3)',
                  borderTopColor: '#C5FF00',
                  borderRadius: 9999,
                  display: 'inline-block',
                  animation: 'spin 0.8s linear infinite',
                }}
              />
              분석 중...
            </>
          ) : (
            '✨ AI 분석하기'
          )}
        </button>
      </div>
    </div>
  );
}

// ─── 파싱 결과 미리보기 섹션 ─────────────────────────────────────────────────

function ResultSection({
  result,
  productMatches,
  onReset,
  onSave,
  isSaving,
}: {
  result: ParsedResult;
  productMatches: Map<string, ProductMatch>;
  onReset: () => void;
  onSave: () => void;
  isSaving: boolean;
}) {
  const morningRoutines = result.routines.filter((r) => r.time === 'morning');
  const eveningRoutines = result.routines.filter((r) => r.time === 'evening');

  // 매핑된 제품 수 / 전체 제품 수
  const totalProducts = productMatches.size;
  const matchedCount = Array.from(productMatches.values()).filter((m) => m.matched).length;

  return (
    <div style={{ padding: '0 16px' }}>
      {/* 분석 결과 헤더 카드 */}
      <div
        style={{
          background: 'linear-gradient(135deg, #f0ffe0 0%, #e8ffc0 100%)',
          border: '1px solid rgba(197,255,0,.3)',
          borderRadius: 16,
          padding: '14px 16px',
          marginBottom: 12,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <div
            style={{
              fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
              fontSize: 13,
              fontWeight: 800,
              color: '#0C0C0A',
            }}
          >
            {result.session}회차
            {result.date ? ` · ${result.date}` : ''}
          </div>
          <div
            style={{
              fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
              fontSize: 11,
              color: '#4A7700',
              marginTop: 3,
            }}
          >
            {totalProducts > 0
              ? `제품 ${matchedCount}/${totalProducts}개 자동 매핑됨`
              : '분석 완료'}
          </div>
        </div>
        <div style={{ fontSize: 28 }}>✨</div>
      </div>

      {/* 루틴 카드 목록 */}
      {[
        { routines: morningRoutines, label: '아침 루틴', icon: '☀️', slot: 'morning' },
        { routines: eveningRoutines, label: '저녁 루틴', icon: '🌙', slot: 'evening' },
      ].map(({ routines, label, icon, slot }) =>
        routines.length === 0 ? null : (
          <div
            key={slot}
            style={{
              background: '#FFFFFF',
              border: '1px solid rgba(12,12,10,.07)',
              borderRadius: 16,
              marginBottom: 12,
              overflow: 'hidden',
              boxShadow: '0 1px 2px rgba(0,0,0,.04)',
            }}
          >
            {/* 시간대 헤더 */}
            <div
              style={{
                padding: '12px 16px',
                borderBottom: '1px solid rgba(12,12,10,.07)',
                background: '#F4F4F0',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <span style={{ fontSize: 14 }}>{icon}</span>
              <span
                style={{
                  fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
                  fontSize: 12,
                  fontWeight: 800,
                  letterSpacing: '0.06em',
                  color: '#0C0C0A',
                }}
              >
                {label}
              </span>
              <span
                style={{
                  marginLeft: 'auto',
                  fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
                  fontSize: 11,
                  color: '#9A9490',
                }}
              >
                {routines.reduce((acc, r) => acc + r.phases.length, 0)}단계
              </span>
            </div>

            {/* 루틴 → 단계 목록 */}
            <div style={{ padding: '10px 16px 14px' }}>
              {routines.map((routine) =>
                routine.phases.map((phase) => (
                  <div
                    key={`${routine.label}-${phase.order}`}
                    style={{
                      display: 'flex',
                      gap: 10,
                      paddingBottom: 12,
                      marginBottom: 12,
                      borderBottom: '1px solid rgba(12,12,10,.05)',
                    }}
                  >
                    {/* 단계 번호 */}
                    <div
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 9999,
                        background: '#0C0C0A',
                        color: '#C5FF00',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
                        fontSize: 10,
                        fontWeight: 800,
                        flexShrink: 0,
                        marginTop: 1,
                      }}
                    >
                      {phase.order}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      {/* 제품 칩 목록 */}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                        {phase.products.map((pName) => {
                          const match = productMatches.get(pName);
                          const isMatched = !!match?.matched;
                          return (
                            <span
                              key={pName}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 3,
                                height: 22,
                                padding: '0 8px',
                                borderRadius: 9999,
                                background: isMatched ? '#F5FDD4' : '#F4F4F0',
                                border: isMatched
                                  ? '1px solid rgba(197,255,0,.4)'
                                  : '1px solid rgba(12,12,10,.1)',
                                fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
                                fontSize: 11,
                                fontWeight: 700,
                                color: isMatched ? '#4A7700' : '#4A4846',
                              }}
                            >
                              {isMatched && (
                                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#4A7700" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                              )}
                              {pName}
                            </span>
                          );
                        })}
                      </div>

                      {/* 사용법 */}
                      {phase.instruction && (
                        <div
                          style={{
                            fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
                            fontSize: 12,
                            color: '#4A4846',
                            lineHeight: 1.6,
                          }}
                        >
                          {phase.instruction}
                          {phase.waitMinutes > 0 && (
                            <span style={{ color: '#9A9490', marginLeft: 4 }}>
                              ({phase.waitMinutes}분 대기)
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )
      )}

      {/* 매핑 안 된 제품 안내 */}
      {matchedCount < totalProducts && (
        <div
          style={{
            background: '#FFF8F0',
            border: '1px solid rgba(255,160,0,.2)',
            borderRadius: 12,
            padding: '10px 14px',
            marginBottom: 12,
            display: 'flex',
            gap: 8,
          }}
        >
          <span style={{ fontSize: 14, flexShrink: 0 }}>⚠️</span>
          <div
            style={{
              fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
              fontSize: 12,
              color: '#8A6000',
              lineHeight: 1.6,
            }}
          >
            일부 제품({totalProducts - matchedCount}개)이 Box에 없습니다. 저장 후 SETUP에서 제품을 직접 연결하거나, 먼저 Box에 제품을 추가하세요.
          </div>
        </div>
      )}

      {/* 액션 버튼 */}
      <div style={{ display: 'flex', gap: 8, paddingBottom: 32 }}>
        <button
          onClick={onReset}
          disabled={isSaving}
          style={{
            flex: 1,
            height: 44,
            borderRadius: 12,
            border: '1.5px solid rgba(12,12,10,.14)',
            background: 'transparent',
            cursor: 'pointer',
            fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
            fontSize: 13,
            fontWeight: 700,
            color: '#0C0C0A',
          }}
        >
          다시 분석
        </button>
        <button
          onClick={onSave}
          disabled={isSaving}
          style={{
            flex: 2,
            height: 44,
            borderRadius: 12,
            border: 'none',
            cursor: isSaving ? 'not-allowed' : 'pointer',
            background: isSaving ? 'rgba(12,12,10,.08)' : '#0C0C0A',
            color: isSaving ? '#9A9490' : '#C5FF00',
            fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
            fontSize: 13,
            fontWeight: 800,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
          }}
        >
          {isSaving ? '저장 중...' : '루틴으로 저장 →'}
        </button>
      </div>
    </div>
  );
}

// ─── 메인 페이지 컴포넌트 ─────────────────────────────────────────────────────

type PageState = 'input' | 'parsing' | 'result' | 'saving' | 'done';

export default function ImportPage() {
  // ── 인증 상태 ──
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // ── 페이지 상태 ──
  const [pageState, setPageState] = useState<PageState>('input');
  const [inputText, setInputText] = useState('');
  const [parsedResult, setParsedResult] = useState<ParsedResult | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  // ── Box 제품 목록 (제품명 자동 매핑용) ──
  const [products, setProducts] = useState<Product[]>([]);
  const [productMatches, setProductMatches] = useState<Map<string, ProductMatch>>(new Map());

  // ── 현재 userId ──
  const userId = user?.uid ?? FALLBACK_USER_ID;

  // ── Firebase Auth 감지 ──
  useEffect(() => {
    if (!auth) { setAuthLoading(false); return; }
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
    });
    return () => unsub();
  }, []);

  // ── Box 제품 목록 로드 ──
  useEffect(() => {
    if (authLoading || !user || !db) return;
    getDocs(collection(db, 'users', userId, 'products'))
      .then((snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Product, 'id'>) }));
        setProducts(list);
      })
      .catch((err) => console.error('[OnStep] 제품 목록 로드 실패:', err));
  }, [userId, authLoading]);

  // ── Gemini 분석 실행 ──
  const handleParse = async () => {
    if (!inputText.trim()) return;
    setPageState('parsing');
    setErrorMsg('');
    setParsedResult(null);

    try {
      const res = await fetch(PARSE_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: inputText }),
      });

      const data = await res.json() as { result?: ParsedResult; error?: string };

      if (!res.ok || data.error) {
        throw new Error(data.error ?? '알 수 없는 오류가 발생했습니다.');
      }

      if (!data.result) {
        throw new Error('AI 응답이 비어 있습니다.');
      }

      const result = data.result;
      // 제품명 → Box 제품 자동 매핑
      const matches = buildProductMatches(result.routines, products);
      setParsedResult(result);
      setProductMatches(matches);
      setPageState('result');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '분석에 실패했습니다.';
      setErrorMsg(msg);
      setPageState('input');
    }
  };

  // ── Firestore에 루틴 저장 ──
  const handleSave = async () => {
    if (!parsedResult || !db) return;
    setPageState('saving');

    try {
      // 파싱 결과 → SETUP 페이지의 Session 구조로 변환
      //
      // 💡 변환 방식:
      // AI 파싱 결과를 phases 구조 그대로 Firestore에 저장
      // 각 phase: { order, productIds, instruction, waitMinutes }

      const buildPhases = (routines: typeof parsedResult.routines, time: 'morning' | 'evening') =>
        routines
          .filter((r) => r.time === time)
          .flatMap((r) => r.phases)
          .map((p, idx) => ({
            order: idx + 1,
            productIds: p.products
              .map((name) => productMatches.get(name)?.matched?.id)
              .filter((id): id is string => Boolean(id)),
            instruction: p.instruction,
            waitMinutes: p.waitMinutes ?? 0,
          }));

      const now = new Date().toISOString();

      const sessionData = {
        sessionNumber: parsedResult.session,
        startDate: parsedResult.date ?? now.slice(0, 10),
        endDate: '',
        morningTime: '07:30',
        eveningTime: '22:00',
        days: [
          {
            dayNumber: 1,
            morning: { phases: buildPhases(parsedResult.routines, 'morning') },
            evening: { phases: buildPhases(parsedResult.routines, 'evening') },
          },
        ],
        importedByAI: true,
        createdAt: now,
        updatedAt: now,
      };

      await addDoc(collection(db, 'users', userId, 'routines'), sessionData);

      setPageState('done');
    } catch (err) {
      console.error('[OnStep] 루틴 저장 실패:', err);
      setErrorMsg('저장에 실패했습니다. 다시 시도해주세요.');
      setPageState('result');
    }
  };

  // ── 로그인 / 로그아웃 ──
  const handleLogin = async () => {
    if (!auth) { alert('Firebase가 설정되지 않았습니다.'); return; }
    try { await signInWithPopup(auth, new GoogleAuthProvider()); }
    catch (err) { console.error('[OnStep] 로그인 실패:', err); }
  };

  const handleLogout = async () => {
    if (!auth) return;
    try { await signOut(auth); }
    catch (err) { console.error('[OnStep] 로그아웃 실패:', err); }
  };

  // ── 성공 화면 ──
  if (pageState === 'done') {
    return (
      <div style={{ background: '#FAFAF8', minHeight: '100%' }}>
        <Appbar user={user} onLogin={handleLogin} onLogout={handleLogout} />
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '80px 32px',
            gap: 16,
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 48 }}>✅</div>
          <div
            style={{
              fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
              fontSize: 20,
              fontWeight: 800,
              color: '#0C0C0A',
            }}
          >
            루틴이 저장되었습니다!
          </div>
          <div
            style={{
              fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
              fontSize: 13,
              color: '#9A9490',
              lineHeight: 1.7,
            }}
          >
            SETUP에서 제품 매핑을 확인하거나<br />Today에서 루틴을 시작하세요.
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <Link
              href="/setup"
              style={{
                height: 40,
                padding: '0 18px',
                borderRadius: 10,
                border: '1.5px solid rgba(12,12,10,.14)',
                display: 'flex',
                alignItems: 'center',
                textDecoration: 'none',
                fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
                fontSize: 13,
                fontWeight: 700,
                color: '#0C0C0A',
              }}
            >
              SETUP 보기
            </Link>
            <button
              onClick={() => { setPageState('input'); setInputText(''); setParsedResult(null); }}
              style={{
                height: 40,
                padding: '0 18px',
                borderRadius: 10,
                border: 'none',
                background: '#0C0C0A',
                cursor: 'pointer',
                fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
                fontSize: 13,
                fontWeight: 800,
                color: '#C5FF00',
              }}
            >
              또 가져오기
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: '#FAFAF8', minHeight: '100%' }}>
      {/* CSS 애니메이션 (로딩 스피너용) */}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>

      <Appbar user={user} onLogin={handleLogin} onLogout={handleLogout} />

      <div style={{ paddingTop: 16 }}>
        {/* 페이지 헤더 */}
        <div style={{ padding: '0 16px 4px' }}>
          <h1
            style={{
              fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
              fontSize: 24,
              fontWeight: 800,
              color: '#0C0C0A',
              letterSpacing: '-0.01em',
              margin: 0,
            }}
          >
            AI 루틴 가져오기
          </h1>
          <p
            style={{
              fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
              fontSize: 13,
              color: '#9A9490',
              marginTop: 4,
              marginBottom: 0,
            }}
          >
            텍스트를 붙여넣으면 AI가 루틴 구조로 변환합니다
          </p>
        </div>

        {/* 에러 메시지 */}
        {errorMsg && (
          <div
            style={{
              margin: '12px 16px 0',
              padding: '10px 14px',
              background: '#FFF0F0',
              border: '1px solid rgba(255,0,0,.15)',
              borderRadius: 12,
              fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
              fontSize: 12,
              color: '#CC0000',
              display: 'flex',
              gap: 8,
              alignItems: 'flex-start',
            }}
          >
            <span style={{ flexShrink: 0 }}>⚠️</span>
            {errorMsg}
          </div>
        )}

        {/* 상태에 따라 입력 섹션 or 결과 섹션 표시 */}
        {pageState === 'result' || pageState === 'saving' ? (
          parsedResult && (
            <ResultSection
              result={parsedResult}
              productMatches={productMatches}
              onReset={() => { setPageState('input'); setParsedResult(null); setErrorMsg(''); }}
              onSave={handleSave}
              isSaving={pageState === 'saving'}
            />
          )
        ) : (
          <InputSection
            text={inputText}
            onChange={setInputText}
            onParse={handleParse}
            isParsing={pageState === 'parsing'}
          />
        )}

        {/* Box 제품 없을 때 안내 */}
        {pageState === 'input' && products.length === 0 && !authLoading && (
          <div
            style={{
              margin: '0 16px',
              padding: '12px 14px',
              background: '#F4F4F0',
              border: '1px solid rgba(12,12,10,.07)',
              borderRadius: 12,
              display: 'flex',
              gap: 8,
              alignItems: 'flex-start',
            }}
          >
            <span style={{ flexShrink: 0, fontSize: 14 }}>💡</span>
            <div
              style={{
                fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
                fontSize: 12,
                color: '#4A4846',
                lineHeight: 1.6,
              }}
            >
              Box에 제품을 먼저 등록하면 루틴에서 자동으로 제품을 연결합니다.{' '}
              <Link href="/box" style={{ color: '#0C0C0A', fontWeight: 700 }}>
                BOX로 이동 →
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
