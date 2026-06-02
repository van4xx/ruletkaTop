import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Spinner } from '@ruletka/ui';

import { adminApi } from '../lib/api';
import { PageTitle } from './ui';

const STATUS_TABS = [
  { key: 'open', label: 'Новые' },
  { key: 'reviewing', label: 'На проверке' },
  { key: 'resolved', label: 'Подтверждённые' },
  { key: 'dismissed', label: 'Отклонённые' },
] as const;

/** AI-flag / report review queue. Confirm or dismiss flagged evidence. */
export function Moderation() {
  const [status, setStatus] = useState<(typeof STATUS_TABS)[number]['key']>('open');
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['review', status], queryFn: () => adminApi.reviewQueue(status) });
  const resolve = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'resolved' | 'dismissed' }) =>
      adminApi.resolveReview(id, decision),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['review'] }),
  });

  return (
    <div>
      <PageTitle title="Модерация" subtitle="AI-флаги и жалобы — подтвердить или отклонить." />
      <div className="mb-5 flex flex-wrap gap-2">
        {STATUS_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setStatus(t.key)}
            className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${status === t.key ? 'bg-aurora text-white' : 'bg-glass text-muted-foreground hover:text-foreground'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {q.isLoading ? (
        <div className="grid place-items-center py-16">
          <Spinner />
        </div>
      ) : q.isError ? (
        <p className="text-sm text-danger">Не удалось загрузить очередь.</p>
      ) : !q.data || q.data.items.length === 0 ? (
        <p className="rounded-2xl glass-strong p-8 text-center text-sm text-muted-foreground">
          Очередь пуста.
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {q.data.items.map((item) => (
            <div
              key={item.id}
              className="flex flex-col gap-3 glass-strong rounded-2xl p-4 ring-1 ring-border/50"
            >
              <div className="flex items-center justify-between">
                <Badge variant={item.label === 'minor' ? 'danger' : 'warning'}>{item.label}</Badge>
                <span className="text-xs tabular-nums text-muted-foreground">
                  score {(item.score * 100).toFixed(0)}%
                </span>
              </div>
              {item.evidenceUrl ? (
                <img
                  src={item.evidenceUrl}
                  alt=""
                  className="aspect-video w-full rounded-lg object-cover opacity-90 blur-md transition hover:blur-0"
                />
              ) : (
                <div className="grid aspect-video w-full place-items-center rounded-lg bg-glass text-xs text-muted-foreground">
                  нет кадра
                </div>
              )}
              <p className="truncate text-xs text-muted-foreground">user {item.userId}</p>
              {status === 'open' || status === 'reviewing' ? (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="danger"
                    block
                    loading={resolve.isPending}
                    onClick={() => resolve.mutate({ id: item.id, decision: 'resolved' })}
                  >
                    Подтвердить
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    block
                    onClick={() => resolve.mutate({ id: item.id, decision: 'dismissed' })}
                  >
                    Отклонить
                  </Button>
                </div>
              ) : (
                <span className="text-xs capitalize text-muted-foreground">{item.status}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
