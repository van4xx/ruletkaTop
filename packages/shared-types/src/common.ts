import { z } from 'zod';

/** Mongo ObjectId as a 24-char hex string (the over-the-wire form). */
export const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');
export type ObjectId = z.infer<typeof objectIdSchema>;

/** ISO-8601 timestamp string, e.g. `2026-05-31T12:00:00.000Z`. */
export const isoDateSchema = z.string();
export type IsoDate = z.infer<typeof isoDateSchema>;

/** ISO 3166-1 alpha-2 country code, uppercase (e.g. `RU`, `US`). */
export const countryCodeSchema = z
  .string()
  .length(2)
  .regex(/^[A-Z]{2}$/, 'Country must be ISO 3166-1 alpha-2');
export type CountryCode = z.infer<typeof countryCodeSchema>;

export const genderSchema = z.enum(['male', 'female', 'other']);
export type Gender = z.infer<typeof genderSchema>;

/** Gender preference used by matchmaking filters. */
export const genderPreferenceSchema = z.enum(['any', 'male', 'female']);
export type GenderPreference = z.infer<typeof genderPreferenceSchema>;

export const matchTypeSchema = z.enum(['video', 'voice']);
export type MatchType = z.infer<typeof matchTypeSchema>;

export const localeSchema = z.enum(['ru', 'en']);
export type Locale = z.infer<typeof localeSchema>;

export const themeSchema = z.enum(['light', 'dark', 'system']);
export type Theme = z.infer<typeof themeSchema>;

export const roleSchema = z.enum(['user', 'moderator', 'admin']);
export type Role = z.infer<typeof roleSchema>;

export const badgeSchema = z.enum(['premium', 'verified', 'top', 'staff']);
export type Badge = z.infer<typeof badgeSchema>;

export const raritySchema = z.enum(['common', 'rare', 'epic', 'legendary']);
export type Rarity = z.infer<typeof raritySchema>;

export const onlineStatusSchema = z.enum(['online', 'offline', 'in_call', 'away']);
export type OnlineStatus = z.infer<typeof onlineStatusSchema>;

/** Cursor-based pagination query. `limit` is coerced from query strings. */
export const paginationQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export const paginationMetaSchema = z.object({
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});
export type PaginationMeta = z.infer<typeof paginationMetaSchema>;

/** Standard API error response body. */
export const apiErrorSchema = z.object({
  statusCode: z.number(),
  message: z.union([z.string(), z.array(z.string())]),
  error: z.string().optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
