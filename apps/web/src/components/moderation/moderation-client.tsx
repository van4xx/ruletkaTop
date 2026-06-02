'use client';

/**
 * Client wrapper for the /moderation page: the on-brand economy hero header +
 * the role gate + the review queue. Kept separate from the server page shell so
 * the page can set metadata while this owns the interactive, gated content.
 */
import { ShieldAlert } from 'lucide-react';
import { EconomyShell } from '@/components/economy/economy-shell';
import { RequireAdmin } from '@/features/moderation/require-admin';
import { ModerationQueue } from './moderation-queue';

export function ModerationClient() {
  return (
    <EconomyShell
      eyebrow={
        <>
          <ShieldAlert className="h-3.5 w-3.5 text-[var(--color-neon-magenta)]" aria-hidden="true" />
          Trust &amp; Safety
        </>
      }
      title={
        <>
          Очередь <span className="text-gradient-neon">модерации</span>
        </>
      }
      lede="Проверяйте отмеченные ИИ события: улики, метки и авто-действия. Подтверждайте нарушения или отклоняйте ложные срабатывания."
    >
      <RequireAdmin>
        <ModerationQueue />
      </RequireAdmin>
    </EconomyShell>
  );
}
