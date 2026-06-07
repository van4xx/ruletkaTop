'use client';

/**
 * The admin moderation review queue.
 *
 * Status-tabbed list of flagged events (`GET /moderation/review?status=`) with
 * evidence, label/score and the auto-action — each resolvable via uphold
 * (confirm + enforce) or dismiss (clear). Wrapped by `<RequireAdmin>` at the
 * page level. Matches the dark, glass economy-page aesthetic.
 */
import { useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { ShieldCheck } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, toast } from '@ruletka/ui';
import type { ReportStatus } from '@ruletka/shared-types';
import { useReviewQueue, useResolveReview, useResolveReviewAndBan } from '@/features/moderation';
import { CardGridSkeleton, EmptyState, ErrorState } from '@/components/economy/states';
import { ReviewCard } from './review-card';

/** Selectable queue statuses with their `misc.moderation.*` label keys. */
const STATUS_TABS: { value: ReportStatus; labelKey: string }[] = [
  { value: 'open', labelKey: 'moderation.statusOpen' },
  { value: 'resolved', labelKey: 'moderation.statusResolved' },
  { value: 'dismissed', labelKey: 'moderation.statusDismissed' },
];

export function ModerationQueue() {
  const t = useTranslations('misc');
  const [status, setStatus] = useState<ReportStatus>('open');
  const queue = useReviewQueue(status);
  const resolve = useResolveReview();
  const resolveAndBan = useResolveReviewAndBan();

  // Track which card has an action in flight so only its buttons spin.
  const pendingId =
    (resolve.isPending ? resolve.variables?.id : undefined) ??
    (resolveAndBan.isPending ? resolveAndBan.variables?.id : undefined);

  function handleResolve(id: string, resolution: 'uphold' | 'dismiss') {
    resolve.mutate(
      { id, resolution },
      {
        onSuccess: () =>
          toast.success(
            resolution === 'uphold' ? t('moderation.upheld') : t('moderation.dismissed'),
          ),
        onError: (err: unknown) =>
          toast.error(err instanceof Error ? err.message : t('moderation.resolveError')),
      },
    );
  }

  function handleResolveAndBan(id: string) {
    resolveAndBan.mutate(
      { id },
      {
        onSuccess: () => toast.success(t('moderation.bannedToast')),
        onError: (err: unknown) =>
          toast.error(err instanceof Error ? err.message : t('moderation.resolveError')),
      },
    );
  }

  const items = queue.data ?? [];

  return (
    <div className="space-y-8">
      <Tabs value={status} onValueChange={(v) => setStatus(v as ReportStatus)}>
        <TabsList variant="pill">
          {STATUS_TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {t(tab.labelKey)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {queue.isLoading ? (
        <CardGridSkeleton count={6} />
      ) : queue.isError ? (
        <ErrorState
          title={t('moderation.queueErrorTitle')}
          description={t('moderation.queueErrorDesc')}
          onRetry={() => queue.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck className="h-6 w-6" />}
          title={
            status === 'open' ? t('moderation.emptyOpenTitle') : t('moderation.emptyOtherTitle')
          }
          description={
            status === 'open' ? t('moderation.emptyOpenDesc') : t('moderation.emptyOtherDesc')
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <AnimatePresence mode="popLayout">
            {items.map((item) => (
              <ReviewCard
                key={item.id}
                item={item}
                onResolve={handleResolve}
                onResolveAndBan={handleResolveAndBan}
                pending={pendingId === item.id}
              />
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
