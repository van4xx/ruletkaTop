'use client';

/**
 * "Forgot password" form — collects an email and POSTs it to
 * `/auth/request-password-reset` via `useRequestPasswordReset`.
 *
 * ANTI-ENUMERATION: we never reveal whether the address has an account. On any
 * settled mutation (success OR error) we swap to the SAME neutral confirmation
 * ("if such an email exists, we've sent a link"). This mirrors the API, which
 * 204s regardless, so attackers can't probe which emails are registered.
 *
 * Style + mechanics mirror the login/register forms: react-hook-form + zod,
 * a top-level error banner is intentionally omitted (we don't surface failures),
 * and a loading submit button.
 */
import { useState } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { motion } from 'framer-motion';
import { ArrowLeft, AtSign, MailCheck } from 'lucide-react';
import { Button, Input } from '@ruletka/ui';
import {
  forgotPasswordFormSchema,
  type ForgotPasswordFormValues,
} from '@/features/auth/schemas';
import { useRequestPasswordReset } from '@/features/auth/use-auth-email';
import { FormField } from './form-field';

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

export function ForgotPasswordForm() {
  const requestReset = useRequestPasswordReset();
  // Flip to the neutral confirmation once the request has been ATTEMPTED — we
  // don't branch on success vs. error, to avoid leaking account existence.
  const [submitted, setSubmitted] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordFormValues>({
    resolver: zodResolver(forgotPasswordFormSchema),
    defaultValues: { email: '' },
    mode: 'onTouched',
  });

  const onSubmit = handleSubmit((values) => {
    requestReset.mutate(values, {
      onSettled: () => setSubmitted(true),
    });
  });

  const busy = isSubmitting || requestReset.isPending;

  if (submitted) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE_OUT }}
      >
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl glass-panel">
          <MailCheck className="h-6 w-6 text-[var(--color-neon-cyan)]" aria-hidden="true" />
        </span>
        <h1 className="mt-6 font-display text-3xl font-bold tracking-tight">Проверьте почту</h1>
        <p className="mt-3 text-muted-foreground">
          Если такой email есть в нашей системе, мы отправили на него ссылку для сброса пароля.
          Перейдите по ней, чтобы задать новый пароль.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Письмо не пришло? Проверьте папку «Спам» или попробуйте ещё раз через пару минут.
        </p>

        <div className="mt-8 flex flex-col gap-3">
          <Button
            type="button"
            variant="ghost"
            size="lg"
            block
            onClick={() => setSubmitted(false)}
          >
            Отправить ещё раз
          </Button>
          <Link
            href="/login"
            className="inline-flex items-center justify-center gap-1.5 text-sm font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Вернуться ко входу
          </Link>
        </div>
      </motion.div>
    );
  }

  return (
    <div>
      <header className="mb-8">
        <h1 className="font-display text-3xl font-bold tracking-tight">Забыли пароль?</h1>
        <p className="mt-2 text-muted-foreground">
          Укажите email от аккаунта — мы пришлём ссылку, чтобы задать новый пароль.
        </p>
      </header>

      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <FormField label="Email" required error={errors.email?.message}>
          {(field) => (
            <Input
              {...field}
              type="email"
              inputMode="email"
              autoComplete="email"
              autoFocus
              placeholder="you@example.com"
              leadingIcon={<AtSign />}
              {...register('email')}
            />
          )}
        </FormField>

        <Button type="submit" variant="primary" size="lg" block loading={busy}>
          Отправить ссылку
        </Button>
      </form>

      <p className="mt-8 text-center text-sm text-muted-foreground">
        Вспомнили пароль?{' '}
        <Link
          href="/login"
          className="font-semibold text-foreground underline-offset-4 transition-colors hover:text-[var(--color-neon-cyan)] hover:underline"
        >
          Войти
        </Link>
      </p>
    </div>
  );
}
