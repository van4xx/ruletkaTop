'use client';

/**
 * The profile hero — the centrepiece of every profile page.
 *
 * A layered cover (aurora gradient + drifting neon orbs + grain), a large
 * avatar with a premium aurora ring + live presence dot, the identity block
 * (nickname, badges, online-status line), and a row of meta chips (gender ·
 * age · country · languages · "в эфире с"). Actions are injected via `actions`
 * so the public and own-profile pages can supply different button sets.
 *
 * Motion is a single, tasteful entrance; looping orb drift is neutralised under
 * `prefers-reduced-motion` (globals.css). Fully responsive + a11y-labelled.
 */
import type { ReactNode } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { motion, useReducedMotion, type Variants } from 'framer-motion';
import { CalendarDays } from 'lucide-react';
import type {
  CoverId,
  EffectiveTier,
  FrameId,
  OnlineStatus,
  PublicProfile,
} from '@ruletka/shared-types';
import { Avatar, codeToFlag, COUNTRY_BY_CODE } from '@ruletka/ui';
import { cn } from '@/lib/cn';
import { ProfileBadges } from '@/components/social/profile-badges';
import { AvatarFrame } from './avatar-frame';
import { ProfileCover } from './cover-presets';
import { InterestChips } from './interest-chips';

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.04 } },
};
const rise: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE_OUT } },
};

/** Dot + text colour per presence status (label is translated at render). */
const PRESENCE: Record<OnlineStatus, { dot: string; text: string }> = {
  online: { dot: 'bg-success', text: 'text-success' },
  away: { dot: 'bg-warning', text: 'text-warning' },
  in_call: { dot: 'bg-accent', text: 'text-accent' },
  offline: { dot: 'bg-subtle-foreground', text: 'text-muted-foreground' },
};

function MetaChip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-card/55 px-3 py-1 text-sm text-foreground/90 ring-1 ring-border/60 backdrop-blur-sm">
      {children}
    </span>
  );
}

