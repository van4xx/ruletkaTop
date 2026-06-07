'use client';

/**
 * Brand mark — the neon "roulette orbit" [Logo] + wordmark.
 *
 * Auth-aware: links to the dashboard for signed-in users, the marketing home
 * for anonymous visitors. The mark gives a playful roulette spin on hover.
 */
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ROUTES } from '@/config/nav';
import { useAuth } from '@/features/auth';
import { Logo } from '@/components/brand/logo';

export function BrandMark() {
  const t = useTranslations('chrome');
  const { isAuthenticated } = useAuth();
  const href = isAuthenticated ? ROUTES.dashboard : ROUTES.home;

  return (
    <Link
      href={href}
      className="group flex shrink-0 items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      aria-label={t('brand.homeAria')}
    >
      <Logo
        size={34}
        className="drop-shadow-[0_0_10px_rgba(170,107,255,0.35)] transition-transform duration-700 ease-out group-hover:rotate-[160deg]"
      />
      <span className="font-display text-[1.15rem] font-bold leading-none tracking-tight">
        ruletka<span className="text-gradient-neon">.top</span>
      </span>
    </Link>
  );
}
