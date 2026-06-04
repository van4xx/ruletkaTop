/**
 * Site footer — intentionally minimal. The product's chrome lives in the header
 * / avatar menu / ⌘K palette, so the footer is just the brand mark, a single
 * «Документы» button that opens the docs "book" hub (`/documents` — О проекте,
 * Правила, Политика, Помощь in one place), and a copyright + age line.
 *
 * Server-rendered; localized via next-intl (`footer` namespace) resolved with
 * `getTranslations`. The button styling is hand-rolled on-brand Tailwind (a
 * frosted "glass" pill) rather than the `Button`/`buttonVariants` helper, since
 * those are client-only exports and this footer renders on the server.
 */
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { BookOpen } from 'lucide-react';
import { ROUTES } from '@/config/nav';

const YEAR = new Date().getFullYear();

export async function SiteFooter() {
  const t = await getTranslations('footer');

  return (
    <footer className="relative mt-24 border-t border-border/60">
      {/* Faint aurora wash so the slim footer still feels on-brand. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-px h-px bg-gradient-to-r from-transparent via-[var(--color-neon-violet)]/40 to-transparent"
      />
      <div className="mx-auto flex max-w-7xl flex-col items-center gap-6 px-4 py-9 sm:px-6 md:flex-row md:justify-between lg:px-8">
        <div className="flex flex-col items-center gap-1 md:items-start">
          <Link href={ROUTES.home} className="font-display text-lg font-bold tracking-tight">
            ruletka<span className="text-gradient-neon">.top</span>
          </Link>
          <p className="text-xs text-muted-foreground">{t('copyright', { year: YEAR })}</p>
        </div>

        <div className="flex flex-col items-center gap-3 sm:flex-row sm:gap-4">
          <span className="hidden text-xs text-muted-foreground sm:inline">{t('ageNotice')}</span>
          <Link
            href={ROUTES.documents}
            className={[
              'group inline-flex h-9 items-center gap-2 rounded-lg px-4 text-sm font-medium',
              'glass text-foreground',
              'transition-[transform,box-shadow,background-color,border-color] duration-[var(--duration-fast)] ease-[var(--ease-out-quart)]',
              'hover:bg-glass-strong hover:border-accent-muted hover:-translate-y-0.5',
              'active:translate-y-0 active:scale-[0.98]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            ].join(' ')}
          >
            <BookOpen
              className="size-4 text-[var(--color-neon-cyan)] transition-transform group-hover:scale-110"
              aria-hidden="true"
            />
            {t('documents')}
          </Link>
        </div>
      </div>
    </footer>
  );
}
