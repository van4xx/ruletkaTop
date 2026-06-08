import type { Metadata, Viewport } from 'next';
import { Manrope, Unbounded } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';
import { Preloader } from '@/components/preloader';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { VerifyEmailBanner } from '@/components/auth/verify-email-banner';
import { Analytics } from '@/components/analytics';
import { JsonLdScript } from '@/components/json-ld';
import { organizationLd, websiteLd } from '@/lib/json-ld';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages, getTranslations } from 'next-intl/server';
import { headers } from 'next/headers';

/**
 * Typography:
 *  - Unbounded — a distinctive geometric display face (full Cyrillic) for
 *    headlines and the brand mark.
 *  - Manrope — a clean, modern body face (full Cyrillic) for everything else.
 * Both are loaded via next/font with `display: swap` and exposed as CSS
 * variables consumed by `globals.css` (`--font-display`, `--font-sans`).
 */
const manrope = Manrope({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-manrope',
  display: 'swap',
});

const unbounded = Unbounded({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-unbounded',
  weight: ['500', '600', '700', '800'],
  display: 'swap',
});

const SITE_URL = process.env.NEXT_PUBLIC_API_URL?.replace(/\/api\/?$/, '') ?? 'https://ruletka.top';

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = await getTranslations('metadata');
  return {
    metadataBase: new URL('https://ruletka.top'),
    title: {
      default: t('titleDefault'),
      template: t('titleTemplate'),
    },
    description: t('description'),
    applicationName: 'ruletka.top',
    keywords: t.raw('keywords') as string[],
    authors: [{ name: 'ruletka.top' }],
    creator: 'ruletka.top',
    // Canonical + hreflang. The locale is COOKIE-based with NO URL prefix, so
    // every locale is served from the SAME clean URL — there's one canonical per
    // page. We still advertise both locales (and x-default) pointing at that same
    // root URL so search engines know the site is bilingual; this is the
    // defensible standard for prefix-less i18n. Per-page canonicals (relative to
    // `metadataBase`) are added in each route's own metadata where needed.
    alternates: {
      canonical: '/',
      languages: {
        ru: '/',
        en: '/',
        'x-default': '/',
      },
    },
    openGraph: {
      type: 'website',
      locale: locale === 'en' ? 'en_US' : 'ru_RU',
      url: SITE_URL,
      siteName: 'ruletka.top',
      title: t('ogTitle'),
      description: t('ogDescription'),
    },
    twitter: {
      card: 'summary_large_image',
      title: t('twitterTitle'),
      description: t('twitterDescription'),
    },
    robots: {
      index: true,
      follow: true,
    },
    // PWA web app manifest (app/manifest.ts) — installable, standalone.
    manifest: '/manifest.webmanifest',
    icons: {
      icon: '/favicon.svg',
      // Generated 180×180 neon mark (app/apple-icon.tsx) for the iOS home screen.
      apple: '/apple-icon',
    },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0f' },
  ],
  colorScheme: 'dark light',
  width: 'device-width',
  initialScale: 1,
  // Draw under the device safe-area insets (notch / home indicator) so the app's
  // own `env(safe-area-inset-*)` padding can take over — required for the
  // edge-to-edge chrome to look right on iOS / Android PWAs.
  viewportFit: 'cover',
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Resolve the active locale (cookie-based) + its merged messages on the server,
  // then hand them to the client provider so `useTranslations` works everywhere.
  const locale = await getLocale();
  const messages = await getMessages();
  const t = await getTranslations('common');
  const tm = await getTranslations('metadata');
  // Per-request CSP nonce (set by the middleware in prod) — passed to next-themes
  // so its pre-paint inline theme script is trusted without script 'unsafe-inline'.
  const nonce = (await headers()).get('x-nonce') ?? undefined;

  // Site-wide structured data (Organization + WebSite), localized via the same
  // `metadata` namespace that drives the document title/description. Inert
  // `ld+json` — no CSP nonce required (see components/json-ld.tsx).
  const structuredData = [
    organizationLd(tm('description')),
    websiteLd(tm('titleDefault'), tm('description')),
  ];

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${manrope.variable} ${unbounded.variable}`}
    >
      <body className="antialiased">
        {/* Organization + WebSite structured data (schema.org JSON-LD). */}
        <JsonLdScript data={structuredData} />
        {/* Privacy-first analytics loader — renders nothing unless configured. */}
        <Analytics />
        <NextIntlClientProvider locale={locale} messages={messages}>
          <Providers nonce={nonce}>
            {/* First-visit neon intro; renders once per browser, then nothing. */}
            <Preloader />
            {/* Skip link for keyboard / screen-reader users. */}
            <a
              href="#main"
              className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
            >
              {t('skipToContent')}
            </a>
            <div className="flex min-h-dvh flex-col">
              <SiteHeader />
              {/* Non-blocking nudge for unverified accounts; renders nothing when
                  signed out / already verified. Lives in the global chrome so it
                  shows across the authenticated app, just under the header. */}
              <VerifyEmailBanner />
              <main id="main" className="flex-1">
                {children}
              </main>
              <SiteFooter />
            </div>
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
