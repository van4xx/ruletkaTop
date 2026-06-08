'use client';

/**
 * Blocklist tab — users the caller has blocked (GET /moderation/blocks), each
 * with an unblock action (DELETE /moderation/blocks/:id, optimistic). Covers
 * loading (skeletons), empty (friendly illustration) and error states.
 *
 * The blocks endpoint now returns each blocked user's minimal public identity
 * (nickname + avatar), so each row shows the real person. If a profile is
 * missing (deleted account), the row gracefully falls back to a shortened id.
 */
import { useTranslations } from 'next-intl';
import { Ban, UserRoundX } from 'lucide-react';
import type { BlockedUser } from '@ruletka/shared-types';
import { Avatar, Button, Skeleton, toast } from '@ruletka/ui';
import { useBlocks, useUnblock } from '@/features/settings/use-settings';
import { SettingsSection } from '../primitives';

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

/** Display label for a blocked user: their nickname, or a short id fallback. */
function blockedLabel(block: BlockedUser): string {
  return block.nickname.trim() ? block.nickname : shortId(block.blockedUserId);
}

export function BlocklistTab() {
  const t = useTranslations('settings');
  const tc = useTranslations('common');
  const { data: blocks, isLoading, isError, error, refetch } = useBlocks();
  const unblock = useUnblock();

  const handleUnblock = (block: BlockedUser) => {
    unblock.mutate(block.blockedUserId, {
      onSuccess: () => toast.success(t('blocklist.unblocked')),
      onError: (e) => toast.error(t('blocklist.unblockError'), { description: e.message }),
    });
  };

  return (
    <SettingsSection
      title={t('blocklist.title')}
      description={t('blocklist.description')}
      icon={<Ban />}
    >
      {isLoading ? (
        <ul className="space-y-3">
          {[0, 1, 2].map((i) => (
            <li key={i} className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-40" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="h-8 w-28 rounded-lg" />
            </li>
          ))}
        </ul>
      ) : isError ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-sm text-muted-foreground">
            {error?.message ?? t('blocklist.loadError')}
          </p>
          <Button variant="secondary" size="sm" onClick={() => refetch()}>
            {tc('retry')}
          </Button>
        </div>
      ) : !blocks || blocks.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-card/70 ring-1 ring-border/70">
            <UserRoundX className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
          </span>
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">{t('blocklist.emptyTitle')}</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              {t('blocklist.emptyDescription')}
            </p>
          </div>
        </div>
      ) : (
        <ul className="divide-y divide-border/50">
          {blocks.map((block) => {
            const label = blockedLabel(block);
            const named = block.nickname.trim().length > 0;
            return (
            <li key={block.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
              <Avatar
                size="md"
                src={block.avatarUrl ?? undefined}
                alt={label}
                fallback={<Ban className="h-4 w-4" />}
              />
              <div className="min-w-0 flex-1">
                <p
                  className={
                    named
                      ? 'truncate text-sm font-medium text-foreground'
                      : 'truncate font-mono text-sm text-foreground'
                  }
                >
                  {label}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('blocklist.blockedOn', { date: formatDate(block.createdAt) })}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleUnblock(block)}
                loading={unblock.isPending && unblock.variables === block.blockedUserId}
              >
                {t('blocklist.unblock')}
              </Button>
            </li>
            );
          })}
        </ul>
      )}
    </SettingsSection>
  );
}
