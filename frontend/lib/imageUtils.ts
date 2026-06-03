// 이미지 → Base64 변환 유틸
// Firebase Storage 없이 Firestore에 직접 저장하는 방식
// 기본: 400px 리사이즈 + JPEG 70% 압축 → 평균 15~35KB (Firestore 1MB 한도 내)
// createImageBitmap을 우선 사용 (모바일 고해상도 사진 디코딩 속도 향상)

export async function imageFileToBase64(file: File, maxPx = 400, quality = 0.7): Promise<string> {
  // createImageBitmap 지원 브라우저에서는 더 빠른 디코딩
  if (typeof createImageBitmap !== 'undefined') {
    const bitmap = await createImageBitmap(file);
    const { width: w, height: h } = bitmap;
    const scale = w > maxPx || h > maxPx ? maxPx / Math.max(w, h) : 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D 컨텍스트를 생성할 수 없습니다.');
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return canvas.toDataURL('image/jpeg', quality);
  }

  // 폴백: Image 요소 방식
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const { naturalWidth: w, naturalHeight: h } = img;
      const scale = w > maxPx || h > maxPx ? maxPx / Math.max(w, h) : 1;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Canvas 2D 컨텍스트를 생성할 수 없습니다.')); return; }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('이미지 로드 실패')); };
    img.src = objectUrl;
  });
}
