'use client';

/**
 * Horizontal strip showing the 3-5 newest unlocked badges for the profile in
 * view. Dropped under the hero on a PUBLIC profile (the owner's profile uses
 * the full grid).
 *
 * The strip is gracefully invisible when:
 *   - the catalogue or unlock query is still loading (we render a thin
 *     skeleton row),
 *   - the catalogue read errored (we render NOTHING — never the strip empty),
 *   - the `whoCanViewProfile` gate 404s the public read (we render NOTHING —
 *     the privacy gate's job, not ours).
 *
 * Sized to fit naturally inside the existing hero column on
 * `public-profile-client.tsx` — no atmosphere of its own, just a row of badges.
 */
import { useTranslations } from 'next-intl';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@ruletka/ui';
import {
  useAchievementsCatalogue,
  usePublicAchievements,
} from '@/features/achievements/use-achievements';
import {
  resolveAchievementIcon,
  tierColorVar,
  tierName,
  type AchievementIcon,
} from '@/features/achievements/icon-map';
import type { AchievementIconName, AchievementTier } from '@ruletka/shared-types';

/** How many badges the strip can render at most. */
const MAX_BADGES = 5;
/** Below this we skip rendering — three is the visual minimum that reads as a row. */
const MIN_BADGES = 1;

/**
 * Render a horizontal row of the user's newest unlocked badges. Hides itself
 * when the user has fewer than MIN_BADGES unlocks (or the data isn't reachable).
 */
export function AchievementsStrip({ userId }: { userId: string }) {
  const t = useTranslations('profile');
  const cat = useAchievementsCatalogue();
  const pub = usePublicAchievements(userId);

  if (cat.isLoading || pub.isLoading) {
    return (
      <div className="flex animate-pulse gap-2" aria-hidden="true">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-10 w-10 rounded-full bg-white/10" />
        ))}
      </div>
    );
  }

  // Errors (incl. 404 from the whoCanViewProfile gate) → render nothing.
  if (cat.isError || pub.isError) return null;
  const catalogue = cat.data?.catalogue ?? [];
  const unlocks = pub.data?.unlocked ?? [];
  if (unlocks.length < MIN_BADGES) return null;

  // Pull the latest MAX_BADGES, newest first. The API already returns rows
  // newest-first but we re-sort defensively so the strip is correct even if
  // the wire ordering changes.
  const newest = [...unlocks]
    .sort((a, b) => Date.parse(b.unlockedAt) - Date.parse(a.unlockedAt))
    .slice(0, MAX_BADGES);

  // Catalogue lookup → icon. Unknown rows (a catalogue + unlock drift)
  // render the fallback icon rather than blanking the strip.
  const catalogueById = new Map<string, { icon: AchievementIconName }>(
    catalogue.map((row) => [row.id, { icon: row.icon }]),
  );

  return (
    <TooltipProvider delayDuration={120}>
      <ul
        className="flex flex-wrap items-center gap-2"
        aria-label={t('achievements.stripAria')}
      >
        {newest.map((unlock) => {
          const meta = catalogueById.get(unlock.achievementId);
          const Icon: AchievementIcon = resolveAchievementIcon(meta?.icon ?? 'sparkles');
          const glow = tierColorVar(unlock.tier as AchievementTier);
          const tierLabel = t(`achievements.tierLabels.${tierName(unlock.tier as AchievementTier)}`);
          let title = unlock.achievementId;
          try {
            title = t(`achievements.titles.${unlock.achievementId}`);
          } catch {
            // unknown id — title fallback already set
          }
          return (
            <li key={`${unlock.achievementId}:${unlock.tier}`}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className="grid h-10 w-10 place-items-center rounded-full bg-white/[0.06] transition-transform hover:scale-110"
                    style={{
                      color: glow,
                      boxShadow: `0 0 16px -4px ${glow}`,
                    }}
                    aria-label={t('achievements.unlockedAria', { title, tier: tierLabel })}
                  >
                    <Icon className="h-5 w-5" />
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">
                    <strong>{title}</strong>
                    <span className="ml-1 text-white/70">· {tierLabel}</span>
                  </p>
                </TooltipContent>
              </Tooltip>
            </li>
          );
        })}
      </ul>
    </TooltipProvider>
  );
}
