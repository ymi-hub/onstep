import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 💡 output: 'export' — Next.js를 정적 HTML/CSS/JS 파일로 빌드
  //    `npm run build` 실행 시 frontend/out/ 폴더 생성
  //    Firebase Hosting에서 이 폴더를 서빙
  //
  // 🚨 주의: 이 설정 시 Next.js API Routes(/api/*)가 빌드에 포함되지 않음
  //    AI 가져오기 기능은 Firebase Function (functions/index.js) 사용
  //    배포 전: frontend/.env.local에 NEXT_PUBLIC_PARSE_API_URL 설정 필수
  output: "export",

  // 정적 export 시 next/image 최적화 서버가 없으므로 비활성화
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
