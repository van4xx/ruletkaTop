import type { Metadata } from 'next';
import { AuthShell } from '@/components/auth/auth-shell';
import { RegisterForm } from '@/components/auth/register-form';
import { RedirectIfAuthed } from '@/components/auth/redirect-if-authed';

export const metadata: Metadata = {
  title: 'Регистрация',
  description: 'Создай аккаунт ruletka.top — случайные видеозвонки, подарки и друзья со всего мира.',
};

export default function RegisterPage() {
  return (
    <AuthShell pitch="Присоединяйся к эфиру">
      <RedirectIfAuthed />
      <RegisterForm />
    </AuthShell>
  );
}
