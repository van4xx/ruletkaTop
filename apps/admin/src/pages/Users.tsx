import { useMemo, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input } from '@ruletka/ui';

import { adminApi, AdminApiError, req } from '../lib/api';
import type { AdminLedgerEntry, AdminUserSummary, Role } from '../lib/types';
import {
  Avatar,
  Badge,
  Coins,
  ConfirmButton,
  DataTable,
  Drawer,
  EmptyState,
  MetricCard,
  Modal,
  PageHeader,
  Pagination,
  RelativeTime,
  Select,
  Toolbar,
  cx,
  fmtDate,
  useDebounced,
  type BadgeVariant,
  type Column,
} from '../components/kit';

const ROLES: { value: Role; label: string }[] = [
  { value: 'user', label: 'Пользователь' },
  { value: 'moderator', label: 'Модератор' },
  { value: 'admin', label: 'Админ' },
];
const ROLE_LABEL: Record<Role, string> = {
  user: 'Пользователь',
  moderator: 'Модератор',
  admin: 'Админ',
};
const ROLE_BADGE: Record<Role, BadgeVariant> = {
  user: 'muted',
  moderator: 'info',
  admin: 'accent',
};

type BannedFilter = 'all' | 'banned' | 'active';

const PAGE = 30;

/** Map any thrown error to a Russian message; a 403 becomes "Недостаточно прав". */
function errMessage(e: unknown, fallback: string): string {
  if (e instanceof AdminApiError) {
    return e.status === 403 ? 'Недостаточно прав' : `${fallback}: ${e.message}`;
  }
  return fallback;
}

/**
 * Пользователи — a full user-management console. The table is a searchable,
 * filterable, cursor-paginated directory; clicking a row opens the "Досье"
 * drawer with the account's identity, status, wallet and every administrative
 * action (role, ban, verify, force-logout, delete, balance, premium).
 *
 * Privileged actions (role change, account deletion) are `admin`-only on the
 * server; the UI mirrors that gate from the `role` prop and surfaces a server
 * `403` as "Недостаточно прав" as defence-in-depth.
 */
