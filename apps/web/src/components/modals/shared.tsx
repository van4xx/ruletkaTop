'use client';

/**
 * Small shared building blocks for the modal system, so every modal shares the
 * same visual grammar (the design-system `Dialog` + a few repeated bits like a
 * field error line, an inline "not enough coins" banner and a premium gate).
 *
 * These keep individual modal files lean and on-brand without re-deriving the
 * same markup in each one.
 */
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Crown, Sparkles, TriangleAlert } from 'lucide-react';
import { Badge, Button, CoinBalance, CoinIcon } from '@ruletka/ui';
import { ROUTES } from '@/config/nav';
import { cn } from '@/lib/cn';
import { useModal } from '@/lib/stores/modal-store';

/** A consistent inline field error line. */
export function FieldError({ id, children }: { id?: string; children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <p id={id} className="text-xs text-destructive">
      {children}
    </p>
  );
}

/** Eyebrow chip used in modal headers (mirrors the landing/economy eyebrow). */
export function ModalEyebrow({
  icon,
  children,
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-card/50 px-2.5 py-1 text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">
      {icon}
      {children}
    </span>
  );
}

/**
 * Inline "not enough coins" banner with the user's balance and a button that
 * opens the buy-coins modal (replacing the current one). Used by the gift and
 * top-purchase flows.
 */
export function InsufficientCoins({
  balance,
  needed,
  className,
}: {
  balance: number | null;
  needed?: number;
  className?: string;
}) {
  const t = useTranslations('chrome');
  const { open } = useModal();
  const shortfall = needed != null && balance != null ? Math.max(0, needed - balance) : undefined;
  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-xl border border-warning/30 bg-warning/10 p-3.5 sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
    >
      <div className="flex items-start gap-2.5">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
        <div className="text-sm">
          <p className="font-medium text-foreground">{t('modals.shared.insufficientTitle')}</p>
          <p className="text-muted-foreground">
            {shortfall != null && shortfall > 0 ? (
              <>
                {t('modals.shared.needMore')}{' '}
                <span className="font-semibold text-foreground tabular-nums">{shortfall}</span>{' '}
                <CoinIcon size="xs" className="-mt-0.5 inline text-[var(--coin)]" />
              </>
            ) : (
              t('modals.shared.topUpPrompt')
            )}
          </p>
        </div>
      </div>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="shrink-0"
        leadingIcon={<CoinIcon size="sm" className="text-[var(--coin)]" />}
        onClick={() => open('buy-coins', shortfall ? { shortfall } : {})}
      >
        {t('modals.shared.topUp')}
      </Button>
    </div>
  );
}

/** A compact balance pill labelled with the user's balance. */
export function BalancePill({ balance }: { balance: number | null }) {
  const t = useTranslations('chrome');
  return (
    <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
      {t('modals.shared.balance')}
      <CoinBalance amount={balance ?? 0} variant="pill" size="sm" />
    </span>
  );
}

/**
 * Premium-only gate card. Shown in place of a control when a non-premium user
 * tries to use a premium-gated feature (e.g. a premium-only gift, or
 * gender/country filters). Opens the premium modal in-place.
 */
export function PremiumGate({
  title,
  description,
  reason,
}: {
  title?: string;
  description?: string;
  reason?: string;
}) {
  const t = useTranslations('chrome');
  const { open } = useModal();
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-warning/30 bg-warning/10 p-5 text-center">
      <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-warning/15 text-warning">
        <Crown className="h-6 w-6" aria-hidden="true" />
      </span>
      <div className="space-y-1">
        <p className="font-display text-base font-bold text-foreground">
          {title ?? t('modals.shared.premiumGateTitle')}
        </p>
        <p className="text-sm text-muted-foreground">
          {description ?? t('modals.shared.premiumGateDescription')}
        </p>
      </div>
      <Button
        type="button"
        size="sm"
        variant="primary"
        leadingIcon={<Sparkles className="h-4 w-4" />}
        onClick={() => open('premium', reason ? { reason } : {})}
      >
        {t('modals.shared.premiumGateCta')}
      </Button>
    </div>
  );
}

/** A small "link to a full page" affordance used in modal footers. */
export function FullPageLink({ href, children }: { href: string; children: React.ReactNode }) {
  const { close } = useModal();
  return (
    <Link
      href={href}
      onClick={close}
      className="text-sm font-medium text-[var(--color-neon-cyan)] underline-offset-4 transition-colors hover:text-foreground hover:underline"
    >
      {children}
    </Link>
  );
}

/** Re-export for convenience so modals can reference the canonical routes. */
export { ROUTES };
export { Badge };
