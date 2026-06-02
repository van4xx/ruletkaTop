'use client';

/**
 * Dashboard hero greeting: a time-of-day-aware welcome with the user's
 * nickname, a short lede, and a live "online now" pulse. Sets the tone for the
 * hub without competing with the quick-launch CTAs below.
 */
import { motion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/features/auth';

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

/** Time-of-day greeting message key. */
function greetingKey(date = new Date()): string {
  const h = date.getHours();
  if (h >= 5 && h < 12) return 'dashboard.greetingMorning';
  if (h >= 12 && h < 18) return 'dashboard.greetingDay';
  if (h >= 18 && h < 23) return 'dashboard.greetingEvening';
  return 'dashboard.greetingNight';
}

export function DashboardWelcome() {
  const t = useTranslations('misc');
  const { user } = useAuth();
  const name = user?.nickname;

  return (
    <motion.header
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, ease: EASE_OUT }}
      className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"
    >
      <div className="min-w-0">
        <span className="glass-panel mb-3 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium text-muted-foreground">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-neon-cyan)] opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--color-neon-cyan)]" />
          </span>
          {t('dashboard.liveBadge')}
        </span>
        <h1 className="font-display text-3xl font-extrabold leading-[1.05] tracking-tight sm:text-4xl">
          {t(greetingKey())}
          {name ? (
            <>
              ,<br className="sm:hidden" /> <span className="text-gradient-neon">{name}</span>
            </>
          ) : null}
        </h1>
        <p className="mt-3 max-w-xl text-balance text-muted-foreground">
          {t('dashboard.welcomeLede')}
        </p>
      </div>
    </motion.header>
  );
}
