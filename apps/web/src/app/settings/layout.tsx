import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import { scopedMessages } from '@/i18n/client-scope';

/**
 * Scopes the `settings` namespace (~11 KB ru) to /settings only. The root client
 * provider withholds it; this nested provider re-attaches it on top of the
 * global set. The `settings` strings are consumed by `app/settings/page.tsx`,
 * `components/settings/*`, `features/settings/*` and the `useWebPush()` hook —
 * all reached only inside this segment (grep-verified). The globally-mounted
 * `useWebPushResync()` re-registration hook is translation-free, so withholding
 * `settings` from root is safe.
 */
export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  return (
    <NextIntlClientProvider locale={locale} messages={scopedMessages(messages, ['settings'])}>
      {children}
    </NextIntlClientProvider>
  );
}
