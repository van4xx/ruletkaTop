import { useMemo, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input } from '@ruletka/ui';

import {
  adminApi,
  AdminApiError,
  type AdminPremiumPlan,
} from '../lib/api';
import type { AdminSubscriber, Role } from '../lib/types';
import {
  Avatar,
  Badge,
  ConfirmButton,
  DataTable,
  EmptyState,
  MetricCard,
  Modal,
  Money,
  PageHeader,
  Pagination,
  RelativeTime,
  Tabs,
  Toolbar,
  fmtInt,
  type BadgeVariant,
  type Column,
} from '../components/kit';

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  active: 'success',
  canceled: 'warning',
  past_due: 'danger',
  none: 'muted',
};

/** A public `code` slug, as the backend validates it (2–49 chars). */
const CODE_RE = /^[a-z0-9][a-z0-9_-]{1,48}$/i;
/** Mirrors the backend perk-count cap (`PREMIUM_PERK_MAX`). */
const PERK_MAX = 20;

/** Pull a human message out of an API error (with a friendly 403 line). */
function errMsg(e: unknown, fallback = 'Не удалось выполнить операцию'): string {
  if (e instanceof AdminApiError) {
    if (e.status === 403) return 'Недостаточно прав: это действие доступно только администратору.';
    return e.message || fallback;
  }
  return fallback;
}

type TabKey = 'subscribers' | 'plans';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'subscribers', label: 'Подписчики' },
  { key: 'plans', label: 'Тарифы' },
];

/**
 * Премиум — premium management console.
 *
 * Two tabs:
 *  - **Подписчики** — the subscribers directory (cursor-paginated) with the live
 *    active count; admins can comp premium for N days or revoke it (both route
 *    through the real premium service and are audited).
 *  - **Тарифы** — full CRUD over the plan-tier catalogue (`premiumplans`),
 *    mirroring the coin-package console. These are the SAME documents the public
 *    pricing page reads and the subscribe flow resolves by `code`, so edits are
 *    live. Reads are moderator-visible; writes are admin-only (buttons hidden for
 *    moderators, and the API re-checks → 403).
 */
export function Premium({ role }: { role: Role }) {
  const isAdmin = role === 'admin';
  const [tab, setTab] = useState<TabKey>('subscribers');

  return (
    <div>
      <PageHeader title="Премиум" subtitle="Подписчики, тарифы, выдача и отзыв доступа." />
      <Tabs items={TABS} value={tab} onChange={(k) => setTab(k as TabKey)} />

      {tab === 'subscribers' && <SubscribersTab isAdmin={isAdmin} />}
      {tab === 'plans' && <PlansTab isAdmin={isAdmin} />}
    </div>
  );
}

/* ──────────────────────────────── Подписчики ───────────────────────────────── */

