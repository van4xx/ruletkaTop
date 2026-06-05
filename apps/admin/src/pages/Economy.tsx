import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input } from '@ruletka/ui';
import type { AuthUser } from '@ruletka/shared-types';

import { adminApi, AdminApiError, req } from '../lib/api';
import {
  Badge,
  type BadgeVariant,
  Coins,
  type Column,
  ConfirmButton,
  DataTable,
  EmptyState,
  MetricCard,
  Modal,
  Money,
  PageHeader,
  RelativeTime,
  Select,
  Tabs,
  Toolbar,
  fmtInt,
} from '../components/kit';

/* ════════════════════════════════════ Types ═════════════════════════════════
 * The economy CRUD endpoints are NOT in `@ruletka/shared-types` (they're local
 * to `admin-economy.controller`), so the row/DTO shapes are mirrored here. They
 * track `apps/api/src/modules/moderation/admin-economy.service.ts` 1:1.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Gift rarities (mirrors `raritySchema`). */
type Rarity = 'common' | 'rare' | 'epic' | 'legendary';
const RARITIES: readonly Rarity[] = ['common', 'rare', 'epic', 'legendary'];

/** A public `code` slug, as the backend validates it (2–49 chars). */
const CODE_RE = /^[a-z0-9][a-z0-9_-]{1,48}$/i;

interface CoinPackageRow {
  id: string;
  code: string;
  coins: number;
  priceRub: number;
  bonusCoins: number;
  createdAt: string | null;
  updatedAt: string | null;
}

interface GiftRow {
  id: string;
  code: string;
  title: string;
  animationUrl: string;
  priceCoins: number;
  rarity: Rarity;
  isPremiumOnly: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

interface TopPlacementRow {
  id: string;
  userId: string;
  nickname: string;
  avatarUrl: string | null;
  lane: string;
  priority: number;
  coinsSpent: number;
  startsAt: string;
  expiresAt: string;
  active: boolean;
}

const RARITY_VARIANT: Record<Rarity, BadgeVariant> = {
  common: 'muted',
  rare: 'info',
  epic: 'accent',
  legendary: 'warning',
};

const RARITY_LABEL: Record<Rarity, string> = {
  common: 'Обычный',
  rare: 'Редкий',
  epic: 'Эпический',
  legendary: 'Легендарный',
};

/** Pull a human message out of an API error (with a friendly 403 line). */
function errMsg(e: unknown, fallback = 'Не удалось выполнить операцию'): string {
  if (e instanceof AdminApiError) {
    if (e.status === 403) return 'Недостаточно прав: это действие доступно только администратору.';
    return e.message || fallback;
  }
  return fallback;
}

/* ═══════════════════════════════════ Page ═══════════════════════════════════ */

type TabKey = 'overview' | 'packages' | 'gifts' | 'top';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'Обзор' },
  { key: 'packages', label: 'Пакеты монет' },
  { key: 'gifts', label: 'Подарки' },
  { key: 'top', label: 'Top' },
];

/**
 * Экономика — economy management console.
 *
 * Four tabs: an aggregate **Обзор** (population + coins/gifts/top metrics), then
 * full CRUD over the three REAL catalogue collections — **Пакеты монет**
 * (`coinpackages`), **Подарки** (`gifts`), and **Top** placements
 * (`topplacements`, list + takedown). Reads are moderator-visible; writes are
 * admin-only (buttons hidden for moderators, and the API re-checks → 403).
 *
 * The page learns the caller's role from `/auth/me` (the route mounts
 * `<Economy />` without a `role` prop), defaulting writes OFF until known.
 */
export function Economy() {
  const [tab, setTab] = useState<TabKey>('overview');

  // The route renders <Economy /> with no role prop, so resolve it here.
  const me = useQuery({ queryKey: ['me'], queryFn: () => req<AuthUser>('/auth/me') });
  const isAdmin = me.data?.role === 'admin';

  return (
    <div>
      <PageHeader title="Экономика" subtitle="Монеты, подарки, Top и население платформы." />
      <Tabs items={TABS} value={tab} onChange={(k) => setTab(k as TabKey)} />

      {tab === 'overview' && <OverviewTab />}
      {tab === 'packages' && <PackagesTab isAdmin={isAdmin} />}
      {tab === 'gifts' && <GiftsTab isAdmin={isAdmin} />}
      {tab === 'top' && <TopTab isAdmin={isAdmin} />}
    </div>
  );
}

