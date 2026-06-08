'use client';

/**
 * "Пополнить баланс" dialog — surfaces the coin storefront inside a modal so
 * the wallet (and anywhere else) can open a real, working top-up flow without
 * routing away.
 *
 * It reuses the EXISTING economy/coins building blocks so the money path stays
 * in one place:
 *   - {@link useCoinPackages} — the public package catalogue
 *   - {@link useBuyCoins}      — the CloudPayments checkout state machine
 *   - {@link CoinPackageCard}  — the storefront card
 *   - {@link CheckoutStatusDialog} — the post-checkout narration (pending → credited)
 *
 * Card data never touches the app: the buy flow opens the hosted CloudPayments
 * widget and polls the balance once the webhook credits the coins.
 */
import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import Script from 'next/script';
import { ShieldCheck, ShoppingBag } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Skeleton,
} from '@ruletka/ui';
import { CLOUDPAYMENTS_WIDGET_SRC } from '@/lib/cloudpayments';
import { pricePerCoin } from '@/features/economy/format';
import { useCoinPackages, useBuyCoins } from '@/features/coins/use-coins';
import { CoinPackageCard } from '@/components/coins/coin-package-card';
import { CheckoutStatusDialog } from '@/components/coins/checkout-status-dialog';
import { ErrorState } from '@/components/economy/states';

export interface BuyCoinsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BuyCoinsDialog({ open, onOpenChange }: BuyCoinsDialogProps) {
  const t = useTranslations('economy');
  const packages = useCoinPackages();
  const buy = useBuyCoins();

  // Index of the lowest price-per-coin package — the "выгодно" highlight.
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

  return (
    <>
      {/* Preload the CloudPayments widget bundle (no card data touches us). */}
      {open && <Script src={CLOUDPAYMENTS_WIDGET_SRC} strategy="lazyOnload" />}

      <Dialog
        open={open}
        onOpenChange={(next) => {
          // Don't let the storefront close while a charge is mid-flight.
          if (!next && buy.isBusy) return;
          onOpenChange(next);
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShoppingBag className="h-5 w-5 text-[var(--coin)]" aria-hidden="true" />
              {t('buyCoins.title')}
            </DialogTitle>
            <DialogDescription>{t('buyCoins.description')}</DialogDescription>
          </DialogHeader>

          {packages.isLoading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="glass-panel rounded-2xl p-6">
                  <Skeleton className="h-14 w-14 rounded-2xl" />
                  <Skeleton className="mt-5 h-8 w-2/3" />
                  <Skeleton className="mt-3 h-4 w-1/2" />
                  <Skeleton className="mt-6 h-11 w-full rounded-lg" />
                </div>
              ))}
            </div>
          ) : packages.isError ? (
            <ErrorState
              title={t('buyCoins.errorTitle')}
              description={t('buyCoins.errorDescription')}
              onRetry={() => packages.refetch()}
            />
          ) : (
            <>
              <div className="grid max-h-[60vh] grid-cols-1 gap-4 overflow-y-auto pr-1 sm:grid-cols-2">
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
              <p className="mt-1 inline-flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5 text-success" aria-hidden="true" />
                {t('buyCoins.secure')}
              </p>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Post-checkout narration (pending → credited / unconfirmed / error).
          Once the charge has settled either way (coins observed, or accepted
          but unconfirmed) we close the storefront so the user lands back on
          their wallet to check the balance. */}
      <CheckoutStatusDialog
        phase={buy.phase}
        pkg={buy.activePackage}
        error={buy.error}
        onClose={() => {
          const settled = buy.phase === 'credited' || buy.phase === 'unconfirmed';
          buy.reset();
          if (settled) onOpenChange(false);
        }}
        onRetry={() => buy.activePackage && buy.buy(buy.activePackage)}
      />
    </>
  );
}
