'use client';

/**
 * Interactive body of the /friends page. Owns: the live friends query, presence
 * subscription, in-page search + online-first sorting, the requests inbox, and
 * the remove/block mutations (with confirmation + toasts).
 */
import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AnimatePresence, motion } from 'framer-motion';
import { Search, Users, UserX } from 'lucide-react';
import type { FriendSummary, OnlineStatus } from '@ruletka/shared-types';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Tabs,
  TabsList,
  TabsTrigger,
  toast,
} from '@ruletka/ui';
import { cn } from '@/lib/cn';
import { useAuth } from '@/features/auth';
import { ErrorState, SignInRequired, StatePanel } from '@/components/social/state-views';
import { FriendCard } from '@/components/friends/friend-card';
import { FriendsSkeleton } from '@/components/friends/friends-skeleton';
import { AddFriendDialog } from '@/components/friends/add-friend-dialog';
import { FriendRequestsPanel } from '@/components/friends/friend-requests-panel';
import { useFriends, useRemoveFriendship, useBlockUser } from './use-friends';
import { usePresence, type PresenceMap } from './use-presence';
import { useFriendRequestsInbox } from './use-friend-requests';

type Filter = 'all' | 'online';

const ONLINE_RANK: Record<OnlineStatus, number> = { online: 0, in_call: 1, away: 2, offline: 3 };

