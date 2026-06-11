/**
 * Landing — Final CTA footer band.
 *
 * Server component. The page's last conversion moment: two CTAs (signup +
 * login) mirroring the hero so a scroller-to-the-end can act without scrolling
 * back up. Adds an inline anchor to `/help` so curious users have a third path
 * to the funnel — and search engines another internal-link signal.
 */
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ArrowRight, LogIn } from 'lucide-react';
import { ROUTES } from '@/config/nav';
import { cn } from '@/lib/cn';

export async function FinalCta() {
  const t = await getTranslations('landing');

  return (
    <section
      aria-labelledby="landing-final"
      className="mx-auto max-w-7xl px-4 pb-16 pt-8 sm:px-6 lg:px-8"
    >
      <div className="relative overflow-hidden rounded-3xl px-6 py-14 text-center sm:px-12">
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-gradient-to-br from-[var(--color-neon-violet)]/25 via-card to-[var(--color-neon-cyan)]/20"
        />
        <div className="glass-panel absolute inset-0 -z-10 rounded-3xl" aria-hidden="true" />

        <h2
          id="landing-final"
          className="font-display text-3xl font-bold tracking-tight sm:text-4xl"
        >
          {t('finalCta.title')}
        </h2>
        <p className="mx-auto mt-4 max-w-lg text-muted-foreground">{t('finalCta.subtitle')}</p>

        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/register"
            className={cn(
              'group inline-flex items-center justify-center gap-2 rounded-xl px-8 py-4',
              'text-base font-semibold text-primary-foreground',
              'bg-gradient-to-r from-[var(--color-neon-violet)] via-[var(--color-neon-magenta)] to-[var(--color-neon-violet)] bg-[length:200%_100%] bg-left',
              'shadow-[0_8px_30px_-8px_var(--color-neon-violet)] transition-[background-position,transform] duration-500',
              'hover:bg-right hover:-translate-y-0.5 active:translate-y-0',
            )}
          >
            {t('finalCta.button')}
            <ArrowRight
              className="h-5 w-5 transition-transform group-hover:translate-x-1"
              aria-hidden="true"
            />
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center justify-center gap-2 rounded-xl px-7 py-4 text-base font-semibold glass-panel hover:bg-card/80"
          >
            <LogIn className="h-5 w-5 text-[var(--color-neon-cyan)]" aria-hidden="true" />
            {t('finalCta.secondary')}
          </Link>
        </div>

        <p className="mx-auto mt-6 max-w-md text-xs text-muted-foreground">
          <Link
            href={ROUTES.help}
            className="font-medium text-[var(--color-neon-cyan)] underline-offset-4 hover:underline"
          >
            {t('links.help')}
          </Link>
        </p>
      </div>
    </section>
  );
}
