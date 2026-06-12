'use client';

// AppContext — Auth + 공유 데이터 구독을 layout 레벨에서 한 번만 실행
// 탭 전환 시 auth 재확인·데이터 재로딩 없이 즉시 표시

import React, { createContext, useContext, useEffect, useRef, useCallback, useState } from 'react';
import {
  onAuthStateChanged,
  type User,
} from 'firebase/auth';
import {
  collection,
  query,
  orderBy,
  onSnapshot,
} from 'firebase/firestore';
import { db, auth } from './firebase';
import type { Product } from '@/types/product';
import type { Session } from '@/types/routine';
import type { Habit } from '@/types/habit';
import type { CtItem } from '@/types/ctitem';
import type { LifetipItem } from '@/types/lifetip';
import type { MedRoutine } from '@/types/medication';
import type { HealthRoutine } from '@/types/healthroutine';
import type { HealthCategory } from '@/types/healthcategory';
import type { DietProgram } from '@/types/dietplan';
import { useTimer, type TimerState } from '@/hooks/useTimer';

import { FALLBACK_USER_ID } from './constants';

// ── 컨텍스트 타입 ───────────────────────────────────────────────────────────

interface AppContextValue {
  user: User | null;
  userId: string;
  authLoading: boolean;
  dataReady: boolean;   // 첫 Firestore 스냅샷 도착 여부 (sessions 기준)
  products: Product[];
  sessions: Session[];
  habits: Habit[];
  careItems: CtItem[];
  makeupItems: CtItem[];   // 하위 호환 유지 (migration 전까지)
  lookItems: CtItem[];     // 하위 호환 유지 (migration 전까지)
  libraryItems: CtItem[];  // 통합 컬렉션 (makeupItems + lookItems + 신규 도메인)
  lifetipItems: LifetipItem[];
  medRoutines: MedRoutine[];
  healthRoutines: HealthRoutine[];
  healthCategories: HealthCategory[];
  dietPrograms: DietProgram[];
  timer: TimerState;
  toastMsg: string | null;
  showToast: (msg: string) => void;
}

const noopTimer: TimerState = {
  timerLabel: null, timerEndMs: null, timerRemainMs: 0,
  alarmVisible: false, alarmLabel: null,
  startTimer: () => {}, stopTimer: () => {}, dismissAlarm: () => {},
};

const AppContext = createContext<AppContextValue>({
  user: null,
  userId: FALLBACK_USER_ID,
  authLoading: true,
  dataReady: false,
  products: [],
  sessions: [],
  habits: [],
  careItems: [],
  makeupItems: [],
  lookItems: [],
  libraryItems: [],
  lifetipItems: [],
  medRoutines: [],
  healthRoutines: [],
  healthCategories: [],
  dietPrograms: [],
  timer: noopTimer,
  toastMsg: null,
  showToast: () => {},
});

export function useAppContext() {
  return useContext(AppContext);
}

