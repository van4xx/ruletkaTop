import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@ruletka/ui';
import type { Block, Report, ReportReason, ReviewItem } from '@ruletka/shared-types';

import { adminApi } from '../lib/api';
import {
  Badge,
  type BadgeVariant,
  Card,
  type Column,
  ConfirmButton,
  DataTable,
  EmptyState,
  Modal,
  PageHeader,
  Pagination,
  RelativeTime,
  Tabs,
} from '../components/kit';

/* ════════════════════════════════════════════════════════════════════════════
 * Local authenticated request helper.
 *
 * The admin client's generic `req` (token + 401→refresh→retry) lives PRIVATE in
 * `lib/api.ts`, and several moderation endpoints have no `adminApi.*` method
 * (reports, blocks, the new ban-lists). Rather than widen the shared client, we
 * mirror its minimal contract here for the missing routes only: attach the
 * in-memory access token, and on a 401 mint a fresh one from the httpOnly
 * refresh cookie (`POST /auth/refresh`, path-scoped to `/auth/*`, sent with
 * credentials) — exactly the pattern `lib/api.ts` uses. The app is already
 * authenticated by the time this page mounts, so the cookie is present; the
 * server's refresh-rotation grace keeps this side-loop from dropping the session.
 * ════════════════════════════════════════════════════════════════════════════ */

const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:4000/api';

/** Independent access-token cache for this page's raw calls. */
let modToken: string | null = null;
let modRefreshing: Promise<boolean> | null = null;

