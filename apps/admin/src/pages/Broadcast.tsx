import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Textarea } from '@ruletka/ui';

import { adminApi, AdminApiError } from '../lib/api';
import type { AdminBroadcastRecord, AdminBroadcastSegment, Role } from '../lib/types';
import {
  Badge,
  Card,
  DataTable,
  EmptyState,
  PageHeader,
  RelativeTime,
  Select,
  fmtInt,
  type Column,
} from '../components/kit';

const SEGMENTS: { value: AdminBroadcastSegment; label: string }[] = [
  { value: 'all', label: 'Все пользователи' },
  { value: 'premium', label: 'Premium' },
  { value: 'active', label: 'Активные (30д)' },
  { value: 'banned', label: 'Забаненные' },
];

const SEGMENT_LABEL: Record<AdminBroadcastSegment, string> = {
  all: 'Все',
  premium: 'Premium',
  active: 'Активные',
  banned: 'Забаненные',
};

/**
 * Рассылки — compose + fan out a system notification to a segment (admin-only;
 * REAL via NotificationsService) and review history (REAL — each send persists a
 * `broadcasts` record, listed newest-first).
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

  const columns: Column<AdminBroadcastRecord>[] = [
    {
      key: 'title',
      header: 'Рассылка',
      render: (b) => (
        <div className="min-w-0 max-w-md">
          <p className="truncate font-medium">{b.title}</p>
          <p className="truncate text-xs text-muted-foreground">{b.body}</p>
        </div>
      ),
    },
    {
      key: 'segment',
      header: 'Сегмент',
      render: (b) => <Badge variant="info">{SEGMENT_LABEL[b.segment] ?? b.segment}</Badge>,
    },
    {
      key: 'recipients',
      header: 'Получателей',
      align: 'right',
      render: (b) => <span className="tabular-nums">{fmtInt(b.recipients)}</span>,
    },
    { key: 'sent', header: 'Отправлено', align: 'right', render: (b) => <RelativeTime iso={b.createdAt} /> },
  ];

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

        <div>
          <h2 className="mb-3 font-display text-base font-semibold">История</h2>
          <DataTable
            columns={columns}
            rows={history.data?.items ?? []}
            rowKey={(b) => b.id}
            loading={history.isLoading}
            error={history.isError ? 'Не удалось загрузить историю.' : undefined}
            empty={<EmptyState title="Рассылок не было" description="История появится после первой отправки." />}
          />
        </div>
      </div>
    </div>
  );
}
