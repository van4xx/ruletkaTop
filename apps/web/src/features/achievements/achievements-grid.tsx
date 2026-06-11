'use client';

/**
 * 4-column grid of every catalogue achievement. Unlocked tiles glow in their
 * tier color; locked tiles render greyscale with the criteria caption
 * ("3/10 calls").
 *
 * Reads the catalogue + the caller's /me state via `useAchievementsCatalogue`
 * + `useMyAchievements`. The component is self-contained — the page just
 * mounts it.
 */
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { Card, Skeleton } from '@ruletka/ui';
import type { AchievementIconName, AchievementTier } from '@ruletka/shared-types';
import { resolveAchievementIcon, tierColorVar, tierName } from './icon-map';
import { useAchievementsCatalogue, useMyAchievements } from './use-achievements';

/** One catalogue row + the user's current state. */
interface ResolvedRow {
  id: string;
  category: string;
  icon: AchievementIconName;
  /** Highest tier reached so far (0 = locked). */
  reached: AchievementTier | 0;
  /** Next tier the user is working toward (only meaningful when not capped). */
  workingTier: AchievementTier;
  /** Current counter (locked rows) / total tiers (capped rows). */
  current: number;
  target: number;
  capped: boolean;
  hidden: boolean;
}

/**
 * Render the full catalogue as a 4-column grid. Categories appear as section
 * headers, with the rows of each grouped together for natural scanning.
 */
export function AchievementsGrid() {
  const t = useTranslations('profile');
  const catalogueQuery = useAchievementsCatalogue();
  const myQuery = useMyAchievements();

  const rows = useMemo<ResolvedRow[]>(() => {
    const catalogue = catalogueQuery.data?.catalogue ?? [];
    const me = myQuery.data;
    const highestByAch = new Map<string, AchievementTier>();
    for (const unlock of me?.unlocked ?? []) {
      const prev = highestByAch.get(unlock.achievementId) ?? 0;
      if (unlock.tier > prev) {
        highestByAch.set(unlock.achievementId, unlock.tier);
      }
    }
    const progressByAch = new Map(
      (me?.progress ?? []).map((p) => [p.achievementId, p] as const),
    );

    return catalogue.map<ResolvedRow>((row) => {
      const reached = highestByAch.get(row.id) ?? 0;
      const isCapped = reached >= row.tiers.length;
      const progress = progressByAch.get(row.id);
      const tier = (progress?.tier ?? (reached === 0 ? 1 : Math.min(reached + 1, row.tiers.length))) as AchievementTier;
      return {
        id: row.id,
        category: row.category,
        icon: row.icon,
        reached,
        workingTier: tier,
        current: isCapped ? row.tiers.length : (progress?.current ?? 0),
        target: progress?.target ?? row.tiers[row.tiers.length - 1] ?? 1,
        capped: isCapped,
        hidden: row.hidden === true,
      };
    });
  }, [catalogueQuery.data, myQuery.data]);

  // Group by category so the grid reads as natural sections.
  const grouped = useMemo(() => {
    const map = new Map<string, ResolvedRow[]>();
    for (const row of rows) {
      const bucket = map.get(row.category) ?? [];
      bucket.push(row);
      map.set(row.category, bucket);
    }
    return Array.from(map.entries());
  }, [rows]);

  if (catalogueQuery.isLoading || myQuery.isLoading) {
    return <AchievementsGridSkeleton />;
  }

  return (
    <div className="space-y-8" aria-label={t('achievements.gridAria')}>
      {grouped.map(([category, items]) => (
        <section key={category} aria-labelledby={`achievements-cat-${category}`}>
          <h3
            id={`achievements-cat-${category}`}
            className="mb-3 text-sm font-semibold uppercase tracking-wider text-white/70"
          >
            {t(`achievements.categories.${category}`)}
          </h3>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {items.map((row) => (
              <li key={row.id}>
                <AchievementTile row={row} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** One badge cell — locked = greyscale, unlocked = glowing tier color. */
function AchievementTile({ row }: { row: ResolvedRow }) {
  const t = useTranslations('profile');
  const Icon = resolveAchievementIcon(row.icon);
  const locked = row.reached === 0;
  const tierForGlow = (row.capped ? row.reached : row.reached) as AchievementTier | 0;
  const glow = tierForGlow > 0 ? tierColorVar(tierForGlow as AchievementTier) : 'rgba(255,255,255,0.04)';

  // Hidden + locked = mystery card. We never show the title/description until
  // the easter egg fires (matches the "Hidden" category contract).
  if (row.hidden && locked) {
    return (
      <Card
        className="flex aspect-square flex-col items-center justify-center gap-2 border-white/5 bg-white/[0.02] p-3 text-center text-white/40"
        aria-label={t('achievements.hiddenLockedAria')}
      >
        <div className="grid h-12 w-12 place-items-center rounded-full bg-white/5">
          <span className="text-xl">?</span>
        </div>
        <p className="text-xs">{t('achievements.hiddenLockedTitle')}</p>
      </Card>
    );
  }

  const title = t(`achievements.titles.${row.id}`);
  const tierLabel = !locked
    ? t(`achievements.tierLabels.${tierName(row.reached as AchievementTier)}`)
    : null;
  const lockedCaption = t('achievements.progressCaption', {
    description: t(`achievements.descriptions.${row.id}`),
    current: row.current,
    target: row.target,
  });

  return (
    <Card
      className="relative flex aspect-square flex-col items-center justify-center gap-2 overflow-hidden border-white/10 bg-white/[0.04] p-3 text-center transition-all hover:border-white/20"
      aria-label={
        locked
          ? t('achievements.lockedAria', { title })
          : t('achievements.unlockedAria', { title, tier: tierLabel ?? '' })
      }
    >
      {/* The radial glow behind the icon. Visible only when unlocked. */}
      {!locked ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background: `radial-gradient(circle at 50% 35%, ${glow}33 0%, transparent 60%)`,
          }}
        />
      ) : null}
      <div
        className={`grid h-12 w-12 place-items-center rounded-full ${
          locked ? 'bg-white/5 text-white/40' : 'bg-white/10'
        }`}
        style={!locked ? { color: glow, boxShadow: `0 0 24px -6px ${glow}` } : undefined}
      >
        <Icon className="h-6 w-6" />
      </div>
      <p
        className={`line-clamp-1 text-xs font-medium ${locked ? 'text-white/50' : 'text-white'}`}
      >
        {title}
      </p>
      <p className="line-clamp-2 text-[11px] leading-tight text-white/50">{lockedCaption}</p>
      {tierLabel ? (
        <span
          className="absolute right-1 top-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-black"
          style={{ background: glow }}
        >
          {tierLabel}
        </span>
      ) : null}
    </Card>
  );
}

/** Skeleton — preserves the layout so the page doesn't shift on load. */
function AchievementsGridSkeleton() {
  return (
    <div className="space-y-8">
      {[1, 2, 3].map((section) => (
        <section key={section}>
          <Skeleton className="mb-3 h-4 w-32" />
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((cell) => (
              <li key={cell}>
                <Skeleton className="aspect-square w-full" />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
