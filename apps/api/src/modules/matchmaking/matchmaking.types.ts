import type { MatchFilters, MatchType } from '@ruletka/shared-types';

/**
 * Everything the matcher needs to know about one waiting user, persisted in
 * Redis (`mm:waiter:<userId>`) while they sit in the pool. Kept compact: the
 * filters + the demographic facts needed to test mutual compatibility, plus the
 * routing info to deliver the `mm:matched` event across nodes.
 */
export interface WaiterEntry {
  userId: string;
  type: MatchType;
  /** This waiter's own filters (what THEY want in a peer). */
  filters: MatchFilters;
  /** This waiter's own demographics (what they OFFER to a peer's filters). */
  age: number;
  gender: 'male' | 'female' | 'other';
  country: string;
  /**
   * This waiter's normalised interest tags (lowercased, deduped). Used to
   * PRIORITISE peers with overlapping interests, and — when their own
   * `filters.sharedInterestsOnly` is set — to REQUIRE ≥1 shared interest.
   * Empty for users who set no interests (they still match).
   */
  interests: string[];
  /** Premium gets matched first. */
  isPremium: boolean;
  /** Socket id this user is currently waiting on (for room join / direct emit). */
  socketId: string;
  /** Epoch ms the waiter joined the pool (FIFO tiebreak within a priority bucket). */
  joinedAt: number;
}

/**
 * Live room descriptor, persisted in Redis (`mm:room:<roomId>`) for the
 * lifetime of a call. Lets any node tear the room down (hangup / next /
 * disconnect / stale sweep) and resolve "who is the peer of this user".
 */
export interface RoomState {
  roomId: string;
  type: MatchType;
  /** Persisted Match document id (for {@link MatchService.endMatch}). */
  matchId: string;
  userA: string;
  userB: string;
  createdAt: number;
}

/** A user's pointer to the room they are currently in (`mm:userroom:<userId>`). */
export interface UserRoomPointer {
  roomId: string;
  /** The user's own filters at join time — reused when they hit `mm:next`. */
  filters: MatchFilters;
  type: MatchType;
}
