'use client';

/**
 * /profile/me/achievements page body. Auth-gated — anonymous viewers see the
 * "sign in to see your achievements" sign-post. Mounts the unlock-toast
 * subscription so a refetch landing a newly-unlocked badge fires the toast in
 * the same render.
 */
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button } from '@ruletka/ui';
import { ArrowLeft } from 'lucide-react';
import { ROUTES } from '@/config/nav';
import { useAuth } from '@/features/auth';
// `ROUTES.login` isn't defined (the auth pages live at top-level /login,
// /register), so we hardcode the path the layout uses.
import { AchievementsGrid } from './achievements-grid';
import { useUnlockToasts } from './use-unlock-toast';

export function MyAchievementsClient() {
  const t = useTranslations('profile');
  const { isAuthenticated } = useAuth();
  // Subscribe to the toast pump — fires once per newly-unlocked badge.
  useUnlockToasts();

  if (!isAuthenticated) {
    return (
      <div className="space-y-4 text-center">
        <h1 className="text-2xl font-semibold">{t('achievements.signInRequiredTitle')}</h1>
        <p className="text-white/70">{t('achievements.signInRequiredBody')}</p>
        <Button asChild variant="primary" size="sm">
          <Link href="/login">{t('achievements.signInAction')}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">{t('achievements.pageTitle')}</h1>
        <Button asChild variant="outline" size="sm">
          <Link href={ROUTES.me} aria-label={t('achievements.backToProfile')}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            {t('achievements.backToProfile')}
          </Link>
        </Button>
      </div>
      <p className="text-sm text-white/60">{t('achievements.pageIntro')}</p>
      <AchievementsGrid />
    </div>
  );
}
