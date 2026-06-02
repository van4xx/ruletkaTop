import { z } from 'zod';
import {
  countryCodeSchema,
  genderSchema,
  isoDateSchema,
  objectIdSchema,
  roleSchema,
} from './common';

/**
 * Admin-panel contract (admin.ruletka.top). All endpoints are role-gated to
 * `moderator`/`admin` server-side; role changes are `admin`-only.
 */

/** A row in the admin user list. */
export const adminUserSummarySchema = z.object({
  id: objectIdSchema,
  email: z.string().email(),
  nickname: z.string(),
  role: roleSchema,
  isPremium: z.boolean(),
  emailVerified: z.boolean(),
  isBanned: z.boolean(),
  country: countryCodeSchema.nullable().optional(),
  gender: genderSchema.nullable().optional(),
  createdAt: isoDateSchema,
});
export type AdminUserSummary = z.infer<typeof adminUserSummarySchema>;

/** `GET /admin/users` query — text search + filters, cursor-paginated. */
export const adminUserListQuerySchema = z.object({
  /** Free-text match on email or nickname. */
  q: z.string().trim().max(120).optional(),
  role: roleSchema.optional(),
  banned: z.coerce.boolean().optional(),
  cursor: objectIdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type AdminUserListQuery = z.infer<typeof adminUserListQuerySchema>;

export const adminUserListSchema = z.object({
  items: z.array(adminUserSummarySchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});
export type AdminUserList = z.infer<typeof adminUserListSchema>;

/** `POST /admin/users/:id/role` — set a user's role (admin-only). */
export const setUserRoleSchema = z.object({ role: roleSchema });
export type SetUserRoleDto = z.infer<typeof setUserRoleSchema>;

/** A recent ledger entry for the economy overview. */
export const adminTransactionSchema = z.object({
  id: objectIdSchema,
  userId: objectIdSchema,
  kind: z.string(),
  amountCoins: z.number(),
  createdAt: isoDateSchema,
});
export type AdminTransaction = z.infer<typeof adminTransactionSchema>;

/** `GET /admin/economy/overview` — aggregate economy + population stats. */
export const economyOverviewSchema = z.object({
  totalUsers: z.number().int().nonnegative(),
  premiumUsers: z.number().int().nonnegative(),
  bannedUsers: z.number().int().nonnegative(),
  verifiedUsers: z.number().int().nonnegative(),
  /** Sum of all wallet balances (coins currently held by users). */
  coinsInCirculation: z.number().nonnegative(),
  /** Total coin value of gifts ever sent. */
  giftsValueCoins: z.number().nonnegative(),
  /** Currently-active Top-feed placements. */
  activeTopPlacements: z.number().int().nonnegative(),
  /** New users in the last 24h / 7d. */
  newUsers24h: z.number().int().nonnegative(),
  newUsers7d: z.number().int().nonnegative(),
  recentTransactions: z.array(adminTransactionSchema),
});
export type EconomyOverview = z.infer<typeof economyOverviewSchema>;
