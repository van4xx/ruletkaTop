import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input } from '@ruletka/ui';

import { adminApi, AdminApiError } from '../lib/api';
import type { Role } from '../lib/types';
import {
  Card,
  Coins,
  DataTable,
  MetricCard,
  Modal,
  PageHeader,
  RelativeTime,
  fmtInt,
  type Column,
} from '../components/kit';
import type { AdminLedgerEntry } from '../lib/types';

/**
 * Баланс — economy-wide wallet stats + a per-user wallet inspector (balance +
 * coin ledger). Admins can apply a manual signed adjustment (credit/debit),
 * which routes through the real wallet service and is audited.
 *
 * Wave-2 will add a global wallet leaderboard + bulk tooling; the contract +
 * inspector flow are wired now.
 */
export function Balances({ role }: { role: Role }) {
  const isAdmin = role === 'admin';
  const qc = useQueryClient();
  const [userId, setUserId] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [adjustOpen, setAdjustOpen] = useState(false);

  const stats = useQuery({ queryKey: ['wallet-stats'], queryFn: () => adminApi.wallet.stats() });

  const detail = useQuery({
    queryKey: ['wallet-detail', submitted],
    queryFn: () => adminApi.wallet.detail(submitted),
    enabled: submitted.length > 0,
  });

  function lookup(e: FormEvent) {
    e.preventDefault();
    setSubmitted(userId.trim());
  }

  const ledgerColumns: Column<AdminLedgerEntry>[] = [
    { key: 'type', header: 'Тип', render: (r) => <span className="text-muted-foreground">{r.type}</span> },
    { key: 'delta', header: 'Δ', align: 'right', render: (r) => <Coins amount={r.delta} signed /> },
    { key: 'balance', header: 'Баланс после', align: 'right', render: (r) => <Coins amount={r.balanceAfter} /> },
    { key: 'ref', header: 'Ref', render: (r) => <span className="font-mono text-xs text-muted-foreground">{r.refId ?? '—'}</span> },
    { key: 'when', header: 'Когда', align: 'right', render: (r) => <RelativeTime iso={r.createdAt} /> },
  ];

  const s = stats.data;

  return (
    <div>
      <PageHeader title="Баланс" subtitle="Кошельки, монеты и ручные корректировки." />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Монет в обороте" value={s ? fmtInt(s.coinsInCirculation) : '—'} loading={stats.isLoading} accent />
        <MetricCard label="Кошельков" value={s ? fmtInt(s.walletCount) : '—'} loading={stats.isLoading} />
        <MetricCard label="Средний баланс" value={s ? fmtInt(Math.round(s.averageBalance)) : '—'} loading={stats.isLoading} />
        <MetricCard label="Макс. баланс" value={s ? fmtInt(s.topBalance) : '—'} loading={stats.isLoading} />
      </div>

      <Card className="mb-6">
        <form onSubmit={lookup} className="flex flex-wrap items-center gap-2">
          <div className="min-w-64 flex-1">
            <Input
              placeholder="ID пользователя (ObjectId)…"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
            />
          </div>
          <Button type="submit" variant="secondary">
            Найти кошелёк
          </Button>
        </form>
      </Card>

      {submitted && (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm">
              <span className="text-muted-foreground">Баланс</span>{' '}
              <span className="font-display text-lg font-bold">
                {detail.data ? <Coins amount={detail.data.balanceCoins} /> : '—'}
              </span>
            </div>
            {isAdmin && detail.data && (
              <Button size="sm" variant="primary" onClick={() => setAdjustOpen(true)}>
                Корректировка
              </Button>
            )}
          </div>

          <DataTable
            columns={ledgerColumns}
            rows={detail.data?.ledger ?? []}
            rowKey={(r) => r.id}
            loading={detail.isLoading}
            error={detail.isError ? 'Не удалось загрузить кошелёк (проверьте ID).' : undefined}
            empty={<p className="p-8 text-center text-sm text-muted-foreground">Операций по кошельку нет.</p>}
          />
        </>
      )}

      {isAdmin && (
        <AdjustModal
          open={adjustOpen}
          onClose={() => setAdjustOpen(false)}
          userId={submitted}
          onDone={() => {
            setAdjustOpen(false);
            qc.invalidateQueries({ queryKey: ['wallet-detail', submitted] });
            qc.invalidateQueries({ queryKey: ['wallet-stats'] });
          }}
        />
      )}
    </div>
  );
}

/** Manual signed wallet adjustment dialog (admin-only). */
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
    mutationFn: () => adminApi.wallet.adjust(userId, { amount: Number(amount), reason: reason.trim() }),
    onSuccess: onDone,
    onError: (e) => setError(e instanceof AdminApiError ? e.message : 'Не удалось применить'),
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
