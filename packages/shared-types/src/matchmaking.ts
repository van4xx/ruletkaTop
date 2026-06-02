import { z } from 'zod';
import {
  badgeSchema,
  countryCodeSchema,
  genderPreferenceSchema,
  genderSchema,
  isoDateSchema,
  matchTypeSchema,
  objectIdSchema,
} from './common';

export const matchFiltersSchema = z
  .object({
    gender: genderPreferenceSchema.default('any'),
    ageMin: z.number().int().min(18).max(120).default(18),
    ageMax: z.number().int().min(18).max(120).default(120),
    countries: z.array(countryCodeSchema).max(50).default([]),
    /** Premium: only match peers who share ≥1 interest (else interests just boost priority). */
    sharedInterestsOnly: z.boolean().default(false),
  })
  .refine((v) => v.ageMin <= v.ageMax, { message: 'ageMin must be <= ageMax' });
export type MatchFilters = z.infer<typeof matchFiltersSchema>;

/** Minimal peer info shown in the call overlay. */
export const peerInfoSchema = z.object({
  userId: objectIdSchema,
  nickname: z.string(),
  age: z.number().int(),
  gender: genderSchema,
  country: countryCodeSchema,
  avatarUrl: z.string().nullable(),
  badges: z.array(badgeSchema),
  isPremium: z.boolean(),
});
export type PeerInfo = z.infer<typeof peerInfoSchema>;

export const matchEndReasonSchema = z.enum(['next', 'stop', 'disconnect', 'timeout', 'reported']);
export type MatchEndReason = z.infer<typeof matchEndReasonSchema>;

export const matchSchema = z.object({
  id: objectIdSchema,
  userA: objectIdSchema,
  userB: objectIdSchema,
  type: matchTypeSchema,
  startedAt: isoDateSchema,
  endedAt: isoDateSchema.nullable(),
  endReason: matchEndReasonSchema.nullable(),
});
export type Match = z.infer<typeof matchSchema>;
