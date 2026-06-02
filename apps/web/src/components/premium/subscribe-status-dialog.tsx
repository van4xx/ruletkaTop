'use client';

/**
 * Narrates the subscribe flow (mirrors the coin checkout dialog):
 *   starting/widget → preparing the secure recurrent CloudPayments widget
 *   pending         → charge captured, activating premium via webhook
 *   error           → reason + retry
 */
import { useTranslations } from 'next-intl';
import { CheckCircle2, Crown, Loader2, ShieldCheck, XCircle } from 'lucide-react';
import type { PremiumPlan } from '@ruletka/shared-types';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@ruletka/ui';
import type { SubscribePhase } from '@/features/premium/use-premium';
import { cn } from '@/lib/cn';

export interface SubscribeStatusDialogProps {
  phase: SubscribePhase;
  plan: PremiumPlan | null;
  error: string | null;
  onClose: () => void;
  onRetry: () => void;
}

export function SubscribeStatusDialog({
  phase,
  plan,
  error,
  onClose,
  onRetry,
}: SubscribeStatusDialogProps) {
  const t = useTranslations('economy');
  const tc = useTranslations('common');
  const open = phase === 'starting' || phase === 'pending' || phase === 'active' || phase === 'error';

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent hideClose={phase === 'starting' || phase === 'pending'}>
        <DialogHeader>
          <DialogTitle>
            {phase === 'error'
              ? t('subscribeStatus.titleError')
              : phase === 'pending'
                ? t('subscribeStatus.titlePending')
                : phase === 'active'
                  ? t('subscribeStatus.titleActive')
                  : t('subscribeStatus.titlePreparing')}
          </DialogTitle>
          <DialogDescription>
            {phase === 'error'
              ? error ?? t('subscribeStatus.descError')
              : phase === 'pending'
                ? t('subscribeStatus.descPending')
                : phase === 'active'
                  ? t('subscribeStatus.descActive', { title: plan?.title ?? '' })
                  : t('subscribeStatus.descPreparing')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-4">
          <Glyph phase={phase} />
          {phase === 'starting' && (
            <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5 text-success" aria-hidden="true" />
              {t('subscribeStatus.secure')}
            </p>
          )}
          {phase === 'pending' && (
            <p className="text-center text-xs text-muted-foreground">
              {t('subscribeStatus.pendingHint')}
            </p>
          )}
        </div>

        {(phase === 'pending' || phase === 'active' || phase === 'error') && (
          <DialogFooter>
            {phase === 'error' ? (
              <>
                <Button variant="ghost" onClick={onClose}>
                  {tc('cancel')}
                </Button>
                <Button onClick={onRetry} leadingIcon={<Crown className="h-4 w-4" />}>
                  {t('subscribeStatus.retry')}
                </Button>
              </>
            ) : (
              <Button onClick={onClose} block>
                {t('subscribeStatus.done')}
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Glyph({ phase }: { phase: SubscribePhase }) {
  if (phase === 'active') {
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
