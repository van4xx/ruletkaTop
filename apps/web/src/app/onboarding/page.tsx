import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { OnboardingClient } from '@/components/onboarding/onboarding-client';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('misc');
  return {
    title: t('onboarding.metaTitle'),
    description: t('onboarding.metaDescription'),
    robots: { index: false, follow: false },
  };
}

/**
 * /onboarding — guided, multi-step profile completion shown after registration.
 * The interactive flow (auth gate, steps, PATCH /profiles/me) lives in the
 * client component.
 */
export default function OnboardingPage() {
  return <OnboardingClient />;
}
