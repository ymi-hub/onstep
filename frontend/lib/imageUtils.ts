// 이미지 → Base64 변환 유틸
// Firebase Storage 없이 Firestore에 직접 저장하는 방식
// 400px 리사이즈 + JPEG 70% 압축 → 평균 15~35KB (Firestore 1MB 한도 내)

export async function imageFileToBase64(file: File, maxPx = 400, quality = 0.7): Promise<string> {
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
      if (!ctx) {
        reject(new Error('Canvas 2D 컨텍스트를 생성할 수 없습니다.'));
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };

    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('이미지 로드 실패')); };
    img.src = objectUrl;
  });
}
