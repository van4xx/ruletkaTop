'use client';

/**
 * Feedback dialog for the coin purchase flow. Reflects the {@link CheckoutPhase}
 * state machine from `useBuyCoins`:
 *   - starting/widget → preparing the secure CloudPayments widget
 *   - pending         → charge captured, waiting for the webhook to credit coins
 *   - credited        → balance updated
 *   - error           → show the reason + retry
 *
 * The actual card form is the CloudPayments hosted widget (separate overlay);
 * this dialog only narrates our side of the flow.
 */
import { CheckCircle2, CreditCard, Loader2, ShieldCheck, XCircle } from 'lucide-react';
import type { CoinPackage } from '@ruletka/shared-types';
import {
  Button,
  CoinIcon,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@ruletka/ui';
import type { CheckoutPhase } from '@/features/coins/use-coins';
import { formatNumber } from '@/features/economy/format';
import { cn } from '@/lib/cn';

export interface CheckoutStatusDialogProps {
  phase: CheckoutPhase;
  pkg: CoinPackage | null;
  error: string | null;
  onClose: () => void;
  onRetry: () => void;
}

export function CheckoutStatusDialog({
  phase,
  pkg,
  error,
  onClose,
  onRetry,
}: CheckoutStatusDialogProps) {
  // The dialog is visible for every phase except idle and the active widget
  // overlay (where CloudPayments owns the screen).
  const open = phase === 'starting' || phase === 'pending' || phase === 'credited' || phase === 'error';
  const total = pkg ? pkg.coins + pkg.bonusCoins : 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent hideClose={phase === 'starting' || phase === 'pending'}>
        <DialogHeader>
          <DialogTitle>
            {phase === 'error'
              ? 'Платёж не завершён'
              : phase === 'credited'
                ? 'Монеты зачислены'
                : phase === 'pending'
                  ? 'Подтверждаем оплату'
                  : 'Готовим оплату'}
          </DialogTitle>
          <DialogDescription>
            {phase === 'error'
              ? error ?? 'Попробуйте ещё раз или выберите другой способ оплаты.'
              : phase === 'credited'
                ? `${formatNumber(total)} монет уже на вашем балансе.`
                : phase === 'pending'
                  ? 'Оплата прошла. Зачисляем монеты — это занимает несколько секунд.'
                  : 'Открываем защищённое окно CloudPayments. Данные карты не попадают на наш сервер.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-4">
          <StatusGlyph phase={phase} />
          {pkg && phase !== 'error' && (
            <div className="inline-flex items-center gap-2 rounded-full border border-[color-mix(in_oklch,var(--coin)_30%,transparent)] bg-[color-mix(in_oklch,var(--coin)_12%,transparent)] px-3.5 py-1.5">
              <CoinIcon size="sm" className="text-[var(--coin)]" />
              <span className="text-sm font-semibold tabular-nums">{formatNumber(total)} монет</span>
            </div>
          )}
          {phase === 'starting' && (
            <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5 text-success" aria-hidden="true" />
              Безопасная оплата CloudPayments
            </p>
          )}
        </div>

        {(phase === 'credited' || phase === 'error') && (
          <DialogFooter>
            {phase === 'error' ? (
              <>
                <Button variant="ghost" onClick={onClose}>
                  Отмена
                </Button>
                <Button onClick={onRetry} leadingIcon={<CreditCard className="h-4 w-4" />}>
                  Повторить оплату
                </Button>
              </>
            ) : (
              <Button onClick={onClose} block>
                Отлично
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function StatusGlyph({ phase }: { phase: CheckoutPhase }) {
  if (phase === 'credited') {
    return (
      <span className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-success/15 text-success">
        <CheckCircle2 className="h-8 w-8" aria-hidden="true" />
      </span>
    );
  }
  if (phase === 'error') {
    return (
      <span className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-destructive/15 text-destructive">
        <XCircle className="h-8 w-8" aria-hidden="true" />
      </span>
    );
  }
  return (
    <span className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-primary/12 text-primary">
      <Loader2 className={cn('h-8 w-8', 'motion-safe:animate-spin')} aria-hidden="true" />
    </span>
  );
}
