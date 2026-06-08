import { z } from 'zod';
import {
  badgeSchema,
  countryCodeSchema,
  genderSchema,
  isoDateSchema,
  localeSchema,
  objectIdSchema,
  paginationQuerySchema,
} from './common';
import { nicknameSchema } from './auth';
import { coverIdSchema, DEFAULT_COVER_ID } from './cosmetics';

/**
 * An avatar reference. Either a server-RELATIVE path served by the API/CDN
 * (e.g. `/uploads/avatars/<file>.webp`, produced by the avatar-upload endpoint)
 * or a legacy absolute URL. Kept as a plain (non-`.url()`) string so the
 * self-hosted served path validates — mirrors how `avatarUrl` is already typed
 * across the rest of the contract (leaderboard/economy/moderation/matchmaking).
 */
const avatarUrlSchema = z.string().min(1).max(2048);

export const publicProfileSchema = z.object({
  id: objectIdSchema,
  nickname: nicknameSchema,
  avatarUrl: avatarUrlSchema.nullable(),
  status: z.string().max(140).nullable(),
  gender: genderSchema,
  age: z.number().int().min(18).max(120),
  country: countryCodeSchema,
  languages: z.array(localeSchema),
  /** Free-form interest tags (music, gaming, travel…), used for smart matching. */
  interests: z.array(z.string().min(1).max(24)).max(10).default([]),
  badges: z.array(badgeSchema),
  isPremium: z.boolean(),
  /**
   * The user's selected profile-cover cosmetic, read on every hero render.
   * Defaulted to {@link DEFAULT_COVER_ID} so responses from an API that predates
   * the field (and older mobile/admin mirrors) still validate client-side.
   */
  activeCover: coverIdSchema.default(DEFAULT_COVER_ID),
  profileViews: z.number().int().nonnegative(),
  createdAt: isoDateSchema,
});
export type PublicProfile = z.infer<typeof publicProfileSchema>;

/**
 * The MINIMAL identity projection of a profile — just enough to render a user
 * (nickname + avatar) without exposing any private detail. Returned for a user
 * you are already entitled to see by another relationship (e.g. an existing
 * chat partner) even when their full `whoCanViewProfile` privacy would 404 the
 * full {@link PublicProfile}. A strict subset of `publicProfileSchema`'s fields
 * so a `PublicProfile` is always assignable where a `MinimalProfile` is wanted.
 */
export const minimalProfileSchema = z.object({
  id: objectIdSchema,
  nickname: nicknameSchema,
  avatarUrl: avatarUrlSchema.nullable(),
});
export type MinimalProfile = z.infer<typeof minimalProfileSchema>;

/**
 * Owner profile PATCH (`PATCH /profiles/me`). Every field is optional (partial).
 *
 * NOTE: `avatarUrl` is deliberately NOT settable here. The avatar is now managed
 * exclusively by the dedicated upload surface (`POST /profiles/me/avatar` to set,
 * `DELETE /profiles/me/avatar` to reset) so the server always owns the stored
 * path (a re-encoded, validated local file) — a client can no longer point the
 * avatar at an arbitrary URL through the generic profile patch.
 */
export const updateProfileSchema = z
  .object({
    nickname: nicknameSchema,
    status: z.string().max(140),
    gender: genderSchema,
    birthDate: z.string(),
    country: countryCodeSchema,
    languages: z.array(localeSchema).max(5),
    interests: z.array(z.string().min(1).max(24)).max(10),
  })
  .partial();
export type UpdateProfileDto = z.infer<typeof updateProfileSchema>;

/**
 * Maximum avatar upload size in bytes (~5 MB). Enforced server-side by multer's
 * limit AND surfaced to the client so the file picker can reject oversize files
 * before the round-trip. Keep the two in lock-step.
 */
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Image mimetypes accepted by the avatar upload. The server does NOT trust this
 * list alone — it additionally sniffs the file's magic bytes and re-encodes —
 * but it gates the client `accept` and gives a fast first-line rejection.
 */
export const AVATAR_ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
] as const;
export type AvatarAllowedMimeType = (typeof AVATAR_ALLOWED_MIME_TYPES)[number];

/**
 * Response of `POST /profiles/me/avatar` and `DELETE /profiles/me/avatar`: the
 * caller's full updated public profile (so the client can refresh its `me`
 * caches from a single source of truth). Identical shape to {@link PublicProfile};
 * aliased for endpoint-contract clarity.
 */
export type AvatarUploadResponse = PublicProfile;

/**
 * Query for `GET /profiles/search` — a free-text nickname prefix plus optional
 * gender / country facets, cursor-paginated. `q` is trimmed and bounded; empty
 * facets are simply omitted from the filter server-side.
 */
export const profileSearchQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().min(1).max(24).optional(),
  gender: genderSchema.optional(),
  country: countryCodeSchema.optional(),
});
export type ProfileSearchQuery = z.infer<typeof profileSearchQuerySchema>;