/* ─────────────────────────────────── Обзор ─────────────────────────────────── */

/** Map a ledger `kind` to a readable label + badge tone. Unknown passes through. */
const KIND_META: Record<string, { label: string; variant: BadgeVariant }> = {
  topup: { label: 'Пополнение', variant: 'success' },
  purchase: { label: 'Покупка', variant: 'danger' },
  gift_sent: { label: 'Подарок отправлен', variant: 'danger' },
  gift_received: { label: 'Подарок получен', variant: 'success' },
  top_placement: { label: 'Размещение в Top', variant: 'accent' },
  premium: { label: 'Premium', variant: 'accent' },
  refund: { label: 'Возврат', variant: 'info' },
};

function OverviewTab() {
  const q = useQuery({ queryKey: ['economy-overview'], queryFn: () => adminApi.economyOverview() });
  const d = q.data;
  const loading = q.isLoading;

  if (q.isError) {
    return (
      <p className="rounded-2xl glass-strong p-8 text-center text-sm text-danger ring-1 ring-danger/30">
        Не удалось загрузить обзор экономики.
      </p>
    );
  }

  return (
    <div>
      <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Всего пользователей" value={d ? fmtInt(d.totalUsers) : '—'} loading={loading} />
        <MetricCard label="Premium" value={d ? fmtInt(d.premiumUsers) : '—'} loading={loading} accent />
        <MetricCard label="Верифицировано" value={d ? fmtInt(d.verifiedUsers) : '—'} loading={loading} />
        <MetricCard label="Забанено" value={d ? fmtInt(d.bannedUsers) : '—'} loading={loading} />
      </div>

      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Монет в обороте"
          value={d ? <Coins amount={d.coinsInCirculation} /> : '—'}
          loading={loading}
        />
        <MetricCard
          label="Стоимость подарков"
          value={d ? <Coins amount={d.giftsValueCoins} /> : '—'}
          loading={loading}
        />
        <MetricCard label="Активный Top" value={d ? fmtInt(d.activeTopPlacements) : '—'} loading={loading} />
        <MetricCard
          label="Новые пользователи"
          value={d ? fmtInt(d.newUsers24h) : '—'}
          hint={d ? `за 24ч · ${fmtInt(d.newUsers7d)} за 7д` : undefined}
          loading={loading}
        />
      </div>

      <section className="glass-strong overflow-hidden rounded-2xl ring-1 ring-border/50">
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <h2 className="font-display text-base font-semibold">Последние транзакции</h2>
          {d && <span className="text-xs text-muted-foreground">{d.recentTransactions.length} записей</span>}
        </div>

        {loading ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-9 animate-pulse rounded-lg bg-glass" />
            ))}
          </div>
        ) : !d || d.recentTransactions.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">Транзакций пока нет.</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {d.recentTransactions.map((t) => {
              const meta = KIND_META[t.kind] ?? { label: t.kind, variant: 'muted' as BadgeVariant };
              const positive = t.amountCoins >= 0;
              return (
                <li key={t.id} className="flex items-center gap-3 px-5 py-3">
                  <Badge variant={meta.variant}>{meta.label}</Badge>
                  <span className="truncate font-mono text-xs text-muted-foreground" title={t.userId}>
                    {t.userId}
                  </span>
                  <span
                    className={`ml-auto shrink-0 text-sm font-semibold tabular-nums ${positive ? 'text-success' : 'text-danger'}`}
                  >
                    {positive ? '+' : ''}
                    {fmtInt(t.amountCoins)}
                  </span>
                  <span className="w-24 shrink-0 text-right">
                    <RelativeTime iso={t.createdAt} />
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

/* ─────────────────────────────── Пакеты монет ──────────────────────────────── */

function PackagesTab({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['economy-coin-packages'],
    queryFn: () => req<CoinPackageRow[]>('/admin/economy/coin-packages'),
  });
  const [editing, setEditing] = useState<CoinPackageRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['economy-coin-packages'] });

  const del = useMutation({
    mutationFn: (id: string) =>
      req<{ id: string }>(`/admin/economy/coin-packages/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
    onError: (e) => setActionError(errMsg(e, 'Не удалось удалить пакет')),
  });

  const columns: Column<CoinPackageRow>[] = [
    { key: 'code', header: 'Код', render: (r) => <span className="font-mono text-xs">{r.code}</span> },
    { key: 'coins', header: 'Монеты', align: 'right', render: (r) => <Coins amount={r.coins} /> },
    {
      key: 'bonus',
      header: 'Бонус',
      align: 'right',
      render: (r) =>
        r.bonusCoins > 0 ? (
          <span className="text-success">+{fmtInt(r.bonusCoins)}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    { key: 'price', header: 'Цена', align: 'right', render: (r) => <Money amount={r.priceRub} /> },
    {
      key: 'total',
      header: 'Всего монет',
      align: 'right',
      render: (r) => (
        <span className="font-semibold">
          <Coins amount={r.coins + r.bonusCoins} />
        </span>
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
              confirmTitle="Удалить пакет?"
              confirmBody={`Пакет «${r.code}» будет удалён. Покупатели смогут выбрать его только до удаления.`}
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
              Создать пакет
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
        error={q.isError ? 'Не удалось загрузить пакеты монет.' : undefined}
        empty={
          <EmptyState
            title="Пакетов нет"
            description={isAdmin ? 'Создайте первый пакет монет.' : 'Каталог пуст.'}
          />
        }
      />

      {(creating || editing) && (
        <CoinPackageModal
          pkg={editing}
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

/** Create/edit dialog for a coin package. `code` is immutable when editing. */
function CoinPackageModal({
  pkg,
  onClose,
  onDone,
}: {
  pkg: CoinPackageRow | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const isEdit = pkg !== null;
  const [code, setCode] = useState(pkg?.code ?? '');
  const [coins, setCoins] = useState(String(pkg?.coins ?? ''));
  const [priceRub, setPriceRub] = useState(String(pkg?.priceRub ?? ''));
  const [bonusCoins, setBonusCoins] = useState(String(pkg?.bonusCoins ?? '0'));
  const [error, setError] = useState<string | null>(null);

  const coinsN = Number(coins);
  const priceN = Number(priceRub);
  const bonusN = Number(bonusCoins || '0');
  const valid =
    (isEdit || CODE_RE.test(code.trim())) &&
    Number.isInteger(coinsN) &&
    coinsN >= 1 &&
    Number.isInteger(priceN) &&
    priceN >= 1 &&
    Number.isInteger(bonusN) &&
    bonusN >= 0;

  const save = useMutation({
    mutationFn: () =>
      isEdit
        ? req<CoinPackageRow>(`/admin/economy/coin-packages/${pkg.id}`, {
            method: 'PATCH',
            json: { coins: coinsN, priceRub: priceN, bonusCoins: bonusN },
          })
        : req<CoinPackageRow>('/admin/economy/coin-packages', {
            method: 'POST',
            json: { code: code.trim(), coins: coinsN, priceRub: priceN, bonusCoins: bonusN },
          }),
    onSuccess: onDone,
    onError: (e) => setError(errMsg(e, 'Не удалось сохранить пакет')),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? `Пакет «${pkg.code}»` : 'Новый пакет монет'}
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
            placeholder="coins_100"
            value={code}
            disabled={isEdit}
            onChange={(e) => setCode(e.target.value)}
          />
          {isEdit && (
            <p className="mt-1 text-xs text-muted-foreground">
              Код неизменяем — по нему оплата находит пакет.
            </p>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Монеты">
            <Input
              type="number"
              min={1}
              placeholder="100"
              value={coins}
              onChange={(e) => setCoins(e.target.value)}
            />
          </Field>
          <Field label="Бонус монет">
            <Input
              type="number"
              min={0}
              placeholder="0"
              value={bonusCoins}
              onChange={(e) => setBonusCoins(e.target.value)}
            />
          </Field>
        </div>
        <Field label="Цена, ₽">
          <Input
            type="number"
            min={1}
            placeholder="99"
            value={priceRub}
            onChange={(e) => setPriceRub(e.target.value)}
          />
        </Field>
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    </Modal>
  );
}

/* ────────────────────────────────── Подарки ────────────────────────────────── */

function GiftsTab({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['economy-gifts'], queryFn: () => req<GiftRow[]>('/admin/economy/gifts') });
  const [editing, setEditing] = useState<GiftRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['economy-gifts'] });

  const del = useMutation({
    mutationFn: (id: string) => req<{ id: string }>(`/admin/economy/gifts/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
    onError: (e) => setActionError(errMsg(e, 'Не удалось удалить подарок')),
  });

  const rows = useMemo(() => {
    const all = q.data ?? [];
    const term = search.trim().toLowerCase();
    if (!term) return all;
    return all.filter(
      (g) => g.title.toLowerCase().includes(term) || g.code.toLowerCase().includes(term),
    );
  }, [q.data, search]);

  const columns: Column<GiftRow>[] = [
    {
      key: 'title',
      header: 'Подарок',
      render: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{r.title}</p>
          <p className="truncate font-mono text-xs text-muted-foreground">{r.code}</p>
        </div>
      ),
    },
    { key: 'price', header: 'Цена', align: 'right', render: (r) => <Coins amount={r.priceCoins} /> },
    {
      key: 'rarity',
      header: 'Редкость',
      render: (r) => <Badge variant={RARITY_VARIANT[r.rarity]}>{RARITY_LABEL[r.rarity]}</Badge>,
    },
    {
      key: 'premium',
      header: 'Доступ',
      render: (r) =>
        r.isPremiumOnly ? (
          <Badge variant="accent">Только Premium</Badge>
        ) : (
          <span className="text-xs text-muted-foreground">Всем</span>
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
              confirmTitle="Удалить подарок?"
              confirmBody={`Подарок «${r.title}» исчезнет из каталога. Ранее отправленные подарки сохранят свою стоимость.`}
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
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Поиск по названию или коду…"
        actions={
          isAdmin ? (
            <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
              Создать подарок
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
        rows={rows}
        rowKey={(r) => r.id}
        loading={q.isLoading}
        error={q.isError ? 'Не удалось загрузить подарки.' : undefined}
        empty={
          <EmptyState
            title={search ? 'Ничего не найдено' : 'Подарков нет'}
            description={
              search ? 'Измените запрос.' : isAdmin ? 'Создайте первый подарок.' : 'Каталог пуст.'
            }
          />
        }
      />

      {(creating || editing) && (
        <GiftModal
          gift={editing}
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

/** Create/edit dialog for a gift. `code` is immutable when editing. */
function GiftModal({
  gift,
  onClose,
  onDone,
}: {
  gift: GiftRow | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const isEdit = gift !== null;
  const [code, setCode] = useState(gift?.code ?? '');
  const [title, setTitle] = useState(gift?.title ?? '');
  const [animationUrl, setAnimationUrl] = useState(gift?.animationUrl ?? '');
  const [priceCoins, setPriceCoins] = useState(String(gift?.priceCoins ?? ''));
  const [rarity, setRarity] = useState<Rarity>(gift?.rarity ?? 'common');
  const [isPremiumOnly, setIsPremiumOnly] = useState(gift?.isPremiumOnly ?? false);
  const [error, setError] = useState<string | null>(null);

  const priceN = Number(priceCoins);
  const valid =
    (isEdit || CODE_RE.test(code.trim())) &&
    title.trim().length > 0 &&
    animationUrl.trim().length > 0 &&
    Number.isInteger(priceN) &&
    priceN >= 0;

  const save = useMutation({
    mutationFn: () =>
      isEdit
        ? req<GiftRow>(`/admin/economy/gifts/${gift.id}`, {
            method: 'PATCH',
            json: {
              title: title.trim(),
              animationUrl: animationUrl.trim(),
              priceCoins: priceN,
              rarity,
              isPremiumOnly,
            },
          })
        : req<GiftRow>('/admin/economy/gifts', {
            method: 'POST',
            json: {
              code: code.trim(),
              title: title.trim(),
              animationUrl: animationUrl.trim(),
              priceCoins: priceN,
              rarity,
              isPremiumOnly,
            },
          }),
    onSuccess: onDone,
    onError: (e) => setError(errMsg(e, 'Не удалось сохранить подарок')),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? `Подарок «${gift.title}»` : 'Новый подарок'}
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
          <Input placeholder="rose" value={code} disabled={isEdit} onChange={(e) => setCode(e.target.value)} />
          {isEdit && <p className="mt-1 text-xs text-muted-foreground">Код неизменяем.</p>}
        </Field>
        <Field label="Название">
          <Input placeholder="Роза" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="URL анимации / иконки">
          <Input
            placeholder="/gifts/rose.json"
            value={animationUrl}
            onChange={(e) => setAnimationUrl(e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Цена, монет">
            <Input
              type="number"
              min={0}
              placeholder="10"
              value={priceCoins}
              onChange={(e) => setPriceCoins(e.target.value)}
            />
          </Field>
          <Field label="Редкость">
            <Select value={rarity} onChange={(v) => setRarity(v as Rarity)} className="w-full">
              {RARITIES.map((r) => (
                <option key={r} value={r}>
                  {RARITY_LABEL[r]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isPremiumOnly}
            onChange={(e) => setIsPremiumOnly(e.target.checked)}
            className="size-4 rounded border-border accent-accent"
          />
          Только для Premium-отправителей
        </label>
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    </Modal>
  );
}

/* ──────────────────────────────────── Top ──────────────────────────────────── */

function TopTab({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['economy-top'], queryFn: () => req<TopPlacementRow[]>('/admin/economy/top') });
  const [actionError, setActionError] = useState<string | null>(null);

  const remove = useMutation({
    mutationFn: (id: string) => req<{ id: string }>(`/admin/economy/top/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['economy-top'] }),
    onError: (e) => setActionError(errMsg(e, 'Не удалось снять размещение')),
  });

  const columns: Column<TopPlacementRow>[] = [
    {
      key: 'user',
      header: 'Пользователь',
      render: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{r.nickname || '(без профиля)'}</p>
          <p className="truncate font-mono text-xs text-muted-foreground">{r.userId}</p>
        </div>
      ),
    },
    {
      key: 'lane',
      header: 'Дорожка',
      render: (r) => (
        <Badge variant="info">
          {r.lane === 'left' ? 'Левая' : r.lane === 'right' ? 'Правая' : r.lane || '—'}
        </Badge>
      ),
    },
    {
      key: 'priority',
      header: 'Приоритет',
      align: 'right',
      render: (r) => <span className="tabular-nums">{fmtInt(r.priority)}</span>,
    },
    { key: 'spent', header: 'Потрачено', align: 'right', render: (r) => <Coins amount={r.coinsSpent} /> },
    {
      key: 'status',
      header: 'Статус',
      render: (r) =>
        r.active ? <Badge variant="success">Активно</Badge> : <Badge variant="muted">Истекло</Badge>,
    },
    {
      key: 'expires',
      header: 'Истекает',
      align: 'right',
      render: (r) => <RelativeTime iso={r.expiresAt} />,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) =>
        isAdmin ? (
          <ConfirmButton
            onConfirm={() => {
              setActionError(null);
              remove.mutate(r.id);
            }}
            confirmTitle="Снять размещение?"
            confirmBody={`Размещение ${r.nickname || r.userId} в дорожке «${r.lane}» будет удалено немедленно.`}
            confirmLabel="Снять"
          >
            Снять
          </ConfirmButton>
        ) : null,
    },
  ];

  return (
    <div>
      {!isAdmin && <ReadOnlyBanner />}
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
        error={q.isError ? 'Не удалось загрузить размещения Top.' : undefined}
        empty={
          <EmptyState
            title="Размещений нет"
            description="Сейчас никто не занимает дорожки Top. Размещения создаются пользователями при покупке видимости."
          />
        }
      />
      <p className="mt-3 text-xs text-muted-foreground">
        Показаны активные размещения (по приоритету), затем недавно истёкшие. Снять можно любое.
      </p>
    </div>
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
      Режим просмотра. Изменять каталог может только администратор.
    </p>
  );
}
