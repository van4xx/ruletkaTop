/**
 * Admin-panel response/DTO types — re-exported from the shared contract so the
 * SPA imports them from one ergonomic local path. The authority is
 * `@ruletka/shared-types` (admin.ts + admin-panel.ts); this file adds nothing,
 * it just narrows the import surface Wave-2 pages reach for.
 */
export type {
  // analytics
  AdminAnalyticsOverview,
  AdminTimeseries,
  AdminTimeseriesMetric,
  AdminTimeseriesPoint,
  AdminTimeseriesQuery,
  AdminTimeseriesRange,
  // wallet
  AdminLedgerEntry,
  AdminWalletAdjustDto,
  AdminWalletAdjustResult,
  AdminWalletDetail,
  AdminWalletStats,
  // premium
  AdminGrantPremiumDto,
  AdminPremiumList,
  AdminSubscriber,
  // payments
  AdminPayment,
  AdminPaymentList,
  AdminPaymentStats,
  // calls
  AdminCall,
  AdminCallList,
  AdminCallsStats,
  // content
  AdminCover,
  AdminCoverList,
  AdminAnnouncement,
  AdminAnnouncementList,
  AdminCreateAnnouncementDto,
  // broadcast
  AdminBroadcastDto,
  AdminBroadcastHistory,
  AdminBroadcastRecord,
  AdminBroadcastResult,
  AdminBroadcastSegment,
  // security
  AdminSession,
  AdminSessionList,
  AdminSecurityEvent,
  AdminSecurityEventList,
  // settings
  AdminSettings,
  AdminSettingFlag,
  AdminPatchSettingsDto,
  AdminPatchSettingsResult,
  // audit
  AdminAuditEntry,
  AdminAuditList,
  AdminAuditQuery,
  // pre-existing
  AdminUserList,
  AdminUserListQuery,
  AdminUserSummary,
  EconomyOverview,
  Role,
} from '@ruletka/shared-types';
