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
import { useQuery, useQueries, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type { Conversation, Message, PublicProfile } from '@ruletka/shared-types';

import { api } from '@/lib/api';
import { useSocketEvent } from './lib/use-socket';

export const chatKeys = {
  all: ['chat'] as const,
  conversations: () => [...chatKeys.all, 'conversations'] as const,
  messages: (conversationId: string) => [...chatKeys.all, 'messages', conversationId] as const,
  peer: (userId: string) => [...chatKeys.all, 'peer', userId] as const,
};

export function useConversations(): UseQueryResult<Conversation[]> {
  return useQuery({
    queryKey: chatKeys.conversations(),
    // Backend paginates: { items, nextCursor, hasMore } — unwrap to the array.
    queryFn: () =>
      api
        .request<{
          items: Conversation[];
          nextCursor: string | null;
          hasMore: boolean;
        }>('/conversations')
        .then((r) => r.items),
    staleTime: 15_000,
  });
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
      qc.setQueryData<Conversation[]>(chatKeys.conversations(), (prev) => {
        if (!prev) return prev;
        const idx = prev.findIndex((c) => c.id === m.conversationId);
        if (idx === -1) {
          // Unknown conversation (first contact): refetch the inbox.
          void qc.invalidateQueries({ queryKey: chatKeys.conversations() });
          return prev;
        }
        const existing = prev[idx]!;
        const isActive = m.conversationId === activeConversationId;
        const updated: Conversation = {
          ...existing,
          lastMessageAt: m.createdAt,
          lastMessagePreview: m.content,
          unreadCount: isActive ? 0 : existing.unreadCount + 1,
        };
        const next = [...prev];
        next.splice(idx, 1);
        return [updated, ...next];
      });
    },
    [qc, activeConversationId],
  );

  useSocketEvent('chat:message', onMessage);
}
