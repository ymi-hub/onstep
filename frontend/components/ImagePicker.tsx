'use client';

import { useRef, useEffect } from 'react';
import { imageFileToBase64 } from '@/lib/imageUtils';

interface ImagePickerProps {
  preview: string;
  onChange: (file: File, base64: string) => void;
  onClear?: () => void;
  height?: number;
  aspectRatio?: string;
  placeholderLabel?: string;
  isOpen?: boolean;
  naturalSize?: boolean; // true: 이미지 있을 때 실제 비율로 자동 확장, 빈 상태는 height 유지
}

export default function ImagePicker({
  preview,
  onChange,
  onClear,
  height,
  aspectRatio,
  placeholderLabel = 'ADD IMAGE',
  isOpen = true,
  naturalSize = false,
}: ImagePickerProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const f = "'Plus Jakarta Sans','Space Grotesk',sans-serif";

  async function applyFile(file: File) {
    try {
      const base64 = await imageFileToBase64(file);
      onChange(file, base64);
    } catch (err) {
      console.error('[OnStep] imageFileToBase64 실패, FileReader 폴백:', err);
      if (file.size > 500 * 1024) {
        alert('이미지 파일이 너무 큽니다. 500KB 이하 파일을 선택해주세요.');
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev) => {
        const r = ev.target?.result;
        if (typeof r === 'string') onChange(file, r);
      };
      reader.onerror = () => alert('이미지를 불러오지 못했습니다. 다른 파일을 선택해주세요.');
      reader.readAsDataURL(file);
    }
  }

  async function pasteFromClipboard() {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        for (const type of item.types) {
          if (type.startsWith('image/')) {
            const blob = await item.getType(type);
            await applyFile(new File([blob], 'pasted.png', { type }));
            return;
          }
        }
      }
      alert('클립보드에 이미지가 없습니다.');
    } catch {
      // clipboard.read() 미지원(모바일 Safari 등) → 파일 피커로 폴백
      fileRef.current?.click();
    }
  }

  // 시트가 열려 있는 동안 Ctrl+V / Cmd+V 로 이미지 붙여넣기
  useEffect(() => {
    if (!isOpen) return;
    function onPaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const blob = item.getAsFile();
          if (blob) {
            void applyFile(new File([blob], 'pasted-image.png', { type: blob.type }));
            e.preventDefault();
            break;
          }
        }
      }
    }
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [isOpen]);

  const sizeStyle: React.CSSProperties = aspectRatio
    ? { width: '100%', aspectRatio }
    : naturalSize && preview
      ? { width: '100%' }                      // 이미지 있으면 자연 높이
      : { width: '100%', height: height ?? 220 }; // 빈 상태 또는 naturalSize 미사용

  // 하단 액션 바 버튼 공통 스타일
  const actionBtn: React.CSSProperties = {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    padding: '10px 8px',
    background: 'transparent',
    border: 'none',
    fontFamily: f,
    fontSize: 12,
    fontWeight: 700,
    color: '#44474A',
    cursor: 'pointer',
    letterSpacing: '.02em',
    minHeight: 40,
  };

  // 버튼 사이 세로 구분선
  const divider: React.CSSProperties = {
    width: 1,
    alignSelf: 'stretch',
    background: 'rgba(12,12,10,.08)',
    flexShrink: 0,
  };

  return (
    <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(12,12,10,.1)' }}>

      {/* ── 이미지 영역 ── */}
      <div
        onClick={() => fileRef.current?.click()}
        style={{
          ...sizeStyle,
          position: 'relative',
          background: preview ? '#F0EFED' : '#F4F4F0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          overflow: 'hidden',
          flexShrink: 0,
        }}
      >
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview}
            alt=""
            style={{
              width: '100%',
              height: naturalSize ? 'auto' : '100%',
              objectFit: naturalSize ? undefined : 'contain',
              display: 'block',
            }}
          />
        ) : (
          <div style={{ textAlign: 'center', padding: '0 26px' }}>
            <div style={{ fontSize: 28, opacity: 0.2, marginBottom: 8 }}>📷</div>
            <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.1em', color: '#9A9490' }}>
              {placeholderLabel}
            </div>
            <div style={{ fontFamily: f, fontSize: 11, color: '#C4C2BE', marginTop: 4 }}>
              탭하여 갤러리/카메라 선택
            </div>
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void applyFile(file);
            e.target.value = '';
          }}
        />
      </div>

      {/* ── 하단 액션 바 ── */}
      <div style={{
        display: 'flex',
        background: '#F4F4F0',
        borderTop: '1px solid rgba(12,12,10,.08)',
      }}>

        {/* 붙여넣기 */}
        <button type="button" onClick={() => void pasteFromClipboard()} style={actionBtn}>
          <span style={{ fontSize: 13 }}>📋</span>
          붙여넣기
        </button>

        <div style={divider} />

        {/* 사진 변경 / 사진 선택 */}
        <button type="button" onClick={() => fileRef.current?.click()} style={actionBtn}>
          <span style={{ fontSize: 13 }}>📷</span>
          {preview ? '사진 변경' : '사진 선택'}
        </button>

        {/* 삭제 — onClear 있고 이미지 있을 때만 표시 */}
        {onClear && preview && (
          <>
            <div style={divider} />
            <button
              type="button"
              onClick={onClear}
              style={{ ...actionBtn, flex: 'none', padding: '10px 16px', color: '#E94F6B' }}
              aria-label="이미지 삭제"
            >
              ✕
            </button>
          </>
        )}

      </div>
    </div>
  );
}
