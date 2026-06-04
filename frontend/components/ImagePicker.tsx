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
}

export default function ImagePicker({
  preview,
  onChange,
  onClear,
  height,
  aspectRatio,
  placeholderLabel = 'ADD IMAGE',
  isOpen = true,
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
      fileRef.current?.click();
    }
  }

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
    : { width: '100%', height: height ?? 220 };

  const overlayBtn: React.CSSProperties = {
    background: 'rgba(0,0,0,.55)',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    padding: '5px 10px',
    fontFamily: f,
    fontSize: 11,
    fontWeight: 700,
    cursor: 'pointer',
  };

  return (
    <div>
      <div
        onClick={() => fileRef.current?.click()}
        style={{
          ...sizeStyle,
          position: 'relative',
          background: preview ? 'transparent' : '#F4F4F0',
          borderRadius: 12,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          overflow: 'hidden',
          flexShrink: 0,
        }}
      >
        {preview ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
            <div style={{ position: 'absolute', bottom: 10, right: 10, display: 'flex', gap: 6 }}>
              <button
                onClick={(e) => { e.stopPropagation(); void pasteFromClipboard(); }}
                style={overlayBtn}
              >📋 붙여넣기</button>
              <div style={{ ...overlayBtn, pointerEvents: 'none' }}>사진 변경</div>
            </div>
            {onClear && (
              <button
                onClick={(e) => { e.stopPropagation(); onClear(); }}
                style={{ position: 'absolute', top: 8, right: 8, width: 28, height: 28, borderRadius: '50%', background: 'rgba(0,0,0,.5)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >✕</button>
            )}
          </>
        ) : (
          <div style={{ textAlign: 'center', padding: '0 16px' }}>
            <div style={{ fontSize: 28, opacity: 0.2, marginBottom: 8 }}>📷</div>
            <div style={{ fontFamily: f, fontSize: 11, fontWeight: 700, letterSpacing: '.1em', color: '#9A9490' }}>{placeholderLabel}</div>
            <div style={{ fontFamily: f, fontSize: 11, color: '#C4C2BE', marginTop: 4 }}>탭하여 갤러리/카메라 선택</div>
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => { const file = e.target.files?.[0]; if (file) void applyFile(file); e.target.value = ''; }}
        />
      </div>

      {!preview && (
        <button
          onClick={pasteFromClipboard}
          style={{
            width: '100%',
            padding: '10px',
            marginTop: 6,
            border: '1.5px dashed rgba(12,12,10,.14)',
            borderRadius: 10,
            background: 'transparent',
            fontFamily: f,
            fontSize: 12,
            fontWeight: 700,
            color: '#9A9490',
            cursor: 'pointer',
          }}
        >📋 클립보드에서 붙여넣기</button>
      )}
    </div>
  );
}
