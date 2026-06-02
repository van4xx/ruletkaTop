'use client';

/**
 * Email-verification landing — reached from the emailed link
 * (`/verify-email?token=…`).
 *
 * On mount it POSTs the token to `/auth/verify-email` (exactly once — guarded by
 * a ref so React 18 StrictMode's double-effect doesn't fire two requests) and
 * renders one of four states:
 *   • verifying — spinner while the request is in flight;
 *   • success   — confirmation + "перейти в приложение" (→ /dashboard);
 *   • error     — expired/invalid/used token, with a way to get a fresh link;
 *   • no-token  — the link was mangled / opened directly.
 *
 * The "выслать заново" action calls `/auth/resend-verification`, which requires a
 * session. When the visitor is signed in we resend in place (with a toast);
 * otherwise we send them to /login first (you must be signed in to re-request).
 */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { CircleCheckBig, MailWarning, Send, TriangleAlert } from 'lucide-react';
import { Button, Spinner, toast } from '@ruletka/ui';
import { useAuth } from '@/features/auth/use-auth';
import { useVerifyEmail, useResendVerification } from '@/features/auth/use-auth-email';

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

/** Shared centered layout for every state (icon + heading + copy + actions). */
function StateFrame({
  icon,
  iconClassName,
  title,
  children,
  actions,
}: {
  icon: React.ReactNode;
  iconClassName: string;
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: EASE_OUT }}
      className="text-center"
    >
      <span
        className={`mx-auto inline-flex h-14 w-14 items-center justify-center rounded-2xl ${iconClassName}`}
      >
        {icon}
      </span>
      <h1 className="mt-6 font-display text-3xl font-bold tracking-tight">{title}</h1>
      <div className="mt-3 text-muted-foreground">{children}</div>
      {actions ? <div className="mt-8 flex flex-col gap-3">{actions}</div> : null}
    </motion.div>
  );
}

/** A "resend verification" button shown to signed-in users on failure. */
function ResendButton() {
  const t = useTranslations('auth');
  const resend = useResendVerification();
  return (
    <Button
      type="button"
      variant="primary"
      size="lg"
      block
      loading={resend.isPending}
      onClick={() =>
        resend.mutate(undefined, {
          onSuccess: () =>
            toast.success(t('verifyEmail.resendSuccessToast'), {
              description: t('verifyEmail.resendSuccessToastDescription'),
            }),
          onError: () =>
            toast.error(t('verifyEmail.resendErrorToast'), {
              description: t('verifyEmail.resendErrorToastDescription'),
            }),
        })
      }
    >
      <Send className="h-4 w-4" aria-hidden="true" />
      {t('verifyEmail.resend')}
    </Button>
  );
}

export function VerifyEmailView() {
  const t = useTranslations('auth');
  const params = useSearchParams();
  const token = params.get('token')?.trim() ?? '';
  const { isAuthenticated } = useAuth();
  const verifyEmail = useVerifyEmail();

  // Verify exactly once per mounted token (StrictMode double-invokes effects).
  const firedRef = useRef(false);
  const [noToken, setNoToken] = useState(false);

  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    if (!token) {
      setNoToken(true);
      return;
    }
    verifyEmail.mutate({ token });
    // Intentionally run once on mount; `verifyEmail`/`token` are stable here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── No token in the link ──
  if (noToken) {
    return (
      <StateFrame
        icon={<MailWarning className="h-7 w-7 text-warning" aria-hidden="true" />}
        iconClassName="border border-warning/40 bg-warning/10"
        title={t('verifyEmail.noToken.title')}
        actions={
          isAuthenticated ? (
            <ResendButton />
          ) : (
            <Button asChild variant="primary" size="lg" block>
              <Link href="/login">{t('verifyEmail.noToken.signIn')}</Link>
            </Button>
          )
        }
      >
        <p>{t('verifyEmail.noToken.body')}</p>
      </StateFrame>
    );
  }

  // ── Success ──
  if (verifyEmail.isSuccess) {
    return (
      <StateFrame
        icon={<CircleCheckBig className="h-7 w-7 text-success" aria-hidden="true" />}
        iconClassName="border border-success/40 bg-success/10"
        title={t('verifyEmail.success.title')}
        actions={
          <Button asChild variant="primary" size="lg" block>
            <Link href={isAuthenticated ? '/dashboard' : '/login'}>
              {t('verifyEmail.success.continue')}
            </Link>
          </Button>
        }
      >
        <p>{t('verifyEmail.success.body')}</p>
      </StateFrame>
    );
  }

  // ── Error: expired / already used / invalid token ──
  if (verifyEmail.isError) {
    return (
      <StateFrame
        icon={<TriangleAlert className="h-7 w-7 text-warning" aria-hidden="true" />}
        iconClassName="border border-warning/40 bg-warning/10"
        title={t('verifyEmail.error.title')}
        actions={
          isAuthenticated ? (
            <ResendButton />
          ) : (
            <Button asChild variant="primary" size="lg" block>
              <Link href="/login">{t('verifyEmail.error.signInToResend')}</Link>
            </Button>
          )
        }
      >
        <p>
          {isAuthenticated ? t('verifyEmail.error.bodyAuthed') : t('verifyEmail.error.bodyGuest')}
        </p>
      </StateFrame>
    );
  }

  // ── Verifying (in flight) ──
  return (
    <StateFrame
      icon={<Spinner size="md" />}
      iconClassName="border border-border/70 bg-card/40"
      title={t('verifyEmail.verifying.title')}
    >
      <p>{t('verifyEmail.verifying.body')}</p>
    </StateFrame>
  );
}
