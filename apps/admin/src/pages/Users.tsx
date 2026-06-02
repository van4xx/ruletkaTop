import { useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Avatar, Badge, Button, Input, Spinner, codeToFlag } from '@ruletka/ui';
import type { AdminUserList, AdminUserSummary, Role } from '@ruletka/shared-types';

import { adminApi, AdminApiError } from '../lib/api';
import { PageTitle } from './ui';

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

type BannedFilter = 'all' | 'banned' | 'active';

/** Debounce a value by `ms`. */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const PAGE = 30;

/**
 * Users directory — searchable, filterable, cursor-paginated table with per-row
 * enforcement (ban/unban) and an admin-only role control. Mutations patch the
 * cached pages in-place for snappy feedback, then invalidate to reconcile.
 */
export function Users({ role: viewerRole }: { role: Role }) {
  const qc = useQueryClient();
  const isAdmin = viewerRole === 'admin';

  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim(), 350);
  const [roleFilter, setRoleFilter] = useState<'' | Role>('');
  const [banned, setBanned] = useState<BannedFilter>('all');
  const [actingId, setActingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  /** Patch a single user across every cached page (used after mutations). */
  function patchRow(id: string, patch: Partial<AdminUserSummary>) {
    qc.setQueryData<{ pages: AdminUserList[]; pageParams: unknown[] }>(queryKey, (old) =>
      old
        ? {
            ...old,
            pages: old.pages.map((pg) => ({
              ...pg,
              items: pg.items.map((it) => (it.id === id ? { ...it, ...patch } : it)),
            })),
          }
        : old,
    );
  }

  const ban = useMutation({
    mutationFn: (u: AdminUserSummary) => adminApi.banUser(u.id),
    onMutate: (u) => {
      setActingId(u.id);
      setError(null);
    },
    onSuccess: (_d, u) => patchRow(u.id, { isBanned: true }),
    onError: (e) =>
      setError(
        e instanceof AdminApiError ? `Не удалось забанить: ${e.message}` : 'Не удалось забанить',
      ),
    onSettled: () => {
      setActingId(null);
      qc.invalidateQueries({ queryKey: ['users'] });
    },
  });

  const unban = useMutation({
    mutationFn: (u: AdminUserSummary) => adminApi.unbanUser(u.id),
    onMutate: (u) => {
      setActingId(u.id);
      setError(null);
    },
    onSuccess: (_d, u) => patchRow(u.id, { isBanned: false }),
    onError: (e) =>
      setError(
        e instanceof AdminApiError ? `Не удалось разбанить: ${e.message}` : 'Не удалось разбанить',
      ),
    onSettled: () => {
      setActingId(null);
      qc.invalidateQueries({ queryKey: ['users'] });
    },
  });

  const changeRole = useMutation({
    mutationFn: ({ u, role }: { u: AdminUserSummary; role: Role }) => adminApi.setRole(u.id, role),
    onMutate: ({ u }) => {
      setActingId(u.id);
      setError(null);
    },
    onSuccess: (updated) => patchRow(updated.id, { role: updated.role }),
    onError: (e) =>
      setError(
        e instanceof AdminApiError
          ? `Не удалось сменить роль: ${e.message}`
          : 'Не удалось сменить роль',
      ),
    onSettled: () => {
      setActingId(null);
      qc.invalidateQueries({ queryKey: ['users'] });
    },
  });

  const selectCls =
    'h-9 rounded-lg border border-border bg-background-elevated px-3 text-sm text-foreground outline-none transition-colors focus:border-accent';

  return (
    <div>
      <PageTitle title="Пользователи" subtitle="Поиск, фильтры, бан / разбан и роли." />

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="min-w-56 flex-1">
          <Input
            placeholder="Поиск по email или нику…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className={selectCls}
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value as '' | Role)}
        >
          <option value="">Все роли</option>
          {ROLES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        <select
          className={selectCls}
          value={banned}
          onChange={(e) => setBanned(e.target.value as BannedFilter)}
        >
          <option value="all">Все статусы</option>
          <option value="active">Активные</option>
          <option value="banned">Забаненные</option>
        </select>
      </div>

      {error && (
        <p className="mb-4 rounded-xl glass-strong p-3 text-sm text-danger ring-1 ring-danger/30">
          {error}
        </p>
      )}

      {/* Table */}
      <div className="glass-strong overflow-hidden rounded-2xl ring-1 ring-border/50">
        {list.isLoading ? (
          <div className="grid place-items-center py-16">
            <Spinner />
          </div>
        ) : list.isError ? (
          <p className="p-8 text-center text-sm text-danger">
            Не удалось загрузить список пользователей.
          </p>
        ) : rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">Никого не найдено.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Пользователь</th>
                  <th className="px-4 py-3 font-medium">Роль</th>
                  <th className="px-4 py-3 font-medium">Статусы</th>
                  <th className="px-4 py-3 text-right font-medium">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {rows.map((u) => {
                  const busy = actingId === u.id;
                  return (
                    <tr key={u.id} className="transition-colors hover:bg-glass/40">
                      {/* Identity */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar size="sm" alt={u.nickname} />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate font-medium text-foreground">
                                {u.nickname}
                              </span>
                              {u.country && <span title={u.country}>{codeToFlag(u.country)}</span>}
                            </div>
                            <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                          </div>
                        </div>
                      </td>

                      {/* Role */}
                      <td className="px-4 py-3">
                        {isAdmin ? (
                          <select
                            className={selectCls}
                            value={u.role}
                            disabled={busy}
                            onChange={(e) => {
                              const role = e.target.value as Role;
                              if (role !== u.role) changeRole.mutate({ u, role });
                            }}
                          >
                            {ROLES.map((r) => (
                              <option key={r.value} value={r.value}>
                                {r.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <Badge
                            variant={
                              u.role === 'admin'
                                ? 'aurora'
                                : u.role === 'moderator'
                                  ? 'accent'
                                  : 'neutral'
                            }
                            size="sm"
                          >
                            {ROLE_LABEL[u.role]}
                          </Badge>
                        )}
                      </td>

                      {/* Badges */}
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1.5">
                          {u.isPremium && (
                            <Badge variant="coin" size="sm">
                              Premium
                            </Badge>
                          )}
                          {u.emailVerified ? (
                            <Badge variant="success" size="sm">
                              Verified
                            </Badge>
                          ) : (
                            <Badge variant="outline" size="sm">
                              Не подтв.
                            </Badge>
                          )}
                          {u.isBanned && (
                            <Badge variant="danger" size="sm">
                              Бан
                            </Badge>
                          )}
                        </div>
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          {u.isBanned ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              loading={busy && unban.isPending}
                              disabled={busy}
                              onClick={() => unban.mutate(u)}
                            >
                              Разбанить
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="danger"
                              loading={busy && ban.isPending}
                              disabled={busy}
                              onClick={() => ban.mutate(u)}
                            >
                              Забанить
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {list.hasNextPage && (
        <div className="mt-4 flex justify-center">
          <Button
            variant="ghost"
            loading={list.isFetchingNextPage}
            onClick={() => list.fetchNextPage()}
          >
            Показать ещё
          </Button>
        </div>
      )}
      {!list.isLoading && !list.isError && rows.length > 0 && (
        <p className="mt-3 text-center text-xs text-muted-foreground">Загружено {rows.length}</p>
      )}
    </div>
  );
}
