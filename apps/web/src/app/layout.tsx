import type { Metadata, Viewport } from 'next';
import { Manrope, Unbounded } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { VerifyEmailBanner } from '@/components/auth/verify-email-banner';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages, getTranslations } from 'next-intl/server';

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

export const metadata: Metadata = {
  metadataBase: new URL('https://ruletka.top'),
  title: {
    default: 'ruletka.top — видео и голосовая рулетка',
    template: '%s · ruletka.top',
  },
  description:
    'Видео- и голосовая рулетка нового поколения. Случайные видеозвонки, голосовое общение, подарки и друзья со всего мира.',
  applicationName: 'ruletka.top',
  keywords: [
    'видеочат',
    'рулетка',
    'видеорулетка',
    'голосовой чат',
    'случайный собеседник',
    'знакомства',
    'общение онлайн',
  ],
  authors: [{ name: 'ruletka.top' }],
  creator: 'ruletka.top',
  openGraph: {
    type: 'website',
    locale: 'ru_RU',
    url: SITE_URL,
    siteName: 'ruletka.top',
    title: 'ruletka.top — видео и голосовая рулетка',
    description:
      'Случайные видеозвонки и голосовое общение с людьми со всего мира. Дари подарки, добавляй друзей, попади в Топ.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ruletka.top — видео и голосовая рулетка',
    description: 'Случайные видеозвонки и голосовое общение со всего мира.',
  },
  robots: {
    index: true,
    follow: true,
  },
  icons: {
    icon: '/favicon.svg',
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0f' },
  ],
  colorScheme: 'dark light',
  width: 'device-width',
  initialScale: 1,
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Resolve the active locale (cookie-based) + its merged messages on the server,
  // then hand them to the client provider so `useTranslations` works everywhere.
  const locale = await getLocale();
  const messages = await getMessages();
  const t = await getTranslations('common');

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${manrope.variable} ${unbounded.variable}`}
    >
      <body className="antialiased">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <Providers>
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
