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
            toast.success('Письмо отправлено', {
              description: 'Проверьте почту и перейдите по новой ссылке.',
            }),
          onError: () =>
            toast.error('Не удалось отправить письмо', {
              description: 'Попробуйте ещё раз чуть позже.',
            }),
        })
      }
    >
      <Send className="h-4 w-4" aria-hidden="true" />
      Выслать письмо заново
    </Button>
  );
}

export function VerifyEmailView() {
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
        title="Ссылка недействительна"
        actions={
          isAuthenticated ? (
            <ResendButton />
          ) : (
            <Button asChild variant="primary" size="lg" block>
              <Link href="/login">Войти</Link>
            </Button>
          )
        }
      >
        <p>
          В ссылке не хватает токена подтверждения. Откройте письмо ещё раз и перейдите по ссылке
          целиком.
        </p>
      </StateFrame>
    );
  }

  // ── Success ──
  if (verifyEmail.isSuccess) {
    return (
      <StateFrame
        icon={<CircleCheckBig className="h-7 w-7 text-success" aria-hidden="true" />}
        iconClassName="border border-success/40 bg-success/10"
        title="Email подтверждён"
        actions={
          <Button asChild variant="primary" size="lg" block>
            <Link href={isAuthenticated ? '/dashboard' : '/login'}>Перейти в приложение</Link>
          </Button>
        }
      >
        <p>
          Спасибо! Ваш адрес подтверждён — теперь доступны все возможности ruletka.top.
        </p>
      </StateFrame>
    );
  }

  // ── Error: expired / already used / invalid token ──
  if (verifyEmail.isError) {
    return (
      <StateFrame
        icon={<TriangleAlert className="h-7 w-7 text-warning" aria-hidden="true" />}
        iconClassName="border border-warning/40 bg-warning/10"
        title="Не удалось подтвердить"
        actions={
          isAuthenticated ? (
            <ResendButton />
          ) : (
            <Button asChild variant="primary" size="lg" block>
              <Link href="/login">Войти, чтобы выслать заново</Link>
            </Button>
          )
        }
      >
        <p>
          Ссылка устарела или уже была использована. {isAuthenticated
            ? 'Запросите новое письмо — оно придёт на почту за пару минут.'
            : 'Войдите в аккаунт, чтобы запросить новое письмо.'}
        </p>
      </StateFrame>
    );
  }

  // ── Verifying (in flight) ──
  return (
    <StateFrame
      icon={<Spinner size="md" />}
      iconClassName="border border-border/70 bg-card/40"
      title="Подтверждаем email"
    >
      <p>Секунду — проверяем вашу ссылку.</p>
    </StateFrame>
  );
}
