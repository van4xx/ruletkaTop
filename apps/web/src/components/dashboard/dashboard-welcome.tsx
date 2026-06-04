'use client';

/**
 * Dashboard hero greeting: a compact, time-of-day-aware welcome bar with the
 * user's nickname and a live "online now" pulse on a single horizontal row, plus
 * a slim, dismissible descriptive strip below it. Sets the tone for the hub
 * without competing with the quick-launch CTAs below.
 *
 * The descriptive lede ("Твой центр управления…") is dismissible via a close
 * button, but the dismissal is IN-MEMORY ONLY (plain React state — no
 * sessionStorage/localStorage). Because this client component remounts on every
 * full navigation/refresh, the lede always reappears on a fresh load; the close
 * button only hides it for the current view. The default `true` (shown) matches
 * on server and client, so there is no hydration mismatch.
 */
import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { Sparkles, X } from 'lucide-react';
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
  const reduce = useReducedMotion();
  const name = user?.nickname;

  // In-memory dismissal only: resets to `true` on remount (full navigation /
  // refresh), so the lede reappears on refresh. No sessionStorage/localStorage.
  const [showLede, setShowLede] = useState(true);

  return (
    <motion.header
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, ease: EASE_OUT }}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="min-w-0 truncate font-display text-xl font-extrabold tracking-tight sm:text-2xl">
          {t(greetingKey())}
          {name ? (
            <>
              , <span className="text-gradient-neon">{name}</span>
            </>
          ) : null}
        </h1>
        <span className="glass-panel ml-auto inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium text-muted-foreground">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-neon-cyan)] opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--color-neon-cyan)]" />
          </span>
          {t('dashboard.liveBadge')}
        </span>
      </div>

      <AnimatePresence initial={false}>
        {showLede && (
          <motion.div
            initial={reduce ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: EASE_OUT }}
            className="overflow-hidden"
          >
            <div className="glass-panel mt-3 flex items-center gap-3 rounded-2xl px-4 py-2.5">
              <Sparkles
                className="h-4 w-4 shrink-0 text-[var(--color-neon-cyan)]"
                aria-hidden="true"
              />
              <p className="min-w-0 flex-1 text-sm text-muted-foreground">
                {t('dashboard.welcomeLede')}
              </p>
              <button
                type="button"
                onClick={() => setShowLede(false)}
                aria-label={t('dashboard.welcomeLedeDismiss')}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.header>
  );
}
