import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { Spinner } from '@ruletka/ui';
import { AuthShell } from '@/components/auth/auth-shell';
import { LoginForm } from '@/components/auth/login-form';
import { RedirectIfAuthed } from '@/components/auth/redirect-if-authed';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return {
    title: t('meta.login.title'),
    description: t('meta.login.description'),
  };
}

async function FormFallback() {
  const t = await getTranslations('auth');
  return (
    <div className="flex min-h-[20rem] items-center justify-center">
      <Spinner size="lg" label={t('shell.loading')} />
    </div>
  );
}

export default async function LoginPage() {
  const t = await getTranslations('auth');
  return (
    <AuthShell pitch={t('shell.pitch.login')}>
      {/* Bounce already-authenticated users away from the auth screens. */}
      <RedirectIfAuthed />
      <Suspense fallback={<FormFallback />}>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
