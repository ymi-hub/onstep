'use client';

// app/onboarding/page.tsx — 온보딩 슬라이드 (3단계)
// design/onboarding.html을 Next.js로 변환
//
// 흐름:
//   1. localStorage 'onstep_onboarded' 확인 → 이미 있으면 / 로 이동
//   2. 슬라이드 1(공감) → 2(제안) → 3(확신) 순으로 진행
//   3. "OnStep 시작하기" 또는 SKIP → localStorage 저장 후 / 로 이동
//   4. 좌우 스와이프 지원

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';

// ─── 애니메이션 CSS ────────────────────────────────────────────────────────
// Next.js에서 keyframe 애니메이션은 <style> 태그로 주입
const KEYFRAMES = `
  @keyframes chaosIn {
    0%   { opacity: 0; transform: scale(.5) rotate(var(--r)); filter: blur(4px); }
    100% { opacity: var(--op); transform: scale(1) rotate(0deg); filter: blur(0); }
  }
  @keyframes gridReveal {
    0%   { opacity: 0; transform: scale(.95); }
    100% { opacity: 1; transform: scale(1); }
  }
  @keyframes flowDrop {
    from { opacity: 0; transform: translateY(-20px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes dashUp {
    from { opacity: 0; transform: translateY(24px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes roiFill {
    from { width: 0; }
    to   { width: var(--w); }
  }
  @keyframes btnPop {
    to { transform: translateY(0); opacity: 1; }
  }
  @keyframes float {
    0%   { transform: translateY(100vh) rotate(0deg); opacity: 0; }
    10%  { opacity: 1; }
    90%  { opacity: 1; }
    100% { transform: translateY(-100px) rotate(360deg); opacity: 0; }
  }
`;

// ─── 슬라이드 1: 공감 ─────────────────────────────────────────────────────
function Slide1() {
  // 카오스 파티클 아이템
  const CHAOS = ['💧','🌸','👗','💄','☀️','🫙','⚗️','🔬','👟','👜','💊','🌿'];

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: '0 0 100px', background: '#09090E' }}>
      {/* 카오스 파티클 */}
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
        {CHAOS.map((ic, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: `${8 + (i * 7.3) % 80}%`,
              top: `${5 + (i * 6.1) % 70}%`,
              fontSize: `${18 + (i % 3) * 6}px`,
              // @ts-expect-error CSS custom property
              '--r': `${(i % 2 === 0 ? 1 : -1) * (10 + i * 3)}deg`,
              '--op': `${0.08 + (i % 4) * 0.03}`,
              animation: `chaosIn 0.6s ${i * 0.08}s forwards`,
              opacity: 0,
            }}
          >
            {ic}
          </div>
        ))}
      </div>

      {/* 정렬된 그리드 */}
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 0, opacity: 0, animation: 'gridReveal 1s 2.2s forwards' }}>
        {[
          [
            { w: 90, h: 36, bg: 'rgba(255,255,255,.04)', border: 'rgba(255,255,255,.07)', color: 'rgba(255,255,255,.5)', text: '☀️ 23°' },
            { w: 110, h: 36, bg: 'rgba(45,59,85,.5)', border: 'rgba(45,59,85,.8)', color: 'rgba(200,215,240,.8)', text: '아침 케어' },
            { w: 80, h: 36, bg: 'rgba(200,102,110,.1)', border: 'rgba(200,102,110,.2)', color: 'rgba(200,102,110,.8)', text: 'OOTD' },
          ],
          [
            { w: 120, h: 44, bg: 'rgba(255,255,255,.03)', border: 'rgba(255,255,255,.06)', color: 'rgba(255,255,255,.4)', text: '💧 토너 → 세럼' },
            { w: 80, h: 44, bg: 'rgba(74,187,120,.08)', border: 'rgba(74,187,120,.15)', color: 'rgba(74,187,120,.7)', text: '활용률 67%' },
            { w: 72, h: 44, bg: 'rgba(255,255,255,.03)', border: 'rgba(255,255,255,.06)', color: 'rgba(255,255,255,.3)', text: '₩2.8M' },
          ],
          [
            { w: 90, h: 36, bg: 'rgba(255,255,255,.03)', border: 'rgba(255,255,255,.05)', color: 'rgba(255,255,255,.3)', text: '루틴 1 · 6step' },
            { w: 90, h: 36, bg: 'rgba(45,59,85,.3)', border: 'rgba(45,59,85,.5)', color: 'rgba(200,215,240,.6)', text: '19회차' },
            { w: 92, h: 36, bg: 'rgba(200,102,110,.08)', border: 'rgba(200,102,110,.15)', color: 'rgba(200,102,110,.6)', text: 'D-10 기한' },
          ],
        ].map((row, ri) => (
          <div key={ri} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            {row.map((cell, ci) => (
              <div
                key={ci}
                style={{
                  width: cell.w, height: cell.h,
                  background: cell.bg,
                  border: `1px solid ${cell.border}`,
                  borderRadius: 8,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, fontWeight: 600, color: cell.color,
                }}
              >
                {cell.text}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* 텍스트 */}
      <div style={{ position: 'relative', zIndex: 5, padding: '0 28px' }}>
        <div style={{ fontSize: 9, letterSpacing: 3, color: 'rgba(255,255,255,.4)', marginBottom: 12, fontWeight: 600 }}>STEP 01 · 공감</div>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 36, fontWeight: 400, color: '#fff', lineHeight: 1.25, marginBottom: 14 }}>
          당신의 아침,<br />더 이상 <em style={{ fontStyle: 'italic', color: 'rgba(255,255,255,.55)' }}>고민할</em><br />필요 없게.
        </div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,.4)', lineHeight: 1.7, fontWeight: 300 }}>
          선택의 피로를 삭제하고<br />지금 이 순간 해야 할 단 하나만 남깁니다.
        </div>
      </div>
    </div>
  );
}

