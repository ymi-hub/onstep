import os

# Read the small base64 strings
with open('silent_wav_small.txt', 'r') as f:
    silent_b64 = f.read().strip()

with open('chime_wav_small.txt', 'r') as f:
    chime_b64 = f.read().strip()

# Construct the full new useTimer.ts contents
new_content = f"""'use client';

import {{ useState, useEffect, useRef }} from 'react';

/** ms → "M:SS" 포맷 */
export function formatTimerRemain(ms: number): string {{
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${{m}}:${{String(s).padStart(2, '0')}}`;
}}

/** Web Audio API로 3음 차임 합성 (포그라운드용 보조) */
export function playAlarmChime(ctx: AudioContext) {{
  try {{
    const notes = [880, 1046, 1318];
    notes.forEach((freq, i) => {{
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
    }});
  }} catch {{
    // 사운드 미지원 환경 무시
  }}
}}

// 맑고 선명한 3톤 알람 벨 사운드 WAV (Base64) - 1.0초 8000Hz 8-bit Mono PCM
const ALARM_SOUND_WAV = "data:audio/wav;base64,{chime_b64}"; 

// 2초 무음 WAV (Base64) - 백그라운드 오디오 세션 획득용 (16-bit Mono 8000Hz PCM)
const SILENT_WAV = "data:audio/wav;base64,{silent_b64}";

export interface TimerState {{
  timerLabel: string | null;
  timerEndMs: number | null;
  timerRemainMs: number;
  alarmVisible: boolean;
  alarmLabel: string | null;
  startTimer: (label: string, minutes: number) => void;
  stopTimer: () => void;
  dismissAlarm: () => void;
}}

export function useTimer(): TimerState {{
  const [timerLabel, setTimerLabel] = useState<string | null>(null);
  const [timerEndMs, setTimerEndMs] = useState<number | null>(null);
  const [timerRemainMs, setTimerRemainMs] = useState<number>(0);
  const [alarmVisible, setAlarmVisible] = useState(false);
  const [alarmLabel, setAlarmLabel] = useState<string | null>(null);

  const alarmFiredRef = useRef(false);
  const alarmDismissRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // 이원화된 HTML5 Audio 객체 레퍼런스
  const silentAudioRef = useRef<HTMLAudioElement | null>(null);
  const alarmAudioRef = useRef<HTMLAudioElement | null>(null);

  const stopBackgroundAudio = () => {{
    if (silentAudioRef.current) {{
      try {{
        silentAudioRef.current.pause();
        silentAudioRef.current.src = "";
      }} catch {{}}
      silentAudioRef.current = null;
    }}
    if (alarmAudioRef.current) {{
      try {{
        alarmAudioRef.current.pause();
        alarmAudioRef.current.src = "";
      }} catch {{}}
      alarmAudioRef.current = null;
    }}
  }};

  useEffect(() => {{
    if (!timerEndMs) return;
    alarmFiredRef.current = false;

    const tick = () => {{
      const remain = Math.max(0, timerEndMs - Date.now());
      setTimerRemainMs(remain);

      if (remain === 0 && !alarmFiredRef.current) {{
        alarmFiredRef.current = true;
        setTimerEndMs(null);

        // 1. 무음 오디오 정지
        if (silentAudioRef.current) {{
          try {{
            silentAudioRef.current.pause();
          }} catch {{}}
        }}

        // 2. 미리 언락해 둔 실제 알람 오디오 재생 (src 변경 없이 즉각 play)
        if (alarmAudioRef.current) {{
          try {{
            alarmAudioRef.current.currentTime = 0;
            alarmAudioRef.current.play().catch((err) => {{
              console.error("Alarm audio play failed on expiration:", err);
            }});
          }} catch (err) {{
            console.error("Alarm audio play trigger error:", err);
          }}
        }}

        // 3. Web Audio API Chime 합성 (포그라운드 서포트)
        if (audioCtxRef.current) {{
          const ctx = audioCtxRef.current;
          if (ctx.state === 'suspended') {{
            ctx.resume().then(() => playAlarmChime(ctx)).catch(() => {{}});
          }} else if (ctx.state === 'running') {{
            playAlarmChime(ctx);
          }}
        }}

        setAlarmLabel(timerLabel);
        setAlarmVisible(true);

        // 4. Web Notification 발송
        if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {{
          const title = '대기 완료';
          const options = {{
            body: timerLabel || '타이머가 완료되었습니다.',
            tag: 'onstep-timer',
            requireInteraction: true,
            vibrate: [300, 100, 300, 100, 400],
            renotify: true,
          }};
          try {{
            if ('serviceWorker' in navigator) {{
              navigator.serviceWorker.ready.then((registration) => {{
                registration.showNotification(title, options);
              }}).catch(() => {{
                new Notification(title, options);
              }});
            }} else {{
              new Notification(title, options);
            }}
          }} catch (err) {{
            console.error('Notification trigger error:', err);
          }}
        }}

        if (alarmDismissRef.current) clearTimeout(alarmDismissRef.current);
        alarmDismissRef.current = setTimeout(() => {{
          setAlarmVisible(false);
          // 알람 대기 시간이 종료되면 사운드도 함께 멈춤
          if (alarmAudioRef.current) {{
            try {{
              alarmAudioRef.current.pause();
            }} catch {{}}
          }}
        }}, 12000); // 알람 12초간 대기
      }}
    }};

    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }}, [timerEndMs, timerLabel]);

  useEffect(() => () => {{
    if (alarmDismissRef.current) clearTimeout(alarmDismissRef.current);
    stopBackgroundAudio();
  }}, []);

  function startTimer(label: string, minutes: number) {{
    setAlarmVisible(false);
    setTimerLabel(label);
    const endMs = Date.now() + minutes * 60_000;
    setTimerEndMs(endMs);

    // 알림 권한 요청 (만약 아직 수락하지 않았다면)
    if (typeof window !== 'undefined' && 'Notification' in window) {{
      if (Notification.permission !== 'granted') {{
        Notification.requestPermission().then((permission) => {{
          if (permission !== 'granted') {{
            alert('타이머가 종료되었을 때 푸시 알림을 받으시려면 브라우저 알림 권한을 허용해주세요.');
          }}
        }}).catch((err) => {{
          console.error('Notification permission request error:', err);
        }});
      }}
    }}

    // 서비스 워커 백그라운드 타이머에 동기화
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {{
      navigator.serviceWorker.ready.then((registration) => {{
        if (registration.active) {{
          registration.active.postMessage({{
            type: 'START_TIMER',
            label,
            endMs
          }});
        }}
      }}).catch((err) => {{
        console.error('Service worker message error:', err);
      }});
    }}

    // ── HTML5 Audio 백그라운드 세션 획득 및 알람 오디오 언락 ──
    try {{
      stopBackgroundAudio();
      
      // A. 무음 루프 오디오 시작 (볼륨 0.05로 세션 유지)
      const silentAudio = new Audio(SILENT_WAV);
      silentAudio.loop = true;
      silentAudio.volume = 0.05;
      silentAudio.play().then(() => {{
        silentAudioRef.current = silentAudio;
      }}).catch((err) => {{
        console.warn("Silent audio autoplay blocked, attempting to unlock:", err);
        silentAudioRef.current = silentAudio;
      }});

      // B. 실제 알람 오디오 선제 언락 (볼륨 1.0, 무한반복 대기)
      const alarmAudio = new Audio(ALARM_SOUND_WAV);
      alarmAudio.loop = true;
      alarmAudio.volume = 1.0;
      alarmAudio.play().then(() => {{
        alarmAudio.pause();
        alarmAudio.currentTime = 0;
        alarmAudioRef.current = alarmAudio;
      }}).catch((err) => {{
        console.warn("Alarm audio unlock failed:", err);
        alarmAudioRef.current = alarmAudio;
      }});

      // Web Audio API Context 언락 (보조)
      const AudioCtx = window.AudioContext || (window as Window & {{ webkitAudioContext?: typeof AudioContext }}).webkitAudioContext;
      if (AudioCtx) {{
        if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {{
          audioCtxRef.current = new AudioCtx();
        }}
        if (audioCtxRef.current.state === 'suspended') {{
          void audioCtxRef.current.resume();
        }}
      }}
    }} catch (err) {{
      console.error("Audio unlock trigger error:", err);
    }}
  }}

  function stopTimer() {{
    setTimerEndMs(null);
    setTimerLabel(null);
    setTimerRemainMs(0);
    setAlarmVisible(false);
    stopBackgroundAudio();

    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {{
      navigator.serviceWorker.ready.then((registration) => {{
        if (registration.active) {{
          registration.active.postMessage({{
            type: 'STOP_TIMER'
          }});
        }}
      }}).catch((err) => {{
        console.error('Service worker stop message error:', err);
      }});
    }}
  }}

  function dismissAlarm() {{
    setAlarmVisible(false);
    stopBackgroundAudio();
  }}

  return {{ timerLabel, timerEndMs, timerRemainMs, alarmVisible, alarmLabel, startTimer, stopTimer, dismissAlarm }};
}}
"""

with open('frontend/hooks/useTimer.ts', 'w') as f:
    f.write(new_content)

print("useTimer.ts patched successfully.")
