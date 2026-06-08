/**
 * Layout for the roulette route group (/video, /voice).
 *
 * The roulette is an immersive, full-bleed experience, so this layout keeps the
 * shared site chrome (header/footer come from the root layout) but renders a
 * minimal wrapper that lets the stage own the viewport.
 *
 * The toast region is now mounted globally in `app/providers.tsx` (a single
 * app-wide <Toaster/>), so this group no longer mounts its own — that avoids a
 * duplicate toast stack while keeping /video and /voice toasts working.
 */
import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import { scopedMessages } from '@/i18n/client-scope';

/**
 * Scopes the `roulette` namespace (~11 KB ru) to /video + /voice only. The root
 * client provider withholds it; this nested provider re-attaches it on top of
 * the global set. `components/roulette/*` + `features/roulette/*` are the sole
 * consumers (grep-verified) and are imported only by the two pages in this
 * group, so no other route ships these strings. Globally-mounted modals (gift /
 * report / block, in `components/modals/*`) use `chrome`/`economy`, which remain
 * in the root scope, so the app-wide `ModalHost` keeps working unchanged.
 */
export default async function RouletteLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  return (
    <NextIntlClientProvider locale={locale} messages={scopedMessages(messages, ['roulette'])}>
      {children}
    </NextIntlClientProvider>
  );
}
