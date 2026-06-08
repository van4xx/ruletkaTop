'use client';

/**
 * The full conversation thread view (used by /chats/[conversationId]).
 *
 * Composes the thread engine ({@link useThread}) with a peer header, a
 * scrollable, day-grouped message list (infinite "load older" at the top,
 * sticky-to-bottom on new messages), a live typing indicator and the composer.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { AnimatePresence } from 'framer-motion';
import { ArrowLeft, ChevronDown, Phone, Video } from 'lucide-react';
import type { PublicProfile, OnlineStatus } from '@ruletka/shared-types';
import { Avatar, Button, IconButton, Spinner } from '@ruletka/ui';
import { ROUTES } from '@/config/nav';
import { cn } from '@/lib/cn';
import { useAuth } from '@/features/auth';
import { usePresence } from '@/features/friends/use-presence';
import { ErrorState, SignInRequired } from '@/components/social/state-views';
import { ProfileBadges } from '@/components/social/profile-badges';
import { MessageBubble } from '@/components/chat/message-bubble';
import { MessageComposer } from '@/components/chat/message-composer';
import { TypingIndicator } from '@/components/chat/typing-indicator';
import { ThreadSkeleton } from '@/components/chat/chat-skeleton';
import { useThread, type ChatMessage } from './use-thread';
import { usePeerProfiles, useConversations, peerIdOf } from './use-conversations';
import { dayKey, formatDayLabel } from './lib/format';

/** Translator shape compatible with next-intl's `useTranslations('social')`. */
type Translate = (key: string, values?: Record<string, string | number>) => string;

/** Lower-case inline status label keys (under the `chatThread` group). */
const STATUS_LABEL_KEY: Record<OnlineStatus, string> = {
  online: 'chatThread.statusOnlineLower',
  offline: 'chatThread.statusOfflineLower',
  in_call: 'chatThread.statusInCallLower',
  away: 'chatThread.statusAwayLower',
};

/** Group consecutive messages by local day for separators. */
function useGrouped(messages: ChatMessage[], t: Translate, locale: string) {
  return useMemo(() => {
    const groups: { key: number; label: string; items: ChatMessage[] }[] = [];
    for (const m of messages) {
      const k = dayKey(m.createdAt);
      const last = groups[groups.length - 1];
      if (last && last.key === k) last.items.push(m);
      else groups.push({ key: k, label: formatDayLabel(m.createdAt, t, locale), items: [m] });
    }
    return groups;
  }, [messages, t, locale]);
}

