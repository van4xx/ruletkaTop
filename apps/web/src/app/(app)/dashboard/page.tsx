import type { Metadata } from 'next';
import { DashboardClient } from '@/components/dashboard/dashboard-client';

export const metadata: Metadata = {
  title: 'Дашборд',
  description:
    'Ваш центр управления: запуск видео- и голосового чата, Топ эфира, друзья онлайн, сообщения и бонусы.',
  // Authenticated, personalised hub — keep it out of search indexes.
  robots: { index: false, follow: false },
};

/**
 * /dashboard — the authenticated hub.
 *
 * Server shell that sets metadata and renders the interactive grid. Auth is
 * enforced inside {@link DashboardClient} via `RequireAuth` (a complement to the
 * edge middleware), so an expired in-session token bounces to /login cleanly.
 */
export default function DashboardPage() {
  return <DashboardClient />;
}
