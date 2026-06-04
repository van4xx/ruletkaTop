'use client';

/**
 * Compact language toggle for the header.
 *
 * With two locales a single cycling button beats a dropdown: it shows the active
 * locale and, on click, switches to the next one. It writes the locale cookie via
 * a server action, then `router.refresh()`es so every Server Component re-renders
 * in the new language. Fully keyboard-accessible; the `aria-label` announces the
 * language it will switch TO.
 */
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Languages } from 'lucide-react';
import { cn } from '@/lib/cn';
import { LOCALES, LOCALE_LABELS, type Locale } from '@/i18n/config';
import { setLocale } from '@/i18n/locale-actions';

export function LanguageSwitcher({ className }: { className?: string }) {
  const locale = useLocale() as Locale;
  const t = useTranslations('common');
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const currentIndex = LOCALES.indexOf(locale);
  const nextLocale = LOCALES[(currentIndex + 1) % LOCALES.length] ?? LOCALES[0];

  function switchTo(target: Locale) {
    if (target === locale || pending) return;
    startTransition(async () => {
      // Persist the locale, then re-render every Server Component in the new
      // language. Guard the whole sequence: an unhandled rejection escaping a
      // transition bubbles to the root error boundary (the full-screen crash),
      // so a flaky network/Server-Action call must never take the app down — at
      // worst the language stays put and the user can retry.
      try {
        const ok = await setLocale(target);
        if (ok) router.refresh();
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Failed to switch locale', error);
      }
    });
  }

  return (
    <button
      type="button"
      onClick={() => switchTo(nextLocale)}
      disabled={pending}
      aria-label={`${t('switchLanguage')} — ${LOCALE_LABELS[nextLocale].native}`}
      title={t('switchLanguage')}
      className={cn(
        'inline-flex h-9 items-center gap-1.5 rounded-full px-3',
        'border border-border/70 bg-card/40 text-sm font-semibold uppercase text-muted-foreground backdrop-blur',
        'outline-none transition-colors hover:bg-card/70 hover:text-foreground',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        pending && 'pointer-events-none opacity-60',
        className,
      )}
    >
      <Languages className="h-4 w-4" aria-hidden="true" />
      <span>{locale}</span>
    </button>
  );
}
