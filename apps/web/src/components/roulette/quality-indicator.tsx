'use client';

/**
 * Connection-quality signal bars for the in-call overlay. Renders a tasteful
 * 4-bar meter (à la a mobile signal indicator) tinted to the call's current
 * {@link QualityLevel}, with an optional RTT tooltip on hover. Purely
 * presentational — the level is derived in the controller from `getStats()`.
 *
 * Hidden entirely when there's no sample yet (`quality == null`), so it never
 * shows a misleading "bad" state before the first measurement lands.
 */
import { motion } from 'framer-motion';
import type { QualityLevel, QualitySample } from '@/features/roulette/types';
import { cn } from '@/lib/cn';

/** Bars lit + accent color + label per level. Colors track the neon palette. */
const LEVELS: Record<
  QualityLevel,
  { bars: number; color: string; glow: string; label: string }
> = {
  great: {
    bars: 4,
    color: 'var(--color-neon-cyan)',
    glow: 'rgba(34,211,238,0.55)',
    label: 'Отличная связь',
  },
  good: {
    bars: 3,
    color: 'var(--color-neon-violet)',
    glow: 'rgba(139,92,246,0.5)',
    label: 'Хорошая связь',
  },
  poor: {
    bars: 2,
    color: '#fbbf24', // amber-400
    glow: 'rgba(251,191,36,0.5)',
    label: 'Слабая связь',
  },
  bad: {
    bars: 1,
    color: '#f87171', // red-400
    glow: 'rgba(248,113,113,0.55)',
    label: 'Плохая связь',
  },
};

const BAR_HEIGHTS = ['h-1.5', 'h-2.5', 'h-3.5', 'h-[1.125rem]'] as const;
/** Slightly shorter bars for the compact (voice) variant. */
const SMALL_HEIGHTS = ['h-1', 'h-2', 'h-2.5', 'h-3'] as const;

export interface QualityIndicatorProps {
  quality: QualitySample | null;
  /** Render a smaller meter (voice-mode compact overlay). */
  compact?: boolean;
  className?: string;
}

export function QualityIndicator({ quality, compact = false, className }: QualityIndicatorProps) {
  if (!quality) return null;
  const cfg = LEVELS[quality.level];
  const rttLabel =
    quality.rttMs != null && Number.isFinite(quality.rttMs)
      ? `${Math.round(quality.rttMs)} мс`
      : null;
  const title = rttLabel ? `${cfg.label} · пинг ${rttLabel}` : cfg.label;

  return (
    <motion.span
      key={quality.level}
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      role="img"
      aria-label={title}
      title={title}
      className={cn(
        'inline-flex items-end gap-[2px]',
        compact ? 'h-3.5' : 'h-[1.125rem]',
        className,
      )}
    >
      {BAR_HEIGHTS.map((h, i) => {
        const lit = i < cfg.bars;
        return (
          <span
            key={i}
            className={cn(
              'w-[3px] rounded-full transition-colors duration-300',
              compact && 'w-[2.5px]',
              h,
              compact && SMALL_HEIGHTS[i],
            )}
            style={{
              backgroundColor: lit ? cfg.color : 'rgba(255,255,255,0.18)',
              boxShadow: lit ? `0 0 6px ${cfg.glow}` : 'none',
            }}
          />
        );
      })}
    </motion.span>
  );
}
