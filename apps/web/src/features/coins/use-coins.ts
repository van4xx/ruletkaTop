'use client';

/**
 * Coins feature hooks: the package catalogue and the buy flow.
 *
 * Buy flow (card data NEVER touches our app):
 *   1. POST /payments/coins/checkout  → server mints a PENDING payment and
 *      returns CloudPayments widget params (amount fixed server-side).
 *   2. Open the CloudPayments widget with those params.
 *   3. On widget success the charge is captured, but the coin CREDIT is applied
 *      by the backend webhook — so we show a "pending" state and poll the
 *      balance until it updates.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { CoinPackage } from '@ruletka/shared-types';

import { economyApi, economyKeys } from '@/features/economy/api';
import { openCloudPaymentsWidget } from '@/lib/cloudpayments';
import { useEconomyInvalidation, useWallet } from '@/hooks/wallet/use-wallet';

/**
 * Active payment provider (`tbank` default). When set to `cloudpayments` the
 * legacy widget bundle is loaded and the existing widget flow is used; the
 * default takes the T-Bank hosted-redirect path (no client SDK).
 */
const PROVIDER: 'tbank' | 'cloudpayments' =
  (process.env.NEXT_PUBLIC_PAYMENT_PROVIDER as 'tbank' | 'cloudpayments' | undefined) ?? 'tbank';

/** Package catalogue (public; cheapest first). */
export function useCoinPackages() {
  return useQuery({
    queryKey: economyKeys.coinPackages(),
    queryFn: economyApi.coinPackages,
  });
}

/**
 * UI phase of the buy flow, used to drive the modal/inline feedback.
 *
 * - `pending`     — charge captured; polling the balance for the webhook credit.
 * - `credited`    — an ACTUAL balance increase was observed (true success).
 * - `unconfirmed` — polling finished without seeing the credit land. The charge
 *   went through, but we can't confirm the coins yet (the webhook may still be
 *   in flight). A neutral "check your balance shortly" state — NOT a success.
 */
export type CheckoutPhase =
  | 'idle'
  | 'starting'
  | 'widget'
  | 'pending'
  | 'credited'
  | 'unconfirmed'
  | 'error';

export interface UseBuyCoinsResult {
  /** Kick off the purchase for a package code. */
  buy: (pkg: CoinPackage) => void;
  phase: CheckoutPhase;
  /** The package currently being purchased (for the pending UI). */
  activePackage: CoinPackage | null;
  /** Last error message, if any. */
  error: string | null;
  /** Reset back to idle (e.g. when closing the modal). */
  reset: () => void;
  isBusy: boolean;
}

/**
 * Orchestrates the coin purchase + CloudPayments widget. Returns a small state
 * machine the page renders against.
 */
export function useBuyCoins(): UseBuyCoinsResult {
  const t = useTranslations('economy');
  const [phase, setPhase] = useState<CheckoutPhase>('idle');
  const [activePackage, setActivePackage] = useState<CoinPackage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { data: wallet } = useWallet();
  const { pollBalance } = useEconomyInvalidation();

  const checkout = useMutation({
    mutationFn: economyApi.coinsCheckout,
  });
  const tbankCheckout = useMutation({
    mutationFn: economyApi.tbankCoinsCheckout,
  });

  const reset = () => {
    setPhase('idle');
    setActivePackage(null);
    setError(null);
  };

  /**
   * T-Bank hosted-redirect path: ask the API to mint the order, then
   * `window.location.href = paymentUrl`. The browser does NOT come back here
   * after the success — it lands on TBANK_SUCCESS_URL (`/wallet?payment=ok`),
   * so we never observe the credit in this hook; the wallet page picks it up
   * on its own load.
   */
  const buyViaTbank = (pkg: CoinPackage) => {
    tbankCheckout.mutate(
      { packageCode: pkg.code },
      {
        onSuccess: (res) => {
          if (typeof window !== 'undefined' && res?.paymentUrl) {
            window.location.href = res.paymentUrl;
            return;
          }
          setError(t('coinsHook.openFailed'));
          setPhase('error');
        },
        onError: (e) => {
          setError(e instanceof Error ? e.message : t('coinsHook.startFailed'));
          setPhase('error');
        },
      },
    );
  };

  const buy = (pkg: CoinPackage) => {
    setActivePackage(pkg);
    setError(null);
    setPhase('starting');
    if (PROVIDER === 'tbank') {
      buyViaTbank(pkg);
      return;
    }
    const balanceBefore = wallet?.balanceCoins ?? null;

    checkout.mutate(
      { packageCode: pkg.code },
      {
        onSuccess: async (params) => {
          setPhase('widget');
          try {
            await openCloudPaymentsWidget(
              {
                publicId: params.publicId,
                description: params.description,
                amount: params.amount,
                currency: params.currency,
                accountId: params.accountId,
                invoiceId: params.invoiceId,
                data: params.data,
              },
              {
                onSuccess: () => {
                  // Charge captured; the credit arrives via webhook. Only show
                  // 'credited' on an OBSERVED balance increase — otherwise land
                  // on the neutral 'unconfirmed' ("check your balance") state so
                  // we never claim coins arrived when they might not have.
                  setPhase('pending');
                  void pollBalance(balanceBefore).then((credited) =>
                    setPhase(credited ? 'credited' : 'unconfirmed'),
                  );
                },
                onFail: (reason) => {
                  setError(reason || t('coinsHook.paymentFailed'));
                  setPhase('error');
                },
              },
            );
          } catch (e) {
            setError(e instanceof Error ? e.message : t('coinsHook.openFailed'));
            setPhase('error');
          }
        },
        onError: (e) => {
          setError(e instanceof Error ? e.message : t('coinsHook.startFailed'));
          setPhase('error');
        },
      },
    );
  };

  return {
    buy,
    phase,
    activePackage,
    error,
    reset,
    isBusy: phase === 'starting' || phase === 'widget' || phase === 'pending',
  };
}
