'use client';

/**
 * /admin/cleanup
 * BOX 제품 중복 데이터 정리 도구
 *
 * 동작:
 * 1. Firestore에서 products와 sessions(루틴) 전체 로드
 * 2. 같은 이름의 제품을 그룹핑 → 중복 탐지
 * 3. 각 그룹에서 루틴에 참조된 productId를 "보존 대상"으로 표시
 * 4. 나머지(루틴에 없는 중복)를 삭제 후보로 표시
 * 5. 사용자가 확인 후 "삭제 실행" 버튼 클릭 → Firestore 문서 삭제
 */

import { useEffect, useState } from 'react';
import {
  collection,
  getDocs,
  deleteDoc,
  doc,
  writeBatch,
  query,
  orderBy,
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { db, auth } from '@/lib/firebase';
import type { Product } from '@/types/product';
import type { Session, RoutineItem } from '@/types/routine';

// ─── 타입 ─────────────────────────────────────────────────────────────
/** 같은 이름으로 묶인 중복 그룹 */
interface DuplicateGroup {
  name: string;                // 공통 제품명
  products: ProductWithMeta[]; // 그룹 내 모든 제품
}

/** 제품 + 루틴 참조 여부 */
interface ProductWithMeta extends Product {
  usedInRoutine: boolean;      // 하나 이상의 루틴 슬롯에서 참조됨
  routineRefs: string[];       // 참조된 세션 ID 목록
  keepFlag: boolean;           // 이 제품을 남길지 여부 (UI 토글)
}

// ─── 유틸 ─────────────────────────────────────────────────────────────
/** Session 전체를 순회하여 사용된 productId Set 반환 */
function extractProductIds(sessions: Session[]): Map<string, string[]> {
  // productId → [sessionId, ...] 매핑
  const map = new Map<string, string[]>();

  for (const session of sessions) {
    // morning / evening 두 슬롯 모두 확인
    for (const slot of [session.morning, session.evening]) {
      if (!slot?.days) continue;
      for (const day of slot.days) {
        const allItems: RoutineItem[] = [
          ...(day.items ?? []),
          ...(day.tipItems ?? []),
        ];
        for (const item of allItems) {
          if (item.type === 'product') {
            const prev = map.get(item.id) ?? [];
            if (!prev.includes(session.id)) {
              map.set(item.id, [...prev, session.id]);
            }
          }
        }
      }
    }
  }
  return map;
}

// ─── 컴포넌트 ─────────────────────────────────────────────────────────
export default function CleanupPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('로그인 확인 중...');

  // 중복 그룹 목록 (이름이 같은 제품이 2개 이상인 것만)
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  // 단독 제품 중 currentRemaining이 음수인 것
  const [negativeProducts, setNegativeProducts] = useState<ProductWithMeta[]>([]);

  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);

  // ── 로그인 확인
  useEffect(() => {
    if (!auth) {
      setStatus('Firebase 미설정');
      setLoading(false);
      return;
    }
    return onAuthStateChanged(auth, (user) => {
      if (user) {
        setUserId(user.uid);
      } else {
        setStatus('로그인이 필요합니다.');
        setLoading(false);
      }
    });
  }, []);

  // ── 데이터 로드 및 분석
  useEffect(() => {
    if (!userId || !db) return;
    (async () => {
      try {
        setStatus('데이터 로드 중...');

        // products 전체 로드
        const productsSnap = await getDocs(
          query(collection(db!, 'users', userId, 'products'), orderBy('createdAt', 'asc'))
        );
        const rawProducts: Product[] = productsSnap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<Product, 'id'>),
        }));

        // sessions(루틴) 전체 로드
        const sessionsSnap = await getDocs(
          collection(db!, 'users', userId, 'routines')
        );
        const sessions: Session[] = sessionsSnap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<Session, 'id'>),
        }));

        // 루틴에서 사용된 productId 추출
        const routineMap = extractProductIds(sessions);

        // ProductWithMeta로 변환
        const products: ProductWithMeta[] = rawProducts.map((p) => {
          const refs = routineMap.get(p.id) ?? [];
          return {
            ...p,
            usedInRoutine: refs.length > 0,
            routineRefs: refs,
            keepFlag: refs.length > 0, // 기본값: 루틴에 있으면 보존
          };
        });

        // 이름 기준으로 그룹핑
        const byName = new Map<string, ProductWithMeta[]>();
        for (const p of products) {
          const key = p.name.trim().toLowerCase();
          const prev = byName.get(key) ?? [];
          byName.set(key, [...prev, p]);
        }

        // 중복 그룹(2개 이상)만 추출
        const dupGroups: DuplicateGroup[] = [];
        for (const [, group] of byName) {
          if (group.length < 2) continue;

          // 루틴에 있는 것이 없으면 createdAt 최신 것을 keepFlag=true
          const hasRoutineItem = group.some((p) => p.usedInRoutine);
          if (!hasRoutineItem) {
            // 모두 루틴 미참조 → 가장 최신 1개만 보존
            const sorted = [...group].sort(
              (a, b) =>
                new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
            );
            sorted[0].keepFlag = true;
            for (let i = 1; i < sorted.length; i++) sorted[i].keepFlag = false;
          }

          dupGroups.push({ name: group[0].name, products: group });
        }

        // 음수 잔량 제품 (단독 제품 중)
        const negList: ProductWithMeta[] = [];
        for (const [, group] of byName) {
          if (group.length === 1 && group[0].currentRemaining < 0) {
            negList.push(group[0]);
          }
        }

        setGroups(dupGroups);
        setNegativeProducts(negList);
        setStatus(
          dupGroups.length === 0
            ? '중복 제품 없음'
            : `중복 그룹 ${dupGroups.length}개 발견`
        );
      } catch (err) {
        console.error(err);
        setStatus('로드 실패: ' + String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, [userId]);

  // ── keepFlag 토글 (사용자가 직접 변경 가능)
  function toggleKeep(groupName: string, productId: string) {
    setGroups((prev) =>
      prev.map((g) => {
        if (g.name.trim().toLowerCase() !== groupName.trim().toLowerCase()) return g;
        return {
          ...g,
          products: g.products.map((p) =>
            p.id === productId ? { ...p, keepFlag: !p.keepFlag } : p
          ),
        };
      })
    );
  }

  // ── 삭제 실행
  async function runCleanup() {
    if (!userId || !db) return;

    // 삭제 대상 목록 수집
    const toDelete: string[] = [];
    for (const g of groups) {
      for (const p of g.products) {
        if (!p.keepFlag) toDelete.push(p.id);
      }
    }

    if (toDelete.length === 0) {
      alert('삭제할 제품이 없습니다. 보존 플래그를 확인해주세요.');
      return;
    }

    if (
      !window.confirm(
        `${toDelete.length}개의 제품을 Firestore에서 삭제합니다.\n` +
          '이 작업은 되돌릴 수 없습니다. 계속할까요?'
      )
    )
      return;

    setRunning(true);
    try {
      // Firestore writeBatch는 최대 500 ops → 분할
      const BATCH_SIZE = 400;
      for (let i = 0; i < toDelete.length; i += BATCH_SIZE) {
        const batch = writeBatch(db!);
        const chunk = toDelete.slice(i, i + BATCH_SIZE);
        for (const id of chunk) {
          batch.delete(doc(db!, 'users', userId, 'products', id));
        }
        await batch.commit();
      }

      setDone(true);
      setStatus(`완료: ${toDelete.length}개 삭제됨`);

      // 삭제된 항목을 UI에서 제거
      setGroups((prev) =>
        prev
          .map((g) => ({
            ...g,
            products: g.products.filter((p) => p.keepFlag),
          }))
          .filter((g) => g.products.length >= 2)
      );
    } catch (err) {
      console.error(err);
      alert('삭제 중 오류 발생: ' + String(err));
    } finally {
      setRunning(false);
    }
  }

  // ─── 렌더 ──────────────────────────────────────────────────────────
  const deleteCount = groups.flatMap((g) => g.products).filter((p) => !p.keepFlag).length;

  return (
    <div style={{ minHeight: '100vh', background: '#0D0D1A', color: '#fff', padding: '24px 16px', fontFamily: 'DM Sans, sans-serif' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>BOX 중복 제품 정리</h1>
      <p style={{ color: 'rgba(255,255,255,.4)', fontSize: 13, marginBottom: 24 }}>{status}</p>

      {loading && <p style={{ color: 'rgba(255,255,255,.5)' }}>분석 중...</p>}

      {!loading && groups.length === 0 && !done && (
        <p style={{ color: '#4CAF50' }}>중복 제품이 없습니다.</p>
      )}

      {/* 중복 그룹 목록 */}
      {groups.map((g) => (
        <div
          key={g.name}
          style={{
            background: 'rgba(255,255,255,.05)',
            border: '1px solid rgba(255,255,255,.08)',
            borderRadius: 16,
            padding: '16px',
            marginBottom: 16,
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12 }}>
            📦 {g.name}
            <span style={{ color: 'rgba(255,255,255,.4)', fontSize: 12, marginLeft: 8 }}>
              ({g.products.length}개)
            </span>
          </div>

          {g.products.map((p) => (
            <div
              key={p.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 12px',
                borderRadius: 10,
                marginBottom: 6,
                background: p.keepFlag
                  ? 'rgba(76,175,80,.12)'
                  : 'rgba(233,79,107,.08)',
                border: `1px solid ${p.keepFlag ? 'rgba(76,175,80,.3)' : 'rgba(233,79,107,.2)'}`,
              }}
            >
              {/* 체크박스 */}
              <input
                type="checkbox"
                checked={p.keepFlag}
                onChange={() => toggleKeep(g.name, p.id)}
                style={{ width: 16, height: 16, cursor: 'pointer' }}
              />

              <div style={{ flex: 1, fontSize: 13 }}>
                <span style={{ fontWeight: 600 }}>{p.name}</span>
                {p.brand && (
                  <span style={{ color: 'rgba(255,255,255,.4)', marginLeft: 6 }}>
                    {p.brand}
                  </span>
                )}
                <div style={{ color: 'rgba(255,255,255,.35)', fontSize: 11, marginTop: 2 }}>
                  잔량: {p.currentRemaining}{p.itemUnit} · 생성:{' '}
                  {p.createdAt ? new Date(p.createdAt).toLocaleDateString('ko-KR') : '-'}
                  {' · ID: '}{p.id.slice(0, 8)}...
                </div>
              </div>

              {/* 루틴 참조 배지 */}
              {p.usedInRoutine ? (
                <span
                  style={{
                    background: 'rgba(33,150,243,.25)',
                    color: '#90CAF9',
                    borderRadius: 6,
                    padding: '2px 8px',
                    fontSize: 11,
                    fontWeight: 700,
                    whiteSpace: 'nowrap',
                  }}
                >
                  루틴 참조 ✓
                </span>
              ) : (
                <span
                  style={{
                    background: 'rgba(255,255,255,.06)',
                    color: 'rgba(255,255,255,.3)',
                    borderRadius: 6,
                    padding: '2px 8px',
                    fontSize: 11,
                  }}
                >
                  미참조
                </span>
              )}

              {/* 보존/삭제 표시 */}
              <span style={{ fontSize: 13, width: 52, textAlign: 'center' }}>
                {p.keepFlag ? '✅ 보존' : '🗑 삭제'}
              </span>
            </div>
          ))}
        </div>
      ))}

      {/* 음수 잔량 경고 (참고용) */}
      {negativeProducts.length > 0 && (
        <div
          style={{
            background: 'rgba(255,193,7,.07)',
            border: '1px solid rgba(255,193,7,.2)',
            borderRadius: 16,
            padding: '16px',
            marginBottom: 16,
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8, color: '#FFC107' }}>
            ⚠️ 잔량 음수 제품 (참고 — 중복 아님, 삭제 안 됨)
          </div>
          {negativeProducts.map((p) => (
            <div key={p.id} style={{ fontSize: 13, marginBottom: 4, color: 'rgba(255,255,255,.6)' }}>
              {p.name} — 잔량 {p.currentRemaining}{p.itemUnit}
            </div>
          ))}
        </div>
      )}

      {/* 실행 버튼 */}
      {!loading && groups.length > 0 && !done && (
        <div style={{ position: 'sticky', bottom: 24, display: 'flex', gap: 12, marginTop: 24 }}>
          <button
            onClick={runCleanup}
            disabled={running || deleteCount === 0}
            style={{
              flex: 1,
              padding: '14px 0',
              borderRadius: 12,
              border: 'none',
              background: deleteCount > 0 ? '#E94F6B' : 'rgba(255,255,255,.1)',
              color: deleteCount > 0 ? '#fff' : 'rgba(255,255,255,.3)',
              fontSize: 15,
              fontWeight: 700,
              cursor: deleteCount > 0 ? 'pointer' : 'default',
            }}
          >
            {running ? '삭제 중...' : `🗑 ${deleteCount}개 삭제 실행`}
          </button>
        </div>
      )}

      {done && (
        <div
          style={{
            background: 'rgba(76,175,80,.15)',
            border: '1px solid rgba(76,175,80,.3)',
            borderRadius: 16,
            padding: 20,
            textAlign: 'center',
            marginTop: 16,
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 700, color: '#4CAF50' }}>✅ 정리 완료</div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,.5)', marginTop: 4 }}>{status}</div>
          <button
            onClick={() => (window.location.href = '/box')}
            style={{
              marginTop: 16,
              padding: '10px 24px',
              borderRadius: 10,
              border: '1px solid rgba(255,255,255,.2)',
              background: 'transparent',
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            BOX로 돌아가기
          </button>
        </div>
      )}
    </div>
  );
}
