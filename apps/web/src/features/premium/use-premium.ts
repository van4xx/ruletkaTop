'use client';

/**
 * Premium feature hooks: plans, current subscription, subscribe (recurrent
 * CloudPayments widget) and cancel.
 *
 * Flow note: the backend's `POST /premium/subscribe` only REGISTERS intent and
 * returns the current subscription — it never grants premium for free.
 * Entitlement is activated by the CloudPayments `recurrent` webhook after a
 * successful charge. There is no server endpoint that mints premium widget
 * params (unlike coins), so we build the recurrent charge params client-side
 * from the chosen plan + the public id, set `accountId` to the user's id, and
 * tag `data` so the webhook can resolve the plan. See the integrator note in
 * the summary — a dedicated `/payments/premium/checkout` endpoint would let the
 * server own the invoice + price (preferred for production).
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PremiumPlan, Subscription } from '@ruletka/shared-types';

import { economyApi, economyKeys } from '@/features/economy/api';
import {
  openCloudPaymentsWidget,
  type CloudPaymentsData,
  type CloudPaymentsRecurrent,
} from '@/lib/cloudpayments';
import { useMe, meKey } from '@/features/economy/use-me';

/** Public id for the CloudPayments widget (premium recurrent charge). */
const CP_PUBLIC_ID = process.env.NEXT_PUBLIC_CLOUDPAYMENTS_PUBLIC_ID ?? '';

/** Premium plan catalogue (public; cheapest first). */
export function usePremiumPlans() {
  return useQuery({
    queryKey: economyKeys.premiumPlans(),
    queryFn: economyApi.premiumPlans,
  });
}

/**
 * Current subscription. Requires auth; returns `null` for signed-out viewers so
 * the pricing page still renders. Clean READ via `GET /premium/subscription`
 * (no side effects — distinct from the intent-registering POST /premium/subscribe).
 */
export function useSubscription() {
  const me = useMe();
  return useQuery<Subscription | null>({
    queryKey: economyKeys.subscription(),
    queryFn: () => economyApi.subscription(),
    enabled: !!me.data, // only when authenticated
  });
}

/** Map a plan's `intervalDays` to a CloudPayments recurrent descriptor. */
export function planToRecurrent(plan: PremiumPlan): CloudPaymentsRecurrent {
  const days = plan.intervalDays;
  if (days % 30 === 0) return { interval: 'Month', period: Math.max(1, Math.round(days / 30)) };
  if (days % 7 === 0) return { interval: 'Week', period: Math.max(1, Math.round(days / 7)) };
  return { interval: 'Day', period: Math.max(1, days) };
}

export type SubscribePhase = 'idle' | 'starting' | 'widget' | 'pending' | 'active' | 'error';

/**
 * Poll `GET /premium/subscription` until the recurrent webhook flips the
 * entitlement to `active`. Resolves `true` once seen, or `false` if the credit
 * hadn't landed by the time we stopped (the webhook may still be in flight).
 */
async function pollSubscriptionActive(attempts = 6, intervalMs = 2500): Promise<boolean> {
  for (let i = 0; i < attempts; i += 1) {
    await new Promise((r) => setTimeout(r, intervalMs));
    try {
      const sub = await economyApi.subscription();
      if (sub?.status === 'active') return true;
    } catch {
      // Transient read error — keep polling; a later attempt may succeed.
    }
  }
  return false;
}

/** Orchestrates the subscribe flow + recurrent widget. */
export function useSubscribe() {
  const t = useTranslations('economy');
  const qc = useQueryClient();
  const [phase, setPhase] = useState<SubscribePhase>('idle');
  const [activePlan, setActivePlan] = useState<PremiumPlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Server-minted checkout: returns the PENDING-payment invoiceId + the widget
  // params (price, accountId, recurrent descriptor) so the browser never fakes
  // the invoice or the amount. Entitlement is still granted only by the webhook.
  const checkout = useMutation({ mutationFn: economyApi.premiumCheckout });

  const reset = () => {
    setPhase('idle');
    setActivePlan(null);
    setError(null);
  };

  const subscribe = (plan: PremiumPlan) => {
    // The widget bundle still needs a public id to load; the server also returns
    // one in the checkout params (preferred), but if neither is present we can't
    // open the widget at all, so fail fast with a clear message.
    if (!CP_PUBLIC_ID) {
      setActivePlan(plan);
      setError(t('premiumHook.widgetNotConfigured'));
      setPhase('error');
      return;
    }
    setActivePlan(plan);
    setError(null);
    setPhase('starting');

    // 1) Ask the server to mint a PENDING premium payment + widget params.
    checkout.mutate(
      { plan: plan.code },
      {
        onSuccess: async (params) => {
          setPhase('widget');
          try {
            await openCloudPaymentsWidget(
              {
                // Trust the SERVER-minted params: real invoiceId, server-fixed
                // amount, and the recurrent descriptor under `data`.
                publicId: params.publicId || CP_PUBLIC_ID,
                description: params.description,
                amount: params.amount,
                currency: params.currency,
                accountId: params.accountId, // REQUIRED for a subscription
                invoiceId: params.invoiceId,
                data: params.data as CloudPaymentsData,
              },
              {
                onSuccess: () => {
                  // Charge captured; entitlement is granted by the recurrent
                  // webhook. Show 'pending' while we poll the subscription, then
                  // flip to 'active' on an OBSERVED active status (and refresh
                  // the caches so /me + the subscription reflect premium). If it
                  // hasn't landed in time we stay on 'pending' — the user keeps
                  // the "activating…" message rather than a false success.
                  setPhase('pending');
                  void pollSubscriptionActive().then((active) => {
                    if (active) {
                      void qc.invalidateQueries({ queryKey: economyKeys.subscription() });
                      void qc.invalidateQueries({ queryKey: meKey });
                      setPhase('active');
                    }
                  });
                },
                onFail: (reason) => {
                  setError(reason || t('premiumHook.paymentFailed'));
                  setPhase('error');
                },
              },
            );
          } catch (e) {
            setError(e instanceof Error ? e.message : t('premiumHook.openFailed'));
            setPhase('error');
          }
        },
        onError: (e) => {
          setError(e instanceof Error ? e.message : t('premiumHook.subscribeFailed'));
          setPhase('error');
        },
      },
    );
  };

  return {
    subscribe,
    phase,
    activePlan,
    error,
    reset,
    isBusy: phase === 'starting' || phase === 'widget' || phase === 'pending',
  };
}

/** Cancel the current subscription (lapses at period end). */
export function useCancelPremium() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: economyApi.cancelPremium,
    onSuccess: (sub) => {
      qc.setQueryData(economyKeys.subscription(), sub);
      void qc.invalidateQueries({ queryKey: meKey });
    },
  });
}
