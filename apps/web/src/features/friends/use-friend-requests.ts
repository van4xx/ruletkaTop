'use client';

/**
 * Incoming friend-request awareness, driven by the realtime notification feed.
 *
 * ── Contract gap (flagged for the integrator) ────────────────────────────
 * The API currently has NO endpoint to list a user's pending *incoming* friend
 * requests, and the `notif:new` payload (id/kind/title/body/createdAt) does not
 * carry the `friendshipId` needed to call `POST /friends/:id/accept`. So this
 * hook surfaces incoming requests for awareness (live count + list) but cannot
 * yet wire a one-tap Accept/Decline.
 *
 * To make Accept/Decline work, the backend needs either:
 *   (a) `GET /friends/requests` → Friendship[] (with requester profiles), or
 *   (b) a `friendshipId` (+ minimal requester profile) embedded in the
 *       `friend_request` notification payload.
 * Once available, replace this with a real query/mutation; the page already
 * renders a requests section that will light up automatically.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AppNotification } from '@ruletka/shared-types';

import { useSocketEvent } from '@/features/chat/lib/use-socket';
import { friendsKeys } from './use-friends';

export interface FriendRequestNotice extends AppNotification {
  kind: 'friend_request';
}

export function useFriendRequestsInbox(): {
  requests: FriendRequestNotice[];
  dismiss: (id: string) => void;
} {
  const qc = useQueryClient();
  const [requests, setRequests] = useState<FriendRequestNotice[]>([]);

  useSocketEvent('notif:new', (n) => {
    if (n.kind === 'friend_request') {
      const notice: FriendRequestNotice = { ...n, kind: 'friend_request' };
      setRequests((prev) => {
        if (prev.some((r) => r.id === notice.id)) return prev;
        return [notice, ...prev].slice(0, 50);
      });
      // A new relationship may now be visible; refresh the accepted list lazily.
      void qc.invalidateQueries({ queryKey: friendsKeys.list() });
    }
  });

  const dismiss = (id: string) => setRequests((prev) => prev.filter((r) => r.id !== id));

  return { requests, dismiss };
}
