import type { Metadata } from 'next';
import { AuthShell } from '@/components/auth/auth-shell';
import { ForgotPasswordForm } from '@/components/auth/forgot-password-form';

export const metadata: Metadata = {
  title: 'Восстановление пароля',
  description: 'Сбросьте пароль от аккаунта ruletka.top по ссылке из письма.',
  // Utility flow — keep it out of search indexes.
  robots: { index: false, follow: false },
};

/**
 * /forgot-password — request a password-reset email.
 *
 * Server shell mirroring /login: sets metadata and hosts the interactive form
 * inside the shared {@link AuthShell}. The form owns the anti-enumeration
 * "neutral success" behaviour.
 */
export default function ForgotPasswordPage() {
  return (
    <AuthShell pitch="Вернём доступ за пару минут">
      <ForgotPasswordForm />
    </AuthShell>
  );
}