async function modRefresh(): Promise<boolean> {
  if (!modRefreshing) {
    modRefreshing = (async () => {
      try {
        const res = await fetch(`${API_BASE.replace(/\/$/, '')}/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
        });
        if (!res.ok) return false;
        const body = (await res.json()) as { tokens?: { accessToken?: string } };
        modToken = body.tokens?.accessToken ?? null;
        return Boolean(modToken);
      } catch {
        return false;
      } finally {
        modRefreshing = null;
      }
    })();
  }
  return modRefreshing;
}

interface ModReqOpts {
  method?: string;
  query?: Record<string, string | undefined>;
  _retry?: boolean;
}

async function modReq<T>(path: string, opts: ModReqOpts = {}): Promise<T> {
  const url = new URL(path.replace(/^\//, ''), `${API_BASE.replace(/\/$/, '')}/`);
  if (opts.query)
    for (const [k, v] of Object.entries(opts.query)) if (v != null) url.searchParams.set(k, v);

  // Prime the token from the cookie on the very first call (no Bearer yet).
  if (!modToken && !opts._retry) await modRefresh();

  const headers: Record<string, string> = {};
  if (modToken) headers.authorization = `Bearer ${modToken}`;

  const res = await fetch(url, { method: opts.method ?? 'GET', headers, credentials: 'include' });
  if (res.status === 401 && !opts._retry && (await modRefresh())) {
    return modReq<T>(path, { ...opts, _retry: true });
  }
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      const b = (await res.json()) as { message?: string | string[] };
      msg = Array.isArray(b.message) ? b.message.join(', ') : (b.message ?? msg);
    } catch {
      /* ignore */
    }
    throw new ModError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

class ModError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Friendly message for a failed query/mutation (403 → permissions hint). */
function errText(err: unknown, fallback: string): string {
  if (err instanceof ModError && err.status === 403) {
    return 'Недостаточно прав для этого действия.';
  }
  return err instanceof Error && err.message ? err.message : fallback;
}

/* ─────────────────────────── shared cursor-page shape ─────────────────────── */
interface Page<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

interface BannedUserRow {
  id: string;
  email: string;
  nickname: string;
  bannedAt: string | null;
  reason: string | null;
  createdAt: string;
}

interface BannedFingerprintRow {
  id: string;
  fingerprint: string;
  userId: string;
  expiresAt: string | null;
  createdAt: string | null;
}

/* ─────────────────────────────── small helpers ────────────────────────────── */
const shortId = (id: string) => (id.length > 10 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id);

/** A compact monospace id chip with the full id on hover. */
function IdChip({ value }: { value: string }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  return (
    <code title={value} className="rounded bg-glass px-1.5 py-0.5 text-xs text-muted-foreground">
      {shortId(value)}
    </code>
  );
}

/* ════════════════════════════════ Root page ═══════════════════════════════ */
const TABS = [
  { key: 'reports', label: 'Репорты' },
  { key: 'review', label: 'AI-ревью' },
  { key: 'bans', label: 'Баны' },
  { key: 'fingerprints', label: 'Fingerprint-баны' },
  { key: 'blocks', label: 'Блокировки' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

/** Moderation console — reports triage, AI-review queue, bans & blocks. */
export function Moderation() {
  const [tab, setTab] = useState<TabKey>('reports');
  return (
    <div>
      <PageHeader
        title="Модерация"
        subtitle="Жалобы, AI-флаги и санкции — единая консоль модерации."
      />
      <Tabs items={TABS as unknown as { key: string; label: ReactNode }[]} value={tab} onChange={(k) => setTab(k as TabKey)} />
      {tab === 'reports' && <ReportsTab />}
      {tab === 'review' && <ReviewTab />}
      {tab === 'bans' && <BansTab />}
      {tab === 'fingerprints' && <FingerprintsTab />}
      {tab === 'blocks' && <BlocksTab />}
    </div>
  );
}

/* ═══════════════════════════════ Репорты ══════════════════════════════════ */
const REPORT_STATUS_FILTERS = [
  { key: 'open', label: 'Новые' },
  { key: 'reviewing', label: 'На проверке' },
  { key: 'resolved', label: 'Подтверждённые' },
  { key: 'dismissed', label: 'Отклонённые' },
] as const;

const REASON_LABEL: Record<ReportReason, string> = {
  nudity: 'Нагота',
  harassment: 'Харассмент',
  minor: 'Несовершеннолетний',
  violence: 'Насилие',
  spam: 'Спам',
  scam: 'Мошенничество',
  other: 'Другое',
};

const REASON_VARIANT: Record<ReportReason, BadgeVariant> = {
  nudity: 'warning',
  harassment: 'warning',
  minor: 'danger',
  violence: 'danger',
  spam: 'muted',
  scam: 'warning',
  other: 'muted',
};

const STATUS_BADGE: Record<string, { label: string; variant: BadgeVariant }> = {
  open: { label: 'Новый', variant: 'info' },
  reviewing: { label: 'На проверке', variant: 'accent' },
  resolved: { label: 'Подтверждён', variant: 'success' },
  dismissed: { label: 'Отклонён', variant: 'muted' },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_BADGE[status] ?? { label: status, variant: 'muted' as BadgeVariant };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

function ReportsTab() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<(typeof REPORT_STATUS_FILTERS)[number]['key']>('open');
  const [items, setItems] = useState<Report[]>([]);

  const q = useQuery({
    queryKey: ['mod-reports', status],
    queryFn: async () => {
      const page = await modReq<Page<Report>>('/reports', { query: { status } });
      setItems(page.items);
      return page;
    },
  });

  const loadMore = useMutation({
    mutationFn: () =>
      modReq<Page<Report>>('/reports', { query: { status, cursor: q.data?.nextCursor ?? undefined } }),
    onSuccess: (page) => {
      setItems((prev) => [...prev, ...page.items]);
      qc.setQueryData(['mod-reports', status], page);
    },
  });

  const resolveReport = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'resolved' | 'dismissed' }) =>
      modReqJson<Report>(`/reports/${id}/resolve`, { status: decision }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mod-reports'] }),
  });

  const columns: Column<Report>[] = [
    {
      key: 'reason',
      header: 'Причина',
      render: (r) => <Badge variant={REASON_VARIANT[r.reason]}>{REASON_LABEL[r.reason]}</Badge>,
    },
    {
      key: 'against',
      header: 'На пользователя',
      render: (r) => <IdChip value={r.againstUserId} />,
    },
    {
      key: 'from',
      header: 'От',
      render: (r) => <IdChip value={r.fromUserId} />,
    },
    {
      key: 'details',
      header: 'Детали',
      render: (r) =>
        r.details ? (
          <span className="line-clamp-2 max-w-xs text-muted-foreground" title={r.details}>
            {r.details}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    { key: 'status', header: 'Статус', render: (r) => <StatusBadge status={r.status} /> },
    {
      key: 'when',
      header: 'Когда',
      render: (r) => <RelativeTime iso={r.createdAt} />,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) =>
        r.status === 'open' || r.status === 'reviewing' ? (
          <div className="flex justify-end gap-2">
            <ConfirmButton
              variant="danger"
              size="sm"
              confirmTitle="Подтвердить жалобу"
              confirmBody="Жалоба будет помечена как подтверждённая. Санкции к пользователю применяются отдельно во вкладке «Баны»."
              confirmLabel="Подтвердить"
              loading={resolveReport.isPending}
              onConfirm={() => resolveReport.mutate({ id: r.id, decision: 'resolved' })}
            >
              Подтвердить
            </ConfirmButton>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => resolveReport.mutate({ id: r.id, decision: 'dismissed' })}
            >
              Отклонить
            </Button>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
  ];

  return (
    <div>
      <Tabs
        items={REPORT_STATUS_FILTERS as unknown as { key: string; label: ReactNode }[]}
        value={status}
        onChange={(k) => setStatus(k as typeof status)}
      />
      <DataTable
        columns={columns}
        rows={items}
        rowKey={(r) => r.id}
        loading={q.isLoading}
        error={q.isError ? errText(q.error, 'Не удалось загрузить жалобы.') : undefined}
        empty={<EmptyState title="Жалоб нет" description="В этой категории пока пусто." />}
        footer={
          q.data && items.length > 0 ? (
            <Pagination
              hasMore={Boolean(q.data.nextCursor)}
              loading={loadMore.isPending}
              loadedCount={items.length}
              onLoadMore={() => loadMore.mutate()}
            />
          ) : undefined
        }
      />
    </div>
  );
}

/* ════════════════════════════════ AI-ревью ════════════════════════════════ */
const REVIEW_STATUS_FILTERS = [
  { key: 'open', label: 'Новые' },
  { key: 'reviewing', label: 'На проверке' },
  { key: 'resolved', label: 'Подтверждённые' },
  { key: 'dismissed', label: 'Отклонённые' },
] as const;

const LABEL_VARIANT: Record<string, BadgeVariant> = {
  minor: 'danger',
  violence: 'danger',
  nudity: 'warning',
  sexual: 'warning',
  other: 'muted',
  safe: 'success',
};

const AUTO_ACTION_LABEL: Record<string, string> = {
  none: 'нет',
  blur: 'блюр',
  warn: 'предупреждение',
  kick: 'кик',
  ban: 'бан',
};

function ReviewTab() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<(typeof REVIEW_STATUS_FILTERS)[number]['key']>('open');
  const [preview, setPreview] = useState<ReviewItem | null>(null);

  const q = useQuery({
    queryKey: ['mod-review', status],
    queryFn: () => adminApi.reviewQueue(status),
  });

  const resolve = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'resolved' | 'dismissed' }) =>
      adminApi.resolveReview(id, decision),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mod-review'] }),
  });

  // "Бан" = uphold the flag AND ban the flagged account (two auditable calls).
  const banAndResolve = useMutation({
    mutationFn: async (item: ReviewItem) => {
      await adminApi.banUser(item.userId, `AI-флаг: ${item.label}`);
      return adminApi.resolveReview(item.id, 'resolved');
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mod-review'] }),
  });

  const active = status === 'open' || status === 'reviewing';
  const items = q.data?.items ?? [];

  return (
    <div>
      <Tabs
        items={REVIEW_STATUS_FILTERS as unknown as { key: string; label: ReactNode }[]}
        value={status}
        onChange={(k) => setStatus(k as typeof status)}
      />

      {q.isLoading ? (
        <Card>
          <div className="grid place-items-center py-12">
            <span className="text-sm text-muted-foreground">Загрузка…</span>
          </div>
        </Card>
      ) : q.isError ? (
        <Card>
          <p className="py-8 text-center text-sm text-danger">
            {errText(q.error, 'Не удалось загрузить очередь.')}
          </p>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState title="Очередь пуста" description="Нет флагов для проверки." />
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex flex-col gap-3 glass-strong rounded-2xl p-4 ring-1 ring-border/50"
            >
              <div className="flex items-center justify-between">
                <Badge variant={LABEL_VARIANT[item.label] ?? 'warning'}>{item.label}</Badge>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {(item.score * 100).toFixed(0)}%
                </span>
              </div>

              {item.evidenceUrl ? (
                <button
                  type="button"
                  onClick={() => setPreview(item)}
                  className="group relative overflow-hidden rounded-lg"
                  title="Показать кадр"
                >
                  <img
                    src={item.evidenceUrl}
                    alt=""
                    className="aspect-video w-full object-cover opacity-90 blur-md transition group-hover:blur-0"
                  />
                </button>
              ) : (
                <div className="grid aspect-video w-full place-items-center rounded-lg bg-glass text-xs text-muted-foreground">
                  нет кадра
                </div>
              )}

              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <IdChip value={item.userId} />
                <span title="Автодействие политики">авто: {AUTO_ACTION_LABEL[item.autoAction] ?? item.autoAction}</span>
              </div>
              <RelativeTime iso={item.createdAt} />

              {active ? (
                <div className="mt-1 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => resolve.mutate({ id: item.id, decision: 'dismissed' })}
                  >
                    Одобрить
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={resolve.isPending}
                    onClick={() => resolve.mutate({ id: item.id, decision: 'resolved' })}
                  >
                    Подтвердить
                  </Button>
                  <ConfirmButton
                    variant="danger"
                    size="sm"
                    confirmTitle="Забанить пользователя"
                    confirmBody={
                      <>
                        Аккаунт <code>{shortId(item.userId)}</code> будет забанен (сессии
                        отозваны, сокеты отключены), а флаг — подтверждён. Действие можно отменить
                        разбаном во вкладке «Баны».
                      </>
                    }
                    confirmLabel="Забанить"
                    loading={banAndResolve.isPending}
                    onConfirm={() => banAndResolve.mutate(item)}
                  >
                    Бан
                  </ConfirmButton>
                </div>
              ) : (
                <StatusBadge status={item.status} />
              )}
            </div>
          ))}
        </div>
      )}

      <Modal
        open={preview !== null}
        onClose={() => setPreview(null)}
        title="Кадр-улика"
        maxWidth="max-w-2xl"
      >
        {preview?.evidenceUrl ? (
          <img src={preview.evidenceUrl} alt="" className="w-full rounded-lg" />
        ) : (
          <p className="text-sm text-muted-foreground">Кадр недоступен.</p>
        )}
      </Modal>
    </div>
  );
}

/* ══════════════════════════════════ Баны ══════════════════════════════════ */
function BansTab() {
  const qc = useQueryClient();
  const [items, setItems] = useState<BannedUserRow[]>([]);

  const q = useQuery({
    queryKey: ['mod-banned-users'],
    queryFn: async () => {
      const page = await modReq<Page<BannedUserRow>>('/admin/banned-users');
      setItems(page.items);
      return page;
    },
  });

  const loadMore = useMutation({
    mutationFn: () =>
      modReq<Page<BannedUserRow>>('/admin/banned-users', {
        query: { cursor: q.data?.nextCursor ?? undefined },
      }),
    onSuccess: (page) => {
      setItems((prev) => [...prev, ...page.items]);
      qc.setQueryData(['mod-banned-users'], page);
    },
  });

  const unban = useMutation({
    mutationFn: (id: string) => adminApi.unbanUser(id),
    onSuccess: (_res, id) => {
      setItems((prev) => prev.filter((u) => u.id !== id));
      qc.invalidateQueries({ queryKey: ['mod-banned-users'] });
    },
  });

  const columns: Column<BannedUserRow>[] = [
    {
      key: 'user',
      header: 'Пользователь',
      render: (u) => (
        <div className="flex flex-col">
          <span className="font-medium">{u.nickname || '—'}</span>
          <span className="text-xs text-muted-foreground">{u.email}</span>
        </div>
      ),
    },
    { key: 'id', header: 'ID', render: (u) => <IdChip value={u.id} /> },
    {
      key: 'reason',
      header: 'Причина',
      render: (u) =>
        u.reason ? <span>{u.reason}</span> : <span className="text-muted-foreground">—</span>,
    },
    {
      key: 'when',
      header: 'Забанен',
      render: (u) =>
        u.bannedAt ? <RelativeTime iso={u.bannedAt} /> : <span className="text-muted-foreground">—</span>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (u) => (
        <ConfirmButton
          variant="secondary"
          size="sm"
          confirmTitle="Разбанить пользователя"
          confirmBody={
            <>
              Снять бан с <code>{u.nickname || u.email}</code>? Сессии не восстанавливаются —
              пользователь сможет войти заново.
            </>
          }
          confirmLabel="Разбанить"
          loading={unban.isPending}
          onConfirm={() => unban.mutate(u.id)}
        >
          Разбанить
        </ConfirmButton>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={items}
      rowKey={(u) => u.id}
      loading={q.isLoading}
      error={q.isError ? errText(q.error, 'Не удалось загрузить список банов.') : undefined}
      empty={<EmptyState title="Забаненных нет" description="Ни один аккаунт сейчас не забанен." />}
      footer={
        q.data && items.length > 0 ? (
          <Pagination
            hasMore={Boolean(q.data.nextCursor)}
            loading={loadMore.isPending}
            loadedCount={items.length}
            onLoadMore={() => loadMore.mutate()}
          />
        ) : undefined
      }
    />
  );
}

/* ═══════════════════════════ Fingerprint-баны ═════════════════════════════ */
function FingerprintsTab() {
  const qc = useQueryClient();
  const [items, setItems] = useState<BannedFingerprintRow[]>([]);

  const q = useQuery({
    queryKey: ['mod-fingerprints'],
    queryFn: async () => {
      const page = await modReq<Page<BannedFingerprintRow>>('/admin/banned-fingerprints');
      setItems(page.items);
      return page;
    },
  });

  const loadMore = useMutation({
    mutationFn: () =>
      modReq<Page<BannedFingerprintRow>>('/admin/banned-fingerprints', {
        query: { cursor: q.data?.nextCursor ?? undefined },
      }),
    onSuccess: (page) => {
      setItems((prev) => [...prev, ...page.items]);
      qc.setQueryData(['mod-fingerprints'], page);
    },
  });

  const lift = useMutation({
    mutationFn: (id: string) =>
      modReq<{ id: string; deleted: true }>(`/admin/banned-fingerprints/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: (_res, id) => {
      setItems((prev) => prev.filter((f) => f.id !== id));
      qc.invalidateQueries({ queryKey: ['mod-fingerprints'] });
    },
  });

  const columns: Column<BannedFingerprintRow>[] = [
    {
      key: 'fp',
      header: 'Отпечаток',
      render: (f) => (
        <code title={f.fingerprint} className="text-xs text-muted-foreground">
          {f.fingerprint ? `${f.fingerprint.slice(0, 16)}…` : '—'}
        </code>
      ),
    },
    { key: 'user', header: 'Аккаунт', render: (f) => <IdChip value={f.userId} /> },
    {
      key: 'expires',
      header: 'Истекает',
      render: (f) =>
        f.expiresAt ? (
          <RelativeTime iso={f.expiresAt} />
        ) : (
          <Badge variant="muted">бессрочно</Badge>
        ),
    },
    {
      key: 'created',
      header: 'Создан',
      render: (f) =>
        f.createdAt ? <RelativeTime iso={f.createdAt} /> : <span className="text-muted-foreground">—</span>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (f) => (
        <ConfirmButton
          variant="secondary"
          size="sm"
          confirmTitle="Снять fingerprint-бан"
          confirmBody="Строка отпечатка будет удалена — устройство/сеть сможет снова регистрироваться. Только для администратора."
          confirmLabel="Снять"
          loading={lift.isPending}
          onConfirm={() => lift.mutate(f.id)}
        >
          Снять
        </ConfirmButton>
      ),
    },
  ];

  return (
    <div>
      <p className="mb-3 text-xs text-muted-foreground">
        Гейт по IP+User-Agent отключён по умолчанию (FINGERPRINT_BAN_ENABLED), но строки
        сохраняются. Снятие доступно только администратору.
      </p>
      <DataTable
        columns={columns}
        rows={items}
        rowKey={(f) => f.id}
        loading={q.isLoading}
        error={q.isError ? errText(q.error, 'Не удалось загрузить fingerprint-баны.') : undefined}
        empty={<EmptyState title="Отпечатков нет" description="Нет записей о ban-evasion." />}
        footer={
          q.data && items.length > 0 ? (
            <Pagination
              hasMore={Boolean(q.data.nextCursor)}
              loading={loadMore.isPending}
              loadedCount={items.length}
              onLoadMore={() => loadMore.mutate()}
            />
          ) : undefined
        }
      />
    </div>
  );
}

/* ═══════════════════════════════ Блокировки ═══════════════════════════════ */
function BlocksTab() {
  const q = useQuery({
    queryKey: ['mod-blocks'],
    queryFn: () => modReq<Block[]>('/blocks'),
  });

  const columns: Column<Block>[] = [
    { key: 'owner', header: 'Кто заблокировал', render: (b) => <IdChip value={b.userId} /> },
    { key: 'blocked', header: 'Кого', render: (b) => <IdChip value={b.blockedUserId} /> },
    { key: 'when', header: 'Когда', render: (b) => <RelativeTime iso={b.createdAt} /> },
  ];

  return (
    <div>
      <p className="mb-3 text-xs text-muted-foreground">
        Блокировки, созданные текущим аккаунтом модератора. Пользователи управляют своими
        блокировками сами.
      </p>
      <DataTable
        columns={columns}
        rows={q.data ?? []}
        rowKey={(b) => b.id}
        loading={q.isLoading}
        error={q.isError ? errText(q.error, 'Не удалось загрузить блокировки.') : undefined}
        empty={<EmptyState title="Блокировок нет" description="Список пуст." />}
      />
    </div>
  );
}

/* ──────────────────────── JSON-body variant of modReq ──────────────────────── */
/** POST/PATCH with a JSON body (the GET-focused `modReq` has no body slot). */
async function modReqJson<T>(path: string, json: unknown, method = 'POST'): Promise<T> {
  const base = API_BASE.replace(/\/$/, '');
  const doFetch = async (): Promise<Response> => {
    if (!modToken) await modRefresh();
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (modToken) headers.authorization = `Bearer ${modToken}`;
    return fetch(`${base}/${path.replace(/^\//, '')}`, {
      method,
      headers,
      credentials: 'include',
      body: JSON.stringify(json),
    });
  };
  let res = await doFetch();
  if (res.status === 401 && (await modRefresh())) res = await doFetch();
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      const b = (await res.json()) as { message?: string | string[] };
      msg = Array.isArray(b.message) ? b.message.join(', ') : (b.message ?? msg);
    } catch {
      /* ignore */
    }
    throw new ModError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
