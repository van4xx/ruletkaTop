'use client';

/**
 * Conversation-inbox data layer.
 *   GET /conversations → Conversation[]  (most-recently-active first)
 *
 * A `Conversation` only carries participant ids, so the UI resolves the OTHER
 * participant's public profile (`GET /profiles/:id`) for display. Peer profiles
 * are cached independently and reused by the thread header.
 *
 * Live updates: incoming `chat:message` events bump the relevant conversation's
 * preview / unread count and re-sort the inbox without a refetch (see
 * {@link useConversationRealtime}).
 */
import { useCallback, useMemo } from 'react';
import {
  useInfiniteQuery,
  useQueries,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import type { Conversation, Message, PublicProfile } from '@ruletka/shared-types';

import { api } from '@/lib/api';
import { useSocketEvent } from './lib/use-socket';

export const chatKeys = {
  all: ['chat'] as const,
  conversations: () => [...chatKeys.all, 'conversations'] as const,
  messages: (conversationId: string) => [...chatKeys.all, 'messages', conversationId] as const,
  peer: (userId: string) => [...chatKeys.all, 'peer', userId] as const,
};

/** Page size requested per `GET /conversations` round-trip (API default). */
const PAGE_SIZE = 20;

/** One cursor-paginated page of conversations (`GET /conversations`). */
interface ConversationPage {
  items: Conversation[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** The cached infinite-query shape for the conversation inbox. */
export type ConversationsCache = InfiniteData<ConversationPage, string | undefined>;

/**
 * The conversation inbox, surfaced as a cursor-paginated infinite query
 * (`GET /conversations?cursor&limit` → `{ items, nextCursor, hasMore }`, most
 * recently active first). Pages are flattened into a single `items` array;
 * `fetchMore` loads the next page so threads past the first 20 stay reachable.
 *
 * Live previews/unread are folded into the same cache by
 * {@link useConversationRealtime}.
 */
export interface UseConversationsResult {
  /** All loaded conversations, flattened across every fetched page. */
  items: Conversation[];
  isLoading: boolean;
  isError: boolean;
  /** Whether another page can be loaded. */
  hasMore: boolean;
  /** True while a follow-up page is in flight. */
  isFetchingMore: boolean;
  /** Load the next page (no-op when exhausted / already loading). */
  fetchMore: () => void;
  refetch: () => void;
}

export function useConversations(): UseConversationsResult {
  const query = useInfiniteQuery<ConversationPage>({
    queryKey: chatKeys.conversations(),
    // Backend paginates: { items, nextCursor, hasMore }. Page through so the
    // inbox isn't capped at the first 20 conversations.
    queryFn: ({ pageParam, signal }) =>
      api.request<ConversationPage>('/conversations', {
        query: { cursor: pageParam as string | undefined, limit: PAGE_SIZE },
        signal,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.hasMore ? (last.nextCursor ?? undefined) : undefined),
    staleTime: 15_000,
  });

  const items = useMemo<Conversation[]>(
    () => query.data?.pages.flatMap((p) => p.items) ?? [],
    [query.data],
  );

  return {
    items,
    isLoading: query.isLoading,
    isError: query.isError,
    hasMore: Boolean(query.hasNextPage),
    isFetchingMore: query.isFetchingNextPage,
    fetchMore: () => {
      if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
    },
    refetch: () => void query.refetch(),
  };
}

/** Resolve the "other" participant id for a conversation given the viewer. */
export function peerIdOf(conversation: Conversation, selfId: string | null): string | undefined {
  return conversation.participants.find((p) => p !== selfId) ?? conversation.participants[0];
}

/**
 * Batch-resolve peer profiles for a set of user ids. Returns a `Map` keyed by
 * user id (only resolved entries are present).
 */
export function usePeerProfiles(userIds: string[]): {
  byId: Map<string, PublicProfile>;
  isLoading: boolean;
} {
  const unique = useMemo(() => Array.from(new Set(userIds.filter(Boolean))), [userIds]);

  const results = useQueries({
    queries: unique.map((id) => ({
      queryKey: chatKeys.peer(id),
      queryFn: () => api.request<PublicProfile>(`/profiles/${id}`),
      staleTime: 5 * 60_000,
    })),
  });

  const byId = useMemo(() => {
    const map = new Map<string, PublicProfile>();
    results.forEach((r, i) => {
      const id = unique[i];
      if (id && r.data) map.set(id, r.data);
    });
    return map;
  }, [results, unique]);

  const isLoading = results.some((r) => r.isLoading);
  return { byId, isLoading };
}

/**
 * Keep the cached conversation inbox live: on every incoming `chat:message`,
 * patch the matching conversation (preview, lastMessageAt, unread bump) and
 * move it to the top. Mount once on the inbox page.
 *
 * @param activeConversationId  if the user is currently viewing a thread, don't
 *                              inflate its unread counter.
 */
export function useConversationRealtime(activeConversationId?: string | null): void {
  const qc = useQueryClient();

  const onMessage = useCallback(
    (m: Message) => {
      qc.setQueryData<ConversationsCache>(chatKeys.conversations(), (prev) => {
        if (!prev || prev.pages.length === 0) return prev;

        // Locate the conversation across every loaded page.
        const flat = prev.pages.flatMap((p) => p.items);
        const existing = flat.find((c) => c.id === m.conversationId);
        if (!existing) {
          // Unknown conversation (first contact): refetch the inbox.
          void qc.invalidateQueries({ queryKey: chatKeys.conversations() });
          return prev;
        }

        const isActive = m.conversationId === activeConversationId;
        const updated: Conversation = {
          ...existing,
          lastMessageAt: m.createdAt,
          lastMessagePreview: m.content,
          unreadCount: isActive ? 0 : existing.unreadCount + 1,
        };

        // Drop the stale copy from wherever it lives, then re-insert it at the
        // very top of the first page so the inbox stays most-recent-first.
        const prunedPages = prev.pages.map((page) => ({
          ...page,
          items: page.items.filter((c) => c.id !== m.conversationId),
        }));
        const [first, ...rest] = prunedPages;
        if (!first) return prev;
        return {
          ...prev,
          pages: [{ ...first, items: [updated, ...first.items] }, ...rest],
        };
      });
    },
    [qc, activeConversationId],
  );

  useSocketEvent('chat:message', onMessage);
}
