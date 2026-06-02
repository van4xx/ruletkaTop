import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ModerationClient } from '@/components/moderation/moderation-client';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('misc');
  return {
    title: t('moderation.metaTitle'),
    description: t('moderation.metaDescription'),
    // Privileged, internal tool — keep it out of search indexes entirely.
    robots: { index: false, follow: false },
  };
}

/**
 * /moderation — the admin/moderator review queue.
 *
 * Server shell that sets metadata and renders the interactive queue. Role
 * gating (admin/moderator) is enforced inside {@link ModerationClient} via
 * `RequireAdmin` (a complement to the server-side role checks on every
 * `/moderation/*` API route).
 */
export default function ModerationPage() {
  return <ModerationClient />;
}
