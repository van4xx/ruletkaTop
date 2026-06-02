'use client';

/**
 * Computes the interests the current viewer shares with the matched peer, for
 * the in-call "общий интерес" badge.
 *
 * `PeerInfo` (the matchmaking payload) intentionally doesn't carry interests, so
 * we derive them from the EXISTING profile fetches:
 *   • the viewer's own interests come from the economy "me" query, and
 *   • the peer's interests come from its public-profile fetch (`useProfile`).
 *
 * The peer fetch is privacy-gated + view-throttled server-side, so it degrades
 * gracefully: if the peer hides their profile (or it fails to load) we simply
 * return `[]` and the badge is skipped — matching the "otherwise skip" rule.
 *
 * We only fetch the peer profile when the viewer actually has interests (no
 * interests → nothing can be shared → no need to hit the network for a badge
 * that could never show).
 */
import { useMemo } from 'react';
import { useProfile } from '@/features/profile/use-profile';
import { useMe } from '@/features/economy/use-me';
import { sharedInterests } from '@/features/profile/interests';

export function useSharedInterests(peerUserId: string | undefined): string[] {
  const me = useMe();
  const myInterests = me.data?.interests ?? [];
  const hasMyInterests = myInterests.length > 0;

  // Only fetch the peer profile when it could possibly produce a shared tag.
  const peerProfile = useProfile(hasMyInterests ? peerUserId : undefined);
  const peerInterests = peerProfile.data?.interests ?? [];

  return useMemo(
    () => (hasMyInterests ? sharedInterests(myInterests, peerInterests) : []),
    [hasMyInterests, myInterests, peerInterests],
  );
}