export function ChatThread({ conversationId }: { conversationId: string }) {
  const t = useTranslations('social');
  const locale = useLocale();
  const { user, isAuthenticated, isReady } = useAuth();
  const selfId = user?.id ?? null;

  // Resolve the peer via the conversations cache (cheap if the inbox is warm).
  const conversationsQuery = useConversations();
  const conversation = conversationsQuery.items.find((c) => c.id === conversationId);
  const peerId = conversation ? peerIdOf(conversation, selfId) : undefined;
  const { byId } = usePeerProfiles(peerId ? [peerId] : []);
  const peer: PublicProfile | undefined = peerId ? byId.get(peerId) : undefined;

  const presence = usePresence(peerId ? [peerId] : []);
  const peerStatus: OnlineStatus = (peerId && presence[peerId]) || 'offline';

  const thread = useThread(conversationId, selfId);
  const groups = useGrouped(thread.messages, t, locale);

  // ── Scroll management ──
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [showJump, setShowJump] = useState(false);
  const atBottomRef = useRef(true);
  const prevHeightRef = useRef(0);
  const prevCountRef = useRef(0);

  // Track whether the user is pinned to the bottom.
  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    atBottomRef.current = distance < 120;
    setShowJump(distance > 240);
  }

  // Preserve scroll position when older messages are prepended; stick to bottom
  // when new messages arrive and the user is already at the bottom.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const count = thread.messages.length;
    const grew = count > prevCountRef.current;

    if (thread.isLoadingOlder || (grew && !atBottomRef.current && el.scrollTop < 80)) {
      // Older page prepended: keep the viewport anchored.
      const delta = el.scrollHeight - prevHeightRef.current;
      if (delta > 0) el.scrollTop += delta;
    } else if (atBottomRef.current) {
      bottomRef.current?.scrollIntoView({ block: 'end' });
    }

    prevHeightRef.current = el.scrollHeight;
    prevCountRef.current = count;
  }, [thread.messages, thread.isLoadingOlder]);

  // On first successful load, jump to the latest message.
  const didInitialScroll = useRef(false);
  useEffect(() => {
    if (!didInitialScroll.current && !thread.isLoading && thread.messages.length > 0) {
      didInitialScroll.current = true;
      requestAnimationFrame(() => bottomRef.current?.scrollIntoView());
    }
  }, [thread.isLoading, thread.messages.length]);

  // Infinite "load older" when the sentinel at the top enters view.
  const topSentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = topSentinelRef.current;
    const root = scrollRef.current;
    if (!el || !root || !thread.hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && thread.hasMore && !thread.isLoadingOlder) {
          prevHeightRef.current = root.scrollHeight;
          thread.loadOlder();
        }
      },
      { root, rootMargin: '120px 0px 0px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [thread.hasMore, thread.isLoadingOlder, thread]);

  function jumpToBottom() {
    atBottomRef.current = true;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }

  if (isReady && !isAuthenticated) {
    return (
      <div className="py-12">
        <SignInRequired description={t('chatThread.signInDescription')} />
      </div>
    );
  }

  const callHref = peerId ? `${ROUTES.video}?to=${peerId}` : ROUTES.video;
  const canCall = peerStatus === 'online' || peerStatus === 'away';

  return (
    // Fill the available column height. `flex-1 min-h-0` lets the thread shrink to
    // whatever the page chrome (header + verify-email banner) leaves, keeping the
    // composer in view; the `dvh` height is a fallback for non-flex parents.
    <div className="flex h-[calc(100dvh-4rem)] min-h-0 flex-1 flex-col">
      {/* Header */}
      <header className="glass-panel z-10 flex items-center gap-3 border-x-0 border-t-0 px-3 py-2.5 sm:px-4">
        <IconButton
          asChild
          variant="ghost"
          size="sm"
          aria-label={t('chatThread.backToChats')}
          className="lg:hidden"
        >
          <Link href={ROUTES.chats}>
            <ArrowLeft aria-hidden="true" />
          </Link>
        </IconButton>

        <Link
          href={peerId ? `/profile/${peerId}` : '#'}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-xl"
        >
          <Avatar
            src={peer?.avatarUrl}
            alt={peer?.nickname ?? ''}
            size="md"
            status={peerStatus}
            ring={peer?.isPremium ? 'aurora' : 'none'}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate font-display text-base font-semibold tracking-tight">
                {peer?.nickname ?? t('interlocutor')}
              </span>
              {peer && <ProfileBadges badges={peer.badges} size="sm" iconOnly />}
            </div>
            <span
              className={cn(
                'text-xs',
                peerStatus === 'online' ? 'text-success' : 'text-muted-foreground',
              )}
            >
              {thread.peerTyping ? t('chatThread.typingInline') : t(STATUS_LABEL_KEY[peerStatus])}
            </span>
          </div>
        </Link>

        {canCall ? (
          <IconButton asChild variant="glass" size="sm" aria-label={t('videoCall')}>
            <Link href={callHref}>
              <Video aria-hidden="true" />
            </Link>
          </IconButton>
        ) : (
          <IconButton
            variant="glass"
            size="sm"
            aria-label={t('chatThread.unavailableForCall')}
            disabled
          >
            <Phone aria-hidden="true" />
          </IconButton>
        )}
      </header>

      {/* Messages */}
      <div className="relative flex-1 overflow-hidden">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="h-full overflow-y-auto px-3 py-4 sm:px-6"
        >
          {thread.isLoading ? (
            <ThreadSkeleton />
          ) : thread.isError ? (
            <div className="py-12">
              <ErrorState
                onRetry={thread.refetch}
                description={t('chatThread.loadMessagesError')}
              />
            </div>
          ) : (
            <div
              className="mx-auto flex max-w-2xl flex-col gap-1.5"
              role="log"
              aria-live="polite"
              aria-relevant="additions"
            >
              <div ref={topSentinelRef} aria-hidden="true" />

              {thread.isLoadingOlder && (
                <div className="flex justify-center py-2">
                  <Spinner size="sm" tone="muted" label={t('chatThread.loadingHistory')} />
                </div>
              )}

              {thread.messages.length === 0 && (
                <div className="flex flex-col items-center gap-2 py-16 text-center">
                  <span className="text-4xl" aria-hidden="true">
                    👋
                  </span>
                  <p className="font-display text-base font-semibold">
                    {t('chatThread.startConversation')}
                  </p>
                  <p className="max-w-xs text-sm text-muted-foreground">
                    {peer
                      ? t('chatThread.conversationStartWith', { name: peer.nickname })
                      : t('chatThread.conversationStart')}
                  </p>
                </div>
              )}

              {groups.map((group) => (
                <div key={group.key} className="flex flex-col gap-1.5">
                  <div className="sticky top-1 z-[1] my-2 flex justify-center">
                    <span className="glass-panel rounded-full px-3 py-1 text-xs font-medium text-muted-foreground">
                      {group.label}
                    </span>
                  </div>
                  {group.items.map((m, i) => {
                    const mine = m.senderId === selfId;
                    const next = group.items[i + 1];
                    const showTail = !next || next.senderId !== m.senderId;
                    return (
                      <MessageBubble
                        key={m.clientId ?? m.id}
                        message={m}
                        mine={mine}
                        showTail={showTail}
                        onRetry={thread.retry}
                      />
                    );
                  })}
                </div>
              ))}

              <AnimatePresence>
                {thread.peerTyping && <TypingIndicator name={peer?.nickname} />}
              </AnimatePresence>

              <div ref={bottomRef} aria-hidden="true" />
            </div>
          )}
        </div>

        {/* Jump-to-latest button */}
        <AnimatePresence>
          {showJump && (
            <Button
              variant="glass"
              size="sm"
              onClick={jumpToBottom}
              className="absolute bottom-4 right-4 rounded-full shadow-lg"
              aria-label={t('chatThread.jumpToLatest')}
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
          )}
        </AnimatePresence>
      </div>

      {/* Composer */}
      <div className="px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 sm:px-6">
        <div className="mx-auto max-w-2xl">
          <MessageComposer onSend={thread.send} onTyping={thread.notifyTyping} />
        </div>
      </div>
    </div>
  );
}
