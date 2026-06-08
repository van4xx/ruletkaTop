'use client';

/**
 * Lightweight, realtime "you have incoming friend requests" AWARENESS feed,
 * driven by `notif:new` (kind `friend_request`). It powers the live banner on
 * the friends list (count + recent notices) and nudges the user toward the
 * dedicated requests surface.
 *
 * This is intentionally awareness-only: the actual list-and-act flow lives on
 * `/friends/requests`, backed by `GET /friends/requests` (`{ incoming, outgoing }`)
 * and one-tap `POST /friends/:id/accept` / `DELETE /friends/:id` via
 * `useFriendRequests` — which carry the `friendshipId` the lean notification
 * payload deliberately omits. So the banner links over there ("View") rather
 * than duplicating per-row accept/decline. A new `friend_request` notice also
 * invalidates the accepted-friends list so it refreshes without a reload.
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

  useSocketEvent(
    'notif:new',
    (n) => {
      if (n.kind === 'friend_request') {
        const notice: FriendRequestNotice = { ...n, kind: 'friend_request' };
        setRequests((prev) => {
          if (prev.some((r) => r.id === notice.id)) return prev;
          return [notice, ...prev].slice(0, 50);
        });
        // A new relationship may now be visible; refresh the accepted list lazily.
        void qc.invalidateQueries({ queryKey: friendsKeys.list() });
      }
    },
    // `notif:new` is delivered on the /mm gateway.
    '/mm',
  );

  const dismiss = (id: string) => setRequests((prev) => prev.filter((r) => r.id !== id));

  return { requests, dismiss };
}
