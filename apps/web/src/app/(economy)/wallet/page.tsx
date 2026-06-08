import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { WalletClient } from './wallet-client';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('economy');
  return {
    title: t('pageMeta.walletTitle'),
    description: t('pageMeta.walletDescription'),
    // Private, account-bound ledger — keep it out of search indexes.
    robots: { index: false, follow: false },
  };
}

/**
 * /wallet — the full wallet & transaction history.
 *
 * Thin server shell: exports localized metadata and renders the interactive
 * {@link WalletClient}, which owns the live balance + ledger + top-up flow.
 */
export default function WalletPage() {
  return <WalletClient />;
}