// ─── 슬라이드 2: 제안 ─────────────────────────────────────────────────────
function Slide2() {
  const CARDS = [
    { icon: '🌸', bg: 'rgba(45,59,85,.5)', label: '06:30 · 아침 케어', name: '스킨케어 루틴 1', statusBg: 'rgba(74,187,120,.12)', statusColor: '#4ABB78', statusBorder: 'rgba(74,187,120,.2)', status: '✓ 완료', delay: '.3s', opacity: 1 },
    { icon: '👗', bg: 'rgba(200,102,110,.12)', label: '08:00 · 오늘의 룩', name: '오피스 캐주얼 OOTD', statusBg: 'rgba(45,59,85,.3)', statusColor: 'rgba(200,215,240,.7)', statusBorder: 'rgba(45,59,85,.5)', status: '진행 중', delay: '.5s', opacity: 1 },
    { icon: '🌙', bg: 'rgba(196,166,110,.1)', label: '21:00 · 저녁 케어', name: '나이트 루틴 1', statusBg: 'rgba(255,255,255,.04)', statusColor: 'rgba(255,255,255,.25)', statusBorder: 'rgba(255,255,255,.06)', status: '예정', delay: '.7s', opacity: 0.6 },
  ];

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: '0 0 100px', background: 'linear-gradient(175deg,#0E1520 0%,#091018 100%)' }}>
      {/* 비주얼 영역 */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '62%', overflow: 'hidden' }}>
        {/* 날씨 칩 */}
        <div style={{ position: 'absolute', top: 64, left: 28, animation: 'flowDrop .6s .2s both', opacity: 0 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 20, padding: '5px 12px', fontSize: 10, color: 'rgba(255,255,255,.6)', fontWeight: 500 }}>
            ☀️ 맑음 23° · 자외선 강함
          </div>
        </div>
        {/* 플로우 카드 */}
        <div style={{ position: 'absolute', left: 24, right: 24, top: 108, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {CARDS.map((c, i) => (
            <div key={i}>
              <div style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.07)', borderRadius: 16, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, opacity: c.opacity, animation: `flowDrop .8s ${c.delay} both` }}>
                <div style={{ width: 38, height: 38, borderRadius: 12, background: c.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>{c.icon}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 9, letterSpacing: 2, color: 'rgba(255,255,255,.35)', fontWeight: 600, marginBottom: 2 }}>{c.label}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,.9)' }}>{c.name}</div>
                </div>
                <div style={{ fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: c.statusBg, color: c.statusColor, border: `1px solid ${c.statusBorder}` }}>{c.status}</div>
              </div>
              {i < CARDS.length - 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '2px 0' }}>
                  <div style={{ width: 1, height: 12, background: 'linear-gradient(to bottom,rgba(255,255,255,.12),rgba(255,255,255,.03))' }} />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 텍스트 */}
      <div style={{ position: 'relative', zIndex: 5, padding: '0 28px' }}>
        <div style={{ fontSize: 9, letterSpacing: 3, color: 'rgba(255,255,255,.35)', marginBottom: 12, fontWeight: 600 }}>STEP 02 · 제안</div>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 36, fontWeight: 400, color: '#fff', lineHeight: 1.25, marginBottom: 14 }}>
          데이터가 제안하는<br />완벽한 오늘의<br />흐름.
        </div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,.4)', lineHeight: 1.7, fontWeight: 300 }}>
          날씨, 시간, 루틴이 연결되어<br />오늘 할 일이 자동으로 펼쳐집니다.
        </div>
      </div>
    </div>
  );
}

