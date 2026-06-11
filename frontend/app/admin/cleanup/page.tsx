'use client';

/**
 * /admin/cleanup — 전체 컬렉션 데이터 뷰어 + 삭제 도구
 * 모든 문서를 나열해 직접 선택 → 삭제
 */

import { useEffect, useState } from 'react';
import {
  collection, getDocs, query, orderBy, writeBatch, doc, setDoc, updateDoc,
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { db, auth } from '@/lib/firebase';

const f = "'Plus Jakarta Sans','Space Grotesk',sans-serif";

interface DocRow {
  id: string;
  label: string;
  sub?: string;
  date?: string;
}

interface CollView {
  key: string;
  label: string;
  icon: string;
  docs: DocRow[];
  selected: Set<string>;
  open: boolean;
}

const COLLECTIONS = [
  { key: 'products',       label: '제품 (BOX)',         icon: '📦' },
  { key: 'routines',       label: '스킨케어 세션',        icon: '🌿' },
  { key: 'habits',         label: '습관 트래커',          icon: '⏰' },
  { key: 'medRoutines',    label: '약 루틴',              icon: '💊' },
  { key: 'healthRoutines', label: '건강 루틴',            icon: '🥗' },
  { key: 'healthCategories', label: '건강 카테고리',      icon: '🏷' },
  { key: 'dietPrograms',   label: '다이어트 플랜',        icon: '📋' },
  { key: 'careItems',      label: '집중케어',             icon: '🧴' },
  { key: 'libraryItems',   label: '라이브러리 (통합)',     icon: '📚' },
  { key: 'makeupItems',    label: '메이크업북 (구)',       icon: '💄' },
  { key: 'lookItems',      label: '룩북 (구)',            icon: '👗' },
  { key: 'ootdLogs',       label: 'OOTD 기록',           icon: '📸' },
  { key: 'usageLogs',      label: '사용 로그',            icon: '📊' },
  { key: 'habitLogs',      label: '습관 로그',            icon: '✅' },
  { key: 'healthLogs',     label: '건강 로그',            icon: '💪' },
  { key: 'medLogs',        label: '약 복용 로그',         icon: '💉' },
];

function docLabel(key: string, d: Record<string, unknown>): { label: string; sub?: string; date?: string } {
  switch (key) {
    case 'products':        return { label: (d.name as string) || '?', sub: `${d.domain ?? ''}${d.brand ? ' · ' + d.brand : ''}`, date: (d.createdAt as string)?.slice(0, 10) };
    case 'routines':        return { label: `Session #${d.sessionNumber ?? '?'}`, sub: `${d.startDate ?? ''} ~ ${d.endDate ?? ''}`, date: (d.createdAt as string)?.slice(0, 10) };
    case 'habits':          return { label: (d.name as string) || '?', sub: d.repeatType as string, date: (d.createdAt as string)?.slice(0, 10) };
    case 'medRoutines':     return { label: (d.name as string) || '?', sub: (d.dosage as string) || '', date: (d.createdAt as string)?.slice(0, 10) };
    case 'healthRoutines':  return { label: (d.name as string) || '?', sub: d.repeatType as string, date: (d.createdAt as string)?.slice(0, 10) };
    case 'healthCategories':return { label: `${d.icon ?? ''} ${d.name ?? '?'}`, sub: `order: ${d.order}` };
    case 'dietPrograms':    return { label: (d.name as string) || '?', sub: (d.startDate as string) || '', date: (d.createdAt as string)?.slice(0, 10) };
    case 'careItems':       return { label: (d.name as string) || '?', date: (d.createdAt as string)?.slice(0, 10) };
    case 'libraryItems':    return { label: (d.name as string) || '?', sub: `domain: ${d.domain ?? '?'}`, date: (d.createdAt as string)?.slice(0, 10) };
    case 'makeupItems':     return { label: (d.name as string) || '?', sub: '(구) beauty', date: (d.createdAt as string)?.slice(0, 10) };
    case 'lookItems':       return { label: (d.name as string) || '?', sub: '(구) fashion', date: (d.createdAt as string)?.slice(0, 10) };
    case 'ootdLogs':        return { label: (d.date as string) || '?', sub: `${d.theme ?? ''} ${d.note ? '· ' + (d.note as string).slice(0, 20) : ''}` };
    case 'usageLogs':       return { label: (d.dateStr as string) || '?', sub: `${d.timeSlot ?? ''} · productId: ${(d.productId as string)?.slice(0, 8)}` };
    case 'habitLogs':       return { label: (d.dateStr as string) || '?', sub: `habitId: ${(d.habitId as string)?.slice(0, 8)}` };
    case 'healthLogs':      return { label: (d.dateStr as string) || '?', sub: `routineId: ${(d.routineId as string)?.slice(0, 8)}` };
    case 'medLogs':         return { label: (d.dateStr as string) || '?', sub: `routineId: ${(d.routineId as string)?.slice(0, 8)}` };
    default:                return { label: d.id as string };
  }
}

export default function CleanupPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('로그인 확인 중...');
  const [colls, setColls] = useState<CollView[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [migrating, setMigrating] = useState(false);
  const [fixing, setFixing] = useState(false);

  useEffect(() => {
    if (!auth) { setStatus('Firebase 미설정'); setLoading(false); return; }
    return onAuthStateChanged(auth, u => {
      if (u) { setUserId(u.uid); }
      else { setStatus('로그인 필요'); setLoading(false); }
    });
  }, []);

  useEffect(() => {
    if (!userId || !db) return;
    loadAll(userId);
  }, [userId]);

  async function loadAll(uid: string) {
    if (!db) return;
    setStatus('불러오는 중...');
    const _db = db;
    const result: CollView[] = [];

    for (const { key, label, icon } of COLLECTIONS) {
      try {
        let q;
        try { q = query(collection(_db, 'users', uid, key), orderBy('createdAt', 'desc')); }
        catch { q = collection(_db, 'users', uid, key) as Parameters<typeof getDocs>[0]; }
        const snap = await getDocs(q);
        const docs: DocRow[] = snap.docs.map(d => {
          const data = d.data() as Record<string, unknown>;
          const { label: lbl, sub, date } = docLabel(key, { ...data, id: d.id });
          return { id: d.id, label: lbl, sub, date };
        });
        result.push({ key, label, icon, docs, selected: new Set(), open: false });
      } catch {
        result.push({ key, label, icon, docs: [], selected: new Set(), open: false });
      }
    }

    setColls(result);
    setStatus('');
    setLoading(false);
  }

  function toggleOpen(key: string) {
    setColls(prev => prev.map(c => c.key === key ? { ...c, open: !c.open } : c));
  }

  function toggleDoc(collKey: string, docId: string) {
    setColls(prev => prev.map(c => {
      if (c.key !== collKey) return c;
      const sel = new Set(c.selected);
      sel.has(docId) ? sel.delete(docId) : sel.add(docId);
      return { ...c, selected: sel };
    }));
  }

  function toggleAll(collKey: string) {
    setColls(prev => prev.map(c => {
      if (c.key !== collKey) return c;
      const allSel = c.docs.every(d => c.selected.has(d.id));
      return { ...c, selected: allSel ? new Set() : new Set(c.docs.map(d => d.id)) };
    }));
  }

  const totalSelected = colls.reduce((n, c) => n + c.selected.size, 0);

  async function deleteSelected() {
    if (!userId || !db || totalSelected === 0) return;
    const items = colls.flatMap(c => [...c.selected].map(id => ({ coll: c.key, id, label: c.label })));
    if (!confirm(`${items.length}개 항목을 영구 삭제할까요?\n이 작업은 되돌릴 수 없습니다.`)) return;
    setDeleting(true);
    const _db = db;
    const lines: string[] = [];
    try {
      // writeBatch 한도(500)를 고려해 청크로 나눔
      for (let i = 0; i < items.length; i += 400) {
        const chunk = items.slice(i, i + 400);
        const batch = writeBatch(_db);
        chunk.forEach(({ coll, id, label }) => {
          batch.delete(doc(_db, 'users', userId, coll, id));
          lines.push(`✓ [${label}] ${id}`);
        });
        await batch.commit();
      }
      lines.push(`\n총 ${items.length}개 삭제 완료`);
      setLogLines(lines);
      await loadAll(userId);
    } catch (err) {
      lines.push(`✕ 오류: ${err instanceof Error ? err.message : String(err)}`);
      setLogLines(lines);
    }
    setDeleting(false);
  }

  // undefined 재귀 제거 (Firestore 저장 전 정리)
  function stripUndefined(val: unknown): unknown {
    if (Array.isArray(val)) return val.map(stripUndefined);
    if (val !== null && typeof val === 'object') {
      return Object.fromEntries(
        Object.entries(val as Record<string, unknown>)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, stripUndefined(v)])
      );
    }
    return val;
  }

  // makeupItems/lookItems → undefined 필드 in-place 정리
  async function fixUndefinedFields() {
    if (!userId || !db) return;
    setFixing(true);
    const lines: string[] = ['=== undefined 필드 정리 시작 ==='];
    const _db = db;
    let fixed = 0;
    for (const coll of ['makeupItems', 'lookItems']) {
      const snap = await getDocs(collection(_db, 'users', userId, coll));
      for (const d of snap.docs) {
        const raw = d.data();
        const cleaned = stripUndefined(raw) as Record<string, unknown>;
        // items/tipItems만 업데이트 (undefined가 있는 배열 필드)
        const patch: Record<string, unknown> = {};
        if (raw.items !== undefined) patch.items = cleaned.items ?? [];
        if (raw.tipItems !== undefined) patch.tipItems = cleaned.tipItems ?? [];
        if (Object.keys(patch).length > 0) {
          await updateDoc(doc(_db, 'users', userId, coll, d.id), patch);
          lines.push(`✓ [${coll}] ${(raw.name as string) || d.id} — 정리 완료`);
          fixed++;
        }
      }
    }
    lines.push(`\n총 ${fixed}개 문서 정리 완료`);
    setLogLines(lines);
    setFixing(false);
    await loadAll(userId);
  }

  // makeupItems(domain:beauty) + lookItems(domain:fashion) → libraryItems 마이그레이션
  async function migrateToLibraryItems() {
    if (!userId || !db) return;
    if (!confirm('makeupItems/lookItems를 libraryItems로 마이그레이션합니다.\n기존 문서는 삭제되지 않습니다. 계속할까요?')) return;
    setMigrating(true);
    const lines: string[] = ['=== libraryItems 마이그레이션 시작 ==='];
    const _db = db;
    let count = 0;
    const migrations = [
      { src: 'makeupItems', domain: 'beauty' },
      { src: 'lookItems',   domain: 'fashion' },
    ];
    for (const { src, domain } of migrations) {
      const snap = await getDocs(collection(_db, 'users', userId, src));
      for (const d of snap.docs) {
        const raw = stripUndefined(d.data()) as Record<string, unknown>;
        const data = {
          ...raw,
          domain,
          items:    (raw.items    as unknown[] | undefined) ?? [],
          tipItems: (raw.tipItems as unknown[] | undefined) ?? [],
        };
        await setDoc(doc(_db, 'users', userId, 'libraryItems', d.id), data);
        lines.push(`✓ [${src} → libraryItems] ${(raw.name as string) || d.id} (domain: ${domain})`);
        count++;
      }
    }
    lines.push(`\n총 ${count}개 마이그레이션 완료`);
    lines.push('⚠ 구 컬렉션(makeupItems/lookItems)은 수동으로 삭제하세요.');
    setLogLines(lines);
    setMigrating(false);
    await loadAll(userId);
  }

  if (loading) return (
    <div style={{ padding: 40, fontFamily: f, color: '#9A9490', textAlign: 'center' }}>{status}</div>
  );

  return (
    <div style={{ padding: '20px 26px 120px', fontFamily: f }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: '#0C0C0A', marginBottom: 4 }}>데이터 정리</div>
      <div style={{ fontSize: 12, color: '#9A9490', marginBottom: 16 }}>
        컬렉션을 펼쳐 항목을 선택하고 삭제하세요.
      </div>

      {/* 데이터 유지보수 도구 */}
      <div style={{ marginBottom: 20, padding: 16, background: '#F4F4F0', borderRadius: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#0C0C0A', marginBottom: 2 }}>🔧 데이터 유지보수</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' as const }}>
          <button type="button" onClick={fixUndefinedFields} disabled={fixing || migrating}
            style={{ padding: '9px 16px', background: fixing ? '#EBEBEB' : '#0C0C0A', color: fixing ? '#9A9490' : '#C5FF00', border: 'none', borderRadius: 10, fontFamily: f, fontSize: 12, fontWeight: 700, cursor: fixing ? 'default' : 'pointer' }}>
            {fixing ? '정리 중...' : '① undefined 필드 정리'}
          </button>
          <button type="button" onClick={migrateToLibraryItems} disabled={migrating || fixing}
            style={{ padding: '9px 16px', background: migrating ? '#EBEBEB' : '#1D6DDB', color: migrating ? '#9A9490' : '#fff', border: 'none', borderRadius: 10, fontFamily: f, fontSize: 12, fontWeight: 700, cursor: migrating ? 'default' : 'pointer' }}>
            {migrating ? '마이그레이션 중...' : '② libraryItems 마이그레이션'}
          </button>
        </div>
        <div style={{ fontSize: 11, color: '#9A9490', lineHeight: 1.6 }}>
          ① 먼저 실행 → makeupItems/lookItems의 undefined 필드 제거<br />
          ② 이후 실행 → libraryItems 통합 컬렉션으로 복사 (기존 데이터 유지)
        </div>
      </div>

      {colls.map(c => (
        <div key={c.key} style={{ marginBottom: 10, border: '1px solid rgba(12,12,10,.1)', borderRadius: 14, overflow: 'hidden' }}>
          {/* 헤더 */}
          <div onClick={() => toggleOpen(c.key)}
            style={{ display: 'flex', alignItems: 'center', padding: '13px 26px', background: '#F9F9F7', cursor: 'pointer', gap: 10 }}>
            <span style={{ fontSize: 18 }}>{c.icon}</span>
            <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: '#0C0C0A' }}>{c.label}</span>
            <span style={{ fontSize: 12, color: '#9A9490' }}>{c.docs.length}개</span>
            {c.selected.size > 0 && (
              <span style={{ background: '#FEE2E2', color: '#DC2626', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 9999 }}>
                {c.selected.size}선택
              </span>
            )}
            <span style={{ fontSize: 12, color: '#BCBAB6' }}>{c.open ? '▲' : '▼'}</span>
          </div>

          {/* 문서 목록 */}
          {c.open && (
            <div>
              {c.docs.length === 0 ? (
                <div style={{ padding: '14px 26px', fontSize: 12, color: '#BCBAB6' }}>데이터 없음</div>
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 26px', borderBottom: '1px solid rgba(12,12,10,.06)', background: '#fff' }}>
                    <button onClick={() => toggleAll(c.key)}
                      style={{ fontSize: 11, fontWeight: 700, color: '#9A9490', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                      {c.docs.every(d => c.selected.has(d.id)) ? '전체 해제' : '전체 선택'}
                    </button>
                    <span style={{ fontSize: 11, color: '#BCBAB6' }}>({c.selected.size}/{c.docs.length})</span>
                  </div>
                  {c.docs.map(row => (
                    <div key={row.id} onClick={() => toggleDoc(c.key, row.id)}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 26px', borderBottom: '1px solid rgba(12,12,10,.04)', cursor: 'pointer', background: c.selected.has(row.id) ? '#FEF2F2' : '#fff' }}>
                      <div style={{ width: 16, height: 16, borderRadius: 3, border: `2px solid ${c.selected.has(row.id) ? '#DC2626' : 'rgba(12,12,10,.2)'}`, background: c.selected.has(row.id) ? '#DC2626' : '#fff', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {c.selected.has(row.id) && <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#0C0C0A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.label}</div>
                        {row.sub && <div style={{ fontSize: 11, color: '#9A9490', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.sub}</div>}
                      </div>
                      {row.date && <span style={{ fontSize: 11, color: '#BCBAB6', flexShrink: 0 }}>{row.date}</span>}
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      ))}

      {/* 삭제 로그 */}
      {logLines.length > 0 && (
        <div style={{ marginTop: 16, padding: 14, background: '#F4F4F0', borderRadius: 12, fontSize: 11, fontFamily: 'monospace', whiteSpace: 'pre-wrap', color: '#4A4846', lineHeight: 1.7 }}>
          {logLines.join('\n')}
        </div>
      )}

      {/* 하단 고정 삭제 버튼 */}
      {totalSelected > 0 && (
        <div style={{ position: 'fixed', bottom: 0, left: 'max(0px,calc(50vw - 215px))', right: 'max(0px,calc(50vw - 215px))', padding: '12px 26px calc(env(safe-area-inset-bottom,0px) + 12px)', background: '#FAFAF8', borderTop: '1px solid rgba(12,12,10,.1)' }}>
          <button onClick={deleteSelected} disabled={deleting}
            style={{ width: '100%', height: 50, background: '#DC2626', color: '#fff', border: 'none', borderRadius: 12, fontFamily: f, fontSize: 14, fontWeight: 700, cursor: 'pointer', opacity: deleting ? .7 : 1 }}>
            {deleting ? '삭제 중…' : `선택한 ${totalSelected}개 영구 삭제`}
          </button>
        </div>
      )}
    </div>
  );
}