export function FriendsClient() {
  const t = useTranslations('social');
  const tc = useTranslations('common');
  const { isAuthenticated, isReady } = useAuth();
  const friendsQuery = useFriends();
  const removeFriendship = useRemoveFriendship();
  const blockUser = useBlockUser();
  const { requests, dismiss } = useFriendRequestsInbox();

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  // Confirmation dialog state for destructive actions.
  const [pending, setPending] = useState<
    | { kind: 'remove'; friendshipId: string; name: string }
    | { kind: 'block'; userId: string; friendshipId: string; name: string }
    | null
  >(null);

  const friends = friendsQuery.items;

  // Seed presence from the server-provided statuses, then keep it live.
  const friendIds = useMemo(() => friends.map((f) => f.profile.id), [friends]);
  const seed = useMemo<PresenceMap>(() => {
    const map: PresenceMap = {};
    for (const f of friends) map[f.profile.id] = f.status;
    return map;
  }, [friends]);
  const presence = usePresence(friendIds, seed);

  const statusOf = (f: FriendSummary): OnlineStatus => presence[f.profile.id] ?? f.status;

  const onlineCount = friends.filter((f) => statusOf(f) !== 'offline').length;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return friends
      .filter((f) => (filter === 'online' ? statusOf(f) !== 'offline' : true))
      .filter((f) => (q ? f.profile.nickname.toLowerCase().includes(q) : true))
      .sort((a, b) => {
        const r = ONLINE_RANK[statusOf(a)] - ONLINE_RANK[statusOf(b)];
        if (r !== 0) return r;
        return a.profile.nickname.localeCompare(b.profile.nickname);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [friends, presence, query, filter]);

  function confirmRemove() {
    if (pending?.kind !== 'remove') return;
    const { friendshipId, name } = pending;
    setPending(null);
    removeFriendship.mutate(friendshipId, {
      onSuccess: () => toast.success(t('friendsClient.removedToast', { name })),
      onError: () => toast.error(t('friendsClient.removeFailed')),
    });
  }

  function confirmBlock() {
    if (pending?.kind !== 'block') return;
    const { userId, friendshipId, name } = pending;
    setPending(null);
    blockUser.mutate(userId, {
      onSuccess: () => {
        // Blocking also removes the friendship server-side; drop it locally too.
        removeFriendship.mutate(friendshipId);
        toast.success(t('friendsClient.blockedToast', { name }));
      },
      onError: () => toast.error(t('friendsClient.blockFailed')),
    });
  }

  // ── Auth gate ──
  if (isReady && !isAuthenticated) {
    return <SignInRequired description={t('friendsClient.signInDescription')} />;
  }

  return (
    <div className="space-y-6">
      <FriendRequestsPanel
        requests={requests}
        onDismiss={dismiss}
        onReview={() => void friendsQuery.refetch()}
      />

      {/* Controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
            <TabsList>
              <TabsTrigger value="all">{t('friendsClient.tabAll')}</TabsTrigger>
              <TabsTrigger value="online">
                {t('friendsClient.tabOnline')}
                {onlineCount > 0 && (
                  <span className="ml-1.5 rounded-full bg-success/20 px-1.5 text-[0.6875rem] font-semibold text-success">
                    {onlineCount}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <div className="flex items-center gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('friendsClient.searchPlaceholder')}
            leadingIcon={<Search className="h-4 w-4" />}
            wrapperClassName="w-full sm:w-56"
            aria-label={t('friendsClient.searchAria')}
          />
          <AddFriendDialog />
        </div>
      </div>

      {/* Body */}
      {friendsQuery.isLoading ? (
        <FriendsSkeleton />
      ) : friendsQuery.isError ? (
        <ErrorState onRetry={() => void friendsQuery.refetch()} />
      ) : friends.length === 0 ? (
        <StatePanel
          icon={<Users className="h-7 w-7" />}
          title={t('friendsClient.emptyTitle')}
          description={t('friendsClient.emptyDescription')}
          action={
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button asChild variant="primary" size="sm">
                <a href="/video">{t('friendsClient.toVideoRoulette')}</a>
              </Button>
              <AddFriendDialog
                trigger={
                  <Button variant="outline" size="sm">
                    {t('friendsClient.addById')}
                  </Button>
                }
              />
            </div>
          }
        />
      ) : visible.length === 0 ? (
        <StatePanel
          icon={<Search className="h-7 w-7" />}
          title={t('friendsClient.notFoundTitle')}
          description={
            filter === 'online'
              ? t('friendsClient.noOnlineDescription')
              : t('friendsClient.notFoundDescription')
          }
        />
      ) : (
        <>
          <motion.ul layout className="space-y-3">
            <AnimatePresence mode="popLayout">
              {visible.map((friend) => (
                <FriendCard
                  key={friend.friendshipId}
                  friend={friend}
                  status={statusOf(friend)}
                  busy={
                    (removeFriendship.isPending &&
                      removeFriendship.variables === friend.friendshipId) ||
                    undefined
                  }
                  onRemove={(friendshipId) =>
                    setPending({ kind: 'remove', friendshipId, name: friend.profile.nickname })
                  }
                  onBlock={(userId) =>
                    setPending({
                      kind: 'block',
                      userId,
                      friendshipId: friend.friendshipId,
                      name: friend.profile.nickname,
                    })
                  }
                />
              ))}
            </AnimatePresence>
          </motion.ul>

          {/* Cursor pagination — reach friends past the first page. */}
          {friendsQuery.hasMore && (
            <div className="mt-4 flex justify-center">
              <Button
                variant="outline"
                onClick={friendsQuery.fetchMore}
                loading={friendsQuery.isFetchingMore}
              >
                {t('friendsClient.showMore')}
              </Button>
            </div>
          )}
        </>
      )}

      {/* Confirmation dialog (shared for remove + block) */}
      <Dialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pending?.kind === 'block'
                ? t('friendsClient.blockDialogTitle')
                : t('friendsClient.removeDialogTitle')}
            </DialogTitle>
            <DialogDescription>
              {pending?.kind === 'block'
                ? t.rich('friendsClient.blockDialogDescription', {
                    name: () => (
                      <span className="font-medium text-foreground">{pending?.name}</span>
                    ),
                  })
                : t.rich('friendsClient.removeDialogDescription', {
                    name: () => (
                      <span className="font-medium text-foreground">{pending?.name}</span>
                    ),
                  })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPending(null)}>
              {tc('cancel')}
            </Button>
            <Button
              variant="danger"
              leadingIcon={<UserX className="h-4 w-4" />}
              loading={blockUser.isPending || removeFriendship.isPending}
              onClick={pending?.kind === 'block' ? confirmBlock : confirmRemove}
              className={cn(pending?.kind !== 'block' && 'bg-destructive')}
            >
              {pending?.kind === 'block'
                ? t('friendsClient.blockConfirm')
                : t('friendsClient.removeConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
