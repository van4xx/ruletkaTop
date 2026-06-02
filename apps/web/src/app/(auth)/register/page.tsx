import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AuthShell } from '@/components/auth/auth-shell';
import { RegisterForm } from '@/components/auth/register-form';
import { RedirectIfAuthed } from '@/components/auth/redirect-if-authed';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return {
    title: t('meta.register.title'),
    description: t('meta.register.description'),
  };
}

export default async function RegisterPage() {
  const t = await getTranslations('auth');
  return (
    <AuthShell pitch={t('shell.pitch.register')}>
      <RedirectIfAuthed />
      <RegisterForm />
    </AuthShell>
  );
}
