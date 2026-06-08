import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import { scopedMessages } from '@/i18n/client-scope';

/**
 * Route-group layout for the legal/info pages (/rules, /privacy, /help,
 * /about). Each page composes the rich {@link LegalLayout} client shell
 * (atmospheric hero + sticky TOC + prose) itself, since the TOC and headings are
 * page-specific; this group layout keeps the four pages grouped.
 *
 * It also scopes the heavy `legal` namespace (~30 KB ru) to THIS group only: the
 * root client provider withholds it, and this nested provider re-attaches it on
 * top of the global set. `components/legal/*` are the sole consumers of `legal`
 * (grep-verified) and are reached only from inside this group, so no other route
 * pays for these strings.
 */
export default async function LegalGroupLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  return (
    <NextIntlClientProvider locale={locale} messages={scopedMessages(messages, ['legal'])}>
      {children}
    </NextIntlClientProvider>
  );
}
