'use client';

import { useState, useEffect, useRef } from 'react';

/** ms → "M:SS" 포맷 */
export function formatTimerRemain(ms: number): string {
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Web Audio API로 3음 차임 재생 */
export function playAlarmChime(ctx: AudioContext) {
  try {
    const notes = [880, 1046, 1318];
    notes.forEach((freq, i) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t = ctx.currentTime + i * 0.22;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.45, t + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
      osc.start(t);
      osc.stop(t + 0.7);
    });
  } catch {
    // 사운드 미지원 환경에서는 조용히 무시
  }
}

export interface TimerState {
  timerLabel: string | null;
  timerEndMs: number | null;
  timerRemainMs: number;
  alarmVisible: boolean;
  alarmLabel: string | null;
  startTimer: (label: string, minutes: number) => void;
  dismissAlarm: () => void;
}

/** 대기 타이머 훅 — 루틴 제품 사용 간격 알람 */
export function useTimer(): TimerState {
  const [timerLabel, setTimerLabel] = useState<string | null>(null);
  const [timerEndMs, setTimerEndMs] = useState<number | null>(null);
  const [timerRemainMs, setTimerRemainMs] = useState<number>(0);
  const [alarmVisible, setAlarmVisible] = useState(false);
  const [alarmLabel, setAlarmLabel] = useState<string | null>(null);

  const alarmFiredRef = useRef(false);
  const alarmDismissRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!timerEndMs) return;
    alarmFiredRef.current = false;

    const tick = () => {
      const remain = Math.max(0, timerEndMs - Date.now());
      setTimerRemainMs(remain);

      if (remain === 0 && !alarmFiredRef.current) {
        alarmFiredRef.current = true;
        setTimerEndMs(null);

        if (audioCtxRef.current) {
          const ctx = audioCtxRef.current;
          if (ctx.state === 'suspended') {
            ctx.resume().then(() => playAlarmChime(ctx)).catch(() => {});
          } else if (ctx.state === 'running') {
            playAlarmChime(ctx);
          }
        }

        setAlarmLabel(timerLabel);
        setAlarmVisible(true);

        if (alarmDismissRef.current) clearTimeout(alarmDismissRef.current);
        alarmDismissRef.current = setTimeout(() => setAlarmVisible(false), 8000);
      }
    };

    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [timerEndMs, timerLabel]);

  useEffect(() => () => {
    if (alarmDismissRef.current) clearTimeout(alarmDismissRef.current);
  }, []);

  function startTimer(label: string, minutes: number) {
    setAlarmVisible(false);
    setTimerLabel(label);
    setTimerEndMs(Date.now() + minutes * 60_000);
    try {
      const AudioCtx = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
          audioCtxRef.current = new AudioCtx();
        }
        if (audioCtxRef.current.state === 'suspended') {
          void audioCtxRef.current.resume();
        }
      }
    } catch { /* 미지원 환경 무시 */ }
  }

  function dismissAlarm() {
    setAlarmVisible(false);
  }

  return { timerLabel, timerEndMs, timerRemainMs, alarmVisible, alarmLabel, startTimer, dismissAlarm };
}