export function Users({ role: viewerRole }: { role: Role }) {
  const isAdmin = viewerRole === 'admin';

  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim(), 350);
  const [roleFilter, setRoleFilter] = useState<'' | Role>('');
  const [banned, setBanned] = useState<BannedFilter>('all');
  const [openId, setOpenId] = useState<string | null>(null);

  const bannedParam = banned === 'all' ? undefined : banned === 'banned';

  const queryKey = useMemo(
    () => ['users', { q, role: roleFilter, banned }] as const,
    [q, roleFilter, banned],
  );

  const list = useInfiniteQuery({
    queryKey,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      adminApi.listUsers({
        q: q || undefined,
        role: roleFilter || undefined,
        banned: bannedParam,
        cursor: pageParam,
        limit: PAGE,
      }),
    getNextPageParam: (last) => (last.hasMore ? (last.nextCursor ?? undefined) : undefined),
  });

  const rows = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);

  const columns: Column<AdminUserSummary>[] = [
    {
      key: 'user',
      header: 'Пользователь',
      render: (u) => (
        <div className="flex items-center gap-3">
          <Avatar seed={u.id} label={u.nickname || u.email} size="sm" />
          <div className="min-w-0">
            <div className="truncate font-medium text-foreground">{u.nickname || '—'}</div>
            <div className="truncate text-xs text-muted-foreground">{u.email}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Роль',
      render: (u) => <Badge variant={ROLE_BADGE[u.role]}>{ROLE_LABEL[u.role]}</Badge>,
    },
    {
      key: 'status',
      header: 'Статусы',
      render: (u) => (
        <div className="flex flex-wrap gap-1.5">
          {u.isPremium && <Badge variant="warning">Premium</Badge>}
          {u.emailVerified ? (
            <Badge variant="success">Подтв.</Badge>
          ) : (
            <Badge variant="muted">Не подтв.</Badge>
          )}
          {u.isBanned && <Badge variant="danger">Бан</Badge>}
        </div>
      ),
    },
    {
      key: 'created',
      header: 'Регистрация',
      align: 'right',
      render: (u) => <RelativeTime iso={u.createdAt} />,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Пользователи"
        subtitle="Поиск, фильтры и полное досье с управлением аккаунтом."
      />

      <Toolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Поиск по email или нику…"
        filters={
          <>
            <Select value={roleFilter} onChange={(v) => setRoleFilter(v as '' | Role)}>
              <option value="">Все роли</option>
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
            <Select value={banned} onChange={(v) => setBanned(v as BannedFilter)}>
              <option value="all">Все статусы</option>
              <option value="active">Активные</option>
              <option value="banned">Забаненные</option>
            </Select>
          </>
        }
      />

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(u) => u.id}
        loading={list.isLoading}
        error={list.isError ? 'Не удалось загрузить список пользователей.' : undefined}
        empty={<EmptyState title="Никого не найдено" description="Измените запрос или фильтры." />}
        onRowClick={(u) => setOpenId(u.id)}
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

      {openId && (
        <Dossier
          userId={openId}
          isAdmin={isAdmin}
          listKey={queryKey}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}

/* ────────────────────────────────── Dossier ──────────────────────────────── */

/**
 * The "Досье" drawer: loads the user summary + wallet detail, renders identity,
 * status, balance + recent ledger, and the full action surface. Every mutation
 * refreshes both the dossier (summary + wallet) and the parent list so the row
 * reflects the new state on close.
 */
function Dossier({
  userId,
  isAdmin,
  listKey,
  onClose,
}: {
  userId: string;
  isAdmin: boolean;
  listKey: readonly unknown[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [banOpen, setBanOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [premiumOpen, setPremiumOpen] = useState(false);

  const summaryKey = ['user', userId] as const;
  const walletKey = ['wallet-detail', userId] as const;

  const summary = useQuery({
    queryKey: summaryKey,
    queryFn: () => adminApi.getUser(userId),
  });
  const wallet = useQuery({
    queryKey: walletKey,
    queryFn: () => adminApi.wallet.detail(userId),
  });

  /** Re-fetch the dossier (summary + wallet) and the parent list after a mutation. */
  function refresh() {
    qc.invalidateQueries({ queryKey: summaryKey });
    qc.invalidateQueries({ queryKey: walletKey });
    qc.invalidateQueries({ queryKey: listKey.slice(0, 1) }); // all ['users', …] pages
  }

  const setRole = useMutation({
    mutationFn: (role: Role) => adminApi.setRole(userId, role),
    onMutate: () => setError(null),
    onSuccess: () => refresh(),
    onError: (e) => setError(errMessage(e, 'Не удалось сменить роль')),
  });
  const unban = useMutation({
    mutationFn: () => adminApi.unbanUser(userId),
    onMutate: () => setError(null),
    onSuccess: () => refresh(),
    onError: (e) => setError(errMessage(e, 'Не удалось разбанить')),
  });
  const verifyEmail = useMutation({
    mutationFn: () =>
      req<AdminUserSummary>(`/admin/users/${userId}/verify-email`, { method: 'POST' }),
    onMutate: () => setError(null),
    onSuccess: () => refresh(),
    onError: (e) => setError(errMessage(e, 'Не удалось подтвердить email')),
  });
  const forceLogout = useMutation({
    mutationFn: () => req<{ ok: true }>(`/admin/users/${userId}/force-logout`, { method: 'POST' }),
    onMutate: () => setError(null),
    onSuccess: () => refresh(),
    onError: (e) => setError(errMessage(e, 'Не удалось завершить сессии')),
  });
  const del = useMutation({
    mutationFn: () => req<{ ok: true }>(`/admin/users/${userId}`, { method: 'DELETE' }),
    onMutate: () => setError(null),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: listKey.slice(0, 1) });
      onClose();
    },
    onError: (e) => setError(errMessage(e, 'Не удалось удалить аккаунт')),
  });
  const revokePremium = useMutation({
    mutationFn: () => adminApi.premium.revoke(userId),
    onMutate: () => setError(null),
    onSuccess: () => refresh(),
    onError: (e) => setError(errMessage(e, 'Не удалось снять премиум')),
  });

  const u = summary.data;
  const busy =
    setRole.isPending ||
    unban.isPending ||
    verifyEmail.isPending ||
    forceLogout.isPending ||
    revokePremium.isPending;

  const ledgerColumns: Column<AdminLedgerEntry>[] = [
    {
      key: 'type',
      header: 'Тип',
      render: (r) => <span className="text-muted-foreground">{r.type}</span>,
    },
    { key: 'delta', header: 'Δ', align: 'right', render: (r) => <Coins amount={r.delta} signed /> },
    {
      key: 'when',
      header: 'Когда',
      align: 'right',
      render: (r) => <RelativeTime iso={r.createdAt} />,
    },
  ];

  return (
    <Drawer open onClose={onClose} title="Досье" width="max-w-lg">
      {summary.isLoading ? (
        <div className="grid place-items-center py-16">
          <span className="text-sm text-muted-foreground">Загрузка…</span>
        </div>
      ) : summary.isError || !u ? (
        <p className="rounded-xl bg-danger/10 p-4 text-sm text-danger ring-1 ring-danger/30">
          Не удалось загрузить досье пользователя.
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          {/* Identity */}
          <div className="flex items-center gap-3">
            <Avatar seed={u.id} label={u.nickname || u.email} size="lg" />
            <div className="min-w-0">
              <div className="truncate font-display text-lg font-bold">{u.nickname || '—'}</div>
              <div className="truncate text-sm text-muted-foreground">{u.email}</div>
              <div className="mt-0.5 font-mono text-[11px] text-muted-foreground/80">{u.id}</div>
            </div>
          </div>

          {/* Status badges */}
          <div className="flex flex-wrap gap-1.5">
            <Badge variant={ROLE_BADGE[u.role]}>{ROLE_LABEL[u.role]}</Badge>
            {u.emailVerified ? (
              <Badge variant="success">Email подтверждён</Badge>
            ) : (
              <Badge variant="muted">Email не подтверждён</Badge>
            )}
            {u.isPremium ? (
              <Badge variant="warning">Premium</Badge>
            ) : (
              <Badge variant="muted">Без премиума</Badge>
            )}
            {u.isBanned ? (
              <Badge variant="danger">Забанен</Badge>
            ) : (
              <Badge variant="success">Активен</Badge>
            )}
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <Field label="Регистрация" value={fmtDate(u.createdAt)} />
            {u.country && <Field label="Страна" value={u.country} />}
            {u.gender && <Field label="Пол" value={u.gender} />}
          </dl>

          {error && (
            <p className="rounded-xl bg-danger/10 p-3 text-sm text-danger ring-1 ring-danger/30">
              {error}
            </p>
          )}

          {/* Balance + recent ledger */}
          <div>
            <MetricCard
              label="Баланс кошелька"
              value={wallet.data ? <Coins amount={wallet.data.balanceCoins} /> : '—'}
              loading={wallet.isLoading}
              accent
            />
            <div className="mt-3">
              <DataTable
                columns={ledgerColumns}
                rows={wallet.data?.ledger ?? []}
                rowKey={(r) => r.id}
                loading={wallet.isLoading}
                error={wallet.isError ? 'Не удалось загрузить кошелёк.' : undefined}
                empty={
                  <p className="p-6 text-center text-sm text-muted-foreground">
                    Операций по кошельку нет.
                  </p>
                }
              />
            </div>
          </div>

          {/* Actions */}
          <div className="border-t border-border/60 pt-4">
            <h3 className="mb-3 font-display text-sm font-semibold">Действия</h3>

            {/* Role (admin-only) */}
            <div className="mb-4">
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Роль
              </label>
              {isAdmin ? (
                <Select
                  value={u.role}
                  className={cx('w-full', busy && 'opacity-60')}
                  onChange={(v) => {
                    const role = v as Role;
                    if (role !== u.role) setRole.mutate(role);
                  }}
                >
                  {ROLES.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </Select>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {ROLE_LABEL[u.role]} — изменение роли доступно только администратору.
                </p>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              {/* Ban / unban */}
              {u.isBanned ? (
                <Button
                  size="sm"
                  variant="secondary"
                  loading={unban.isPending}
                  disabled={busy}
                  onClick={() => unban.mutate()}
                >
                  Разбанить
                </Button>
              ) : (
                <Button size="sm" variant="danger" disabled={busy} onClick={() => setBanOpen(true)}>
                  Забанить
                </Button>
              )}

              {/* Verify email (idempotent; only meaningful when unverified) */}
              {!u.emailVerified && (
                <Button
                  size="sm"
                  variant="secondary"
                  loading={verifyEmail.isPending}
                  disabled={busy}
                  onClick={() => verifyEmail.mutate()}
                >
                  Подтвердить email
                </Button>
              )}

              {/* Force-logout */}
              <ConfirmButton
                variant="secondary"
                disabled={busy}
                loading={forceLogout.isPending}
                confirmTitle="Завершить все сессии?"
                confirmBody="Пользователь будет разлогинен на всех устройствах и должен будет войти заново."
                confirmLabel="Завершить сессии"
                onConfirm={() => forceLogout.mutate()}
              >
                Завершить сессии
              </ConfirmButton>

              {/* Balance adjust (admin-only) */}
              {isAdmin && (
                <Button
                  size="sm"
                  variant="primary"
                  disabled={busy}
                  onClick={() => setAdjustOpen(true)}
                >
                  Корректировка баланса
                </Button>
              )}

              {/* Premium grant / revoke (admin-only) */}
              {isAdmin &&
                (u.isPremium ? (
                  <ConfirmButton
                    variant="secondary"
                    disabled={busy}
                    loading={revokePremium.isPending}
                    confirmTitle="Снять премиум?"
                    confirmBody="Премиум-статус пользователя будет отозван."
                    confirmLabel="Снять премиум"
                    onConfirm={() => revokePremium.mutate()}
                  >
                    Снять премиум
                  </ConfirmButton>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => setPremiumOpen(true)}
                  >
                    Выдать премиум
                  </Button>
                ))}

              {/* Delete account (admin-only, danger) */}
              {isAdmin && (
                <ConfirmButton
                  variant="danger"
                  disabled={busy || del.isPending}
                  loading={del.isPending}
                  confirmTitle="Удалить аккаунт?"
                  confirmBody="Аккаунт будет анонимизирован (email/ник/профиль очищены), забанен, а все сессии удалены. Действие необратимо."
                  confirmLabel="Удалить аккаунт"
                  onConfirm={() => del.mutate()}
                >
                  Удалить аккаунт
                </ConfirmButton>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Ban-with-reason modal */}
      <BanModal
        open={banOpen}
        onClose={() => setBanOpen(false)}
        userId={userId}
        onDone={() => {
          setBanOpen(false);
          refresh();
        }}
        onError={(m) => setError(m)}
      />

      {/* Balance adjust modal (admin-only) */}
      {isAdmin && (
        <AdjustModal
          open={adjustOpen}
          onClose={() => setAdjustOpen(false)}
          userId={userId}
          onDone={() => {
            setAdjustOpen(false);
            refresh();
          }}
        />
      )}

      {/* Grant-premium modal (admin-only) */}
      {isAdmin && (
        <GrantPremiumModal
          open={premiumOpen}
          onClose={() => setPremiumOpen(false)}
          userId={userId}
          onDone={() => {
            setPremiumOpen(false);
            refresh();
          }}
        />
      )}
    </Drawer>
  );
}

/** A labelled definition row in the dossier. */
function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

/* ───────────────────────────────── Modals ────────────────────────────────── */

/** Ban a user with an optional free-text reason. */
function BanModal({
  open,
  onClose,
  userId,
  onDone,
  onError,
}: {
  open: boolean;
  onClose: () => void;
  userId: string;
  onDone: () => void;
  onError: (msg: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const ban = useMutation({
    mutationFn: () => adminApi.banUser(userId, reason.trim() || undefined),
    onSuccess: () => {
      setReason('');
      onDone();
    },
    onError: (e) => {
      const m = errMessage(e, 'Не удалось забанить');
      setLocalError(m);
      onError(m);
    },
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Забанить пользователя"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Отмена
          </Button>
          <Button
            variant="danger"
            size="sm"
            loading={ban.isPending}
            onClick={() => {
              setLocalError(null);
              ban.mutate();
            }}
          >
            Забанить
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-muted-foreground">
        Бан блокирует вход, отзывает все сессии и сбрасывает живые соединения. Причина опциональна.
      </p>
      <Input
        placeholder="Причина (опционально)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      {localError && <p className="mt-2 text-sm text-danger">{localError}</p>}
    </Modal>
  );
}

/** Manual signed wallet adjustment (admin-only). */
function AdjustModal({
  open,
  onClose,
  userId,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  userId: string;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const adjust = useMutation({
    mutationFn: () =>
      adminApi.wallet.adjust(userId, { amount: Number(amount), reason: reason.trim() }),
    onSuccess: () => {
      setAmount('');
      setReason('');
      onDone();
    },
    onError: (e) => setError(errMessage(e, 'Не удалось применить')),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Корректировка баланса"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Отмена
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={adjust.isPending}
            disabled={!amount || Number(amount) === 0 || !reason.trim()}
            onClick={() => {
              setError(null);
              adjust.mutate();
            }}
          >
            Применить
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-muted-foreground">
        Положительная сумма — начисление, отрицательная — списание. Операция фиксируется в ауд-логе.
      </p>
      <div className="flex flex-col gap-3">
        <Input
          type="number"
          placeholder="Сумма (± монеты)"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <Input placeholder="Причина" value={reason} onChange={(e) => setReason(e.target.value)} />
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    </Modal>
  );
}

/** Grant comp premium for N days (admin-only). */
function GrantPremiumModal({
  open,
  onClose,
  userId,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  userId: string;
  onDone: () => void;
}) {
  const [days, setDays] = useState('30');
  const [error, setError] = useState<string | null>(null);

  const grant = useMutation({
    mutationFn: () => adminApi.premium.grant(userId, { days: Number(days) }),
    onSuccess: onDone,
    onError: (e) => setError(errMessage(e, 'Не удалось выдать премиум')),
  });

  const n = Number(days);
  const valid = Number.isInteger(n) && n >= 1 && n <= 3650;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Выдать премиум"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Отмена
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={grant.isPending}
            disabled={!valid}
            onClick={() => {
              setError(null);
              grant.mutate();
            }}
          >
            Выдать
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-muted-foreground">
        Комплиментарный премиум на указанное число дней (1–3650). Операция фиксируется в ауд-логе.
      </p>
      <Input
        type="number"
        placeholder="Дней"
        value={days}
        onChange={(e) => setDays(e.target.value)}
      />
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </Modal>
  );
}
