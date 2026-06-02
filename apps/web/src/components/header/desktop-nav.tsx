'use client';

/**
 * Desktop primary navigation.
 *
 * A compact, segmented nav with a single shared "pill" highlight that glides
 * between the active link via framer-motion's `layoutId` (one element, GPU
 * transform — zero layout shift). On hover, an idle link shows a faint surface;
 * the active link gets the gradient-tinted pill + neon underline. The whole nav
 * is memoised so unrelated header state (scroll, balance) never re-renders it.
 */
import { memo } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { LayoutGroup, motion } from 'framer-motion';
import { PRIMARY_NAV } from '@/config/nav';
import { cn } from '@/lib/cn';
import { isRouteActive } from './lib';

interface DesktopNavProps {
  pathname: string;
}

function DesktopNavImpl({ pathname }: DesktopNavProps) {
  const t = useTranslations('chrome');
  const tn = useTranslations('nav');
  return (
    <LayoutGroup id="primary-nav">
      <nav aria-label={t('desktopNav.aria')} className="relative hidden items-center gap-1 lg:flex">
        {PRIMARY_NAV.map((item) => {
          const active = isRouteActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.key}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              title={tn(`${item.key}.description`)}
              className={cn(
                'relative inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-medium',
                'outline-none transition-colors duration-200',
                'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {active && (
                <motion.span
                  layoutId="nav-pill"
                  aria-hidden="true"
                  transition={{ type: 'spring', stiffness: 420, damping: 34, mass: 0.7 }}
                  className="absolute inset-0 -z-10 rounded-full border border-border/70 bg-gradient-to-b from-card/80 to-card/40 shadow-[0_1px_0_0_color-mix(in_oklch,var(--color-foreground)_8%,transparent)_inset]"
                >
                  {/* Neon underline rides along with the pill. */}
                  <span className="absolute inset-x-3 -bottom-px h-px bg-gradient-to-r from-transparent via-[var(--color-neon-violet)] to-transparent" />
                </motion.span>
              )}
              <Icon className="h-4 w-4" aria-hidden="true" />
              <span>{tn(`${item.key}.label`)}</span>
            </Link>
          );
        })}
      </nav>
    </LayoutGroup>
  );
}

export const DesktopNav = memo(DesktopNavImpl);
