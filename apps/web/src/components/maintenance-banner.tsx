'use client';

/**
 * Site-wide, NON-BLOCKING maintenance banner.
 *
 * A slim top bar shown whenever the live `GET /public/status` flag
 * `maintenanceMode === true`. Mounted high in the global app shell (just under
 * the header, alongside the verify-email banner) so it appears for BOTH
 * signed-in and signed-out users — the status query is public and never gated
 * on auth.
 *
 * Deliberately a single hairline bar, never a modal or full-screen gate: the
 * platform stays usable, this just warns that some features may be temporarily
 * unavailable. When `maintenanceMode` is false / unknown / the fetch fails, it
 * renders nothing (no layout shift). The amber `--color-warning` tone keeps it
 * visually distinct from the violet "confirm your email" banner.
 */
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { Wrench } from 'lucide-react';
import { usePublicStatus } from '@/features/status/use-public-status';

export function MaintenanceBanner() {
  const t = useTranslations('chrome');
  const reduce = useReducedMotion();
  const { data } = usePublicStatus();

  // Only show on an explicit `true`; undefined (still loading / fetch failed) is
  // treated as "all clear" so a status hiccup never plasters the banner.
  const visible = data?.maintenanceMode === true;

  return (
    <AnimatePresence initial={false}>
      {visible && (
        <motion.div
          initial={reduce ? false : { height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          className="overflow-hidden border-b border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 backdrop-blur"
          role="status"
          aria-live="polite"
        >
          <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2.5 sm:px-6 lg:px-8">
            <Wrench
              className="h-4 w-4 shrink-0 text-[var(--color-warning)]"
              aria-hidden="true"
            />
            <p className="min-w-0 flex-1 text-sm text-foreground/90">
              <span className="font-semibold">{t('maintenance.titlePrefix')}</span>{' '}
              <span className="text-muted-foreground">{t('maintenance.body')}</span>
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
