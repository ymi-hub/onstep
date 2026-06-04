'use client';

/**
 * /admin/cleanup — 전체 컬렉션 데이터 뷰어 + 삭제 도구
 * 모든 문서를 나열해 직접 선택 → 삭제
 */

import { useEffect, useState } from 'react';
import {
  collection, getDocs, query, orderBy, writeBatch, doc,
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
  { key: 'makeupItems',    label: '메이크업북',           icon: '💄' },
  { key: 'lookItems',      label: '룩북',                icon: '👗' },
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
    case 'makeupItems':     return { label: (d.name as string) || '?', date: (d.createdAt as string)?.slice(0, 10) };
    case 'lookItems':       return { label: (d.name as string) || '?', date: (d.createdAt as string)?.slice(0, 10) };
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

  if (loading) return (
    <div style={{ padding: 40, fontFamily: f, color: '#9A9490', textAlign: 'center' }}>{status}</div>
  );

  return (
    <div style={{ padding: '20px 24px 120px', fontFamily: f }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: '#0C0C0A', marginBottom: 4 }}>데이터 정리</div>
      <div style={{ fontSize: 12, color: '#9A9490', marginBottom: 20 }}>
        컬렉션을 펼쳐 항목을 선택하고 삭제하세요.
      </div>

      {colls.map(c => (
        <div key={c.key} style={{ marginBottom: 10, border: '1px solid rgba(12,12,10,.1)', borderRadius: 14, overflow: 'hidden' }}>
          {/* 헤더 */}
          <div onClick={() => toggleOpen(c.key)}
            style={{ display: 'flex', alignItems: 'center', padding: '13px 24px', background: '#F9F9F7', cursor: 'pointer', gap: 10 }}>
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
                <div style={{ padding: '14px 24px', fontSize: 12, color: '#BCBAB6' }}>데이터 없음</div>
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 24px', borderBottom: '1px solid rgba(12,12,10,.06)', background: '#fff' }}>
                    <button onClick={() => toggleAll(c.key)}
                      style={{ fontSize: 11, fontWeight: 700, color: '#9A9490', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                      {c.docs.every(d => c.selected.has(d.id)) ? '전체 해제' : '전체 선택'}
                    </button>
                    <span style={{ fontSize: 11, color: '#BCBAB6' }}>({c.selected.size}/{c.docs.length})</span>
                  </div>
                  {c.docs.map(row => (
                    <div key={row.id} onClick={() => toggleDoc(c.key, row.id)}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 24px', borderBottom: '1px solid rgba(12,12,10,.04)', cursor: 'pointer', background: c.selected.has(row.id) ? '#FEF2F2' : '#fff' }}>
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
        <div style={{ position: 'fixed', bottom: 0, left: 'max(0px,calc(50vw - 215px))', right: 'max(0px,calc(50vw - 215px))', padding: '12px 24px calc(env(safe-area-inset-bottom,0px) + 12px)', background: '#FAFAF8', borderTop: '1px solid rgba(12,12,10,.1)' }}>
          <button onClick={deleteSelected} disabled={deleting}
            style={{ width: '100%', height: 50, background: '#DC2626', color: '#fff', border: 'none', borderRadius: 12, fontFamily: f, fontSize: 14, fontWeight: 700, cursor: 'pointer', opacity: deleting ? .7 : 1 }}>
            {deleting ? '삭제 중…' : `선택한 ${totalSelected}개 영구 삭제`}
          </button>
        </div>
      )}
    </div>
  );
}