// ─── 슬라이드 3: 확신 ─────────────────────────────────────────────────────
function Slide3() {
  const CELLS = [
    { icon: '👗', label: '옷장', val: '147개', sub: 'CPW ₩3,200' },
    { icon: '💄', label: '화장대', val: '63개', sub: 'D-12 주의 2건' },
    { icon: '♻️', label: '활용률', val: '67%', sub: '지난달 +4%' },
    { icon: '💰', label: '이달 절약', val: '₩180K', sub: '충동구매 3건 차단' },
  ];
  const BARS = [
    { label: 'CARE ROI', pct: '83%', color: 'linear-gradient(90deg,#4ABB78,#2D9E5F)' },
    { label: 'WARDROBE ROI', pct: '67%', color: 'linear-gradient(90deg,#C4A66E,#A88B52)' },
  ];

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: '0 0 100px', background: 'linear-gradient(175deg,#0D1118 0%,#09090E 100%)' }}>
      {/* 대시보드 비주얼 */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '60%', padding: '60px 24px 0', overflow: 'hidden' }}>
        <div style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.07)', borderRadius: 20, padding: 18, animation: 'dashUp .8s .3s both', opacity: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 9, letterSpacing: 2, color: 'rgba(255,255,255,.3)', fontWeight: 600, marginBottom: 4 }}>TOTAL ASSET VALUE</div>
              <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 28, fontWeight: 600, color: '#fff', letterSpacing: -1 }}>₩2,840,000</div>
            </div>
            <div style={{ fontSize: 9, fontWeight: 700, background: 'rgba(74,187,120,.15)', color: '#4ABB78', border: '1px solid rgba(74,187,120,.2)', padding: '3px 10px', borderRadius: 20 }}>↑ ROI 67%</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {CELLS.map((c, i) => (
              <div key={i} style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.05)', borderRadius: 12, padding: 12 }}>
                <div style={{ fontSize: 16, marginBottom: 6 }}>{c.icon}</div>
                <div style={{ fontSize: 8, letterSpacing: 1.5, color: 'rgba(255,255,255,.3)', fontWeight: 600, marginBottom: 3 }}>{c.label}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'rgba(255,255,255,.9)' }}>{c.val}</div>
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,.3)', marginTop: 1 }}>{c.sub}</div>
              </div>
            ))}
          </div>
          {BARS.map((b, i) => (
            <div key={i} style={{ marginTop: i === 0 ? 10 : 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 9, color: 'rgba(255,255,255,.3)', letterSpacing: 1, fontWeight: 600 }}>{b.label}</span>
                <span style={{ fontSize: 9, color: 'rgba(255,255,255,.3)', letterSpacing: 1, fontWeight: 600 }}>{b.pct}</span>
              </div>
              <div style={{ height: 4, background: 'rgba(255,255,255,.06)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 2,
                  background: b.color,
                  // @ts-expect-error CSS custom property
                  '--w': b.pct,
                  animation: 'roiFill 1.2s .6s both cubic-bezier(.4,0,.2,1)',
                  width: 0,
                }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 텍스트 */}
      <div style={{ position: 'relative', zIndex: 5, padding: '0 28px' }}>
        <div style={{ fontSize: 9, letterSpacing: 3, color: 'rgba(255,255,255,.35)', marginBottom: 12, fontWeight: 600 }}>STEP 03 · 확신</div>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 34, fontWeight: 400, color: '#fff', lineHeight: 1.3, marginBottom: 14 }}>
          기록은 경험이 되고,<br />경험은 당신의<br />자산이 됩니다.
        </div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,.4)', lineHeight: 1.7, fontWeight: 300 }}>
          오늘 바른 크림 하나,<br />오늘 입은 옷 하나가 데이터가 됩니다.
        </div>
      </div>
    </div>
  );
}

