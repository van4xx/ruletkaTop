'use client';

/**
 * /friends/requests — incoming & outgoing friend requests, wired to the real
 * `GET /friends/requests` endpoint (`{ incoming, outgoing }`, see
 * `useFriendRequests`):
 *   • Incoming — people who asked you. Accept (`POST /friends/:id/accept`) or
 *     decline (`DELETE /friends/:id`), keyed by `friendshipId`.
 *   • Outgoing — requests you sent that are still pending. Cancel them
 *     (`DELETE /friends/:id`).
 * Both sections render the counterpart's avatar + badges and one-tap actions.
 * Incoming requests also arrive live over the socket (`notif:new`,
 * kind 'friend_request'); we invalidate the query on each so the list refreshes
 * without a manual reload.
 */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AnimatePresence, motion } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  Clock,
  Inbox,
  Send,
  UserPlus,
  X,
} from 'lucide-react';
import type { FriendRequestItem } from '@ruletka/shared-types';
import {
  Avatar,
  Button,
  IconButton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
} from '@ruletka/ui';
import { ApiClientError } from '@/lib/api';
import { useAuth } from '@/features/auth';
import {
  friendsKeys,
  useAcceptFriendRequest,
  useFriendRequests,
  useRemoveFriendship,
} from '@/features/friends/use-friends';
import { useSocketEvent } from '@/features/chat/lib/use-socket';
import { EconomyShell } from '@/components/economy/economy-shell';
import { CardGridSkeleton, EmptyState, ErrorState } from '@/components/economy/states';
import { SignInRequired } from '@/components/social/state-views';
import { ProfileBadges } from '@/components/social/profile-badges';
import { AddFriendDialog } from '@/components/friends/add-friend-dialog';
import { formatRelativeTime } from '@/components/notifications/notification-meta';

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

type Tab = 'incoming' | 'outgoing';

