import type { Metadata } from 'next';
import { ModerationClient } from '@/components/moderation/moderation-client';

export const metadata: Metadata = {
  title: 'Модерация',
  description: 'Очередь проверки нарушений: улики, метки, авто-действия.',
  // Privileged, internal tool — keep it out of search indexes entirely.
  robots: { index: false, follow: false },
};

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
