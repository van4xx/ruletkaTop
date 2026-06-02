import type { Rarity } from '@ruletka/shared-types';
import type { BadgeProps } from '@ruletka/ui';

/**
 * Per-rarity visual config for gifts/cosmetics. Colors reference the design
 * tokens' rarity ramp (`--rarity-*`) with web-shell fallbacks so styling holds
 * even before the UI theme layer is wired into the app stylesheet.
 */
export interface RarityStyle {
  /** `economy.rarity.*` message key for the rarity label; resolve with `useTranslations('economy')`. */
  labelKey: string;
  /** Badge variant from the design system. */
  badge: NonNullable<BadgeProps['variant']>;
  /** CSS color expression for glows/borders. */
  color: string;
  /** Tailwind-ish gradient used behind the gift glyph. */
  glow: string;
}

export const RARITY_STYLES: Record<Rarity, RarityStyle> = {
  common: {
    labelKey: 'rarity.common',
    badge: 'common',
    color: 'var(--rarity-common, oklch(0.7 0.02 268))',
    glow: 'from-slate-400/20 to-slate-500/5',
  },
  rare: {
    labelKey: 'rarity.rare',
    badge: 'rare',
    color: 'var(--rarity-rare, oklch(0.7 0.16 235))',
    glow: 'from-sky-400/30 to-blue-500/10',
  },
  epic: {
    labelKey: 'rarity.epic',
    badge: 'epic',
    color: 'var(--rarity-epic, oklch(0.68 0.2 300))',
    glow: 'from-fuchsia-500/30 to-violet-500/10',
  },
  legendary: {
    labelKey: 'rarity.legendary',
    badge: 'legendary',
    color: 'var(--rarity-legendary, oklch(0.82 0.16 78))',
    glow: 'from-amber-400/35 to-orange-500/10',
  },
};
