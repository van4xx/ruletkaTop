'use client';

/**
 * /wallet — the full wallet & transaction history.
 *
 * - Live balance hero (GET /wallet) + a derived stats strip (received / spent /
 *   operations across the loaded ledger window).
 * - The complete coin ledger (GET /wallet/transactions, cursor-paginated) with
 *   type badges, signed deltas, running balance and dates — see {@link WalletLedger}.
 * - A "Пополнить" CTA that opens the coin storefront in a dialog
 *   ({@link BuyCoinsDialog}) — a real, working CloudPayments top-up flow that
 *   never leaves the page.
 *
 * This complements /coins (the storefront): /wallet is the account view, with a
 * shortcut into the same buy flow.
 */
import { useState } from 'react';
import Link from 'next/link';
import { History, Plus, ShoppingBag, Wallet as WalletIcon } from 'lucide-react';
import { Button, CoinBalance } from '@ruletka/ui';
import { useAuth } from '@/features/auth';
import { useWallet, useTransactions, flattenTransactions } from '@/hooks/wallet/use-wallet';
import { EconomyShell } from '@/components/economy/economy-shell';
import { SignInRequired } from '@/components/social/state-views';
import { BalanceHero } from '@/components/coins/balance-hero';
import { WalletStats } from '@/components/wallet/wallet-stats';
import { WalletLedger } from '@/components/wallet/wallet-ledger';
import { BuyCoinsDialog } from '@/components/wallet/buy-coins-dialog';

export default function WalletPage() {
  const { isAuthenticated, isReady } = useAuth();
  const wallet = useWallet();
  const tx = useTransactions();
  const [buyOpen, setBuyOpen] = useState(false);

  const transactions = flattenTransactions(tx.data?.pages);

  return (
    <>
      <EconomyShell
        eyebrow={
          <>
            <WalletIcon className="h-3.5 w-3.5 text-[var(--coin)]" aria-hidden="true" />
            Кошелёк
          </>
        }
        title={
          <>
            Ваши <span className="text-gradient-neon">монеты и история</span>
          </>
        }
        lede="Следите за балансом и всеми операциями: пополнения, подарки и места в Топе — в одном месте."
        actions={
          <div className="flex items-center gap-2">
            <CoinBalance
              amount={wallet.data?.balanceCoins ?? 0}
              variant="pill"
              size="lg"
              className="hidden sm:inline-flex"
            />
            <Button leadingIcon={<Plus className="h-4 w-4" />} onClick={() => setBuyOpen(true)}>
              Пополнить
            </Button>
          </div>
        }
      >
        {isReady && !isAuthenticated ? (
          <SignInRequired description="Войдите, чтобы видеть баланс и историю операций." />
        ) : (
          <div className="space-y-10">
            {/* Balance + derived stats */}
            <div className="space-y-5">
              <BalanceHero
                balance={wallet.data?.balanceCoins ?? null}
                isLoading={wallet.isLoading}
                isError={wallet.isError}
              />
              <WalletStats transactions={transactions} isLoading={tx.isLoading} />
            </div>

            {/* Ledger */}
            <section aria-labelledby="ledger-heading">
              <div className="mb-5 flex items-center justify-between gap-3">
                <h2
                  id="ledger-heading"
                  className="inline-flex items-center gap-2 font-display text-xl font-bold tracking-tight"
                >
                  <History className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                  История операций
                </h2>
                <Button asChild variant="ghost" size="sm">
                  <Link href="/coins">
                    <ShoppingBag className="h-4 w-4" aria-hidden="true" />
                    <span className="hidden sm:inline">Магазин монет</span>
                  </Link>
                </Button>
              </div>

              <WalletLedger
                transactions={transactions}
                isLoading={tx.isLoading}
                isError={tx.isError}
                hasNextPage={tx.hasNextPage}
                isFetchingNextPage={tx.isFetchingNextPage}
                onLoadMore={() => tx.fetchNextPage()}
                onRetry={() => tx.refetch()}
                onTopUp={() => setBuyOpen(true)}
              />
            </section>
          </div>
        )}
      </EconomyShell>

      <BuyCoinsDialog open={buyOpen} onOpenChange={setBuyOpen} />
    </>
  );
}
