'use client';

/**
 * A COMPOSABLE EMPTY thread for a peer you have never messaged (reached via the
 * `/chats?to=<userId>` deep link). No conversation exists yet, so there is no
 * `conversationId` to drive {@link useThread}; instead this surface resolves the
 * peer's public profile for the header and lets the user type a first message.
 *
 * On first send it calls `POST /messages` with `{ recipientId, content }` — the
 * backend creates the conversation on first contact and returns the persisted
 * {@link Message}. We then route into the freshly-created thread
 * (`/chats/<conversationId>`), where {@link ChatThread} takes over with live
 * delivery, history, typing and receipts. The inbox cache is invalidated so the
 * new conversation appears the next time the user returns to /chats.
 *
 * This replaces the previous dead-end where a never-messaged peer could only
 * "open profile" and never actually start a chat.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import type { Message, PublicProfile } from '@ruletka/shared-types';
import { Avatar, IconButton } from '@ruletka/ui';
import { ROUTES } from '@/config/nav';
import { api, ApiClientError } from '@/lib/api';
import { useProfile } from '@/features/profile/use-profile';
import { ProfileBadges } from '@/components/social/profile-badges';
import { ThreadSkeleton } from '@/components/chat/chat-skeleton';
import { ErrorState } from '@/components/social/state-views';
import { MessageComposer } from '@/components/chat/message-composer';
import { chatKeys } from './use-conversations';

export function DraftThread({ recipientId }: { recipientId: string }) {
  const t = useTranslations('social');
  const router = useRouter();
  const qc = useQueryClient();

  const profileQuery = useProfile(recipientId);
  const peer: PublicProfile | undefined = profileQuery.data;

  // Guard against a double-send while the first message is in flight.
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(false);

  async function handleSend(content: string) {
    const trimmed = content.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setSendError(false);
    try {
      // First contact: the backend creates the conversation and returns the
      // persisted message (carrying the new conversationId).
      const message = await api.request<Message>('/messages', {
        method: 'POST',
        json: { recipientId, content: trimmed },
      });
      // The inbox now has a new thread — drop the stale cache so it reappears.
      await qc.invalidateQueries({ queryKey: chatKeys.conversations() });
      router.replace(`${ROUTES.chats}/${message.conversationId}`);
    } catch {
      // Surface a retry affordance; the composer keeps the typed text on failure
      // is not possible (it clears optimistically), so we show an inline error.
      setSendError(true);
      setSending(false);
    }
  }

  if (profileQuery.isLoading) {
    return (
      <div className="flex h-[calc(100dvh-4rem)] min-h-0 flex-1 flex-col px-3 py-4 sm:px-6">
        <ThreadSkeleton />
      </div>
    );
  }

  // A 404 here means the peer's profile is private / gone — there is nothing to
  // compose against, so fall back to the error state with a path back to /chats.
  if (profileQuery.isError) {
    const notFound =
      profileQuery.error instanceof ApiClientError && profileQuery.error.status === 404;
    return (
      <div className="py-12">
        <ErrorState
          onRetry={notFound ? undefined : () => void profileQuery.refetch()}
          description={
            notFound ? t('draftThread.peerUnavailable') : t('chatThread.loadMessagesError')
          }
        />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100dvh-4rem)] min-h-0 flex-1 flex-col">
      {/* Header — mirrors ChatThread so the transition into the real thread is seamless. */}
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
          href={`/profile/${recipientId}`}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-xl"
        >
          <Avatar
            src={peer?.avatarUrl}
            alt={peer?.nickname ?? ''}
            size="md"
            ring={peer?.isPremium ? 'aurora' : 'none'}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate font-display text-base font-semibold tracking-tight">
                {peer?.nickname ?? t('interlocutor')}
              </span>
              {peer && <ProfileBadges badges={peer.badges} size="sm" iconOnly />}
            </div>
            <span className="text-xs text-muted-foreground">{t('draftThread.newConversation')}</span>
          </div>
        </Link>
      </header>

      {/* Empty body — the invitation to write the first message. */}
      <div className="relative flex-1 overflow-hidden">
        <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
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
          {sendError && (
            <p className="text-sm text-destructive" role="alert">
              {t('draftThread.sendError')}
            </p>
          )}
        </div>
      </div>

      {/* Composer — first send creates the conversation. */}
      <div className="px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 sm:px-6">
        <div className="mx-auto max-w-2xl">
          <MessageComposer onSend={handleSend} disabled={sending} />
        </div>
      </div>
    </div>
  );
}
