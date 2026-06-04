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
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Languages } from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  LOCALES,
  LOCALE_LABELS,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  type Locale,
} from '@/i18n/config';

export function LanguageSwitcher({ className }: { className?: string }) {
  const locale = useLocale() as Locale;
  const t = useTranslations('common');
  const [pending, setPending] = useState(false);

  const currentIndex = LOCALES.indexOf(locale);
  const nextLocale = LOCALES[(currentIndex + 1) % LOCALES.length] ?? LOCALES[0];

  function switchTo(target: Locale) {
    if (target === locale || pending || !LOCALES.includes(target)) return;
    setPending(true);
    // The locale cookie is a PLAIN (non-httpOnly) cookie that `getRequestConfig`
    // reads per request — so set it directly on the client and do a FULL page
    // reload. The reload re-issues the request with the new cookie, so every
    // Server Component + the intl provider re-render in the chosen language.
    // (A soft `router.refresh()` did not reliably re-apply the cookie locale in
    // Next 16; a full reload is bulletproof and can never crash the app.)
    document.cookie = `${LOCALE_COOKIE}=${target}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
    window.location.reload();
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
