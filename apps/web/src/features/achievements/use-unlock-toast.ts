'use client';

/**
 * Drives the "Achievement unlocked!" toast.
 *
 * Mount once at the app level (or anywhere inside the auth-gated tree). It
 * subscribes to `useMyAchievements()` so a refetch that yields newly-unlocked
 * rows fires one toast per row. The detection is anchored on
 * `useNewlyUnlocked` (the `localStorage` cursor + the server `checkedAt`
 * stamp), so an unlock that already toasted in a previous tab DOES NOT
 * re-toast in this one.
 *
 * Polite by default — the toasts use `info` (not `success`) so they don't
 * compete with the loud notification stack on the social pages, and the
 * description carries the badge title + the tier so power-users can tell
 * a Silver from a Gold without opening the grid.
 */
import { useTranslations } from 'next-intl';
import { useCallback } from 'react';
import { toast } from '@ruletka/ui';
import type { UserAchievementUnlock } from '@ruletka/shared-types';
import { useMyAchievements, useNewlyUnlocked } from './use-achievements';
import { tierName } from './icon-map';

/**
 * Subscribe to `/achievements/me` and fire a toast on every newly-unlocked
 * badge. Returns nothing — it's a side effect.
 */
export function useUnlockToasts(): void {
  const t = useTranslations('profile');
  const { data } = useMyAchievements();

  const onNewUnlock = useCallback(
    (unlock: UserAchievementUnlock) => {
      // Resolve the title from i18n. The catalogue id maps directly to a
      // `titles.<id>` key; the hidden easter eggs share the same lookup
      // (they're no longer hidden once unlocked).
      let title: string;
      try {
        title = t(`achievements.titles.${unlock.achievementId}`);
      } catch {
        title = unlock.achievementId;
      }
      const tier = t(`achievements.tierLabels.${tierName(unlock.tier)}`);
      toast({
        title: t('achievements.toast.unlocked'),
        description: t('achievements.toast.unlockedBody', { title, tier }),
        variant: 'info',
      });
    },
    [t],
  );

  useNewlyUnlocked(data, onNewUnlock);
}
