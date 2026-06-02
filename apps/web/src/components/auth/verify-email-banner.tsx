'use client';

/**
 * Slim, dismissible "confirm your email" banner.
 *
 * Shown in the authenticated app chrome (mounted once under the global header)
 * whenever the signed-in user's `emailVerified` is explicitly `false`. It is
 * deliberately NON-BLOCKING: a single hairline bar with a "выслать письмо снова"
 * action and a close button — never a modal, never a full-screen gate.
 *
 * Visibility rules:
 *   • Render only once auth has settled (`isReady`), the user is signed in, and
 *     `user.emailVerified === false`. `emailVerified` is optional in the
 *     contract, so `undefined` (older sessions / unknown) is treated as "don't
 *     nag" — we only show on an explicit `false`.
 *   • Dismissal is remembered for the browser session (sessionStorage), so it
 *     stays hidden across route changes but returns on a fresh visit until the
 *     address is actually verified.
 *
 * The "resend" action calls `/auth/resend-verification` (authenticated) and
 * surfaces a toast on success/failure. No layout shift: when hidden it renders
 * nothing.
 */
import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { MailWarning, Send, X } from 'lucide-react';
import { toast } from '@ruletka/ui';
import { cn } from '@/lib/cn';
import { useAuth } from '@/features/auth/use-auth';
import { useResendVerification } from '@/features/auth/use-auth-email';

/** sessionStorage key for a per-session dismissal. */
const DISMISS_KEY = 'ruletka.verify-email-banner.dismissed';

export function VerifyEmailBanner() {
  const t = useTranslations('auth');
  const { user, isAuthenticated, isReady } = useAuth();
  const resend = useResendVerification();
  const reduce = useReducedMotion();

  // Start hidden; read the per-session dismissal after mount to avoid an SSR/CSR
  // markup mismatch (sessionStorage is client-only).
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => {
    try {
      setDismissed(sessionStorage.getItem(DISMISS_KEY) === '1');
    } catch {
      setDismissed(false);
    }
  }, []);

  // Only nag on an explicit `false` (see visibility rules above).
  const needsVerification = isReady && isAuthenticated && user?.emailVerified === false;
  const visible = needsVerification && !dismissed;

  function dismiss() {
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* sessionStorage unavailable (private mode / SSR) — in-memory dismiss is fine */
    }
  }

  function handleResend() {
    resend.mutate(undefined, {
      onSuccess: () =>
        toast.success(t('banner.resendSuccessToast'), {
          description: t('banner.resendSuccessToastDescription'),
        }),
      onError: () =>
        toast.error(t('banner.resendErrorToast'), {
          description: t('banner.resendErrorToastDescription'),
        }),
    });
  }

  return (
    <AnimatePresence initial={false}>
      {visible && (
        <motion.div
          initial={reduce ? false : { height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          className="overflow-hidden border-b border-[var(--color-neon-violet)]/25 bg-[var(--color-neon-violet)]/10 backdrop-blur"
          role="status"
        >
          <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2.5 sm:px-6 lg:px-8">
            <MailWarning
              className="h-4 w-4 shrink-0 text-[var(--color-neon-violet)]"
              aria-hidden="true"
            />
            <p className="min-w-0 flex-1 truncate text-sm text-foreground/90">
              <span className="font-semibold">{t('banner.titlePrefix')}</span>{' '}
              <span className="text-muted-foreground">
                {user?.email
                  ? t('banner.bodyWithEmail', { email: user.email })
                  : t('banner.bodyNoEmail')}
              </span>
            </p>

            <button
              type="button"
              onClick={handleResend}
              disabled={resend.isPending}
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold',
                'text-foreground transition-colors',
                'bg-[var(--color-neon-violet)]/15 hover:bg-[var(--color-neon-violet)]/25',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                'disabled:opacity-60',
              )}
            >
              <Send className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">
                {resend.isPending ? t('banner.sending') : t('banner.resendLong')}
              </span>
              <span className="sm:hidden">
                {resend.isPending ? t('banner.sendingShort') : t('banner.resendShort')}
              </span>
            </button>

            <button
              type="button"
              onClick={dismiss}
              aria-label={t('banner.dismiss')}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
