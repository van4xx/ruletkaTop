'use client';

/**
 * Interactive body of /chats — the conversation inbox. Lists conversations
 * (unread badges + last-message previews), resolves peer profiles, keeps
 * presence + previews live over the socket, and supports a `?to=<userId>` deep
 * link that jumps straight into (or starts) a conversation with a user.
 */
import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AnimatePresence, motion } from 'framer-motion';
import { MessageSquarePlus, Search } from 'lucide-react';
import type { Conversation, OnlineStatus } from '@ruletka/shared-types';
import { Button, Input } from '@ruletka/ui';
import { useAuth } from '@/features/auth';
import { usePresence, type PresenceMap } from '@/features/friends/use-presence';
import { ErrorState, SignInRequired, StatePanel } from '@/components/social/state-views';
import { ConversationListItem } from '@/components/chat/conversation-list-item';
import { ConversationsSkeleton } from '@/components/chat/chat-skeleton';
import {
  useConversations,
  usePeerProfiles,
  useConversationRealtime,
  peerIdOf,
} from './use-conversations';

export function ChatsClient() {
  const t = useTranslations('social');
  const router = useRouter();
  const searchParams = useSearchParams();
  const toUserId = searchParams.get('to');

  const { user, isAuthenticated, isReady } = useAuth();
  const selfId = user?.id ?? null;

  const conversationsQuery = useConversations();
  const conversations = useMemo(() => conversationsQuery.data ?? [], [conversationsQuery.data]);

  // Keep inbox previews/unread live.
  useConversationRealtime(null);

  // Resolve every peer profile + presence.
  const peerIds = useMemo(
    () => conversations.map((c) => peerIdOf(c, selfId)).filter(Boolean) as string[],
    [conversations, selfId],
  );
  const { byId } = usePeerProfiles(peerIds);
  const seed = useMemo<PresenceMap>(() => ({}), []);
  const presence = usePresence(peerIds, seed);

  const [query, setQuery] = useState('');

  // ── `?to=<userId>` deep link: jump into an existing thread if one matches.
  useEffect(() => {
    if (!toUserId || conversationsQuery.isLoading) return;
    const existing = conversations.find((c) => c.participants.includes(toUserId));
    if (existing) {
      router.replace(`/chats/${existing.id}`);
    }
    // If none exists, we surface a "start a new chat" affordance below.
  }, [toUserId, conversations, conversationsQuery.isLoading, router]);

  const statusOf = (c: Conversation): OnlineStatus => {
    const pid = peerIdOf(c, selfId);
    return (pid && presence[pid]) || 'offline';
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = [...conversations].sort((a, b) => {
      const ta = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
      const tb = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
      return tb - ta;
    });
    if (!q) return list;
    return list.filter((c) => {
      const pid = peerIdOf(c, selfId);
      const peer = pid ? byId.get(pid) : undefined;
      return (
        peer?.nickname.toLowerCase().includes(q) || c.lastMessagePreview?.toLowerCase().includes(q)
      );
    });
  }, [conversations, query, byId, selfId]);

  const toPeer = toUserId ? byId.get(toUserId) : undefined;
  const hasDeepLinkPrompt =
    Boolean(toUserId) &&
    !conversationsQuery.isLoading &&
    !conversations.some((c) => c.participants.includes(toUserId!));

  if (isReady && !isAuthenticated) {
    return <SignInRequired description={t('chatsClient.signInDescription')} />;
  }

  return (
    <div className="space-y-4">
      {/* Deep-link "start new chat" prompt */}
      {hasDeepLinkPrompt && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-panel flex items-center gap-3 rounded-2xl p-3"
        >
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-card/70 text-[var(--color-neon-cyan)]">
            <MessageSquarePlus className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {toPeer
                ? t('chatsClient.newChatWith', { name: toPeer.nickname })
                : t('chatsClient.newChat')}
            </p>
            <p className="text-xs text-muted-foreground">{t('chatsClient.sendFirstMessage')}</p>
          </div>
          <Button asChild variant="primary" size="sm">
            <a href={`/profile/${toUserId}`}>{t('openProfile')}</a>
          </Button>
        </motion.div>
      )}

      {/* Search */}
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('chatsClient.searchPlaceholder')}
        leadingIcon={<Search className="h-4 w-4" />}
        aria-label={t('chatsClient.searchPlaceholder')}
      />

      {conversationsQuery.isLoading ? (
        <ConversationsSkeleton />
      ) : conversationsQuery.isError ? (
        <ErrorState onRetry={() => void conversationsQuery.refetch()} />
      ) : conversations.length === 0 ? (
        <StatePanel
          icon={<MessageSquarePlus className="h-7 w-7" />}
          title={t('chatsClient.emptyTitle')}
          description={t('chatsClient.emptyDescription')}
          action={
            <Button asChild variant="primary" size="sm">
              <a href="/friends">{t('chatsClient.toFriends')}</a>
            </Button>
          }
        />
      ) : visible.length === 0 ? (
        <StatePanel
          icon={<Search className="h-7 w-7" />}
          title={t('chatsClient.notFoundTitle')}
          description={t('chatsClient.notFoundDescription')}
        />
      ) : (
        <motion.ul layout className="space-y-1">
          <AnimatePresence initial={false}>
            {visible.map((c) => {
              const pid = peerIdOf(c, selfId);
              return (
                <motion.li key={c.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  <ConversationListItem
                    conversation={c}
                    peer={pid ? byId.get(pid) : undefined}
                    status={statusOf(c)}
                  />
                </motion.li>
              );
            })}
          </AnimatePresence>
        </motion.ul>
      )}
    </div>
  );
}