export default function FriendRequestsPage() {
  const t = useTranslations('social');
  const { isAuthenticated, isReady } = useAuth();
  const [tab, setTab] = useState<Tab>('incoming');
  const qc = useQueryClient();

  const requestsQuery = useFriendRequests({ enabled: isReady && isAuthenticated });
  const incoming = requestsQuery.data?.incoming ?? [];
  const outgoing = requestsQuery.data?.outgoing ?? [];

  const accept = useAcceptFriendRequest();
  const remove = useRemoveFriendship();

  // Live: a new incoming request over the socket refreshes the list.
  useSocketEvent('notif:new', (n) => {
    if (n.kind === 'friend_request') {
      void qc.invalidateQueries({ queryKey: friendsKeys.requests() });
    }
  });

  // If the incoming tab empties out but outgoing has items, drift the user to
  // where the content is (only once they've acted on everything incoming).
  useEffect(() => {
    if (tab === 'incoming' && incoming.length === 0 && outgoing.length > 0) {
      setTab('outgoing');
    }
  }, [tab, incoming.length, outgoing.length]);

  // Per-item busy tracking so only the acted-on row shows a spinner.
  const [busyId, setBusyId] = useState<string | null>(null);

  function onAccept(item: FriendRequestItem) {
    setBusyId(item.friendshipId);
    accept.mutate(item.friendshipId, {
      onSuccess: () => {
        toast.success(t('requestAcceptedToast'), {
          description: t('requestAcceptedDescription', { name: item.profile.nickname }),
        });
      },
      onError: (err) => {
        toast.error(acceptErrorMessage(err, t));
      },
      onSettled: () => setBusyId(null),
    });
  }

  function onDecline(item: FriendRequestItem) {
    setBusyId(item.friendshipId);
    remove.mutate(item.friendshipId, {
      onSuccess: () => toast.success(t('requestDeclinedToast')),
      onError: () => toast.error(t('declineFailed')),
      onSettled: () => setBusyId(null),
    });
  }

  function onCancel(item: FriendRequestItem) {
    setBusyId(item.friendshipId);
    remove.mutate(item.friendshipId, {
      onSuccess: () => toast.success(t('requestCancelledToast')),
      onError: () => toast.error(t('cancelFailed')),
      onSettled: () => setBusyId(null),
    });
  }

  return (
    <EconomyShell
      eyebrow={
        <>
          <UserPlus className="h-3.5 w-3.5 text-[var(--color-neon-violet)]" aria-hidden="true" />
          {t('requestsEyebrow')}
        </>
      }
      title={
        <>
          {t('requestsTitlePrefix')} <span className="text-gradient-neon">{t('requestsTitleAccent')}</span>
        </>
      }
      lede={t('requestsLede')}
      actions={
        <AddFriendDialog
          trigger={<Button leadingIcon={<UserPlus className="h-4 w-4" />}>{t('addFriend')}</Button>}
        />
      }
    >
      {isReady && !isAuthenticated ? (
        <SignInRequired description={t('signInToSeeRequests')} />
      ) : (
        <div className="mx-auto max-w-2xl space-y-6">
          <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
            <TabsList className="w-full sm:w-auto">
              <TabsTrigger value="incoming" className="flex-1 sm:flex-none">
                <ArrowDownLeft className="h-4 w-4" aria-hidden="true" />
                {t('tabIncoming')}
                {incoming.length > 0 && (
                  <span className="ml-1.5 rounded-full bg-[var(--color-neon-magenta)]/20 px-1.5 text-[0.6875rem] font-semibold text-[var(--color-neon-magenta)]">
                    {incoming.length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="outgoing" className="flex-1 sm:flex-none">
                <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                {t('tabOutgoing')}
                {outgoing.length > 0 && (
                  <span className="ml-1.5 rounded-full bg-white/10 px-1.5 text-[0.6875rem] font-semibold text-muted-foreground">
                    {outgoing.length}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>

            {/* ── Incoming ── */}
            <TabsContent value="incoming" className="mt-6 space-y-4">
              {requestsQuery.isPending ? (
                <CardGridSkeleton count={3} />
              ) : requestsQuery.isError ? (
                <ErrorState
                  title={t('loadRequestsError')}
                  description={t('loadRequestsErrorDescription')}
                  onRetry={() => void requestsQuery.refetch()}
                />
              ) : incoming.length === 0 ? (
                <EmptyState
                  icon={<Inbox className="h-6 w-6" />}
                  title={t('noIncomingTitle')}
                  description={t('noIncomingDescription')}
                />
              ) : (
                <ul className="space-y-3">
                  <AnimatePresence initial={false}>
                    {incoming.map((item) => (
                      <RequestRow
                        key={item.friendshipId}
                        item={item}
                        busy={busyId === item.friendshipId}
                        actions={
                          <>
                            <Button
                              variant="primary"
                              size="sm"
                              leadingIcon={<Check className="h-4 w-4" />}
                              loading={busyId === item.friendshipId && accept.isPending}
                              disabled={busyId === item.friendshipId}
                              onClick={() => onAccept(item)}
                            >
                              {t('accept')}
                            </Button>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <IconButton
                                  variant="ghost"
                                  size="sm"
                                  aria-label={t('declineRequest')}
                                  disabled={busyId === item.friendshipId}
                                  onClick={() => onDecline(item)}
                                >
                                  <X aria-hidden="true" />
                                </IconButton>
                              </TooltipTrigger>
                              <TooltipContent>{t('decline')}</TooltipContent>
                            </Tooltip>
                          </>
                        }
                      />
                    ))}
                  </AnimatePresence>
                </ul>
              )}
            </TabsContent>

            {/* ── Outgoing ── */}
            <TabsContent value="outgoing" className="mt-6 space-y-4">
              {requestsQuery.isPending ? (
                <CardGridSkeleton count={2} />
              ) : requestsQuery.isError ? (
                <ErrorState
                  title={t('loadRequestsError')}
                  description={t('loadRequestsErrorDescription')}
                  onRetry={() => void requestsQuery.refetch()}
                />
              ) : outgoing.length === 0 ? (
                <EmptyState
                  icon={<Send className="h-6 w-6" />}
                  title={t('noOutgoingTitle')}
                  description={t('noOutgoingDescription')}
                  action={
                    <AddFriendDialog
                      trigger={
                        <Button
                          variant="primary"
                          size="sm"
                          leadingIcon={<UserPlus className="h-4 w-4" />}
                        >
                          {t('sendRequest')}
                        </Button>
                      }
                    />
                  }
                />
              ) : (
                <ul className="space-y-3">
                  <AnimatePresence initial={false}>
                    {outgoing.map((item) => (
                      <RequestRow
                        key={item.friendshipId}
                        item={item}
                        busy={busyId === item.friendshipId}
                        actions={
                          <>
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1 text-xs font-medium text-muted-foreground">
                              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                              {t('pending')}
                            </span>
                            <Button
                              variant="outline"
                              size="sm"
                              leadingIcon={<X className="h-4 w-4" />}
                              loading={busyId === item.friendshipId && remove.isPending}
                              disabled={busyId === item.friendshipId}
                              onClick={() => onCancel(item)}
                            >
                              {t('cancel')}
                            </Button>
                          </>
                        }
                      />
                    ))}
                  </AnimatePresence>
                </ul>
              )}
            </TabsContent>
          </Tabs>
        </div>
      )}
    </EconomyShell>
  );
}

/** One request row — avatar (premium ring) + nickname/badges + relative time + slotted actions. */
function RequestRow({
  item,
  busy,
  actions,
}: {
  item: FriendRequestItem;
  busy: boolean;
  actions: React.ReactNode;
}) {
  const { profile } = item;
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: busy ? 0.6 : 1, y: 0 }}
      exit={{ opacity: 0, x: 12 }}
      transition={{ duration: 0.25, ease: EASE_OUT }}
      className="glass-panel flex items-center gap-3 rounded-2xl p-3 sm:gap-4 sm:p-4"
    >
      <Avatar
        src={profile.avatarUrl}
        alt={profile.nickname}
        size="lg"
        ring={profile.isPremium ? 'aurora' : 'none'}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-display text-base font-semibold tracking-tight">
            {profile.nickname}
          </p>
          <ProfileBadges badges={profile.badges} iconOnly />
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground/80">
          {formatRelativeTime(item.createdAt)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">{actions}</div>
    </motion.li>
  );
}

/** Map an accept failure to a friendly, localized message. */
function acceptErrorMessage(err: unknown, t: (key: string) => string): string {
  if (err instanceof ApiClientError) {
    if (err.status === 404) return t('acceptNotFound');
    if (err.status === 403) return t('acceptForbidden');
  }
  return t('acceptFailed');
}
