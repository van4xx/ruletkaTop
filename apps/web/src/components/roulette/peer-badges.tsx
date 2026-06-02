'use client';

/** Renders a peer's verification/premium/top/staff badges as small pills. */
import { BadgeCheck, Crown, Shield, Star } from 'lucide-react';
import { Badge } from '@ruletka/ui';
import type { Badge as BadgeKind } from '@ruletka/shared-types';

const CONFIG: Record<
  BadgeKind,
  { label: string; variant: 'aurora' | 'accent' | 'success' | 'warning'; Icon: typeof Crown }
> = {
  premium: { label: 'Premium', variant: 'aurora', Icon: Crown },
  verified: { label: 'Verified', variant: 'accent', Icon: BadgeCheck },
  top: { label: 'Top', variant: 'warning', Icon: Star },
  staff: { label: 'Staff', variant: 'success', Icon: Shield },
};

export function PeerBadges({ badges, max = 3 }: { badges: BadgeKind[]; max?: number }) {
  if (!badges?.length) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {badges.slice(0, max).map((b) => {
        const cfg = CONFIG[b];
        if (!cfg) return null;
        const { label, variant, Icon } = cfg;
        return (
          <Badge key={b} variant={variant} size="sm" className="gap-1">
            <Icon className="h-3 w-3" aria-hidden="true" />
            {label}
          </Badge>
        );
      })}
    </span>
  );
}
