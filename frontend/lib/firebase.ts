import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getAuth, type Auth } from 'firebase/auth';
import { getStorage, type FirebaseStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey:            process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain:        process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId:         process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket:     process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId:             process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// .env.local이 없을 때 앱이 크래시하지 않도록 try-catch로 감쌈
// Firebase가 설정되지 않으면 null을 반환하고 각 기능에서 graceful하게 처리
let _app: FirebaseApp | null = null;
let _db: Firestore | null = null;
let _auth: Auth | null = null;
let _storage: FirebaseStorage | null = null;

try {
  if (firebaseConfig.apiKey) {
    // 중복 초기화 방지 (Next.js HMR 환경 대응)
    _app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
    _db      = getFirestore(_app);
    _auth    = getAuth(_app);
    _storage = getStorage(_app);
  } else {
    // .env.local 미설정 시 경고 (개발 중에는 정상)
    if (typeof window !== 'undefined') {
      console.warn('[OnStep] Firebase 환경변수가 설정되지 않았습니다. .env.local을 확인하세요.');
    }
  }
} catch (err) {
  console.error('[OnStep] Firebase 초기화 실패:', err);
}

export const app     = _app;
export const db      = _db;
export const auth    = _auth;
export const storage = _storage;
export default _app;