function SubscribersTab({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const list = useInfiniteQuery({
    queryKey: ['premium-list'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => adminApi.premium.list(pageParam),
    getNextPageParam: (last) => (last.hasMore ? (last.nextCursor ?? undefined) : undefined),
  });

  const rows = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  const activeCount = list.data?.pages[0]?.activeCount ?? 0;

  const grant = useMutation({
    mutationFn: (userId: string) => adminApi.premium.grant(userId, { days: 30 }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['premium-list'] }),
    onError: (e) => setError(e instanceof AdminApiError ? e.message : 'Не удалось выдать премиум'),
  });
  const revoke = useMutation({
    mutationFn: (userId: string) => adminApi.premium.revoke(userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['premium-list'] }),
    onError: (e) =>
      setError(e instanceof AdminApiError ? e.message : 'Не удалось отозвать премиум'),
  });

  const columns: Column<AdminSubscriber>[] = [
    {
      key: 'user',
      header: 'Подписчик',
      render: (r) => (
        <div className="flex items-center gap-3">
          <Avatar seed={r.userId} label={r.nickname} size="sm" />
          <div className="min-w-0">
            <p className="truncate font-medium">{r.nickname || '—'}</p>
            <p className="truncate text-xs text-muted-foreground">{r.email || r.userId}</p>
          </div>
        </div>
      ),
    },
    { key: 'plan', header: 'План', render: (r) => <span className="font-medium">{r.plan}</span> },
    {
      key: 'status',
      header: 'Статус',
      render: (r) => <Badge variant={STATUS_VARIANT[r.status] ?? 'muted'}>{r.status}</Badge>,
    },
    {
      key: 'until',
      header: 'До',
      render: (r) =>
        r.currentPeriodEnd ? (
          <RelativeTime iso={r.currentPeriodEnd} />
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    ...(isAdmin
      ? [
          {
            key: 'actions',
            header: 'Действия',
            align: 'right' as const,
            render: (r: AdminSubscriber) => (
              <div className="flex justify-end gap-2">
                <ConfirmButton
                  variant="secondary"
                  confirmTitle="Выдать премиум на 30 дней?"
                  confirmLabel="Выдать"
                  loading={grant.isPending}
                  onConfirm={() => grant.mutate(r.userId)}
                >
                  +30д
                </ConfirmButton>
                <ConfirmButton
                  variant="danger"
                  confirmTitle="Отозвать премиум?"
                  confirmLabel="Отозвать"
                  loading={revoke.isPending}
                  onConfirm={() => revoke.mutate(r.userId)}
                >
                  Отозвать
                </ConfirmButton>
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <div>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Активных подписок"
          value={fmtInt(activeCount)}
          loading={list.isLoading}
          accent
        />
        <MetricCard
          label="Загружено записей"
          value={fmtInt(rows.length)}
          loading={list.isLoading}
        />
      </div>

      {error && (
        <p className="mb-4 rounded-xl glass-strong p-3 text-sm text-danger ring-1 ring-danger/30">
          {error}
        </p>
      )}

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.userId}
        loading={list.isLoading}
        error={list.isError ? 'Не удалось загрузить подписчиков.' : undefined}
        empty={
          <p className="p-8 text-center text-sm text-muted-foreground">Подписчиков пока нет.</p>
        }
        footer={
          rows.length > 0 ? (
            <Pagination
              hasMore={Boolean(list.hasNextPage)}
              loading={list.isFetchingNextPage}
              loadedCount={rows.length}
              onLoadMore={() => list.fetchNextPage()}
            />
          ) : undefined
        }
      />
    </div>
  );
}

/* ───────────────────────────────── Тарифы ──────────────────────────────────── */

function PlansTab({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['premium-plans'], queryFn: () => adminApi.premium.plans.list() });
  const [editing, setEditing] = useState<AdminPremiumPlan | null>(null);
  const [creating, setCreating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['premium-plans'] });

  const del = useMutation({
    mutationFn: (id: string) => adminApi.premium.plans.remove(id),
    onSuccess: invalidate,
    onError: (e) => setActionError(errMsg(e, 'Не удалось удалить тариф')),
  });

  const columns: Column<AdminPremiumPlan>[] = [
    {
      key: 'plan',
      header: 'Тариф',
      render: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{r.title}</p>
          <p className="truncate font-mono text-xs text-muted-foreground">{r.code}</p>
        </div>
      ),
    },
    { key: 'price', header: 'Цена', align: 'right', render: (r) => <Money amount={r.priceRub} /> },
    {
      key: 'interval',
      header: 'Период',
      align: 'right',
      render: (r) => <span className="tabular-nums">{fmtInt(r.intervalDays)} дн.</span>,
    },
    {
      key: 'perks',
      header: 'Преимущества',
      render: (r) =>
        r.perks.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {r.perks.slice(0, 3).map((p, i) => (
              <Badge key={i} variant="muted">
                {p}
              </Badge>
            ))}
            {r.perks.length > 3 && (
              <span className="text-xs text-muted-foreground">+{r.perks.length - 3}</span>
            )}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) =>
        isAdmin ? (
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditing(r)}>
              Изменить
            </Button>
            <ConfirmButton
              onConfirm={() => {
                setActionError(null);
                del.mutate(r.id);
              }}
              confirmTitle="Удалить тариф?"
              confirmBody={`Тариф «${r.title}» исчезнет со страницы цен. Активные подписки сохранят свой план и срок действия.`}
              confirmLabel="Удалить"
            >
              Удалить
            </ConfirmButton>
          </div>
        ) : null,
    },
  ];

  return (
    <div>
      {!isAdmin && <ReadOnlyBanner />}
      <Toolbar
        actions={
          isAdmin ? (
            <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
              Создать тариф
            </Button>
          ) : undefined
        }
      />
      {actionError && (
        <p className="mb-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger ring-1 ring-danger/30">
          {actionError}
        </p>
      )}
      <DataTable
        columns={columns}
        rows={q.data ?? []}
        rowKey={(r) => r.id}
        loading={q.isLoading}
        error={q.isError ? 'Не удалось загрузить тарифы.' : undefined}
        empty={
          <EmptyState
            title="Тарифов нет"
            description={isAdmin ? 'Создайте первый премиум-тариф.' : 'Каталог пуст.'}
          />
        }
      />

      {(creating || editing) && (
        <PlanModal
          plan={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onDone={() => {
            setCreating(false);
            setEditing(null);
            invalidate();
          }}
        />
      )}
    </div>
  );
}

/** Create/edit dialog for a premium plan. `code` is immutable when editing. */
function PlanModal({
  plan,
  onClose,
  onDone,
}: {
  plan: AdminPremiumPlan | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const isEdit = plan !== null;
  const [code, setCode] = useState(plan?.code ?? '');
  const [title, setTitle] = useState(plan?.title ?? '');
  const [priceRub, setPriceRub] = useState(String(plan?.priceRub ?? ''));
  const [intervalDays, setIntervalDays] = useState(String(plan?.intervalDays ?? ''));
  // Perks edited as one-per-line; blank lines are dropped on save.
  const [perksText, setPerksText] = useState((plan?.perks ?? []).join('\n'));
  const [error, setError] = useState<string | null>(null);

  const priceN = Number(priceRub);
  const intervalN = Number(intervalDays);
  const perks = perksText
    .split('\n')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const valid =
    (isEdit || CODE_RE.test(code.trim())) &&
    title.trim().length > 0 &&
    Number.isInteger(priceN) &&
    priceN >= 1 &&
    Number.isInteger(intervalN) &&
    intervalN >= 1 &&
    perks.length <= PERK_MAX;

  const save = useMutation({
    mutationFn: () =>
      isEdit
        ? adminApi.premium.plans.update(plan.id, {
            title: title.trim(),
            priceRub: priceN,
            intervalDays: intervalN,
            perks,
          })
        : adminApi.premium.plans.create({
            code: code.trim(),
            title: title.trim(),
            priceRub: priceN,
            intervalDays: intervalN,
            perks,
          }),
    onSuccess: onDone,
    onError: (e) => setError(errMsg(e, 'Не удалось сохранить тариф')),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? `Тариф «${plan.title}»` : 'Новый тариф'}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Отмена
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={save.isPending}
            disabled={!valid}
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
        <Field label="Код (public id)">
          <Input
            placeholder="monthly"
            value={code}
            disabled={isEdit}
            onChange={(e) => setCode(e.target.value)}
          />
          {isEdit && (
            <p className="mt-1 text-xs text-muted-foreground">
              Код неизменяем — по нему оформление подписки находит тариф.
            </p>
          )}
        </Field>
        <Field label="Название">
          <Input
            placeholder="Premium Monthly"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Цена, ₽">
            <Input
              type="number"
              min={1}
              placeholder="399"
              value={priceRub}
              onChange={(e) => setPriceRub(e.target.value)}
            />
          </Field>
          <Field label="Период, дней">
            <Input
              type="number"
              min={1}
              placeholder="30"
              value={intervalDays}
              onChange={(e) => setIntervalDays(e.target.value)}
            />
          </Field>
        </div>
        <Field label="Преимущества (по одному на строку)">
          <textarea
            placeholder={'Безлимит совпадений\nФильтры по полу и стране\nПремиум-подарки'}
            value={perksText}
            onChange={(e) => setPerksText(e.target.value)}
            rows={5}
            className="w-full rounded-lg border border-border bg-background-elevated px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-accent"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            {perks.length}/{PERK_MAX} преимуществ.
          </p>
        </Field>
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    </Modal>
  );
}

/* ──────────────────────────────── Shared bits ──────────────────────────────── */

/** Labelled form field wrapper for the modals. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

/** Banner shown to moderators (read-only): catalogue writes are admin-only. */
function ReadOnlyBanner() {
  return (
    <p className="mb-4 rounded-lg bg-info/10 px-3 py-2 text-sm text-info ring-1 ring-info/30">
      Режим просмотра. Изменять тарифы может только администратор.
    </p>
  );
}
