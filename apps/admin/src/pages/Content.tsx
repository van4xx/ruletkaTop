import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Textarea } from '@ruletka/ui';

import { adminApi, AdminApiError } from '../lib/api';
import type { Role } from '../lib/types';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  Modal,
  PageHeader,
  RelativeTime,
  fmtInt,
} from '../components/kit';

/**
 * Контент — the cover cosmetic catalogue with live ownership counts (REAL) and
 * a platform-announcements panel (list is a Wave-2 stub; create flow is wired —
 * admin-only). Covers render as on-brand swatch cards using each cover's accent.
 */
export function Content({ role }: { role: Role }) {
  const isAdmin = role === 'admin';
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);

  const covers = useQuery({ queryKey: ['content-covers'], queryFn: () => adminApi.content.covers() });
  const announcements = useQuery({
    queryKey: ['content-announcements'],
    queryFn: () => adminApi.content.announcements(),
  });

  return (
    <div>
      <PageHeader
        title="Контент"
        subtitle="Каталог обложек и системные объявления."
        actions={
          isAdmin ? (
            <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
              Новое объявление
            </Button>
          ) : undefined
        }
      />

      <section className="mb-8">
        <h2 className="mb-3 font-display text-base font-semibold">Обложки профиля</h2>
        {covers.isLoading ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="h-32 animate-pulse rounded-2xl bg-glass" />
            ))}
          </div>
        ) : covers.isError ? (
          <Card className="text-sm text-danger ring-danger/30">Не удалось загрузить обложки.</Card>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {(covers.data?.items ?? []).map((c) => (
              <div key={c.id} className="overflow-hidden rounded-2xl ring-1 ring-border/50">
                <div className="h-16" style={{ background: `linear-gradient(135deg, ${c.accent}, transparent)` }} />
                <div className="glass-strong p-3">
                  <div className="flex items-center justify-between gap-1">
                    <p className="truncate text-sm font-semibold">{c.name}</p>
                    <Badge variant={c.tier === 'free' ? 'muted' : 'accent'}>{c.tier}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {c.priceCoins > 0 ? `${fmtInt(c.priceCoins)} мон.` : 'Бесплатно'}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{fmtInt(c.ownedCount)} владельцев</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <Card padding="none">
        <CardHeader title="Объявления" />
        {announcements.isLoading ? (
          <div className="grid place-items-center py-12">
            <div className="h-5 w-32 animate-pulse rounded bg-glass" />
          </div>
        ) : (announcements.data?.items.length ?? 0) === 0 ? (
          <EmptyState
            title="Объявлений нет"
            description="Создайте системное объявление — оно появится баннером у пользователей (Wave 2)."
          />
        ) : (
          <ul className="divide-y divide-border/60">
            {announcements.data?.items.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{a.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{a.body}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant={a.active ? 'success' : 'muted'}>{a.active ? 'активно' : 'выкл'}</Badge>
                  <RelativeTime iso={a.createdAt} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {isAdmin && (
        <CreateAnnouncementModal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onDone={() => {
            setCreateOpen(false);
            qc.invalidateQueries({ queryKey: ['content-announcements'] });
          }}
        />
      )}
    </div>
  );
}

/** Create-announcement dialog (admin-only). Persistence lands in Wave 2. */
function CreateAnnouncementModal({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => adminApi.content.createAnnouncement({ title: title.trim(), body: body.trim(), active: true }),
    onSuccess: onDone,
    onError: (e) => setError(e instanceof AdminApiError ? e.message : 'Не удалось создать'),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Новое объявление"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Отмена
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={create.isPending}
            disabled={!title.trim() || !body.trim()}
            onClick={() => {
              setError(null);
              create.mutate();
            }}
          >
            Создать
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-muted-foreground">
        Сохранение и доставка баннера — в Wave 2. Сейчас контракт и форма уже работают.
      </p>
      <div className="flex flex-col gap-3">
        <Input placeholder="Заголовок" value={title} onChange={(e) => setTitle(e.target.value)} />
        <Textarea placeholder="Текст" rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    </Modal>
  );
}
