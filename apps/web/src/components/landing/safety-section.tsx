/**
 * Landing — "Safety / moderation" section.
 *
 * Server component. Three prose paragraphs explaining the trust-&-safety
 * story (Cloudflare Turnstile at signup, Sightengine NSFW on the video stream,
 * 24/7 mod team, age gating). Ends with a natural anchor to the platform
 * rules page — both a UX nicety and an SEO win.
 */
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ShieldCheck } from 'lucide-react';
import { ROUTES } from '@/config/nav';

export async function SafetySection() {
  const t = await getTranslations('landing');

  return (
    <section
      aria-labelledby="landing-safety"
      className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8"
    >
      <div className="glass-panel relative overflow-hidden rounded-3xl p-8 sm:p-12">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[radial-gradient(circle,var(--color-neon-cyan)_0%,transparent_60%)] opacity-25 blur-3xl"
        />
        <div className="relative grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:gap-12">
          <header>
            <span className="inline-flex items-center gap-2 rounded-full border border-border/60 px-3 py-1 text-xs font-medium text-muted-foreground">
              <ShieldCheck
                className="h-3.5 w-3.5 text-[var(--color-neon-cyan)]"
                aria-hidden="true"
              />
              T&S
            </span>
            <h2
              id="landing-safety"
              className="mt-4 font-display text-3xl font-bold tracking-tight sm:text-4xl"
            >
              {t('safety.title')}
            </h2>
            <p className="mt-4 text-balance text-muted-foreground">{t('safety.lede')}</p>
          </header>

          <div className="space-y-5 text-base leading-7 text-foreground/85">
            <p>{t('safety.p1')}</p>
            <p>{t('safety.p2')}</p>
            <p>
              {t('safety.p3')}{' '}
              <Link
                href={ROUTES.rules}
                className="font-medium text-[var(--color-neon-cyan)] underline-offset-4 hover:underline"
              >
                {t('links.rules')}
              </Link>
              .
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
