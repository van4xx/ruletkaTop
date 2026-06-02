import type { PeerInfo, PublicProfile } from '@ruletka/shared-types';

/**
 * Cross-module service contracts CONSUMED by the realtime layer.
 *
 * Why interfaces + DI tokens instead of importing the concrete service
 * classes? Five agents build `apps/api/src/modules/*` in parallel; the
 * identity / social / economy modules may not yet exist on disk while this
 * module compiles. Depending on a structural interface (the *shape* the
 * INTER-MODULE SERVICE CONTRACT promises) keeps this module type-safe and
 * self-contained, and lets the integrator bind the real providers to these
 * tokens at wiring time (`{ provide: PROFILES_SERVICE, useExisting: ProfilesService }`).
 *
 * Each interface lists ONLY the methods this module actually calls — a minimal,
 * honest contract.
 */

// ── identity → ProfilesService ─────────────────────────────────────────────
export interface ProfilesServiceContract {
  /** Public profile used to build {@link PeerInfo} for the call overlay. */
  getPublicProfile(userId: string): Promise<PublicProfile>;
  /**
   * Age + gender + interests for filter compatibility / interest-aware ranking
   * (cheaper than a full profile build). `interests` is normalised and defaults
   * to `[]` for profiles with none.
   */
  getAgeAndGender(
    userId: string,
  ): Promise<{ age: number; gender: PublicProfile['gender']; interests: string[] }>;
}
export const PROFILES_SERVICE = Symbol('PROFILES_SERVICE');

// ── social → BlocksService ─────────────────────────────────────────────────
export interface BlocksServiceContract {
  /** True if `viewerId` has blocked `targetId` (one direction). */
  isBlocked(viewerId: string, targetId: string): Promise<boolean>;
}
export const BLOCKS_SERVICE = Symbol('BLOCKS_SERVICE');

// ── economy → PremiumService ───────────────────────────────────────────────
export interface PremiumServiceContract {
  /** True if the user currently holds an active premium subscription. */
  isPremium(userId: string): Promise<boolean>;
}
export const PREMIUM_SERVICE = Symbol('PREMIUM_SERVICE');

// ── social → FriendsService ────────────────────────────────────────────────
export interface FriendsServiceContract {
  /** True if `a` and `b` have an ACCEPTED friendship (order-independent). */
  areFriends(a: string, b: string): Promise<boolean>;
}
export const FRIENDS_SERVICE = Symbol('FRIENDS_SERVICE');