export function ProfileHeader({
  profile,
  status,
  /**
   * The cover cosmetic to render in the hero band. Defaults to the profile's
   * `activeCover` (then the free `aurora`), so existing profiles look identical.
   * Passed explicitly by the owner page so the live picker preview can override
   * it before the server round-trip lands.
   */
  coverId,
  /**
   * The avatar-frame cosmetic to render around the avatar. Defaults to
   * `null` (no frame) so existing profiles render bare. Passed explicitly by
   * the owner page so the live picker preview can override before the server
   * round-trip lands.
   */
  frameId,
  /**
   * The viewer's premium tier — drives the tier-aware glow (`silver` for Lite,
   * animated `gold-shimmer` for Pro). Optional and only meaningful when
   * `profile.isPremium` is true; falls back to a generic premium aurora ring
   * when omitted (the historical look — no visual regression on public
   * profiles where the server doesn't expose another user's tier).
   */
  premiumTier,
  actions,
}: {
  profile: PublicProfile;
  status?: OnlineStatus;
  coverId?: CoverId;
  frameId?: FrameId | null;
  premiumTier?: EffectiveTier;
  actions?: ReactNode;
}) {
  const t = useTranslations('profile');
  const format = useFormatter();
  const reduce = useReducedMotion();
  const country = COUNTRY_BY_CODE.get(profile.country);
  const presence = status ? PRESENCE[status] : null;
  const joined = format.dateTime(new Date(profile.createdAt), {
    month: 'long',
    year: 'numeric',
  });

  return (
    <motion.section
      variants={container}
      initial="hidden"
      animate="show"
      className="glass-panel relative overflow-hidden rounded-3xl"
      aria-labelledby="profile-name"
    >
      {/* ── Cover ─────────────────────────────────────────────────────── */}
      {/* Registry-driven cosmetic: the active cover's layered visual. Looping
          motion is gated on prefers-reduced-motion (the static gradient still
          renders). `coverId` defaults to the profile's `activeCover`. */}
      <div aria-hidden="true" className="relative h-32 overflow-hidden sm:h-44">
        <ProfileCover coverId={coverId ?? profile.activeCover} animated={!reduce} />
      </div>

      {/* ── Identity ──────────────────────────────────────────────────── */}
      <div className="px-5 pb-6 sm:px-8">
        <div className="-mt-14 flex flex-col gap-4 sm:-mt-16 sm:flex-row sm:items-end sm:justify-between">
          <motion.div variants={rise} className="flex items-end gap-4">
            {/* Avatar with a soft glow + presence dot, optionally wrapped
                in the equipped avatar-frame cosmetic (decorative ring). The
                frame is invisible when `frameId` is null, so users with no
                frame see zero visual delta. */}
            <div className="relative">
              {/* Tier-aware glow:
                  - Pro  → animated gold-shimmer halo + a stronger aurora ring;
                  - Lite → subtle silver-ish halo (silvers the violet/cyan mix);
                  - Free → the historical generic neon glow.
                  Class names are intentionally derived (not raw `bg-[...]`) so
                  the diff against the previous hero is a CSS-only change. */}
              <span
                aria-hidden="true"
                className={cn(
                  'profile-glow absolute -inset-2 -z-10 rounded-full blur-xl',
                  profile.isPremium && premiumTier === 'pro'
                    ? 'profile-glow--pro'
                    : profile.isPremium && premiumTier === 'lite'
                      ? 'profile-glow--lite'
                      : 'profile-glow--free',
                )}
              />
              <AvatarFrame frameId={frameId ?? null}>
                <div className="rounded-full ring-4 ring-background">
                  <Avatar
                    src={profile.avatarUrl}
                    alt={profile.nickname}
                    size="xl"
                    status={status}
                    // Tier-aware ring: Pro keeps the animated aurora; Lite gets
                    // a crisp accent ring (so the silver glow alone reads the
                    // tier); everyone else stays accent.
                    ring={profile.isPremium && premiumTier === 'pro' ? 'aurora' : 'accent'}
                    // Vivid on-brand gradient disk behind the initial so an
                    // image-less avatar still looks designed, not empty.
                    fallback={
                      <span className="font-display text-3xl font-extrabold text-white drop-shadow-sm sm:text-4xl">
                        {profile.nickname.charAt(0).toUpperCase()}
                      </span>
                    }
                    className="size-24 bg-[linear-gradient(135deg,var(--color-neon-violet),var(--color-neon-magenta)_55%,var(--color-neon-cyan))] sm:size-28"
                  />
                </div>
              </AvatarFrame>
            </div>

            <div className="mb-1 min-w-0">
              <h1
                id="profile-name"
                className="truncate font-display text-2xl font-extrabold tracking-tight sm:text-3xl"
              >
                {profile.nickname}
              </h1>
              {/* Presence + badges line. */}
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                {presence && status && (
                  <span
                    className={cn(
                      'inline-flex items-center gap-1.5 text-sm font-medium',
                      presence.text,
                    )}
                  >
                    <span className="relative flex h-2 w-2">
                      {status === 'online' && (
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
                      )}
                      <span
                        className={cn('relative inline-flex h-2 w-2 rounded-full', presence.dot)}
                      />
                    </span>
                    {t(`presence.${status}`)}
                  </span>
                )}
                {profile.badges.length > 0 && <ProfileBadges badges={profile.badges} size="sm" />}
              </div>
            </div>
          </motion.div>

          {actions && (
            <motion.div variants={rise} className="flex flex-wrap items-center gap-2 sm:mb-1">
              {actions}
            </motion.div>
          )}
        </div>

        {/* Status / bio line. */}
        {profile.status && (
          <motion.p
            variants={rise}
            className="mt-4 max-w-prose text-pretty text-sm text-foreground/85"
          >
            {profile.status}
          </motion.p>
        )}

        {/* Meta chips. */}
        <motion.div variants={rise} className="mt-4 flex flex-wrap items-center gap-2">
          <MetaChip>{t(`gender.${profile.gender}`)}</MetaChip>
          <MetaChip>{t('age', { age: profile.age })}</MetaChip>
          <MetaChip>
            <span aria-hidden="true">{codeToFlag(profile.country)}</span>
            <span>{country?.name ?? profile.country}</span>
          </MetaChip>
          {profile.languages.length > 0 && (
            <MetaChip>
              <span className="text-muted-foreground">{t('header.languagesLabel')}</span>
              <span className="uppercase">{profile.languages.join(', ')}</span>
            </MetaChip>
          )}
          <MetaChip>
            <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            <span className="text-muted-foreground">{t('header.joinedLine')}</span>
            <span>{joined}</span>
          </MetaChip>
        </motion.div>

        {/* Interests (hidden when empty) */}
        {profile.interests && profile.interests.length > 0 && (
          <motion.div variants={rise} className="mt-3">
            <InterestChips interests={profile.interests} withLabel />
          </motion.div>
        )}
      </div>
    </motion.section>
  );
}
