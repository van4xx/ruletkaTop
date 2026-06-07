'use client';

/**
 * Dashboard data composition.
 *
 * The dashboard is the authenticated hub, so it stitches together several
 * already-built feature data layers rather than introducing new endpoints:
 *   - identity / session         → `@/features/auth` (AuthUser)
 *   - rich own profile + views   → `@/features/profile` (PublicProfile + gifts)
 *   - wallet balance             → `@/hooks/wallet`
 *   - top feed (signature)       → `@/features/top`
 *   - online friends             → `@/features/friends` + live presence
 *   - recent conversations       → `@/features/chat`
 *
 * Each widget consumes the slice it needs via the focused hooks below, so a
 * slow/erroring section degrades on its own without taking the page down.
 */
import { useMemo } from 'react';
import type { Conversation, FriendSummary } from '@ruletka/shared-types';

import { useFriends } from '@/features/friends/use-friends';
import { usePresence, type PresenceMap } from '@/features/friends/use-presence';
import { useConversations } from '@/features/chat/use-conversations';

/** "Live" statuses worth surfacing in the online-friends strip. */
const LIVE: ReadonlySet<string> = new Set(['online', 'in_call', 'away']);

export interface OnlineFriendsResult {
  /** Friends currently online/away/in-call, most-available first. */
  online: FriendSummary[];
  /** Total accepted friends (for the "+N" / context label). */
  total: number;
  presence: PresenceMap;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

/**
 * Accepted friends decorated with live presence, filtered + sorted so the strip
 * shows who's reachable right now. Presence is seeded from the list's `status`
 * and kept live over the socket.
 */
export function useOnlineFriends(): OnlineFriendsResult {
  const friendsQuery = useFriends();
  const friends = useMemo(() => friendsQuery.items, [friendsQuery.items]);

  const ids = useMemo(() => friends.map((f) => f.profile.id), [friends]);
  const seed = useMemo<PresenceMap>(() => {
    const map: PresenceMap = {};
    for (const f of friends) map[f.profile.id] = f.status;
    return map;
  }, [friends]);

  const presence = usePresence(ids, seed);

  const online = useMemo(() => {
    const ranked = friends
      .map((f) => ({ f, status: presence[f.profile.id] ?? f.status }))
      .filter(({ status }) => LIVE.has(status));
    // online → away → in_call ordering keeps the most "joinable" first.
    const weight: Record<string, number> = { online: 0, away: 1, in_call: 2 };
    ranked.sort((a, b) => (weight[a.status] ?? 9) - (weight[b.status] ?? 9));
    return ranked.map(({ f }) => f);
  }, [friends, presence]);

  return {
    online,
    total: friends.length,
    presence,
    isLoading: friendsQuery.isLoading,
    isError: friendsQuery.isError,
    refetch: () => void friendsQuery.refetch(),
  };
}

export interface RecentChatsResult {
  conversations: Conversation[];
  /** Sum of unread across all conversations (badge on the widget header). */
  unreadTotal: number;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

/**
 * The most-recently-active conversations, capped for the preview widget. The
 * inbox is already sorted most-recent-first server-side.
 */
export function useRecentChats(limit = 4): RecentChatsResult {
  const query = useConversations();
  const all = useMemo(() => query.items, [query.items]);

  const conversations = useMemo(() => all.slice(0, limit), [all, limit]);
  const unreadTotal = useMemo(() => all.reduce((sum, c) => sum + (c.unreadCount ?? 0), 0), [all]);

  return {
    conversations,
    unreadTotal,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: () => void query.refetch(),
  };
}
