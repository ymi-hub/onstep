'use client';

// AppContext — Auth + 공유 데이터 구독을 layout 레벨에서 한 번만 실행
// 탭 전환 시 auth 재확인·데이터 재로딩 없이 즉시 표시

import React, { createContext, useContext, useEffect, useState } from 'react';
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
import type { MedRoutine } from '@/types/medication';
import type { HealthRoutine } from '@/types/healthroutine';
import type { HealthCategory } from '@/types/healthcategory';
import type { DietProgram } from '@/types/dietplan';

import { FALLBACK_USER_ID } from './constants';

// ── 컨텍스트 타입 ───────────────────────────────────────────────────────────

interface AppContextValue {
  user: User | null;
  userId: string;
  authLoading: boolean;
  products: Product[];
  sessions: Session[];
  habits: Habit[];
  careItems: CtItem[];
  makeupItems: CtItem[];
  lookItems: CtItem[];
  medRoutines: MedRoutine[];
  healthRoutines: HealthRoutine[];
  healthCategories: HealthCategory[];
  dietPrograms: DietProgram[];
}

const AppContext = createContext<AppContextValue>({
  user: null,
  userId: FALLBACK_USER_ID,
  authLoading: true,
  products: [],
  sessions: [],
  habits: [],
  careItems: [],
  makeupItems: [],
  lookItems: [],
  medRoutines: [],
  healthRoutines: [],
  healthCategories: [],
  dietPrograms: [],
});

export function useAppContext() {
  return useContext(AppContext);
}

// ── Provider ───────────────────────────────────────────────────────────────

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [products, setProducts] = useState<Product[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [careItems, setCareItems] = useState<CtItem[]>([]);
  const [makeupItems, setMakeupItems] = useState<CtItem[]>([]);
  const [lookItems, setLookItems] = useState<CtItem[]>([]);
  const [medRoutines, setMedRoutines] = useState<MedRoutine[]>([]);
  const [healthRoutines, setHealthRoutines] = useState<HealthRoutine[]>([]);
  const [healthCategories, setHealthCategories] = useState<HealthCategory[]>([]);
  const [dietPrograms, setDietPrograms] = useState<DietProgram[]>([]);

  const userId = user?.uid ?? FALLBACK_USER_ID;

  // Auth — 앱 전체에서 1회만 실행
  useEffect(() => {
    if (!auth) { setAuthLoading(false); return; }
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
      if (!u) {
        setProducts([]); setSessions([]); setHabits([]);
        setCareItems([]); setMakeupItems([]); setLookItems([]);
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
        (s) => setSessions(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Session, 'id'>) }))),
        () => {}
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
    <AppContext.Provider value={{ user, userId, authLoading, products, sessions, habits, careItems, makeupItems, lookItems, medRoutines, healthRoutines, healthCategories, dietPrograms }}>
      {children}
    </AppContext.Provider>
  );
}
