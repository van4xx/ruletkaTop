'use client';

/**
 * /premium — plans, perks, subscribe & manage.
 *
 * - GET /premium/plans (public) → plan cards with perks
 * - Current subscription status + cancel (POST /premium/cancel)
 * - Subscribe → POST /premium/subscribe (register intent) then the recurrent
 *   CloudPayments widget; premium is activated by the webhook.
 */
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
  { icon: Filter, title: 'Фильтры', text: 'Подбор по полу и стране собеседника.' },
  { icon: Ban, title: 'Без рекламы', text: 'Чистый эфир без баннеров и пауз.' },
  { icon: Search, title: 'Приоритет', text: 'Вас находят быстрее в очереди поиска.' },
  { icon: Star, title: 'Статус', text: 'Премиум-бейдж и эксклюзивные подарки.' },
] as const;

export default function PremiumPage() {
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
            Премиум
          </>
        }
        title={
          <>
            Больше <span className="text-gradient-neon">возможностей</span>
          </>
        }
        lede="Фильтры по полу и стране, эфир без рекламы, приоритет в поиске и премиум-статус. Отменить можно в любой момент."
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
            {HIGHLIGHTS.map(({ icon: Icon, title, text }) => (
              <li key={title} className="glass-panel flex flex-col gap-2 rounded-2xl p-5">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/12 text-primary">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <p className="font-display text-sm font-bold">{title}</p>
                <p className="text-xs text-muted-foreground">{text}</p>
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
              Тарифы
            </h2>

            {plans.isLoading ? (
              <CardGridSkeleton count={3} />
            ) : plans.isError ? (
              <ErrorState
                title="Не удалось загрузить тарифы"
                description="Список тарифов временно недоступен."
                onRetry={() => plans.refetch()}
              />
            ) : !plans.data || plans.data.length === 0 ? (
              <EmptyState
                icon={<Crown className="h-6 w-6" />}
                title="Тарифы скоро появятся"
                description="Мы готовим премиум-планы — загляните чуть позже."
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
              Оплата проходит через CloudPayments. Подписка продлевается автоматически, отменить
              можно в любой момент.
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
