'use client';

/**
 * /coins — the coin storefront & wallet.
 *
 * - Live balance hero (GET /wallet)
 * - Coin packages grid (GET /coin-packages) → buy via CloudPayments
 * - Coin ledger (GET /wallet/transactions, cursor-paginated)
 *
 * The buy flow never handles card data: it calls POST /payments/coins/checkout
 * for server-minted widget params, opens the hosted CloudPayments widget, then
 * shows a pending state and polls the balance (credited by the webhook).
 */
import { useMemo } from 'react';
import Script from 'next/script';
import { History, ShoppingBag } from 'lucide-react';
import { EconomyShell } from '@/components/economy/economy-shell';
import { CardGridSkeleton, ErrorState } from '@/components/economy/states';
import { BalanceHero } from '@/components/coins/balance-hero';
import { CoinPackageCard } from '@/components/coins/coin-package-card';
import { CheckoutStatusDialog } from '@/components/coins/checkout-status-dialog';
import { TransactionList } from '@/components/coins/transaction-list';
import { CLOUDPAYMENTS_WIDGET_SRC } from '@/lib/cloudpayments';
import { pricePerCoin } from '@/features/economy/format';
import { useCoinPackages, useBuyCoins } from '@/features/coins/use-coins';
import { useWallet, useTransactions, flattenTransactions } from '@/hooks/wallet/use-wallet';

export default function CoinsPage() {
  const wallet = useWallet();
  const packages = useCoinPackages();
  const buy = useBuyCoins();
  const tx = useTransactions();

  // Index of the lowest price-per-coin package (the "best value" highlight).
  const bestIndex = useMemo(() => {
    const list = packages.data;
    if (!list || list.length === 0) return -1;
    let best = 0;
    let bestPpc = Infinity;
    list.forEach((p, i) => {
      const ppc = pricePerCoin(p.priceRub, p.coins, p.bonusCoins);
      if (ppc < bestPpc) {
        bestPpc = ppc;
        best = i;
      }
    });
    return best;
  }, [packages.data]);

  const transactions = flattenTransactions(tx.data?.pages);

  return (
    <>
      {/* Preload the CloudPayments widget bundle (no card data touches us). */}
      <Script src={CLOUDPAYMENTS_WIDGET_SRC} strategy="lazyOnload" />

      <EconomyShell
        eyebrow={
          <>
            <ShoppingBag className="h-3.5 w-3.5 text-[var(--coin)]" aria-hidden="true" />
            Магазин монет
          </>
        }
        title={
          <>
            Монеты для <span className="text-gradient-neon">подарков и Топа</span>
          </>
        }
        lede="Пополняйте баланс, чтобы дарить анимированные подарки, покупать места в Топе и открывать больше возможностей."
      >
        <div className="space-y-12">
          {/* Balance */}
          <BalanceHero
            balance={wallet.data?.balanceCoins ?? null}
            isLoading={wallet.isLoading}
            isError={wallet.isError}
          />

          {/* Packages */}
          <section aria-labelledby="packages-heading">
            <h2 id="packages-heading" className="mb-5 font-display text-xl font-bold tracking-tight">
              Выберите пакет
            </h2>
            {packages.isLoading ? (
              <CardGridSkeleton count={6} />
            ) : packages.isError ? (
              <ErrorState
                title="Не удалось загрузить пакеты"
                description="Каталог монет временно недоступен."
                onRetry={() => packages.refetch()}
              />
            ) : (
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {packages.data?.map((pkg, i) => (
                  <CoinPackageCard
                    key={pkg.code}
                    pkg={pkg}
                    index={i}
                    best={i === bestIndex}
                    loading={buy.isBusy && buy.activePackage?.code === pkg.code}
                    disabled={buy.isBusy}
                    onBuy={buy.buy}
                  />
                ))}
              </div>
            )}
          </section>

          {/* Ledger */}
          <section aria-labelledby="ledger-heading">
            <h2
              id="ledger-heading"
              className="mb-5 inline-flex items-center gap-2 font-display text-xl font-bold tracking-tight"
            >
              <History className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
              История операций
            </h2>
            <TransactionList
              transactions={transactions}
              isLoading={tx.isLoading}
              isError={tx.isError}
              hasNextPage={tx.hasNextPage}
              isFetchingNextPage={tx.isFetchingNextPage}
              onLoadMore={() => tx.fetchNextPage()}
              onRetry={() => tx.refetch()}
            />
          </section>
        </div>
      </EconomyShell>

      <CheckoutStatusDialog
        phase={buy.phase}
        pkg={buy.activePackage}
        error={buy.error}
        onClose={buy.reset}
        onRetry={() => buy.activePackage && buy.buy(buy.activePackage)}
      />
    </>
  );
}
