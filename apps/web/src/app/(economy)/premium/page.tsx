'use client';

/**
 * /premium — plans, perks, subscribe & manage.
 *
 * - GET /premium/plans (public) → plan cards with perks
 * - Current subscription status + cancel (POST /premium/cancel)
 * - Subscribe → POST /premium/subscribe (register intent) then the recurrent
 *   CloudPayments widget; premium is activated by the webhook.
 */
import { useTranslations } from 'next-intl';
import Script from 'next/script';
import { Ban, Crown, Filter, Search, Sparkles, Star } from 'lucide-react';
import { EconomyShell } from '@/components/economy/economy-shell';
import { CardGridSkeleton, EmptyState, ErrorState } from '@/components/economy/states';
import { PlanCard } from '@/components/premium/plan-card';
import { SubscriptionStatus } from '@/components/premium/subscription-status';
import { SubscribeStatusDialog } from '@/components/premium/subscribe-status-dialog';
import { CLOUDPAYMENTS_WIDGET_SRC } from '@/lib/cloudpayments';
import { usePremiumPlans, useSubscription, useSubscribe } from '@/features/premium/use-premium';
import { useMe } from '@/features/economy/use-me';

const HIGHLIGHTS = [
  { icon: Filter, key: 'Filters' },
  { icon: Ban, key: 'NoAds' },
  { icon: Search, key: 'Priority' },
  { icon: Star, key: 'Status' },
] as const;

export default function PremiumPage() {
  const t = useTranslations('economy');
  const plans = usePremiumPlans();
  const me = useMe();
  const subscription = useSubscription();
  const subscribe = useSubscribe();

  const authenticated = !!me.data;
  const currentPlanCode =
    subscription.data && subscription.data.status === 'active' ? subscription.data.plan : null;

  // Feature the middle plan (or the second one) as "popular".
  const featuredIndex = plans.data ? Math.min(1, plans.data.length - 1) : -1;

  return (
    <>
      <Script src={CLOUDPAYMENTS_WIDGET_SRC} strategy="lazyOnload" />

      <EconomyShell
        eyebrow={
          <>
            <Crown className="h-3.5 w-3.5 text-warning" aria-hidden="true" />
            {t('premium.eyebrow')}
          </>
        }
        title={
          <>
            {t('premium.titlePrefix')}{' '}
            <span className="text-gradient-neon">{t('premium.titleHighlight')}</span>
          </>
        }
        lede={t('premium.lede')}
      >
        <div className="space-y-10">
          {/* Current subscription (authenticated only) */}
          <SubscriptionStatus
            subscription={subscription.data}
            isLoading={subscription.isLoading}
            authenticated={authenticated}
          />

          {/* Perks highlights */}
          <ul className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {HIGHLIGHTS.map(({ icon: Icon, key }) => (
              <li key={key} className="glass-panel flex flex-col gap-2 rounded-2xl p-5">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/12 text-primary">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <p className="font-display text-sm font-bold">
                  {t(`premium.highlight${key}Title`)}
                </p>
                <p className="text-xs text-muted-foreground">{t(`premium.highlight${key}Text`)}</p>
              </li>
            ))}
          </ul>

          {/* Plans */}
          <section aria-labelledby="plans-heading">
            <h2
              id="plans-heading"
              className="mb-6 inline-flex items-center gap-2 font-display text-xl font-bold tracking-tight"
            >
              <Sparkles className="h-5 w-5 text-[var(--color-neon-magenta)]" aria-hidden="true" />
              {t('premium.plansHeading')}
            </h2>

            {plans.isLoading ? (
              <CardGridSkeleton count={3} />
            ) : plans.isError ? (
              <ErrorState
                title={t('premium.plansErrorTitle')}
                description={t('premium.plansErrorDescription')}
                onRetry={() => plans.refetch()}
              />
            ) : !plans.data || plans.data.length === 0 ? (
              <EmptyState
                icon={<Crown className="h-6 w-6" />}
                title={t('premium.plansEmptyTitle')}
                description={t('premium.plansEmptyDescription')}
              />
            ) : (
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 lg:items-center">
                {plans.data.map((plan, i) => (
                  <PlanCard
                    key={plan.code}
                    plan={plan}
                    index={i}
                    featured={i === featuredIndex}
                    current={plan.code === currentPlanCode}
                    loading={subscribe.isBusy && subscribe.activePlan?.code === plan.code}
                    disabled={subscribe.isBusy}
                    onSubscribe={subscribe.subscribe}
                  />
                ))}
              </div>
            )}

            <p className="mt-6 text-center text-xs text-muted-foreground">
              {t('premium.billingNote')}
            </p>
          </section>
        </div>
      </EconomyShell>

      <SubscribeStatusDialog
        phase={subscribe.phase}
        plan={subscribe.activePlan}
        error={subscribe.error}
        onClose={subscribe.reset}
        onRetry={() => subscribe.activePlan && subscribe.subscribe(subscribe.activePlan)}
      />
    </>
  );
}
