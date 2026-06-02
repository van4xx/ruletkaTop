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
import { ShieldCheck } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, toast } from '@ruletka/ui';
import type { ReportStatus } from '@ruletka/shared-types';
import { useReviewQueue, useResolveReview } from '@/features/moderation';
import { CardGridSkeleton, EmptyState, ErrorState } from '@/components/economy/states';
import { ReviewCard } from './review-card';

/** Selectable queue statuses (Russian labels). */
const STATUS_TABS: { value: ReportStatus; label: string }[] = [
  { value: 'open', label: 'Новые' },
  { value: 'resolved', label: 'Подтверждённые' },
  { value: 'dismissed', label: 'Отклонённые' },
];

export function ModerationQueue() {
  const [status, setStatus] = useState<ReportStatus>('open');
  const queue = useReviewQueue(status);
  const resolve = useResolveReview();

  // Track which card is being resolved so only its buttons spin.
  const pendingId = resolve.isPending ? resolve.variables?.id : undefined;

  function handleResolve(id: string, resolution: 'uphold' | 'dismiss') {
    resolve.mutate(
      { id, resolution },
      {
        onSuccess: () =>
          toast.success(
            resolution === 'uphold' ? 'Нарушение подтверждено' : 'Жалоба отклонена',
          ),
        onError: (err: unknown) =>
          toast.error(err instanceof Error ? err.message : 'Не удалось сохранить решение'),
      },
    );
  }

  const items = queue.data ?? [];

  return (
    <div className="space-y-8">
      <Tabs value={status} onValueChange={(v) => setStatus(v as ReportStatus)}>
        <TabsList variant="pill">
          {STATUS_TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {queue.isLoading ? (
        <CardGridSkeleton count={6} />
      ) : queue.isError ? (
        <ErrorState
          title="Не удалось загрузить очередь"
          description="Проверьте доступ и попробуйте ещё раз."
          onRetry={() => queue.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck className="h-6 w-6" />}
          title={status === 'open' ? 'Очередь пуста' : 'Здесь пока ничего нет'}
          description={
            status === 'open'
              ? 'Нет событий, ожидающих проверки. Отличная работа!'
              : 'Решённые элементы появятся здесь.'
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
                pending={pendingId === item.id}
              />
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
