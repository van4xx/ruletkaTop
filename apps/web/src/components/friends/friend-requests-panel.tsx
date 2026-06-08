'use client';

/**
 * Live "incoming friend requests" banner, fed by realtime notifications
 * (see `use-friend-requests.ts`). Rendered only when there is at least one
 * pending request notice.
 *
 * This is an awareness surface: each row's action ("View", via `onReview`)
 * sends the user to `/friends/requests`, where Accept/Decline happens one-tap
 * against the real `GET /friends/requests` data. The banner stays deliberately
 * action-light so the lean notification payload (no `friendshipId`) is enough.
 */
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { Check, UserPlus, X } from 'lucide-react';
import { Button, Card, IconButton } from '@ruletka/ui';
import type { FriendRequestNotice } from '@/features/friends/use-friend-requests';

export function FriendRequestsPanel({
  requests,
  onDismiss,
  onReview,
}: {
  requests: FriendRequestNotice[];
  onDismiss: (id: string) => void;
  onReview: () => void;
}) {
  const t = useTranslations('social');
  if (requests.length === 0) return null;

  return (
    <Card variant="aurora" padding="md" className="overflow-visible">
      <div className="mb-3 flex items-center gap-2">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-card/70 text-[var(--color-neon-violet)] ring-1 ring-border/70">
          <UserPlus className="h-4 w-4" aria-hidden="true" />
        </span>
        <h2 className="font-display text-sm font-bold tracking-tight">
          {t('newFriendRequests')}
          <span className="ml-2 rounded-full bg-[var(--color-neon-magenta)]/20 px-2 py-0.5 text-xs text-[var(--color-neon-magenta)]">
            {requests.length}
          </span>
        </h2>
      </div>

      <ul className="space-y-2">
        <AnimatePresence initial={false}>
          {requests.map((r) => (
            <motion.li
              key={r.id}
              layout
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 8 }}
              transition={{ duration: 0.2 }}
              className="flex items-center gap-3 rounded-xl bg-card/50 p-2.5"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{r.title}</p>
                <p className="truncate text-xs text-muted-foreground">{r.body}</p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                leadingIcon={<Check className="h-4 w-4" />}
                onClick={onReview}
              >
                {t('view')}
              </Button>
              <IconButton
                variant="ghost"
                size="sm"
                aria-label={t('dismissRequest')}
                onClick={() => onDismiss(r.id)}
              >
                <X aria-hidden="true" />
              </IconButton>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </Card>
  );
}
