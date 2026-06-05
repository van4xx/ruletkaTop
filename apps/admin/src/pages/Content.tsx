import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Textarea } from '@ruletka/ui';

import { adminApi, AdminApiError, req } from '../lib/api';
import type { AdminAnnouncement, Role } from '../lib/types';
import {
  Badge,
  Card,
  ConfirmButton,
  DataTable,
  EmptyState,
  Modal,
  PageHeader,
  RelativeTime,
  fmtInt,
  type Column,
} from '../components/kit';

/**
 * Контент — the cover cosmetic catalogue with live ownership counts (REAL) and
 * a platform-announcements manager (REAL — Wave 2): list (newest first), create,
 * edit, active-toggle and delete, all admin-only + audited server-side. Covers
 * render as on-brand swatch cards using each cover's accent.
 */
export function Content({ role }: { role: Role }) {
  const isAdmin = role === 'admin';
  const qc = useQueryClient();
  const [editing, setEditing] = useState<AdminAnnouncement | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const covers = useQuery({ queryKey: ['content-covers'], queryFn: () => adminApi.content.covers() });
  const announcements = useQuery({
    queryKey: ['content-announcements'],
    queryFn: () => adminApi.content.announcements(),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['content-announcements'] });

  // Toggle active (PATCH /admin/content/announcements/:id) — via the exported
  // `req` (the typed adminApi.content has no patch method).
  const toggle = useMutation({
    mutationFn: (a: AdminAnnouncement) =>
      req<AdminAnnouncement>(`/admin/content/announcements/${a.id}`, {
        method: 'PATCH',
        json: { active: !a.active },
      }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      req<void>(`/admin/content/announcements/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });

  const columns: Column<AdminAnnouncement>[] = [
    {
      key: 'title',
      header: 'Объявление',
      render: (a) => (
        <div className="min-w-0 max-w-md">
          <p className="truncate font-medium">{a.title}</p>
          <p className="truncate text-xs text-muted-foreground">{a.body}</p>
        </div>
      ),
    },
    {
      key: 'state',
      header: 'Статус',
      render: (a) => <Badge variant={a.active ? 'success' : 'muted'}>{a.active ? 'активно' : 'выкл'}</Badge>,
    },
    { key: 'created', header: 'Создано', align: 'right', render: (a) => <RelativeTime iso={a.createdAt} /> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (a) =>
        isAdmin ? (
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" loading={toggle.isPending} onClick={() => toggle.mutate(a)}>
              {a.active ? 'Выключить' : 'Включить'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setEditing(a)}>
              Изменить
            </Button>
            <ConfirmButton
              size="sm"
              loading={remove.isPending}
              confirmTitle="Удалить объявление?"
              confirmBody="Объявление будет удалено без возможности восстановления."
              confirmLabel="Удалить"
              onConfirm={() => remove.mutate(a.id)}
            >
              Удалить
            </ConfirmButton>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">только просмотр</span>
        ),
    },
  ];

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

      <h2 className="mb-3 font-display text-base font-semibold">Объявления</h2>
      <DataTable
        columns={columns}
        rows={announcements.data?.items ?? []}
        rowKey={(a) => a.id}
        loading={announcements.isLoading}
        error={announcements.isError ? 'Не удалось загрузить объявления.' : undefined}
        empty={
          <EmptyState
            title="Объявлений нет"
            description="Создайте системное объявление — оно станет доступно как баннер у пользователей."
          />
        }
      />

      {isAdmin && (createOpen || editing) && (
        <AnnouncementModal
          announcement={editing}
          onClose={() => {
            setCreateOpen(false);
            setEditing(null);
          }}
          onDone={() => {
            setCreateOpen(false);
            setEditing(null);
            invalidate();
          }}
        />
      )}
    </div>
  );
}

/**
 * Create/edit announcement dialog (admin-only). Create POSTs via
 * `adminApi.content.createAnnouncement`; edit PATCHes title/body via `req`.
 */
function AnnouncementModal({
  announcement,
  onClose,
  onDone,
}: {
  announcement: AdminAnnouncement | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const isEdit = announcement !== null;
  const [title, setTitle] = useState(announcement?.title ?? '');
  const [body, setBody] = useState(announcement?.body ?? '');
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      isEdit
        ? req<AdminAnnouncement>(`/admin/content/announcements/${announcement.id}`, {
            method: 'PATCH',
            json: { title: title.trim(), body: body.trim() },
          })
        : adminApi.content.createAnnouncement({ title: title.trim(), body: body.trim(), active: true }),
    onSuccess: onDone,
    onError: (e) => setError(e instanceof AdminApiError ? e.message : 'Не удалось сохранить'),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? 'Изменить объявление' : 'Новое объявление'}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Отмена
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={save.isPending}
            disabled={!title.trim() || !body.trim()}
            onClick={() => {
              setError(null);
              save.mutate();
            }}
          >
            {isEdit ? 'Сохранить' : 'Создать'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Input placeholder="Заголовок" value={title} onChange={(e) => setTitle(e.target.value)} />
        <Textarea placeholder="Текст" rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    </Modal>
  );
}
