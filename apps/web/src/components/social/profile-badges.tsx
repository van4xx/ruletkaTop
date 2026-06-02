'use client';

/**
 * Renders the shared `Badge[]` enum (premium / verified / top / staff) as a row
 * of on-brand pills with icons. Reused across friend cards, profile headers and
 * chat headers so badge presentation stays consistent.
 */
import type { Badge as BadgeKind } from '@ruletka/shared-types';
import { Badge } from '@ruletka/ui';
import { BadgeCheck, Crown, ShieldCheck, Trophy } from 'lucide-react';
import { cn } from '@/lib/cn';

const BADGE_CONFIG: Record<
  BadgeKind,
  { label: string; icon: typeof Crown; variant: 'aurora' | 'accent' | 'success' | 'warning' }
> = {
  premium: { label: 'Premium', icon: Crown, variant: 'aurora' },
  verified: { label: 'Проверен', icon: BadgeCheck, variant: 'accent' },
  top: { label: 'Топ', icon: Trophy, variant: 'warning' },
  staff: { label: 'Команда', icon: ShieldCheck, variant: 'success' },
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
  if (!badges?.length) return null;
  const sorted = [...badges].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {sorted.map((b) => {
        const cfg = BADGE_CONFIG[b];
        if (!cfg) return null;
        const Icon = cfg.icon;
        return (
          <Badge
            key={b}
            variant={cfg.variant}
            size={size}
            aria-label={cfg.label}
            title={cfg.label}
            className={iconOnly ? 'px-1.5' : undefined}
          >
            <Icon aria-hidden="true" />
            {!iconOnly && <span>{cfg.label}</span>}
          </Badge>
        );
      })}
    </div>
  );
}