// ── Provider ───────────────────────────────────────────────────────────────

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const timer = useTimer();

  const [dataReady, setDataReady] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [careItems, setCareItems] = useState<CtItem[]>([]);
  const [makeupItems, setMakeupItems] = useState<CtItem[]>([]);
  const [lookItems, setLookItems] = useState<CtItem[]>([]);
  const [libraryItems, setLibraryItems] = useState<CtItem[]>([]);
  const [lifetipItems, setLifetipItems] = useState<LifetipItem[]>([]);
  const [medRoutines, setMedRoutines] = useState<MedRoutine[]>([]);
  const [healthRoutines, setHealthRoutines] = useState<HealthRoutine[]>([]);
  const [healthCategories, setHealthCategories] = useState<HealthCategory[]>([]);
  const [dietPrograms, setDietPrograms] = useState<DietProgram[]>([]);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToastMsg(msg);
    toastTimer.current = setTimeout(() => setToastMsg(null), 2800);
  }, []);

  const userId = user?.uid ?? FALLBACK_USER_ID;

  // 서비스 워커 등록 및 알림 권한 자동 요청 — 앱 초기화 시 1회 실행
  useEffect(() => {
    if (typeof window !== 'undefined') {
      // 1. 서비스 워커 등록
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js')
          .then((reg) => {
            console.log('ServiceWorker registered with scope:', reg.scope);
          })
          .catch((err) => {
            console.error('ServiceWorker registration failed:', err);
          });
      }

      // 2. 접속 시 알림 권한 자동 요청
      if ('Notification' in window && Notification.permission !== 'granted' && Notification.permission !== 'denied') {
        Notification.requestPermission().then((permission) => {
          console.log('Notification permission status:', permission);
        }).catch((err) => {
          console.error('Notification permission request error:', err);
        });
      }
    }
  }, []);

  // Auth — 앱 전체에서 1회만 실행
  useEffect(() => {
    if (!auth) { setAuthLoading(false); return; }
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
      if (!u) {
        setDataReady(false);
        setProducts([]); setSessions([]); setHabits([]);
        setCareItems([]); setMakeupItems([]); setLookItems([]); setLibraryItems([]); setLifetipItems([]);
        setMedRoutines([]); setHealthRoutines([]); setHealthCategories([]); setDietPrograms([]);
      }
    });
    return () => unsub();
  }, []);

  // 공유 구독 — 로그인 확인 후 1회 설정, 탭 전환해도 유지
  useEffect(() => {
    if (authLoading || !user || !db) return;
    const _db = db;

    const subs = [
      onSnapshot(
        query(collection(_db, 'users', userId, 'products'), orderBy('createdAt', 'desc')),
        (s) => setProducts(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Product, 'id'>) }))),
        () => {}
      ),
      onSnapshot(
        query(collection(_db, 'users', userId, 'routines'), orderBy('sessionNumber', 'desc')),
        (s) => { setSessions(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Session, 'id'>) }))); setDataReady(true); },
        () => { setDataReady(true); }
      ),
      onSnapshot(
        query(collection(_db, 'users', userId, 'habits'), orderBy('createdAt', 'asc')),
        (s) => setHabits(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Habit, 'id'>) }))),
        () => {}
      ),
      onSnapshot(
        query(collection(_db, 'users', userId, 'careItems'), orderBy('createdAt', 'desc')),
        (s) => setCareItems(s.docs.map((d) => ({ id: d.id, ...d.data() } as CtItem))),
        () => {}
      ),
      onSnapshot(
        query(collection(_db, 'users', userId, 'makeupItems'), orderBy('createdAt', 'desc')),
        (s) => setMakeupItems(s.docs.map((d) => ({ id: d.id, ...d.data() } as CtItem))),
        () => {}
      ),
      onSnapshot(
        collection(_db, 'users', userId, 'lookItems'),
        (s) => setLookItems(s.docs.map((d) => ({ id: d.id, ...d.data() } as CtItem))),
        () => {}
      ),
      onSnapshot(
        collection(_db, 'users', userId, 'libraryItems'),
        (s) => setLibraryItems(s.docs.map((d) => ({ id: d.id, ...d.data() } as CtItem))),
        () => {}
      ),
      onSnapshot(
        query(collection(_db, 'users', userId, 'lifetipItems'), orderBy('createdAt', 'desc')),
        (s) => setLifetipItems(s.docs.map((d) => ({ id: d.id, ...d.data() } as LifetipItem))),
        () => {}
      ),
      onSnapshot(
        query(collection(_db, 'users', userId, 'medRoutines'), orderBy('createdAt', 'asc')),
        (s) => setMedRoutines(s.docs.map((d) => ({ id: d.id, ...d.data() } as MedRoutine))),
        () => {}
      ),
      onSnapshot(
        query(collection(_db, 'users', userId, 'healthRoutines'), orderBy('createdAt', 'asc')),
        (s) => setHealthRoutines(s.docs.map((d) => ({ id: d.id, ...d.data() } as HealthRoutine))),
        () => {}
      ),
      onSnapshot(
        query(collection(_db, 'users', userId, 'healthCategories'), orderBy('order', 'asc')),
        (s) => setHealthCategories(s.docs.map((d) => ({ id: d.id, ...d.data() } as HealthCategory))),
        () => {}
      ),
      onSnapshot(
        query(collection(_db, 'users', userId, 'dietPrograms'), orderBy('createdAt', 'desc')),
        (s) => setDietPrograms(s.docs.map((d) => ({ id: d.id, ...d.data() } as DietProgram))),
        () => {}
      ),
    ];

    return () => subs.forEach((u) => u());
  }, [userId, authLoading]);

  return (
    <AppContext.Provider value={{ user, userId, authLoading, dataReady, products, sessions, habits, careItems, makeupItems, lookItems, libraryItems, lifetipItems, medRoutines, healthRoutines, healthCategories, dietPrograms, timer, toastMsg, showToast }}>
      {children}
    </AppContext.Provider>
  );
}
