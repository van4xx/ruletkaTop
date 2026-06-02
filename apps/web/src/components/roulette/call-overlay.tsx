'use client';

/**
 * The peer-identity overlay shown during a call: avatar, nickname, age, country
 * flag, badges, premium ring, a live call timer and a connection-state pill.
 * Rendered over the remote video (top-left) or above the avatar in voice mode.
 */
import { motion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { Sparkles } from 'lucide-react';
import { codeToFlag, COUNTRY_BY_CODE, Avatar, Badge } from '@ruletka/ui';
import type { PeerInfo } from '@ruletka/shared-types';
import type { QualitySample, RouletteStatus } from '@/features/roulette/types';
import { PeerBadges } from './peer-badges';
import { QualityIndicator } from './quality-indicator';
import { useCallTimer } from '@/hooks/roulette/use-call-timer';
import { cn } from '@/lib/cn';

export interface CallOverlayProps {
  peer: PeerInfo;
  status: RouletteStatus;
  /** Live connection-quality sample (signal bars). Hidden when null. */
  quality?: QualitySample | null;
  /**
   * Interests shared with this peer (case-insensitive intersection of the
   * viewer's and the peer's interests). Surfaces a subtle "общий интерес" badge.
   * Empty/omitted → no badge.
   */
  sharedInterests?: readonly string[];
  /** Hide the avatar (voice mode shows its own big avatar already). */
  compact?: boolean;
  className?: string;
}

export function CallOverlay({
  peer,
  status,
  quality = null,
  sharedInterests = [],
  compact = false,
  className,
}: CallOverlayProps) {
  const t = useTranslations('roulette');
  const connected = status === 'connected';
  const reconnecting = status === 'reconnecting';
  const genderLabel =
    peer.gender === 'male'
      ? t('overlay.genderMale')
      : peer.gender === 'female'
        ? t('overlay.genderFemale')
        : '';
  // Keep the timer running across a transient reconnect — the call hasn't ended.
  const timer = useCallTimer(connected || reconnecting);
  const countryName = COUNTRY_BY_CODE.get(peer.country)?.name ?? peer.country;
  // Show at most one shared-interest tag inline (keep the overlay compact); the
  // label adapts when there are several in common.
  const topShared = sharedInterests[0];
  const moreShared = sharedInterests.length - 1;

  return (
    <motion.div
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        'glass-panel pointer-events-none flex items-center gap-3 rounded-2xl px-3 py-2.5',
        className,
      )}
    >
      {!compact && (
        <Avatar
          size="md"
          src={peer.avatarUrl ?? undefined}
          alt={peer.nickname}
          ring={peer.isPremium ? 'aurora' : 'none'}
        />
      )}
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate font-display text-sm font-bold text-foreground">
            {peer.nickname}
          </span>
          <span className="shrink-0 text-sm text-muted-foreground">
            {peer.age}
            {genderLabel ? `, ${genderLabel}` : ''}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <span aria-hidden="true">{codeToFlag(peer.country)}</span>
            <span className="truncate">{countryName}</span>
          </span>
          <PeerBadges badges={peer.badges} max={2} />
        </div>
        {topShared && (
          <div className="mt-1">
            <Badge variant="aurora" size="sm" className="max-w-[12rem] gap-1">
              <Sparkles className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="truncate">
                {moreShared > 0
                  ? t('overlay.sharedInterestsMany', { interest: topShared, count: moreShared })
                  : t('overlay.sharedInterestOne', { interest: topShared })}
              </span>
            </Badge>
          </div>
        )}
      </div>

      {/* Status / quality / timer pill */}
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {connected ? (
          <>
            <QualityIndicator quality={quality} compact={compact} />
            <Badge variant="success" size="sm" className="gap-1 tabular-nums" dot>
              {timer}
            </Badge>
          </>
        ) : reconnecting ? (
          <Badge variant="warning" size="sm" className="gap-1 tabular-nums">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
            </span>
            {t('overlay.reconnecting')}
          </Badge>
        ) : (
          <Badge variant="accent" size="sm" className="gap-1">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
            </span>
            {t('overlay.connecting')}
          </Badge>
        )}
      </div>
    </motion.div>
  );
}
