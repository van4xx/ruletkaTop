'use client';

/**
 * Dashboard hero greeting: a time-of-day-aware welcome with the user's
 * nickname, a short lede, and a live "online now" pulse. Sets the tone for the
 * hub without competing with the quick-launch CTAs below.
 */
import { motion } from 'framer-motion';
import { useAuth } from '@/features/auth';

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

/** Russian time-of-day greeting. */
function greeting(date = new Date()): string {
  const h = date.getHours();
  if (h >= 5 && h < 12) return 'Доброе утро';
  if (h >= 12 && h < 18) return 'Добрый день';
  if (h >= 18 && h < 23) return 'Добрый вечер';
  return 'Доброй ночи';
}

export function DashboardWelcome() {
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
          Сейчас в эфире — присоединяйся
        </span>
        <h1 className="font-display text-3xl font-extrabold leading-[1.05] tracking-tight sm:text-4xl">
          {greeting()}
          {name ? (
            <>
              ,<br className="sm:hidden" />{' '}
              <span className="text-gradient-neon">{name}</span>
            </>
          ) : null}
        </h1>
        <p className="mt-3 max-w-xl text-balance text-muted-foreground">
          Твой центр управления: запусти рулетку, загляни в Топ и оставайся на связи с друзьями.
        </p>
      </div>
    </motion.header>
  );
}
