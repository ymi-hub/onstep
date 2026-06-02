import { redirect } from 'next/navigation';

// /today 로 직접 접근하면 / (TODAY 화면)으로 이동
export default function TodayRedirectPage() {
  redirect('/');
}
