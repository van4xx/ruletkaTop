import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Textarea } from '@ruletka/ui';

import { adminApi, AdminApiError } from '../lib/api';
import type { AdminBroadcastSegment, Role } from '../lib/types';
import {
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  RelativeTime,
  Select,
  fmtInt,
} from '../components/kit';

const SEGMENTS: { value: AdminBroadcastSegment; label: string }[] = [
  { value: 'all', label: 'Все пользователи' },
  { value: 'premium', label: 'Premium' },
  { value: 'active', label: 'Активные (30д)' },
  { value: 'banned', label: 'Забаненные' },
];

/**
 * Рассылки — compose + fan out a system notification to a segment (admin-only;
 * REAL via NotificationsService) and review history (Wave-2 stub until a
 * broadcast-records collection lands).
 */
export function Broadcast({ role }: { role: Role }) {
  const isAdmin = role === 'admin';
  const qc = useQueryClient();

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [segment, setSegment] = useState<AdminBroadcastSegment>('all');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const history = useQuery({ queryKey: ['broadcast-history'], queryFn: () => adminApi.broadcast.history() });

  const send = useMutation({
    mutationFn: () => adminApi.broadcast.send({ title: title.trim(), body: body.trim(), segment }),
    onSuccess: (r) => {
      setNotice(`Отправлено получателям: ${fmtInt(r.recipients)}.`);
      setTitle('');
      setBody('');
      qc.invalidateQueries({ queryKey: ['broadcast-history'] });
    },
    onError: (e) => setError(e instanceof AdminApiError ? e.message : 'Не удалось отправить'),
  });

  return (
    <div>
      <PageHeader title="Рассылки" subtitle="Системные уведомления по сегментам аудитории." />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-4 font-display text-base font-semibold">Новая рассылка</h2>
          {!isAdmin ? (
            <p className="text-sm text-muted-foreground">Отправка доступна только администраторам.</p>
          ) : (
            <div className="flex flex-col gap-3">
              <Input placeholder="Заголовок" value={title} onChange={(e) => setTitle(e.target.value)} />
              <Textarea placeholder="Текст уведомления" rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Сегмент:</span>
                <Select value={segment} onChange={(v) => setSegment(v as AdminBroadcastSegment)}>
                  {SEGMENTS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              </div>
              {notice && <p className="text-sm text-success">{notice}</p>}
              {error && <p className="text-sm text-danger">{error}</p>}
              <Button
                variant="primary"
                loading={send.isPending}
                disabled={!title.trim() || !body.trim()}
                onClick={() => {
                  setNotice(null);
                  setError(null);
                  send.mutate();
                }}
              >
                Отправить
              </Button>
            </div>
          )}
        </Card>

        <Card padding="none">
          <CardHeader title="История" />
          {history.isLoading ? (
            <div className="grid place-items-center py-12">
              <div className="h-5 w-32 animate-pulse rounded bg-glass" />
            </div>
          ) : (history.data?.items.length ?? 0) === 0 ? (
            <EmptyState title="Рассылок не было" description="История появится после первой отправки (Wave 2)." />
          ) : (
            <ul className="divide-y divide-border/60">
              {history.data?.items.map((b) => (
                <li key={b.id} className="px-5 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate font-medium">{b.title}</p>
                    <RelativeTime iso={b.createdAt} />
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {b.segment} · {fmtInt(b.recipients)} получателей
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
