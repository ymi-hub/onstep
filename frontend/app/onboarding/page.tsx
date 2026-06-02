'use client';

// app/onboarding/page.tsx — 온보딩 슬라이드 (3단계)
//
// 구조 변경 포인트:
//   - position: fixed → 제거. NavWrapper가 BottomNav를 숨기므로
//     <main>이 100dvh를 채움. 그 안에서 height: 100dvh로 자연스럽게 꽉 참.
//   - 전체 화면이 아닌 430px 앱 박스 안에서 렌더링됨 (앱 화면처럼 보임)
//   - 슬라이드 1 → 킹받은 귀요미 캐릭터(logo.png) 중심 웰컴 화면
//   - 슬라이드 2 → 오늘 흐름 시각화 (기존 유지)
//   - 슬라이드 3 → 소형 캐릭터 + 통계 미니카드 + 시작 버튼
//
// 흐름:
//   1. localStorage 'onstep_onboarded' 확인 → 이미 있으면 / 로 이동
//   2. 슬라이드 1 → 2 → 3
//   3. "OnStep 시작하기" 또는 SKIP → localStorage 저장 후 / 로 이동
//   4. 좌우 스와이프 지원

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { signInWithRedirect, GoogleAuthProvider } from 'firebase/auth';
import { auth } from '@/lib/firebase';

// ─── 애니메이션 keyframes ──────────────────────────────────────────────────
// CSS 애니메이션은 <style> 태그로 주입한다.
// (Tailwind는 keyframe 커스터마이징이 복잡하므로 인라인 style 방식 유지)
const KEYFRAMES = `
  /* 캐릭터 둥실둥실 */
  @keyframes charBounce {
    0%, 100% { transform: translateY(0) rotate(-1.5deg) scale(1); }
    50%       { transform: translateY(-14px) rotate(1.5deg) scale(1.03); }
  }
  /* 배경 글로우 pulse */
  @keyframes glowPulse {
    0%, 100% { opacity: 0.4; transform: translate(-50%,-50%) scale(1); }
    50%       { opacity: 0.7; transform: translate(-50%,-50%) scale(1.08); }
  }
  /* 파티클 둥실 */
  @keyframes particleDrift {
    0%   { transform: translateY(0) rotate(0deg)   scale(1);    opacity: 0.7; }
    33%  { transform: translateY(-16px) rotate(8deg)  scale(1.08); opacity: 1;   }
    66%  { transform: translateY(-8px)  rotate(-5deg) scale(0.96); opacity: 0.85;}
    100% { transform: translateY(0) rotate(0deg)   scale(1);    opacity: 0.7; }
  }
  /* 아래에서 위로 페이드인 */
  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(24px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  /* 위에서 아래로 페이드인 */
  @keyframes flowDrop {
    from { opacity: 0; transform: translateY(-20px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  /* ROI 바 채우기 */
  @keyframes roiFill {
    from { width: 0; }
    to   { width: var(--w); }
  }
  /* 시작 버튼 팝 */
  @keyframes btnPop {
    to { transform: translateY(0); opacity: 1; }
  }
  /* 별 반짝 */
  @keyframes starTwinkle {
    0%, 100% { opacity: 0; transform: scale(0) rotate(0deg); }
    50%       { opacity: 1; transform: scale(1) rotate(180deg); }
  }
`;

