'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '../lib/cn';

const coinSizes = {
  xs: 'size-3.5',
  sm: 'size-4',
  md: 'size-5',
  lg: 'size-6',
  xl: 'size-8',
} as const;

export interface CoinIconProps extends React.SVGAttributes<SVGSVGElement> {
  size?: keyof typeof coinSizes;
  /** Add a soft golden glow behind the coin. */
  glow?: boolean;
}

/**
 * The product's coin glyph — a custom minted-coin mark (not a generic dollar
 * sign) rendered in the warm `--coin` gold with an engraved "R" for ruletka.
 * Scales crisply at any size and is theme-aware.
 */
export const CoinIcon = React.forwardRef<SVGSVGElement, CoinIconProps>(function CoinIcon(
  { className, size = 'md', glow = false, ...props },
  ref,
) {
  return (
    <svg
      ref={ref}
      viewBox="0 0 24 24"
      fill="none"
      role="img"
      aria-label="coins"
      className={cn(coinSizes[size], glow && 'drop-shadow-[0_0_6px_var(--coin)]', className)}
      {...props}
    >
      <defs>
        <linearGradient
          id="ruletka-coin-face"
          x1="4"
          y1="3"
          x2="20"
          y2="21"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="var(--coin-shine)" />
          <stop offset="1" stopColor="var(--coin)" />
        </linearGradient>
      </defs>
      <circle cx="12" cy="12" r="9.5" fill="url(#ruletka-coin-face)" />
      <circle
        cx="12"
        cy="12"
        r="9.5"
        stroke="var(--coin-foreground)"
        strokeOpacity="0.35"
        strokeWidth="1"
      />
      <circle
        cx="12"
        cy="12"
        r="7"
        stroke="var(--coin-foreground)"
        strokeOpacity="0.25"
        strokeWidth="0.75"
      />
      {/* Engraved monogram. */}
      <path
        d="M9.6 16V8h2.9c1.6 0 2.7 1 2.7 2.5 0 1.1-.6 1.9-1.6 2.3l1.9 3.2h-1.9l-1.7-3h-.7v3H9.6Zm1.6-4.4h1.1c.8 0 1.3-.4 1.3-1.1 0-.7-.5-1.1-1.3-1.1h-1.1v2.2Z"
        fill="var(--coin-foreground)"
      />
    </svg>
  );
});

const balanceVariants = cva(
  'inline-flex items-center gap-1.5 font-semibold tabular-nums leading-none text-foreground',
  {
    variants: {
      variant: {
        plain: '',
        pill: 'rounded-full border border-coin/30 bg-coin/12 px-3 py-1.5 text-coin',
        glass: 'glass rounded-full px-3 py-1.5',
      },
      size: {
        sm: 'text-xs',
        md: 'text-sm',
        lg: 'text-base',
      },
    },
    defaultVariants: { variant: 'pill', size: 'md' },
  },
);

const iconForBalanceSize = { sm: 'sm', md: 'sm', lg: 'md' } as const;

export interface CoinBalanceProps
  extends
    Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'>,
    VariantProps<typeof balanceVariants> {
  /** The coin amount. Formatted with locale grouping (e.g. 12,500). */
  amount: number;
  /** BCP-47 locale for number grouping. Defaults to the environment locale. */
  locale?: string;
  /** Abbreviate large numbers (12.5K, 1.2M). Default false. */
  compact?: boolean;
  /** Hide the coin glyph (text only). */
  hideIcon?: boolean;
}

/**
 * Displays a user's coin balance with the {@link CoinIcon} and locale-aware,
 * `tabular-nums` formatting so the figure doesn't jitter as it animates/updates.
 * Pairs with the `economy` domain's `Wallet.balanceCoins`.
 */
export const CoinBalance = React.forwardRef<HTMLSpanElement, CoinBalanceProps>(function CoinBalance(
  { className, amount, locale, compact = false, hideIcon = false, variant, size = 'md', ...props },
  ref,
) {
  const formatted = React.useMemo(() => {
    try {
      return new Intl.NumberFormat(locale, {
        notation: compact ? 'compact' : 'standard',
        maximumFractionDigits: compact ? 1 : 0,
      }).format(amount);
    } catch {
      return String(amount);
    }
  }, [amount, locale, compact]);

  const iconSize: CoinIconProps['size'] = iconForBalanceSize[size ?? 'md'] ?? 'sm';

  return (
    <span ref={ref} className={cn(balanceVariants({ variant, size }), className)} {...props}>
      {!hideIcon && <CoinIcon size={iconSize} />}
      <span>{formatted}</span>
    </span>
  );
});
