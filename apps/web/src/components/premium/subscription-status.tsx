'use client';

/**
 * Current-subscription banner. Renders the active/canceled/past-due state with
 * the renewal/expiry date and a cancel affordance (with confirmation dialog).
 * Hidden entirely when the viewer has no subscription (`status: 'none'`).
 */
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { motion } from 'framer-motion';
import { CalendarClock, Crown, ShieldCheck, TriangleAlert } from 'lucide-react';
import type { Subscription } from '@ruletka/shared-types';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Skeleton,
  toast,
} from '@ruletka/ui';
import { cn } from '@/lib/cn';
import { ErrorState } from '@/components/economy/states';
import { formatDateTime } from '@/features/economy/format';
import { useCancelPremium } from '@/features/premium/use-premium';

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

export interface SubscriptionStatusProps {
  subscription: Subscription | null | undefined;
  isLoading: boolean;
  /** The subscription read failed — show an inline error with a retry. */
  isError?: boolean;
  /** Retry the subscription read (wired to the query's `refetch`). */
  onRetry?: () => void;
  /** Hide when unauthenticated (no point showing an empty state). */
  authenticated: boolean;
}

export function SubscriptionStatus({
  subscription,
  isLoading,
  isError,
  onRetry,
  authenticated,
}: SubscriptionStatusProps) {
  const t = useTranslations('economy');
  const locale = useLocale();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const cancel = useCancelPremium();

  if (!authenticated) return null;

  if (isLoading) {
    return (
      <div className="glass-panel rounded-2xl p-5">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="mt-3 h-4 w-64" />
      </div>
    );
  }

  // The subscription read failed — surface an inline, retryable error rather
  // than silently hiding the banner (which would look like "no subscription").
  if (isError) {
    return (
      <ErrorState
        title={t('subscriptionStatus.errorTitle')}
        description={t('subscriptionStatus.errorDescription')}
        onRetry={onRetry}
      />
    );
  }

  if (!subscription || subscription.status === 'none') return null;

  const { status, currentPeriodEnd, cancelAtPeriodEnd } = subscription;
  const isActive = status === 'active';
  const isPastDue = status === 'past_due';
  const isCanceled = status === 'canceled' || cancelAtPeriodEnd;

  const tone = isPastDue
    ? 'border-destructive/30 bg-destructive/10'
    : isCanceled
      ? 'border-warning/30 bg-warning/10'
      : 'border-success/25 bg-success/10';

  const handleCancel = () => {
    cancel.mutate(undefined, {
      onSuccess: () => {
        toast.success(t('subscriptionStatus.cancelSuccess'), {
          description: currentPeriodEnd
            ? t('subscriptionStatus.cancelSuccessUntil', {
                date: formatDateTime(currentPeriodEnd, locale),
              })
            : t('subscriptionStatus.cancelSuccessGeneric'),
        });
        setConfirmOpen(false);
      },
      onError: () => toast.error(t('subscriptionStatus.cancelError')),
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: EASE_OUT }}
      className={cn(
        'flex flex-col gap-4 rounded-2xl border p-5 sm:flex-row sm:items-center sm:justify-between',
        tone,
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full',
            isPastDue
              ? 'bg-destructive/20 text-destructive'
              : isCanceled
                ? 'bg-warning/20 text-warning'
                : 'bg-success/20 text-success',
          )}
        >
          {isPastDue ? (
            <TriangleAlert className="h-5 w-5" aria-hidden="true" />
          ) : isActive ? (
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          ) : (
            <Crown className="h-5 w-5" aria-hidden="true" />
          )}
        </span>
        <div>
          <div className="flex items-center gap-2">
            <p className="font-display text-base font-bold">
              {t('subscriptionStatus.planLabel', { plan: subscription.plan })}
            </p>
            <Badge variant={isPastDue ? 'danger' : isCanceled ? 'warning' : 'success'} size="sm">
              {isPastDue
                ? t('subscriptionStatus.statusPastDue')
                : isCanceled
                  ? t('subscriptionStatus.statusCanceled')
                  : t('subscriptionStatus.statusActive')}
            </Badge>
          </div>
          {currentPeriodEnd && (
            <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
              {isCanceled
                ? t('subscriptionStatus.accessUntil')
                : t('subscriptionStatus.renewal')}{' '}
              {formatDateTime(currentPeriodEnd, locale)}
            </p>
          )}
        </div>
      </div>

      {isActive && !cancelAtPeriodEnd && (
        <Button variant="ghost" size="sm" onClick={() => setConfirmOpen(true)}>
          {t('subscriptionStatus.cancel')}
        </Button>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('subscriptionStatus.confirmTitle')}</DialogTitle>
            <DialogDescription>
              {t('subscriptionStatus.confirmDescription', {
                periodSuffix: currentPeriodEnd
                  ? ` (${formatDateTime(currentPeriodEnd, locale)})`
                  : '',
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              {t('subscriptionStatus.keepPremium')}
            </Button>
            <Button variant="danger" loading={cancel.isPending} onClick={handleCancel}>
              {t('subscriptionStatus.cancel')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}
