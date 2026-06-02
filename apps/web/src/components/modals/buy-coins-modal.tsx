'use client';

/**
 * Buy coins.
 *
 * - GET /coin-packages (`useCoinPackages`), best-value highlighted.
 * - Choose a pack → POST /payments/coins/checkout, then the hosted
 *   CloudPayments widget opens (card data never touches us). All of this is the
 *   same `useBuyCoins` state machine the full /coins page uses, so behaviour is
 *   identical: a "pending" state after a successful charge while the
 *   webhook-driven credit lands (the hook polls the balance).
 */
import { useMemo } from 'react';
import { CheckCircle2, Loader2, ShoppingBag, Sparkles, TriangleAlert } from 'lucide-react';
import type { CoinPackage } from '@ruletka/shared-types';
import {
  Badge,
  Button,
  CoinIcon,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Skeleton,
  Spinner,
} from '@ruletka/ui';
import { cn } from '@/lib/cn';
import { useModal, useModalProps } from '@/lib/stores/modal-store';
import { formatNumber, formatRub, pricePerCoin } from '@/features/economy/format';
import { useCoinPackages, useBuyCoins } from '@/features/coins/use-coins';
import { useCoinBalance } from '@/hooks/wallet/use-wallet';
import { BalancePill, FullPageLink } from './shared';

export function BuyCoinsModal() {
  const { close } = useModal();
  const { presetPackageCode, shortfall } = useModalProps<'buy-coins'>();
  const packages = useCoinPackages();
  const buy = useBuyCoins();
  const balance = useCoinBalance();

  const bestIndex = useMemo(() => {
    const list = packages.data;
    if (!list || list.length === 0) return -1;
    let best = 0;
    let bestPpc = Infinity;
    list.forEach((p, i) => {
      const ppc = pricePerCoin(p.priceRub, p.coins, p.bonusCoins);
      if (ppc < bestPpc) {
        bestPpc = ppc;
        best = i;
      }
    });
    return best;
  }, [packages.data]);

  // ── Terminal / transient phases get a dedicated panel ──
  if (buy.phase === 'pending') {
    return (
      <StatusPanel
        icon={<Loader2 className="h-7 w-7 animate-spin text-accent" />}
        title="Зачисляем монеты…"
        description="Платёж принят. Монеты появятся на балансе через несколько секунд."
      >
        <Button type="button" variant="ghost" onClick={close}>
          Закрыть
        </Button>
      </StatusPanel>
    );
  }

  if (buy.phase === 'credited') {
    return (
      <StatusPanel
        icon={<CheckCircle2 className="h-7 w-7 text-success" />}
        title="Готово!"
        description={`Баланс пополнен${buy.activePackage ? ` на ${formatNumber(buy.activePackage.coins + buy.activePackage.bonusCoins)}` : ''}. Спасибо!`}
      >
        <Button type="button" variant="primary" onClick={() => { buy.reset(); close(); }}>
          Отлично
        </Button>
      </StatusPanel>
    );
  }

  if (buy.phase === 'error') {
    return (
      <StatusPanel
        icon={<TriangleAlert className="h-7 w-7 text-danger" />}
        title="Платёж не прошёл"
        description={buy.error ?? 'Что-то пошло не так. Попробуйте ещё раз.'}
      >
        <Button type="button" variant="ghost" onClick={buy.reset}>
          Назад
        </Button>
        {buy.activePackage && (
          <Button type="button" variant="primary" onClick={() => buy.buy(buy.activePackage!)}>
            Повторить
          </Button>
        )}
      </StatusPanel>
    );
  }

  // ── Default: package picker ──
  return (
    <>
      <DialogHeader>
        <div className="flex items-center justify-between gap-2 pr-8">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-card/50 px-2.5 py-1 text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">
            <ShoppingBag className="h-3.5 w-3.5 text-[var(--coin)]" aria-hidden="true" />
            Магазин монет
          </span>
          <BalancePill balance={balance} />
        </div>
        <DialogTitle>Пополнить баланс</DialogTitle>
        <DialogDescription>
          {shortfall && shortfall > 0 ? (
            <>
              Не хватает <span className="font-semibold text-foreground">{shortfall}</span> монет.
              Выберите пакет, чтобы продолжить.
            </>
          ) : (
            'Монеты нужны для подарков и мест в Топе. Оплата защищена CloudPayments.'
          )}
        </DialogDescription>
      </DialogHeader>

      <div className="max-h-[55vh] space-y-3 overflow-y-auto pr-1">
        {packages.isLoading &&
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}

        {packages.isError && (
          <div className="rounded-xl border border-border/60 bg-card/40 p-6 text-center text-sm text-muted-foreground">
            Не удалось загрузить пакеты.{' '}
            <button
              type="button"
              onClick={() => packages.refetch()}
              className="font-medium text-accent hover:underline"
            >
              Повторить
            </button>
          </div>
        )}

        {packages.data?.map((pkg, i) => (
          <PackageRow
            key={pkg.code}
            pkg={pkg}
            best={i === bestIndex}
            preset={pkg.code === presetPackageCode}
            busy={buy.isBusy && buy.activePackage?.code === pkg.code}
            disabled={buy.isBusy}
            onBuy={() => buy.buy(pkg)}
          />
        ))}
      </div>

      <DialogFooter className="sm:justify-between">
        <FullPageLink href="/coins">Открыть магазин целиком</FullPageLink>
        <Button type="button" variant="ghost" onClick={close} disabled={buy.isBusy}>
          Закрыть
        </Button>
      </DialogFooter>
    </>
  );
}

function PackageRow({
  pkg,
  best,
  preset,
  busy,
  disabled,
  onBuy,
}: {
  pkg: CoinPackage;
  best: boolean;
  preset: boolean;
  busy: boolean;
  disabled: boolean;
  onBuy: () => void;
}) {
  const total = pkg.coins + pkg.bonusCoins;
  return (
    <button
      type="button"
      onClick={onBuy}
      disabled={disabled}
      className={cn(
        'group flex w-full items-center gap-4 rounded-xl border p-3.5 text-left transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'disabled:cursor-not-allowed disabled:opacity-60',
        best || preset
          ? 'border-accent-muted bg-accent-soft/60'
          : 'border-border bg-card/40 hover:border-border-strong hover:bg-card/70',
      )}
    >
      <span className="relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-coin/12 text-[var(--coin)]">
        <CoinIcon size="lg" glow />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="font-display text-base font-bold tabular-nums text-foreground">
            {formatNumber(total)}
          </span>
          <span className="text-sm text-muted-foreground">монет</span>
          {best && (
            <Badge variant="aurora" size="sm" className="gap-1">
              <Sparkles className="h-3 w-3" /> Выгодно
            </Badge>
          )}
        </span>
        {pkg.bonusCoins > 0 && (
          <span className="text-xs font-medium text-success">
            +{formatNumber(pkg.bonusCoins)} бонусом
          </span>
        )}
      </span>
      <span className="shrink-0 text-right">
        {busy ? (
          <Spinner size="sm" />
        ) : (
          <span className="font-display text-base font-bold tabular-nums text-foreground">
            {formatRub(pkg.priceRub)}
          </span>
        )}
      </span>
    </button>
  );
}

function StatusPanel({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="flex flex-col items-center gap-3 py-4 text-center">
        <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-card/60 ring-1 ring-border/70">
          {icon}
        </span>
        <div className="space-y-1">
          <DialogTitle className="text-lg">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </div>
      </div>
      <DialogFooter className="sm:justify-center">{children}</DialogFooter>
    </>
  );
}
