'use client';

/**
 * Interactive body of the /friends page. Owns: the live friends query, presence
 * subscription, in-page search + online-first sorting, the requests inbox, and
 * the remove/block mutations (with confirmation + toasts).
 */
import { useMemo, useState } from 'react';
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

  const friends = friendsQuery.data ?? [];

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
      onSuccess: () => toast.success(`${name} удалён из друзей`),
      onError: () => toast.error('Не удалось удалить из друзей'),
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
        toast.success(`${name} заблокирован`);
      },
      onError: () => toast.error('Не удалось заблокировать пользователя'),
    });
  }

  // ── Auth gate ──
  if (isReady && !isAuthenticated) {
    return <SignInRequired description="Войдите, чтобы видеть список друзей и заявки." />;
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
              <TabsTrigger value="all">Все</TabsTrigger>
              <TabsTrigger value="online">
                В сети
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
            placeholder="Поиск по нику"
            leadingIcon={<Search className="h-4 w-4" />}
            wrapperClassName="w-full sm:w-56"
            aria-label="Поиск друзей"
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
          title="Пока нет друзей"
          description="Знакомьтесь в рулетке и добавляйте понравившихся собеседников — они появятся здесь."
          action={
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button asChild variant="primary" size="sm">
                <a href="/video">В видеорулетку</a>
              </Button>
              <AddFriendDialog
                trigger={
                  <Button variant="outline" size="sm">
                    Добавить по ID
                  </Button>
                }
              />
            </div>
          }
        />
      ) : visible.length === 0 ? (
        <StatePanel
          icon={<Search className="h-7 w-7" />}
          title="Никого не нашлось"
          description={filter === 'online' ? 'Сейчас никто из друзей не в сети.' : 'Попробуйте изменить запрос.'}
        />
      ) : (
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
      )}

      {/* Confirmation dialog (shared for remove + block) */}
      <Dialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pending?.kind === 'block' ? 'Заблокировать пользователя?' : 'Удалить из друзей?'}
            </DialogTitle>
            <DialogDescription>
              {pending?.kind === 'block' ? (
                <>
                  <span className="font-medium text-foreground">{pending?.name}</span> больше не сможет
                  писать вам и звонить. Дружба будет разорвана.
                </>
              ) : (
                <>
                  Вы уверены, что хотите удалить{' '}
                  <span className="font-medium text-foreground">{pending?.name}</span> из друзей?
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPending(null)}>
              Отмена
            </Button>
            <Button
              variant="danger"
              leadingIcon={<UserX className="h-4 w-4" />}
              loading={blockUser.isPending || removeFriendship.isPending}
              onClick={pending?.kind === 'block' ? confirmBlock : confirmRemove}
              className={cn(pending?.kind !== 'block' && 'bg-destructive')}
            >
              {pending?.kind === 'block' ? 'Заблокировать' : 'Удалить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