// ─── Slide 1 : 캐릭터 웰컴 ────────────────────────────────────────────────
// 킹받은 귀요미 캐릭터가 화면 중앙에서 둥실둥실.
// 주변에 스킨케어/라이프스타일 이모지가 파티클처럼 떠다님.
function Slide1() {
  // 파티클 이모지: 위치·지연시간·크기 등을 미리 고정값으로 정의
  // (Math.random() 는 서버/클라이언트 hydration 불일치 유발하므로 사용 금지)
  const PARTICLES = [
    { emoji: '🌸', x: 12, y: 18, size: 22, delay: 0,    dur: 3.2 },
    { emoji: '💧', x: 82, y: 14, size: 18, delay: 0.6,  dur: 3.8 },
    { emoji: '✨', x: 18, y: 52, size: 16, delay: 1.1,  dur: 2.9 },
    { emoji: '🫧', x: 78, y: 48, size: 20, delay: 0.3,  dur: 3.5 },
    { emoji: '🌿', x: 8,  y: 72, size: 18, delay: 0.9,  dur: 4.0 },
    { emoji: '💫', x: 86, y: 68, size: 22, delay: 1.4,  dur: 3.3 },
    { emoji: '🌙', x: 48, y: 10, size: 20, delay: 0.5,  dur: 3.6 },
    { emoji: '🍯', x: 62, y: 78, size: 16, delay: 1.7,  dur: 2.8 },
    { emoji: '⭐', x: 30, y: 82, size: 14, delay: 0.2,  dur: 4.2 },
  ];

  return (
    <div style={{
      width: '100%', height: '100%',
      background: 'linear-gradient(180deg, #0D0D1A 0%, #131025 50%, #0F0E20 100%)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      position: 'relative', overflow: 'hidden',
    }}>
      {/* 배경 글로우 — 캐릭터 뒤에서 은은하게 빛남 */}
      <div style={{
        position: 'absolute',
        top: '38%', left: '50%',
        transform: 'translate(-50%, -50%)',
        width: 300, height: 300,
        background: 'radial-gradient(circle, rgba(233,79,107,0.18) 0%, rgba(233,79,107,0.05) 50%, transparent 70%)',
        borderRadius: '50%',
        animation: 'glowPulse 4s ease-in-out infinite',
        pointerEvents: 'none',
      }} />
      {/* 보조 글로우 (보라빛) */}
      <div style={{
        position: 'absolute',
        top: '42%', left: '45%',
        transform: 'translate(-50%, -50%)',
        width: 200, height: 200,
        background: 'radial-gradient(circle, rgba(130,80,200,0.12) 0%, transparent 60%)',
        borderRadius: '50%',
        animation: 'glowPulse 5s 1s ease-in-out infinite',
        pointerEvents: 'none',
      }} />

      {/* 파티클 이모지들 */}
      {PARTICLES.map((p, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: `${p.x}%`,
            top: `${p.y}%`,
            fontSize: p.size,
            animation: `particleDrift ${p.dur}s ${p.delay}s ease-in-out infinite`,
            pointerEvents: 'none',
            // 파티클은 캐릭터보다 뒤에 있어야 하므로 zIndex 낮게
            zIndex: 0,
          }}
        >
          {p.emoji}
        </div>
      ))}

      {/* ── 캐릭터 ── */}
      {/*
        filter: drop-shadow 는 바깥 div에 유지.
        안쪽 div에 borderRadius 50% + overflow hidden → 원형으로 크롭해서
        PNG 배경색 사각 테두리가 사라지고 캐릭터만 공중에 떠있는 효과.
      */}
      <div style={{
        position: 'relative', zIndex: 2,
        animation: 'charBounce 3.5s ease-in-out infinite',
        marginBottom: 8,
        filter: 'drop-shadow(0 24px 48px rgba(233,79,107,0.4)) drop-shadow(0 8px 16px rgba(0,0,0,0.4))',
      }}>
        <div style={{ borderRadius: '50%', overflow: 'hidden', width: 180, height: 180 }}>
          <Image
            src="/logo.png"
            alt="OnStep 캐릭터"
            width={180}
            height={180}
            style={{ objectFit: 'cover', display: 'block' }}
            priority
          />
        </div>
      </div>

      {/* ── 텍스트 블록 ── */}
      {/*
        both 필모드: 딜레이 동안 from(opacity:0) 상태 유지 → 딜레이를 최소화해야
        첫 화면이 빈 화면처럼 보이지 않음. 0.4s → 0.1s로 단축.
      */}
      <div style={{
        position: 'relative', zIndex: 2,
        textAlign: 'center',
        padding: '0 36px',
        animation: 'fadeUp 0.7s 0.1s both',
      }}>
        {/* 브랜드 레터링 */}
        <div style={{
          fontFamily: "'Cormorant Garamond', serif",
          fontSize: 11,
          letterSpacing: 10,
          color: 'rgba(255,255,255,0.4)',
          marginBottom: 18,
          fontWeight: 300,
        }}>
          ONSTEP
        </div>

        {/* 메인 카피 */}
        <div style={{
          fontFamily: "'Cormorant Garamond', serif",
          fontSize: 34,
          fontWeight: 400,
          color: '#fff',
          lineHeight: 1.3,
          marginBottom: 16,
        }}>
          당신의 하루를<br />
          <em style={{
            fontStyle: 'italic',
            // 포인트 컬러 그라데이션
            background: 'linear-gradient(135deg, #E94F6B, #F4847A)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}>더 가볍게.</em>
        </div>

        {/* 서브카피 */}
        <div style={{
          fontSize: 13,
          color: 'rgba(255,255,255,0.42)',
          lineHeight: 1.75,
          fontWeight: 300,
          letterSpacing: 0.2,
        }}>
          스킨케어부터 라이프스타일까지<br />
          제로 설정으로 관리하는 Life OS
        </div>
      </div>

      {/* 하단 힌트 (스와이프 유도) */}
      <div style={{
        position: 'absolute', bottom: 40,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
        animation: 'fadeUp 0.6s 0.4s both',
        zIndex: 2,
      }}>
        <div style={{ fontSize: 9, letterSpacing: 3, color: 'rgba(255,255,255,0.2)', fontWeight: 600 }}>
          SWIPE TO EXPLORE
        </div>
        {/* 작은 물결 선 3개 */}
        <div style={{ display: 'flex', gap: 4 }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              width: 16, height: 2, borderRadius: 1,
              background: `rgba(255,255,255,${0.08 + i * 0.06})`,
            }} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Slide 2 : 오늘의 흐름 ────────────────────────────────────────────────
// 날씨 칩 + 루틴 플로우 카드로 "앱이 하루를 이렇게 안내해요"를 보여줌.
function Slide2() {
  const CARDS = [
    {
      icon: '🌸', iconBg: 'rgba(45,59,85,.5)',
      label: '06:30 · 아침 케어', name: '스킨케어 루틴',
      statusBg: 'rgba(74,187,120,.12)', statusColor: '#4ABB78',
      statusBorder: 'rgba(74,187,120,.2)', status: '✓ 완료',
      delay: '.3s', opacity: 1,
    },
    {
      // OOTD(미구현) 대신 루틴 완료 후 자동 기록 — LOG 기능 소개
      icon: '📝', iconBg: 'rgba(200,120,80,.12)',
      label: '루틴 완료 · 자동 기록', name: '오늘의 사용 기록',
      statusBg: 'rgba(74,187,120,.08)', statusColor: 'rgba(74,187,120,.7)',
      statusBorder: 'rgba(74,187,120,.15)', status: '자동 저장',
      delay: '.5s', opacity: 1,
    },
    {
      icon: '🌙', iconBg: 'rgba(196,166,110,.1)',
      label: '21:00 · 나이트 케어', name: '나이트 루틴',
      statusBg: 'rgba(255,255,255,.04)', statusColor: 'rgba(255,255,255,.25)',
      statusBorder: 'rgba(255,255,255,.06)', status: '예정',
      delay: '.7s', opacity: 0.55,
    },
  ];

  return (
    <div style={{
      width: '100%', height: '100%',
      background: 'linear-gradient(175deg, #0E1520 0%, #091018 100%)',
      position: 'relative', display: 'flex', flexDirection: 'column',
      justifyContent: 'flex-end', padding: '0 0 100px',
    }}>
      {/* 상단 비주얼 영역 */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '62%', overflow: 'hidden' }}>

        {/* 날씨 칩 */}
        <div style={{
          position: 'absolute', top: 64, left: 28,
          animation: 'flowDrop .6s .2s both', opacity: 0,
        }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)',
            borderRadius: 20, padding: '5px 14px',
            fontSize: 11, color: 'rgba(255,255,255,.65)', fontWeight: 500,
          }}>
            ☀️ 맑음 23° &nbsp;·&nbsp; 자외선 강함
          </div>
        </div>

        {/* 플로우 카드 목록 */}
        <div style={{ position: 'absolute', left: 24, right: 24, top: 112, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {CARDS.map((c, i) => (
            <div key={i}>
              <div style={{
                background: 'rgba(255,255,255,.04)',
                border: '1px solid rgba(255,255,255,.07)',
                borderRadius: 16, padding: '14px 16px',
                display: 'flex', alignItems: 'center', gap: 12,
                opacity: c.opacity,
                animation: `flowDrop .8s ${c.delay} both`,
              }}>
                {/* 아이콘 */}
                <div style={{
                  width: 40, height: 40, borderRadius: 12,
                  background: c.iconBg,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 20, flexShrink: 0,
                }}>
                  {c.icon}
                </div>
                {/* 텍스트 */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 9, letterSpacing: 2, color: 'rgba(255,255,255,.35)', fontWeight: 600, marginBottom: 3 }}>
                    {c.label}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,.9)' }}>
                    {c.name}
                  </div>
                </div>
                {/* 상태 배지 */}
                <div style={{
                  fontSize: 10, fontWeight: 700,
                  padding: '4px 11px', borderRadius: 20,
                  background: c.statusBg, color: c.statusColor,
                  border: `1px solid ${c.statusBorder}`,
                  whiteSpace: 'nowrap', flexShrink: 0,
                }}>
                  {c.status}
                </div>
              </div>
              {/* 카드 연결선 */}
              {i < CARDS.length - 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '2px 0' }}>
                  <div style={{
                    width: 1, height: 12,
                    background: 'linear-gradient(to bottom, rgba(255,255,255,.14), rgba(255,255,255,.02))',
                  }} />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 하단 텍스트 */}
      <div style={{ position: 'relative', zIndex: 5, padding: '0 28px' }}>
        <div style={{ fontSize: 9, letterSpacing: 3, color: 'rgba(255,255,255,.35)', marginBottom: 12, fontWeight: 600 }}>
          STEP 02 · 제안
        </div>
        <div style={{
          fontFamily: "'Cormorant Garamond', serif",
          fontSize: 36, fontWeight: 400, color: '#fff',
          lineHeight: 1.25, marginBottom: 14,
        }}>
          데이터가 제안하는<br />완벽한 오늘의<br />흐름.
        </div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,.42)', lineHeight: 1.75, fontWeight: 300 }}>
          날씨, 시간, 루틴이 연결되어<br />오늘 할 일이 자동으로 펼쳐집니다.
        </div>
      </div>
    </div>
  );
}

