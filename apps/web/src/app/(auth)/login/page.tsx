import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Spinner } from '@ruletka/ui';
import { AuthShell } from '@/components/auth/auth-shell';
import { LoginForm } from '@/components/auth/login-form';
import { RedirectIfAuthed } from '@/components/auth/redirect-if-authed';

export const metadata: Metadata = {
  title: 'Вход',
  description: 'Войди в ruletka.top, чтобы продолжить общение в видео- и голосовой рулетке.',
};

function FormFallback() {
  return (
    <div className="flex min-h-[20rem] items-center justify-center">
      <Spinner size="lg" label="Загрузка" />
    </div>
  );
}

export default function LoginPage() {
  return (
    <AuthShell pitch="С возвращением в эфир">
      {/* Bounce already-authenticated users away from the auth screens. */}
      <RedirectIfAuthed />
      <Suspense fallback={<FormFallback />}>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
