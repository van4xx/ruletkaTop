import { z } from 'zod';
import { isoDateSchema, objectIdSchema } from './common';

/**
 * Admin-panel WAVE-1 contract (admin.ruletka.top) — the scaffold surface.
 *
 * These types are the CONTRACT shared by the API (`apps/api/src/modules/admin`)
 * and the admin SPA (`apps/admin`). Every endpoint here is role-gated to
 * `moderator`/`admin` server-side (some narrow to `admin`-only). Wave-2 agents
 * deepen the logic behind these shapes; this file fixes the wire format so both
 * sides compile against one source of truth.
 *
 * The pre-existing admin contract (users directory + economy overview) lives in
 * `admin.ts`; this file is the ADDITIVE expansion (analytics, wallet, premium,
 * payments, calls, content, broadcast, security, settings, audit). Shapes that
 * Wave-1 STUBS server-side are marked `// TODO(wave2)` in the controller, but
 * the type is final.
 */

// ════════════════════════════════ Analytics ════════════════════════════════

/** `GET /admin/analytics/overview` — headline KPIs for the dashboard. */
export const adminAnalyticsOverviewSchema = z.object({
  totalUsers: z.number().int().nonnegative(),
  onlineUsers: z.number().int().nonnegative(),
  newUsers24h: z.number().int().nonnegative(),
  newUsers7d: z.number().int().nonnegative(),
  premiumUsers: z.number().int().nonnegative(),
  bannedUsers: z.number().int().nonnegative(),
  /** Σ of all wallet balances (coins currently held by users). */
  coinsInCirculation: z.number().nonnegative(),
  /** Gross revenue (RUB) from completed payments, all-time. */
  revenueRubTotal: z.number().nonnegative(),
  /** Revenue (RUB) from completed payments in the last 24h. */
  revenueRub24h: z.number().nonnegative(),
  /** Total calls (matches) ever recorded. */
  callsTotal: z.number().int().nonnegative(),
  /** Calls started in the last 24h. */
  calls24h: z.number().int().nonnegative(),
  /** Reports/flags still awaiting a human decision. */
  openReports: z.number().int().nonnegative(),
});
export type AdminAnalyticsOverview = z.infer<typeof adminAnalyticsOverviewSchema>;

/** Metrics the timeseries endpoint can plot. */
export const adminTimeseriesMetricSchema = z.enum(['signups', 'revenue', 'calls']);
export type AdminTimeseriesMetric = z.infer<typeof adminTimeseriesMetricSchema>;

/** Bucketing range for the timeseries endpoint. */
export const adminTimeseriesRangeSchema = z.enum(['7d', '30d', '90d']);
export type AdminTimeseriesRange = z.infer<typeof adminTimeseriesRangeSchema>;

/** `GET /admin/analytics/timeseries` query. */
export const adminTimeseriesQuerySchema = z.object({
  metric: adminTimeseriesMetricSchema.default('signups'),
  range: adminTimeseriesRangeSchema.default('30d'),
});
export type AdminTimeseriesQuery = z.infer<typeof adminTimeseriesQuerySchema>;

/** A single day's bucket: an ISO date (`YYYY-MM-DD`) and its value. */
export const adminTimeseriesPointSchema = z.object({
  /** Bucket day, `YYYY-MM-DD`. */
  date: z.string(),
  value: z.number(),
});
export type AdminTimeseriesPoint = z.infer<typeof adminTimeseriesPointSchema>;

/** `GET /admin/analytics/timeseries` response. */
export const adminTimeseriesSchema = z.object({
  metric: adminTimeseriesMetricSchema,
  range: adminTimeseriesRangeSchema,
  points: z.array(adminTimeseriesPointSchema),
});
export type AdminTimeseries = z.infer<typeof adminTimeseriesSchema>;

// ═════════════════════════════════ Wallet ══════════════════════════════════

/** A single ledger row as the wallet detail surface renders it. */
export const adminLedgerEntrySchema = z.object({
  id: objectIdSchema,
  delta: z.number().int(),
  type: z.string(),
  refId: z.string().nullable(),
  balanceAfter: z.number().int().nonnegative(),
  createdAt: isoDateSchema,
});
export type AdminLedgerEntry = z.infer<typeof adminLedgerEntrySchema>;