// ─── Slide 3 : 확신 + 시작 ────────────────────────────────────────────────
// 소형 캐릭터 + 통계 미니카드 3개 + "OnStep 시작하기" 버튼.
// 마지막 슬라이드라 시작 버튼이 이 컴포넌트 밖에서 오버레이됨.
function Slide3() {
  const STATS = [
    { icon: '💄', val: '63개', label: '화장대' },
    { icon: '♻️', val: '67%',  label: '활용률' },
    { icon: '💰', val: '₩180K', label: '이달 절약' },
  ];

  return (
    <div style={{
      width: '100%', height: '100%',
      background: 'linear-gradient(180deg, #0D0D1A 0%, #0A1015 100%)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      position: 'relative', overflow: 'hidden',
      padding: '0 28px 110px', // 하단 버튼 공간 확보 (140 → 110으로 공백 줄임)
    }}>
      {/* 배경 글로우 (초록빛 — 성취/확신 분위기) */}
      <div style={{
        position: 'absolute', top: '30%', left: '50%',
        transform: 'translate(-50%, -50%)',
        width: 280, height: 280,
        background: 'radial-gradient(circle, rgba(74,187,120,0.10) 0%, transparent 65%)',
        borderRadius: '50%',
        pointerEvents: 'none',
      }} />

      {/* 소형 캐릭터 */}
      <div style={{
        animation: 'charBounce 3.2s ease-in-out infinite',
        marginBottom: 20,
        filter: 'drop-shadow(0 16px 32px rgba(74,187,120,0.3)) drop-shadow(0 6px 12px rgba(0,0,0,0.3))',
        zIndex: 1,
      }}>
        <div style={{ borderRadius: '50%', overflow: 'hidden', width: 110, height: 110 }}>
          <Image
            src="/logo.png"
            alt="OnStep 캐릭터"
            width={110}
            height={110}
            style={{ objectFit: 'cover', display: 'block' }}
          />
        </div>
      </div>

      {/* 텍스트 */}
      <div style={{
        textAlign: 'center', width: '100%',
        animation: 'fadeUp 0.7s 0.1s both',
        zIndex: 1,
      }}>
        <div style={{ fontSize: 9, letterSpacing: 3, color: 'rgba(255,255,255,.35)', marginBottom: 12, fontWeight: 600 }}>
          STEP 03 · 확신
        </div>
        <div style={{
          fontFamily: "'Cormorant Garamond', serif",
          fontSize: 32, fontWeight: 400, color: '#fff',
          lineHeight: 1.35, marginBottom: 14,
        }}>
          기록은 경험이 되고,<br />경험은 당신의<br />자산이 됩니다.
        </div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,.42)', lineHeight: 1.75, fontWeight: 300, marginBottom: 28 }}>
          오늘 바른 크림 하나,<br />오늘 입은 옷 하나가 데이터가 됩니다.
        </div>
      </div>

      {/* 통계 미니카드 — 예시 레이블 + 3개 카드 */}
      <div style={{
        width: '100%', animation: 'fadeUp 0.8s 0.5s both', zIndex: 1,
      }}>
        {/* 예시 안내 — 실제 수치가 아님을 명시 */}
        <div style={{
          textAlign: 'center', fontSize: 8, letterSpacing: 2,
          color: 'rgba(255,255,255,.18)', fontWeight: 600, marginBottom: 10,
        }}>
          SAMPLE · 예시 데이터
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
        {STATS.map((s, i) => (
          <div key={i} style={{
            background: 'rgba(255,255,255,.04)',
            border: '1px solid rgba(255,255,255,.09)',
            borderRadius: 16, padding: '14px 12px',
            textAlign: 'center', flex: 1,
          }}>
            <div style={{ fontSize: 22, marginBottom: 6 }}>{s.icon}</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,.9)' }}>{s.val}</div>
            <div style={{
              fontSize: 9, letterSpacing: 0.5,
              color: 'rgba(255,255,255,.3)', marginTop: 3, fontWeight: 500,
            }}>
              {s.label}
            </div>
          </div>
        ))}
        </div>{/* /flex row */}

        {/* CTA 브릿지 문구 — 예시 수치임을 자연스럽게 인식시키고 시작을 유도 */}
        <div style={{
          textAlign: 'center', marginTop: 18,
          fontSize: 11, color: 'rgba(255,255,255,.22)',
          lineHeight: 1.6, fontWeight: 300,
          animation: 'fadeUp 0.6s 0.7s both',
        }}>
          지금 시작하면 나만의 데이터가 채워집니다
        </div>
      </div>{/* /통계 래퍼 */}
    </div>
  );
}

