'use client';

/**
 * Received-gifts mini-showcase. Reuses the profile feature's `useProfileGifts`
 * (joins received gift transactions to the catalogue for glyph + rarity) and the
 * shared `GiftsShowcase` grid, capped for the dashboard. Links to the full
 * showcase on the profile, and to the gift catalogue.
 */
import Link from 'next/link';
import { Gift as GiftIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/features/auth';
import { useProfileGifts } from '@/features/profile/use-profile';
import { GiftsShowcase } from '@/components/profile/gifts-showcase';
import { ErrorState } from '@/components/economy/states';
import { DashboardCard, WidgetHeader } from './dashboard-card';

const GIFTS_ROUTE = '/gifts';
/** Cap the dashboard preview to a single tidy row-ish cluster. */
const PREVIEW_LIMIT = 8;

export function GiftsWidget() {
  const t = useTranslations('misc');
  const { user } = useAuth();
  const { gifts, isLoading, isError, refetch } = useProfileGifts(user?.id);

  const preview = gifts.slice(0, PREVIEW_LIMIT);

  return (
    <DashboardCard label={t('dashboard.giftsLabel')}>
      <WidgetHeader
        icon={<GiftIcon className="h-4 w-4" aria-hidden="true" />}
        accent="var(--color-neon-magenta)"
        title={t('dashboard.giftsTitle')}
        count={gifts.length > 0 ? gifts.length : null}
        href="/profile/me"
        linkLabel={t('dashboard.widgetAll')}
      />

      {isError ? (
        <ErrorState
          title={t('dashboard.giftsErrorTitle')}
          description={t('dashboard.giftsErrorDesc')}
          onRetry={refetch}
        />
      ) : (
        <>
          <GiftsShowcase gifts={preview} isLoading={isLoading} />
          {!isLoading && gifts.length === 0 && (
            <div className="mt-3 flex justify-center">
              <Link
                href={GIFTS_ROUTE}
                className="text-xs font-semibold text-[var(--color-neon-magenta)] transition-colors hover:text-foreground"
              >
                {t('dashboard.giftsCatalog')}
              </Link>
            </div>
          )}
        </>
      )}
    </DashboardCard>
  );
}
