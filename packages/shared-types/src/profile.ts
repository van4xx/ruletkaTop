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

export const publicProfileSchema = z.object({
  id: objectIdSchema,
  nickname: nicknameSchema,
  avatarUrl: z.string().url().nullable(),
  status: z.string().max(140).nullable(),
  gender: genderSchema,
  age: z.number().int().min(18).max(120),
  country: countryCodeSchema,
  languages: z.array(localeSchema),
  /** Free-form interest tags (music, gaming, travel…), used for smart matching. */
  interests: z.array(z.string().min(1).max(24)).max(10).default([]),
  badges: z.array(badgeSchema),
  isPremium: z.boolean(),
  profileViews: z.number().int().nonnegative(),
  createdAt: isoDateSchema,
});
export type PublicProfile = z.infer<typeof publicProfileSchema>;

export const updateProfileSchema = z
  .object({
    nickname: nicknameSchema,
    status: z.string().max(140),
    avatarUrl: z.string().url(),
    gender: genderSchema,
    birthDate: z.string(),
    country: countryCodeSchema,
    languages: z.array(localeSchema).max(5),
    interests: z.array(z.string().min(1).max(24)).max(10),
  })
  .partial();
export type UpdateProfileDto = z.infer<typeof updateProfileSchema>;

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