/** `GET /admin/wallet/:userId` — balance + a page of the user's ledger. */
export const adminWalletDetailSchema = z.object({
  userId: objectIdSchema,
  balanceCoins: z.number().int().nonnegative(),
  ledger: z.array(adminLedgerEntrySchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});
export type AdminWalletDetail = z.infer<typeof adminWalletDetailSchema>;

/** `POST /admin/wallet/:userId/adjust` body — signed manual credit/debit. */
export const adminWalletAdjustSchema = z.object({
  /** Non-zero signed coin delta (positive credits, negative debits). */
  amount: z.coerce.number().int().refine((n) => n !== 0, 'Amount must be non-zero'),
  reason: z.string().trim().min(1).max(280),
});
export type AdminWalletAdjustDto = z.infer<typeof adminWalletAdjustSchema>;

/** `POST /admin/wallet/:userId/adjust` result — the new balance. */
export const adminWalletAdjustResultSchema = z.object({
  userId: objectIdSchema,
  balanceCoins: z.number().int().nonnegative(),
  delta: z.number().int(),
});
export type AdminWalletAdjustResult = z.infer<typeof adminWalletAdjustResultSchema>;

/** `GET /admin/wallet/stats` — economy-wide wallet aggregates. */
export const adminWalletStatsSchema = z.object({
  coinsInCirculation: z.number().nonnegative(),
  walletCount: z.number().int().nonnegative(),
  /** Mean balance across all wallets. */
  averageBalance: z.number().nonnegative(),
  /** Largest single wallet balance. */
  topBalance: z.number().int().nonnegative(),
});
export type AdminWalletStats = z.infer<typeof adminWalletStatsSchema>;

// ════════════════════════════════ Premium ══════════════════════════════════

/** A subscriber row in the premium list. */
export const adminSubscriberSchema = z.object({
  userId: objectIdSchema,
  nickname: z.string(),
  email: z.string(),
  plan: z.string(),
  status: z.string(),
  startedAt: isoDateSchema.nullable(),
  currentPeriodEnd: isoDateSchema.nullable(),
  cancelAtPeriodEnd: z.boolean(),
});
export type AdminSubscriber = z.infer<typeof adminSubscriberSchema>;

/** `GET /admin/premium` — paginated subscribers + active count. */
export const adminPremiumListSchema = z.object({
  items: z.array(adminSubscriberSchema),
  activeCount: z.number().int().nonnegative(),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});
export type AdminPremiumList = z.infer<typeof adminPremiumListSchema>;

/** `POST /admin/premium/:userId/grant` body — comp premium for N days. */
export const adminGrantPremiumSchema = z.object({
  days: z.coerce.number().int().min(1).max(3650),
});
export type AdminGrantPremiumDto = z.infer<typeof adminGrantPremiumSchema>;

// ════════════════════════════════ Payments ═════════════════════════════════

/** A charge row in the payments list. */
export const adminPaymentSchema = z.object({
  id: objectIdSchema,
  userId: objectIdSchema,
  provider: z.string(),
  invoiceId: z.string(),
  amount: z.number(),
  currency: z.string(),
  status: z.string(),
  purpose: z.string(),
  createdAt: isoDateSchema,
});
export type AdminPayment = z.infer<typeof adminPaymentSchema>;

/** `GET /admin/payments` — paginated charges. */
export const adminPaymentListSchema = z.object({
  items: z.array(adminPaymentSchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});
export type AdminPaymentList = z.infer<typeof adminPaymentListSchema>;

/** `GET /admin/payments/stats` — revenue + funnel aggregates. */
export const adminPaymentStatsSchema = z.object({
  /** Gross revenue (RUB) from completed charges. */
  revenueRubTotal: z.number().nonnegative(),
  revenueRub24h: z.number().nonnegative(),
  completedCount: z.number().int().nonnegative(),
  pendingCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  refundedCount: z.number().int().nonnegative(),
});
export type AdminPaymentStats = z.infer<typeof adminPaymentStatsSchema>;

// ═════════════════════════════════ Calls ═══════════════════════════════════

/** `GET /admin/calls/stats` — match/call volume + mix. */
export const adminCallsStatsSchema = z.object({
  totalCalls: z.number().int().nonnegative(),
  calls24h: z.number().int().nonnegative(),
  videoCalls: z.number().int().nonnegative(),
  voiceCalls: z.number().int().nonnegative(),
  /** Active matches happening right now. */
  liveCalls: z.number().int().nonnegative(),
  /** Mean call duration in seconds (0 when unknown). */
  averageDurationSec: z.number().nonnegative(),
});
export type AdminCallsStats = z.infer<typeof adminCallsStatsSchema>;

/** A recent call/match row. */
export const adminCallSchema = z.object({
  id: objectIdSchema,
  type: z.string(),
  participantA: objectIdSchema.nullable(),
  participantB: objectIdSchema.nullable(),
  durationSec: z.number().int().nonnegative().nullable(),
  startedAt: isoDateSchema,
  endedAt: isoDateSchema.nullable(),
});
export type AdminCall = z.infer<typeof adminCallSchema>;

/** `GET /admin/calls/recent` — newest calls. */
export const adminCallListSchema = z.object({
  items: z.array(adminCallSchema),
});
export type AdminCallList = z.infer<typeof adminCallListSchema>;

// ════════════════════════════════ Content ══════════════════════════════════

/** A cover catalogue row with live ownership counts. */
export const adminCoverSchema = z.object({
  id: z.string(),
  name: z.string(),
  tier: z.string(),
  priceCoins: z.number().int().nonnegative(),
  accent: z.string(),
  /** How many profiles currently own this cover. */
  ownedCount: z.number().int().nonnegative(),
});
export type AdminCover = z.infer<typeof adminCoverSchema>;

/** `GET /admin/content/covers` — covers + ownership analytics. */
export const adminCoverListSchema = z.object({
  items: z.array(adminCoverSchema),
});
export type AdminCoverList = z.infer<typeof adminCoverListSchema>;

/** A platform announcement (system banner / changelog entry). */
export const adminAnnouncementSchema = z.object({
  id: objectIdSchema,
  title: z.string(),
  body: z.string(),
  active: z.boolean(),
  createdAt: isoDateSchema,
});
export type AdminAnnouncement = z.infer<typeof adminAnnouncementSchema>;

/** `GET /admin/content/announcements` — announcement list. */
export const adminAnnouncementListSchema = z.object({
  items: z.array(adminAnnouncementSchema),
});
export type AdminAnnouncementList = z.infer<typeof adminAnnouncementListSchema>;

/** `POST /admin/content/announcements` body. */
export const adminCreateAnnouncementSchema = z.object({
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(2000),
  active: z.boolean().default(true),
});
export type AdminCreateAnnouncementDto = z.infer<typeof adminCreateAnnouncementSchema>;

// ═══════════════════════════════ Broadcast ═════════════════════════════════

/** Audience segment for a broadcast. */
export const adminBroadcastSegmentSchema = z.enum(['all', 'premium', 'active', 'banned']);
export type AdminBroadcastSegment = z.infer<typeof adminBroadcastSegmentSchema>;

/** `POST /admin/broadcast` body — fan-out a notification to a segment. */
export const adminBroadcastSchema = z.object({
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(2000),
  segment: adminBroadcastSegmentSchema.default('all'),
});
export type AdminBroadcastDto = z.infer<typeof adminBroadcastSchema>;

/** A past broadcast record. */
export const adminBroadcastRecordSchema = z.object({
  id: objectIdSchema,
  title: z.string(),
  body: z.string(),
  segment: adminBroadcastSegmentSchema,
  /** How many recipients the fan-out targeted. */
  recipients: z.number().int().nonnegative(),
  createdAt: isoDateSchema,
});
export type AdminBroadcastRecord = z.infer<typeof adminBroadcastRecordSchema>;

/** `POST /admin/broadcast` result. */
export const adminBroadcastResultSchema = z.object({
  id: objectIdSchema,
  recipients: z.number().int().nonnegative(),
});
export type AdminBroadcastResult = z.infer<typeof adminBroadcastResultSchema>;

/** `GET /admin/broadcast` — broadcast history. */
export const adminBroadcastHistorySchema = z.object({
  items: z.array(adminBroadcastRecordSchema),
});
export type AdminBroadcastHistory = z.infer<typeof adminBroadcastHistorySchema>;

// ═══════════════════════════════ Security ══════════════════════════════════

/** An active refresh session row (security surface). */
export const adminSessionSchema = z.object({
  id: objectIdSchema,
  userId: objectIdSchema,
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  device: z.string().nullable(),
  createdAt: isoDateSchema,
  expiresAt: isoDateSchema,
  revoked: z.boolean(),
});
export type AdminSession = z.infer<typeof adminSessionSchema>;

/** `GET /admin/security/sessions` — recent sessions + live count. */
export const adminSessionListSchema = z.object({
  items: z.array(adminSessionSchema),
  /** Sessions that are neither expired nor revoked. */
  activeCount: z.number().int().nonnegative(),
});
export type AdminSessionList = z.infer<typeof adminSessionListSchema>;

/** A security-relevant event (login lock, ban, reuse-detection …). */
export const adminSecurityEventSchema = z.object({
  id: objectIdSchema,
  type: z.string(),
  userId: objectIdSchema.nullable(),
  detail: z.string(),
  createdAt: isoDateSchema,
});
export type AdminSecurityEvent = z.infer<typeof adminSecurityEventSchema>;

/** `GET /admin/security/events` — recent security events. */
export const adminSecurityEventListSchema = z.object({
  items: z.array(adminSecurityEventSchema),
});
export type AdminSecurityEventList = z.infer<typeof adminSecurityEventListSchema>;

// ═══════════════════════════════ Settings ══════════════════════════════════

/** A single feature flag / limit, read from server config (env-backed). */
export const adminSettingFlagSchema = z.object({
  key: z.string(),
  label: z.string(),
  value: z.union([z.boolean(), z.number(), z.string()]),
  /** Where the value comes from / how it changes. */
  source: z.enum(['env', 'config', 'runtime']),
  /** True when changing it needs an API restart (env-based flags). */
  requiresRestart: z.boolean(),
});
export type AdminSettingFlag = z.infer<typeof adminSettingFlagSchema>;

/** `GET /admin/settings` — feature flags + throttle limits. */
export const adminSettingsSchema = z.object({
  flags: z.array(adminSettingFlagSchema),
});
export type AdminSettings = z.infer<typeof adminSettingsSchema>;

/** `PATCH /admin/settings` body — patch a runtime flag (stub in Wave 1). */
export const adminPatchSettingsSchema = z.object({
  key: z.string().min(1),
  value: z.union([z.boolean(), z.number(), z.string()]),
});
export type AdminPatchSettingsDto = z.infer<typeof adminPatchSettingsSchema>;

/** `PATCH /admin/settings` result. */
export const adminPatchSettingsResultSchema = z.object({
  key: z.string(),
  applied: z.boolean(),
  /** Human note, e.g. "env flag — requires a restart to take effect". */
  note: z.string(),
});
export type AdminPatchSettingsResult = z.infer<typeof adminPatchSettingsResultSchema>;

// ═════════════════════════════════ Audit ═══════════════════════════════════

/** A single audit-log entry. */
export const adminAuditEntrySchema = z.object({
  id: objectIdSchema,
  actorId: objectIdSchema.nullable(),
  actorEmail: z.string().nullable(),
  action: z.string(),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  meta: z.record(z.string(), z.unknown()).nullable(),
  createdAt: isoDateSchema,
});
export type AdminAuditEntry = z.infer<typeof adminAuditEntrySchema>;

/** `GET /admin/audit` query — cursor-paginated, optional action filter. */
export const adminAuditQuerySchema = z.object({
  action: z.string().trim().max(120).optional(),
  cursor: objectIdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type AdminAuditQuery = z.infer<typeof adminAuditQuerySchema>;

/** `GET /admin/audit` response. */
export const adminAuditListSchema = z.object({
  items: z.array(adminAuditEntrySchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});
export type AdminAuditList = z.infer<typeof adminAuditListSchema>;
