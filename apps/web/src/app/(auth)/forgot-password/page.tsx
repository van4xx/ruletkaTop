import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AuthShell } from '@/components/auth/auth-shell';
import { ForgotPasswordForm } from '@/components/auth/forgot-password-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return {
    title: t('meta.forgotPassword.title'),
    description: t('meta.forgotPassword.description'),
    // Utility flow — keep it out of search indexes.
    robots: { index: false, follow: false },
  };
}

/**
 * /forgot-password — request a password-reset email.
 *
 * Server shell mirroring /login: sets metadata and hosts the interactive form
 * inside the shared {@link AuthShell}. The form owns the anti-enumeration
 * "neutral success" behaviour.
 */
export default async function ForgotPasswordPage() {
  const t = await getTranslations('auth');
  return (
    <AuthShell pitch={t('shell.pitch.forgotPassword')}>
      <ForgotPasswordForm />
    </AuthShell>
  );
}
