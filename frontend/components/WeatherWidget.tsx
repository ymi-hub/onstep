'use client';

import { useState, useEffect } from 'react';
import { FONT } from '@/lib/constants';

type WeatherData = { temp: number; desc: string; emoji: string };

const WMO_MAP: Record<number, [string, string]> = {
  0: ['맑음', '☀️'], 1: ['대체로 맑음', '🌤'], 2: ['구름 조금', '⛅️'], 3: ['흐림', '☁️'],
  45: ['안개', '🌫'], 48: ['안개', '🌫'],
  51: ['가는 이슬비', '🌦'], 53: ['이슬비', '🌦'], 55: ['짙은 이슬비', '🌦'],
  61: ['약한 비', '🌧'], 63: ['비', '🌧'], 65: ['강한 비', '🌧'],
  71: ['약한 눈', '🌨'], 73: ['눈', '🌨'], 75: ['강한 눈', '❄️'],
  80: ['소나기', '🌦'], 81: ['소나기', '🌧'], 82: ['강한 소나기', '⛈'],
  95: ['뇌우', '⛈'], 96: ['뇌우+우박', '⛈'], 99: ['강한 뇌우', '⛈'],
};

export default function WeatherWidget() {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [locName, setLocName] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [requested, setRequested] = useState(false);

  const fetchWeather = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setError('위치 정보를 지원하지 않는 브라우저입니다.');
      return;
    }
    setLoading(true);
    setRequested(true);
    setError('');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lon } = pos.coords;
        try {
          const res = await fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&current=temperature_2m,weather_code&timezone=auto`
          );
          const data = await res.json();
          const code: number = data.current?.weather_code ?? data.current?.weathercode ?? 0;
          const temp: number = Math.round(data.current?.temperature_2m ?? 0);
          const [desc, emoji] = WMO_MAP[code] ?? ['알 수 없음', '🌡'];
          const w: WeatherData = { temp, desc, emoji };

          let name = '';
          try {
            const geo = await fetch(
              `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=ko`
            );
            const gd = await geo.json();
            name = gd.address?.city || gd.address?.town || gd.address?.county || gd.address?.state || '';
          } catch { /* 위치명은 없어도 날씨는 표시 */ }

          setWeather(w);
          setLocName(name);
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem('onstep_weather_v5', JSON.stringify({ ts: Date.now(), weather: w, locName: name }));
          }
        } catch (e) {
          console.error('[OnStep] 날씨 fetch 실패:', e);
          setError('날씨 정보를 가져오지 못했습니다.');
        }
        setLoading(false);
      },
      (err) => {
        console.error('[OnStep] 위치 권한 오류:', err.code, err.message);
        setError(err.code === 1 ? 'denied' : '위치 정보를 가져오지 못했습니다.');
        setLoading(false);
      },
      { timeout: 10000 }
    );
  };

  useEffect(() => {
    const cached = typeof localStorage !== 'undefined' ? localStorage.getItem('onstep_weather_v5') : null;
    if (cached) {
      try {
        const d = JSON.parse(cached);
        if (Date.now() - d.ts < 30 * 60 * 1000) {
          setWeather(d.weather);
          setLocName(d.locName);
          setRequested(true);
          return;
        }
      } catch { /* ignore */ }
    }
    fetchWeather();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading || !requested) {
    return (
      <div style={{ padding: '10px 26px 4px' }}>
        <div style={{ fontFamily: FONT, fontSize: 12, color: '#BCBAB6' }}>날씨 불러오는 중…</div>
      </div>
    );
  }

  if (error) {
    if (error === 'denied') {
      return (
        <div style={{ padding: '10px 26px 4px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontFamily: FONT, fontSize: 12, color: '#9A9490' }}>📍 위치 권한 필요</span>
          <a
            href="app-settings:"
            onClick={(e) => {
              e.preventDefault();
              if (/iPhone|iPad|iPod/.test(navigator.userAgent)) {
                window.location.href = 'app-settings:';
              } else {
                alert('브라우저 주소창 왼쪽 자물쇠(🔒) 아이콘 → 위치 → 허용으로 변경해주세요.');
              }
            }}
            style={{ fontFamily: FONT, fontSize: 11, fontWeight: 700, color: '#0C0C0A', textDecoration: 'underline', cursor: 'pointer' }}
          >
            설정 열기
          </a>
          <button onClick={() => { setError(''); fetchWeather(); }} style={{ background: 'none', border: 'none', fontFamily: FONT, fontSize: 11, color: '#9A9490', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>재시도</button>
        </div>
      );
    }
    return (
      <div style={{ padding: '10px 26px 4px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontFamily: FONT, fontSize: 12, color: '#9A9490' }}>날씨 정보 없음</span>
        <button onClick={() => { setError(''); fetchWeather(); }} style={{ background: 'none', border: 'none', fontFamily: FONT, fontSize: 11, color: '#9A9490', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>재시도</button>
      </div>
    );
  }

  if (!weather) return null;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 26px 4px' }}>
      <div style={{ width: 40, height: 40, background: 'rgba(139,111,71,.12)', borderRadius: 10, border: '1px solid rgba(139,111,71,.20)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, lineHeight: 1 }}>
        {weather.emoji}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {locName && (
          <div style={{ fontFamily: FONT, fontSize: 11, fontWeight: 600, color: '#9A9490', letterSpacing: '.04em', lineHeight: 1 }}>{locName}</div>
        )}
        <div style={{ fontFamily: FONT, fontSize: 13, fontWeight: 500, color: '#4E382F', lineHeight: 1 }}>
          {weather.temp}°C · {weather.desc}
        </div>
      </div>
    </div>
  );
}
