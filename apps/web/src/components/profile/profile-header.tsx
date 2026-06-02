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
import type { OnlineStatus, PublicProfile } from '@ruletka/shared-types';
import { Avatar, codeToFlag, COUNTRY_BY_CODE } from '@ruletka/ui';
import { cn } from '@/lib/cn';
import { ProfileBadges } from '@/components/social/profile-badges';
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
  /** Optional cover image URL layered under the gradient (future-proof). */
  coverUrl,
  actions,
}: {
  profile: PublicProfile;
  status?: OnlineStatus;
  coverUrl?: string | null;
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
      <div aria-hidden="true" className="relative h-32 overflow-hidden sm:h-44">
        {coverUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- remote, dynamic cover asset
          <img
            src={coverUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover opacity-60"
          />
        )}
        {/* Aurora base wash — richer so the cover reads vivid, not washed-out. */}
        <div className="absolute inset-0 bg-gradient-to-br from-[var(--color-neon-violet)]/65 via-[var(--color-neon-magenta)]/40 to-[var(--color-neon-cyan)]/55" />
        {/* Bright central bloom for depth under the identity block. */}
        <div
          aria-hidden="true"
          className="absolute left-1/2 top-0 h-56 w-2/3 -translate-x-1/2 bg-[radial-gradient(ellipse_at_top,color-mix(in_oklch,var(--color-neon-cyan)_45%,transparent),transparent_70%)] blur-2xl"
        />
        {/* Drifting neon orbs (paused under reduced-motion). */}
        <motion.div
          className="absolute -left-10 -top-16 h-48 w-48 rounded-full bg-[radial-gradient(circle,var(--color-neon-violet),transparent_65%)] opacity-60 blur-2xl"
          animate={reduce ? undefined : { x: [0, 24, 0], y: [0, 14, 0] }}
          transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute -right-8 top-0 h-40 w-40 rounded-full bg-[radial-gradient(circle,var(--color-neon-cyan),transparent_65%)] opacity-50 blur-2xl"
          animate={reduce ? undefined : { x: [0, -20, 0], y: [0, 18, 0] }}
          transition={{ duration: 17, repeat: Infinity, ease: 'easeInOut' }}
        />
        {/* Tech grid + grain for texture, fading into the panel. */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,var(--color-border)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-border)_1px,transparent_1px)] bg-[size:40px_40px] opacity-[0.12] [mask-image:linear-gradient(to_bottom,black,transparent)]" />
        <div className="grain absolute inset-0" />
        <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[var(--color-card)]/70 to-transparent" />
      </div>

      {/* ── Identity ──────────────────────────────────────────────────── */}
      <div className="px-5 pb-6 sm:px-8">
        <div className="-mt-14 flex flex-col gap-4 sm:-mt-16 sm:flex-row sm:items-end sm:justify-between">
          <motion.div variants={rise} className="flex items-end gap-4">
            {/* Avatar with a soft glow + presence dot. */}
            <div className="relative">
              <span
                aria-hidden="true"
                className="absolute -inset-2 -z-10 rounded-full bg-gradient-to-br from-[var(--color-neon-violet)]/50 to-[var(--color-neon-cyan)]/40 blur-xl"
              />
              <div className="rounded-full ring-4 ring-background">
                <Avatar
                  src={profile.avatarUrl}
                  alt={profile.nickname}
                  size="xl"
                  status={status}
                  // Premium gets the animated aurora ring; everyone else still
                  // gets a crisp accent ring so the avatar never reads as "naked".
                  ring={profile.isPremium ? 'aurora' : 'accent'}
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
