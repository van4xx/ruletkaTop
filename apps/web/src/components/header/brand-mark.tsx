'use client';

/**
 * Brand mark — the concentric "roulette" emblem + wordmark.
 *
 * Auth-aware: links to the dashboard for signed-in users, the marketing home
 * for anonymous visitors. The emblem's neon ring sweeps on hover; the inner
 * pip carries a soft cyan glow. Decorative layers are `aria-hidden`.
 */
import Link from 'next/link';
import { ROUTES } from '@/config/nav';
import { useAuth } from '@/features/auth';

export function BrandMark() {
  const { isAuthenticated } = useAuth();
  const href = isAuthenticated ? ROUTES.dashboard : ROUTES.home;

  return (
    <Link
      href={href}
      className="group flex shrink-0 items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      aria-label="ruletka.top — на главную"
    >
      <span className="relative inline-flex h-9 w-9 items-center justify-center">
        {/* Concentric "roulette" emblem with a neon sweep. */}
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-full bg-[conic-gradient(from_140deg,var(--color-neon-violet),var(--color-neon-magenta),var(--color-neon-cyan),var(--color-neon-violet))] opacity-90 blur-[1px] transition-transform duration-700 ease-out group-hover:rotate-180"
        />
        <span aria-hidden="true" className="absolute inset-[3px] rounded-full bg-background" />
        <span
          aria-hidden="true"
          className="relative h-2 w-2 rounded-full bg-[var(--color-neon-cyan)] shadow-[0_0_10px_var(--color-neon-cyan)] transition-transform duration-500 group-hover:scale-125"
        />
      </span>
      <span className="font-display text-[1.15rem] font-bold leading-none tracking-tight">
        ruletka<span className="text-gradient-neon">.top</span>
      </span>
    </Link>
  );
}