// ─── 메인 온보딩 페이지 ────────────────────────────────────────────────────
export default function OnboardingPage() {
  const router = useRouter();
  // 현재 슬라이드 인덱스 (0=웰컴, 1=제안, 2=확신)
  const [cur, setCur] = useState(0);
  const touchStartX = useRef(0);

  // 이미 온보딩 완료한 경우 바로 메인으로 이동
  useEffect(() => {
    if (typeof window !== 'undefined' && localStorage.getItem('onstep_onboarded')) {
      router.replace('/');
    }
  }, [router]);

  // 온보딩 완료 → 메인으로
  function goToApp() {
    localStorage.setItem('onstep_onboarded', '1');
    router.push('/');
  }

  // Google 로그인 후 메인으로 (redirect 방식 → 돌아오면 / 에 착지)
  function signInWithGoogle() {
    localStorage.setItem('onstep_onboarded', '1');
    if (auth) {
      signInWithRedirect(auth, new GoogleAuthProvider());
    } else {
      router.push('/');
    }
  }

  function next() { if (cur < 2) setCur((c) => c + 1); }
  function prev() { if (cur > 0) setCur((c) => c - 1); }

  // 터치 스와이프 지원
  function onTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
  }
  function onTouchEnd(e: React.TouchEvent) {
    const diff = touchStartX.current - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 44) {
      if (diff > 0) next();
      else prev();
    }
  }

  return (
    <>
      {/* keyframe 애니메이션 주입 */}
      <style>{KEYFRAMES}</style>

      {/*
        ★ position: fixed 를 쓰지 않음!
        NavWrapper 덕분에 BottomNav가 사라져 <main>이 100dvh를 차지한다.
        이 컨테이너도 height: 100dvh로 채우면 앱 화면 안에 꽉 맞음.
        ★ overflow: hidden 으로 슬라이드가 옆으로 삐져나가지 않도록.
      */}
      <div
        style={{
          height: '100dvh',
          overflow: 'hidden',
          position: 'relative',
          fontFamily: "'DM Sans', 'Noto Sans KR', sans-serif",
          background: '#0D0D1A',
        }}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {/* ── 슬라이드 트랙 ── */}
        {/*
          width: 300% + translateX 로 3개 슬라이드를 가로로 배치.
          transition: transform 으로 부드럽게 슬라이드.
        */}
        <div style={{
          display: 'flex',
          width: '300%', height: '100%',
          transform: `translateX(-${cur * 33.333}%)`,
          transition: 'transform .55s cubic-bezier(.77,0,.18,1)',
        }}>
          <div style={{ width: '33.333%', height: '100%', flexShrink: 0 }}><Slide1 /></div>
          <div style={{ width: '33.333%', height: '100%', flexShrink: 0 }}><Slide2 /></div>
          <div style={{ width: '33.333%', height: '100%', flexShrink: 0 }}><Slide3 /></div>
        </div>

        {/* ── SKIP 버튼 ── */}
        <button
          onClick={goToApp}
          style={{
            position: 'absolute',
            // iOS safe area 대응: 상단 노치 아래에 위치
            top: 'calc(env(safe-area-inset-top, 0px) + 52px)',
            right: 24,
            fontSize: 11, letterSpacing: 1.5,
            color: 'rgba(255,255,255,.3)', fontWeight: 600,
            cursor: 'pointer', background: 'none', border: 'none',
            padding: '8px 0', zIndex: 10,
            fontFamily: 'inherit',
          }}
        >
          SKIP
        </button>

        {/* ── 진행 점 (pill 형태) ── */}
        <div style={{
          position: 'absolute', bottom: 52, left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex', gap: 8, zIndex: 10,
        }}>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              style={{
                height: 3, borderRadius: 2,
                // 활성 점은 더 길고 밝게
                width: cur === i ? 28 : 16,
                background: cur === i ? 'rgba(255,255,255,.9)' : 'rgba(255,255,255,.18)',
                transition: 'all .4s cubic-bezier(.4,0,.2,1)',
              }}
            />
          ))}
        </div>

        {/* ── Next 버튼 (슬라이드 2까지만) ── */}
        {cur < 2 && (
          <button
            onClick={next}
            style={{
              position: 'absolute', bottom: 72, right: 24,
              width: 52, height: 52, borderRadius: '50%',
              border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 22, zIndex: 10,
              background: '#fff', color: '#09090E',
              boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
              transition: 'transform .2s, box-shadow .2s',
              fontFamily: 'inherit',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1.08)';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)';
            }}
          >
            ›
          </button>
        )}

        {/* ── 시작 버튼 (마지막 슬라이드) ── */}
        {cur === 2 && (
          <div
            style={{
              position: 'absolute', bottom: 60, left: 28, right: 28,
              display: 'flex', flexDirection: 'column', gap: 12,
              animation: 'btnPop .5s .15s forwards',
              transform: 'translateY(20px)', opacity: 0,
              zIndex: 10,
            }}
          >
            {/* Google 로그인 (primary) */}
            <button
              onClick={signInWithGoogle}
              style={{
                width: '100%', padding: '16px 0',
                background: '#fff',
                border: 'none', borderRadius: 50,
                fontSize: 14, fontWeight: 700,
                color: '#09090E', letterSpacing: 0.3,
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
                fontFamily: 'inherit',
              }}
            >
              {/* Google G 아이콘 */}
              <svg width="18" height="18" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Google로 시작하기
            </button>

            {/* 둘러보기 (secondary) */}
            <button
              onClick={goToApp}
              style={{
                width: '100%', padding: '12px 0',
                background: 'transparent',
                border: '1.5px solid rgba(255,255,255,.2)', borderRadius: 50,
                fontSize: 13, fontWeight: 600,
                color: 'rgba(255,255,255,.55)', letterSpacing: 0.3,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              로그인 없이 둘러보기
            </button>
          </div>
        )}
      </div>
    </>
  );
}