// ─── 메인 온보딩 페이지 ────────────────────────────────────────────────────
export default function OnboardingPage() {
  const router = useRouter();
  const [cur, setCur] = useState(0);
  const touchStartX = useRef(0);

  // 이미 온보딩 완료한 경우 바로 메인으로
  useEffect(() => {
    if (typeof window !== 'undefined' && localStorage.getItem('onstep_onboarded')) {
      router.replace('/');
    }
  }, [router]);

  // 온보딩 완료 → 메인으로 이동
  function goToApp() {
    localStorage.setItem('onstep_onboarded', '1');
    router.push('/');
  }

  // 다음 슬라이드
  function next() {
    if (cur < 2) setCur((c) => c + 1);
  }

  // 이전 슬라이드 (스와이프 뒤로)
  function prev() {
    if (cur > 0) setCur((c) => c - 1);
  }

  // 스와이프 처리
  function handleTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
  }
  function handleTouchEnd(e: React.TouchEvent) {
    const diff = touchStartX.current - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 40) {
      if (diff > 0) next();
      else prev();
    }
  }

  return (
    <>
      {/* 애니메이션 keyframes 주입 */}
      <style>{KEYFRAMES}</style>

      {/* 전체 화면 오버레이 — BottomNav 위에 덮음 */}
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 9999, background: '#09090E', fontFamily: "'DM Sans','Noto Sans KR',sans-serif" }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {/* 슬라이드 컨테이너 */}
        <div
          style={{
            display: 'flex',
            width: '300%',
            height: '100%',
            transform: `translateX(-${cur * 33.333}%)`,
            transition: 'transform .6s cubic-bezier(.77,0,.18,1)',
          }}
        >
          <div style={{ width: '33.333%', height: '100%', flexShrink: 0 }}><Slide1 /></div>
          <div style={{ width: '33.333%', height: '100%', flexShrink: 0 }}><Slide2 /></div>
          <div style={{ width: '33.333%', height: '100%', flexShrink: 0 }}><Slide3 /></div>
        </div>

        {/* SKIP 버튼 */}
        <button
          onClick={goToApp}
          style={{ position: 'absolute', top: 'calc(env(safe-area-inset-top,0px) + 54px)', right: 24, fontSize: 12, color: 'rgba(255,255,255,.35)', letterSpacing: 1, fontWeight: 500, cursor: 'pointer', background: 'none', border: 'none', padding: '6px 0', zIndex: 10 }}
        >
          SKIP
        </button>

        {/* 진행 점 */}
        <div style={{ position: 'absolute', bottom: 56, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 8, zIndex: 10 }}>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              style={{
                height: 3, borderRadius: 2,
                width: cur === i ? 32 : 20,
                background: cur === i ? '#fff' : 'rgba(255,255,255,.18)',
                transition: 'all .4s cubic-bezier(.4,0,.2,1)',
              }}
            />
          ))}
        </div>

        {/* Next 버튼 (마지막 슬라이드 제외) */}
        {cur < 2 && (
          <button
            onClick={next}
            style={{ position: 'absolute', bottom: 80, right: 24, width: 52, height: 52, borderRadius: '50%', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, zIndex: 10, background: '#fff', color: '#09090E' }}
          >
            ›
          </button>
        )}

        {/* 시작 버튼 (마지막 슬라이드) */}
        {cur === 2 && (
          <button
            onClick={goToApp}
            style={{
              position: 'absolute', bottom: 80, left: 28, right: 28,
              padding: 17, background: '#fff', border: 'none', borderRadius: 50,
              fontSize: 14, fontWeight: 700, color: '#09090E', letterSpacing: 1,
              cursor: 'pointer', zIndex: 10,
              animation: 'btnPop .5s .2s forwards',
              transform: 'translateY(20px)', opacity: 0,
            }}
          >
            OnStep 시작하기 →
          </button>
        )}
      </div>
    </>
  );
}
