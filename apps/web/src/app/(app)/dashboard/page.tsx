import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { DashboardClient } from '@/components/dashboard/dashboard-client';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('misc');
  return {
    title: t('dashboard.metaTitle'),
    description: t('dashboard.metaDescription'),
    // Authenticated, personalised hub — keep it out of search indexes.
    robots: { index: false, follow: false },
  };
}

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
