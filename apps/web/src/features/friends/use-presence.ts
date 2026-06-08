'use client';

/**
 * Live presence tracking over the socket. Maintains a `userId → OnlineStatus`
 * map seeded from initial statuses (e.g. from the friends list) and updated in
 * real time via `presence:online` / `presence:offline`. Subscribes the socket
 * to the ids it cares about via `presence:subscribe`.
 *
 * All presence traffic rides the `/mm` socket (presence is delivered by the /mm
 * gateway): `presence:subscribe(ids)` joins each subject's watch room and the
 * gateway replies with the current status plus live `presence:online` /
 * `presence:offline` transitions.
 *
 * Used by the friends list (live dots) and the chat header.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { OnlineStatus } from '@ruletka/shared-types';

import { useSocket, useSocketEvent } from '@/features/chat/lib/use-socket';

export type PresenceMap = Record<string, OnlineStatus>;

/**
 * @param userIds   ids to track (the hook re-subscribes when the set changes)
 * @param seed      initial statuses (e.g. server-provided), applied once per id
 */
export function usePresence(userIds: string[], seed?: PresenceMap): PresenceMap {
  const socket = useSocket('/mm');
  const [presence, setPresence] = useState<PresenceMap>(() => ({ ...seed }));

  // Stable, de-duplicated, sorted key so the subscribe effect only re-runs when
  // the actual membership changes — not on every render.
  const idsKey = useMemo(() => Array.from(new Set(userIds)).sort().join(','), [userIds]);

  // Fold in any newly-seeded statuses (without clobbering live updates we
  // already received for an id).
  const seededRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!seed) return;
    setPresence((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [id, status] of Object.entries(seed)) {
        if (!seededRef.current.has(id) && next[id] === undefined) {
          next[id] = status;
          seededRef.current.add(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [seed]);

  // Ask the gateway to push presence for these ids.
  useEffect(() => {
    if (!idsKey) return;
    const ids = idsKey.split(',').filter(Boolean);
    if (ids.length === 0) return;
    const emit = () => socket.emit('presence:subscribe', ids);
    if (socket.connected) emit();
    socket.on('connect', emit);
    return () => {
      socket.off('connect', emit);
    };
  }, [socket, idsKey]);

  useSocketEvent(
    'presence:online',
    (p) => {
      setPresence((prev) => ({ ...prev, [p.userId]: p.status ?? 'online' }));
    },
    '/mm',
  );
  useSocketEvent(
    'presence:offline',
    (p) => {
      setPresence((prev) => ({ ...prev, [p.userId]: 'offline' }));
    },
    '/mm',
  );

  return presence;
}
