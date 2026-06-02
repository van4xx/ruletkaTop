'use client';

/**
 * Client wrapper for the /moderation page: the on-brand economy hero header +
 * the role gate + the review queue. Kept separate from the server page shell so
 * the page can set metadata while this owns the interactive, gated content.
 */
import { ShieldAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { EconomyShell } from '@/components/economy/economy-shell';
import { RequireAdmin } from '@/features/moderation/require-admin';
import { ModerationQueue } from './moderation-queue';

export function ModerationClient() {
  const t = useTranslations('misc');
  return (
    <EconomyShell
      eyebrow={
        <>
          <ShieldAlert
            className="h-3.5 w-3.5 text-[var(--color-neon-magenta)]"
            aria-hidden="true"
          />
          Trust &amp; Safety
        </>
      }
      title={
        <>
          {t('moderation.titlePrefix')}{' '}
          <span className="text-gradient-neon">{t('moderation.titleAccent')}</span>
        </>
      }
      lede={t('moderation.lede')}
    >
      <RequireAdmin>
        <ModerationQueue />
      </RequireAdmin>
    </EconomyShell>
  );
}
