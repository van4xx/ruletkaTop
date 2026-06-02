'use client';

/**
 * Thin social-feature adapters over the canonical auth feature
 * (`@/features/auth`). The auth-settings feature owns the session, token
 * persistence and `/auth/me` revalidation; social surfaces only need to read
 * "who am I" and "am I signed in", so we delegate rather than duplicate.
 *
 * Note: the backend's `/auth/me` returns an `AuthUser` (id/email/role/nickname/
 * isPremium) — NOT a full `PublicProfile`. For the rich own-profile (status,
 * country, gifts, …) fetch `/profiles/:id` via the profile hooks.
 */
import { useAuth } from '@/features/auth';

/** The current user's id, or `null` when unauthenticated / not yet ready. */
export function useCurrentUserId(): string | null {
  const { user } = useAuth();
  return user?.id ?? null;
}

/** Re-export the canonical hooks for ergonomic imports within social code. */
export { useAuth, useCurrentUser } from '@/features/auth';
