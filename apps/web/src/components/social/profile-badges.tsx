'use client';

/**
 * Renders the shared `Badge[]` enum (premium / verified / top / staff) as a row
 * of on-brand pills with icons. Reused across friend cards, profile headers and
 * chat headers so badge presentation stays consistent.
 */
import { useTranslations } from 'next-intl';
import type { Badge as BadgeKind } from '@ruletka/shared-types';
import { Badge } from '@ruletka/ui';
import { BadgeCheck, Crown, ShieldCheck, Trophy } from 'lucide-react';
import { cn } from '@/lib/cn';

const BADGE_CONFIG: Record<
  BadgeKind,
  { labelKey: string; icon: typeof Crown; variant: 'aurora' | 'accent' | 'success' | 'warning' }
> = {
  premium: { labelKey: 'badgePremium', icon: Crown, variant: 'aurora' },
  verified: { labelKey: 'badgeVerified', icon: BadgeCheck, variant: 'accent' },
  top: { labelKey: 'badgeTop', icon: Trophy, variant: 'warning' },
  staff: { labelKey: 'badgeStaff', icon: ShieldCheck, variant: 'success' },
};

const ORDER: BadgeKind[] = ['staff', 'top', 'verified', 'premium'];

export function ProfileBadges({
  badges,
  size = 'sm',
  iconOnly = false,
  className,
}: {
  badges: BadgeKind[];
  size?: 'sm' | 'md' | 'lg';
  iconOnly?: boolean;
  className?: string;
}) {
  const t = useTranslations('social');
  if (!badges?.length) return null;
  const sorted = [...badges].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {sorted.map((b) => {
        const cfg = BADGE_CONFIG[b];
        if (!cfg) return null;
        const Icon = cfg.icon;
        const label = t(cfg.labelKey);
        return (
          <Badge
            key={b}
            variant={cfg.variant}
            size={size}
            aria-label={label}
            title={label}
            className={iconOnly ? 'px-1.5' : undefined}
          >
            <Icon aria-hidden="true" />
            {!iconOnly && <span>{label}</span>}
          </Badge>
        );
      })}
    </div>
  );
}
