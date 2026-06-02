import type { Metadata } from 'next';
import { OnboardingClient } from '@/components/onboarding/onboarding-client';

export const metadata: Metadata = {
  title: 'Настройка профиля',
  description: 'Завершите настройку профиля ruletka.top за несколько шагов.',
  robots: { index: false, follow: false },
};

/**
 * /onboarding — guided, multi-step profile completion shown after registration.
 * The interactive flow (auth gate, steps, PATCH /profiles/me) lives in the
 * client component.
 */
export default function OnboardingPage() {
  return <OnboardingClient />;
}
