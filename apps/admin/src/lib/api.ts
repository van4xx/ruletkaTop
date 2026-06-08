/**
 * Admin API client — talks to the ruletka.top API (api.ruletka.top in prod,
 * :4000 in dev). Access token in memory; refresh rides the httpOnly cookie
 * (same-site across *.ruletka.top). All requests are credentialed.
 */
import type {
  AdminAnalyticsOverview,
  AdminAuditList,
  AdminAuditQuery,
  AdminBroadcastDto,
  AdminBroadcastHistory,
  AdminBroadcastResult,
  AdminCallList,
  AdminCallsStats,
  AdminCoverList,
  AdminAnnouncement,
  AdminAnnouncementList,
  AdminCreateAnnouncementDto,
  AdminGrantPremiumDto,
  AdminPatchSettingsDto,
  AdminPatchSettingsResult,
  AdminPaymentList,
  AdminPaymentStats,
  AdminPremiumList,
  AdminSecurityEventList,
  AdminSessionList,
  AdminSettings,
  AdminTimeseries,
  AdminTimeseriesQuery,
  AdminUserList,
  AdminUserListQuery,
  AdminUserSummary,
  AdminWalletAdjustResult,
  AdminWalletDetail,
  AdminWalletStats,
  Appeal,
  AppealStatus,
  AuthResponse,
  AuthUser,
  EconomyOverview,
  OpenReportCount,
  Report,
  ResolvedAppeal,
  ResolvedWithBan,
  ReviewItem,
  Role,
} from '@ruletka/shared-types';

const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:4000/api';

let accessToken: string | null = null;
export const setAccessToken = (t: string | null) => {
  accessToken = t;
};

export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

let refreshing: Promise<boolean> | null = null;
async function refresh(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const res = await fetch(`${API_BASE}/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
        });
        if (!res.ok) return false;
        const body = (await res.json()) as AuthResponse;
        accessToken = body.tokens?.accessToken ?? null;
        return Boolean(accessToken);
      } catch {
        return false;
      } finally {
        refreshing = null;
      }
    })();
  }
  return refreshing;
}

/**
 * Authenticated request to the API (Bearer access token in memory + httpOnly
 * refresh cookie; auto-refreshes once on 401). EXPORTED so admin pages can call
 * `/admin/...` endpoints that don't (yet) have a dedicated `adminApi.*` method,
 * reusing the single shared token cache instead of minting their own.
 */
export async function req<T>(
  path: string,
  opts: {
    method?: string;
    json?: unknown;
    query?: Record<string, string | undefined>;
    _retry?: boolean;
  } = {},
): Promise<T> {
  const url = new URL(path.replace(/^\//, ''), `${API_BASE.replace(/\/$/, '')}/`);
  if (opts.query)
    for (const [k, v] of Object.entries(opts.query)) if (v != null) url.searchParams.set(k, v);
  const headers: Record<string, string> = {};
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;
  if (opts.json !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    headers,
    credentials: 'include',
    body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined,
  });
  if (res.status === 401 && !opts._retry && (await refresh())) {
    return req<T>(path, { ...opts, _retry: true });
  }
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      const b = (await res.json()) as { message?: string | string[] };
      msg = Array.isArray(b.message) ? b.message.join(', ') : (b.message ?? msg);
    } catch {
      /* ignore */
    }
    throw new AdminApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** A cursor page returned by the review-queue endpoint. */
interface ReviewPage {
  items: ReviewItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** A cursor page of abuse reports (`GET /reports`), typed via the shared contract. */
export interface ReportPage {
  items: Report[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** A cursor page of ban appeals (`GET /moderation/appeals`), shared-typed. */
export interface AppealPage {
  items: Appeal[];
  nextCursor: string | null;
  hasMore: boolean;
}

/* ───────────────────────────── Economy CRUD types ─────────────────────────────
 * The economy/premium-plan CRUD endpoints are NOT in `@ruletka/shared-types`
 * (they're local to `admin-economy.controller`), so the row/DTO shapes are
 * mirrored here. They track `apps/api/src/modules/moderation/admin-economy.service`
 * 1:1 — the same convention `pages/Economy.tsx` uses for coin packages + gifts.
 * ──────────────────────────────────────────────────────────────────────────── */

/** One premium-plan catalogue row, as the admin economy controller returns it. */
export interface AdminPremiumPlan {
  id: string;
  code: string;
  title: string;
  priceRub: number;
  intervalDays: number;
  perks: string[];
  createdAt: string | null;
  updatedAt: string | null;
}

/** Create body for a premium plan (`code` is the unique, immutable public id). */
export interface CreatePremiumPlanDto {
  code: string;
  title: string;
  priceRub: number;
  intervalDays: number;
  perks?: string[];
}

/** Partial update for a premium plan. `code` is immutable, so it's not here. */
export interface UpdatePremiumPlanDto {
  title?: string;
  priceRub?: number;
  intervalDays?: number;
  perks?: string[];
}

export const adminApi = {
  bootstrap: async (): Promise<AuthUser | null> => {
    if (!(await refresh())) return null;
    try {
      return await req<AuthUser>('/auth/me');
    } catch {
      return null;
    }
  },
  login: async (email: string, password: string): Promise<AuthUser> => {
    const body = await req<AuthResponse>('/auth/login', {
      method: 'POST',
      json: { email, password },
    });
    accessToken = body.tokens.accessToken;
    return body.user;
  },
  logout: async (): Promise<void> => {
    await req<void>('/auth/logout', { method: 'POST' }).catch(() => undefined);
    accessToken = null;
  },

  // ── Moderation review queue (moderator/admin) ──
  reviewQueue: (status?: string) => req<ReviewPage>('/moderation/review', { query: { status } }),
  resolveReview: (id: string, status: 'resolved' | 'dismissed') =>
    req<ReviewItem>(`/moderation/review/${id}/resolve`, { method: 'POST', json: { status } }),

  // ── Abuse reports (moderator/admin) ──
  reports: {
    /** Cursor-paginated triage queue, optionally filtered by `status`. */
    list: (status?: string, cursor?: string) =>
      req<ReportPage>('/reports', { query: { status, cursor } }),
    /**
     * Every report filed AGAINST one user (the reported account), newest-first,
     * for the user-dossier "reports against this user" view. Cursor-paginated.
     */
    against: (againstUserId: string, cursor?: string) =>
      req<ReportPage>('/reports', { query: { againstUserId, cursor } }),
    /** Close a report as resolved/dismissed (no ban). */
    resolve: (id: string, status: 'resolved' | 'dismissed') =>
      req<Report>(`/reports/${id}/resolve`, { method: 'POST', json: { status } }),
    /** Uphold a report AND ban the reported user in one action. */
    resolveBan: (id: string) =>
      req<ResolvedWithBan>(`/reports/${id}/resolve-ban`, { method: 'POST' }),
    /** Per-target open-report counts, most-reported first (the "hot list"). */
    openCounts: (limit?: number) =>
      req<OpenReportCount[]>('/reports/open-counts', {
        query: { limit: limit != null ? String(limit) : undefined },
      }),
  },

  // ── Ban appeals (moderator/admin) ──
  appeals: {
    /** Cursor-paginated appeals queue, optionally filtered by `status`. */
    list: (status?: AppealStatus, cursor?: string) =>
      req<AppealPage>('/moderation/appeals', { query: { status, cursor } }),
    /** Accept (⇒ unban the user) or reject a ban appeal. */
    resolve: (id: string, status: 'accepted' | 'rejected') =>
      req<ResolvedAppeal>(`/moderation/appeals/${id}/resolve`, {
        method: 'POST',
        json: { status },
      }),
  },

  // ── User enforcement (moderator/admin) — routes live under /admin ──
  banUser: (id: string, reason?: string) =>
    req<void>(`/admin/users/${id}/ban`, { method: 'POST', json: reason ? { reason } : {} }),
  unbanUser: (id: string) => req<void>(`/admin/users/${id}/unban`, { method: 'POST' }),

  // ── Admin: users directory (moderator/admin) ──
  listUsers: (query: Partial<AdminUserListQuery> = {}) =>
    req<AdminUserList>('/admin/users', {
      query: {
        q: query.q || undefined,
        role: query.role || undefined,
        banned: query.banned === undefined ? undefined : String(query.banned),
        cursor: query.cursor || undefined,
        limit: query.limit != null ? String(query.limit) : undefined,
      },
    }),
  getUser: (id: string) => req<AdminUserSummary>(`/admin/users/${id}`),
  setRole: (id: string, role: Role) =>
    req<AdminUserSummary>(`/admin/users/${id}/role`, { method: 'POST', json: { role } }),

  // ── Admin: economy + population overview (moderator/admin) ──
  economyOverview: () => req<EconomyOverview>('/admin/economy/overview'),

  // ════════════════════════════════════════════════════════════════════════
  // Expanded admin surface (Wave 1). Grouped by section; each method maps 1:1
  // to a `/admin/...` endpoint in `apps/api/src/modules/admin`. The response
  // types are the shared CONTRACT in `@ruletka/shared-types` (admin-panel.ts).
  // ════════════════════════════════════════════════════════════════════════

  /** Дашборд — KPI overview + timeseries. */
  analytics: {
    overview: () => req<AdminAnalyticsOverview>('/admin/analytics/overview'),
    timeseries: (params: Partial<AdminTimeseriesQuery> = {}) =>
      req<AdminTimeseries>('/admin/analytics/timeseries', {
        query: { metric: params.metric, range: params.range },
      }),
  },

  /** Баланс — wallet detail, manual adjust (admin), economy-wide stats. */
  wallet: {
    detail: (userId: string, cursor?: string) =>
      req<AdminWalletDetail>(`/admin/wallet/${userId}`, { query: { cursor } }),
    adjust: (userId: string, body: { amount: number; reason: string }) =>
      req<AdminWalletAdjustResult>(`/admin/wallet/${userId}/adjust`, {
        method: 'POST',
        json: body,
      }),
    stats: () => req<AdminWalletStats>('/admin/wallet/stats'),
  },

  /** Премиум — subscribers list, grant/revoke (admin), and plan-catalogue CRUD. */
  premium: {
    list: (cursor?: string) => req<AdminPremiumList>('/admin/premium', { query: { cursor } }),
    grant: (userId: string, body: AdminGrantPremiumDto) =>
      req<{ ok: true }>(`/admin/premium/${userId}/grant`, { method: 'POST', json: body }),
    revoke: (userId: string) =>
      req<{ ok: true }>(`/admin/premium/${userId}/revoke`, { method: 'POST' }),

    /**
     * Plan-tier catalogue (`premiumplans`) — list is moderator-visible; writes
     * are admin-only and the API re-checks the role (→ 403). Lives under
     * `/admin/economy/premium-plans` alongside the coin-package + gift CRUD.
     */
    plans: {
      list: () => req<AdminPremiumPlan[]>('/admin/economy/premium-plans'),
      create: (body: CreatePremiumPlanDto) =>
        req<AdminPremiumPlan>('/admin/economy/premium-plans', { method: 'POST', json: body }),
      update: (id: string, body: UpdatePremiumPlanDto) =>
        req<AdminPremiumPlan>(`/admin/economy/premium-plans/${id}`, {
          method: 'PATCH',
          json: body,
        }),
      remove: (id: string) =>
        req<{ id: string }>(`/admin/economy/premium-plans/${id}`, { method: 'DELETE' }),
    },
  },

  /** Платежи — charges list + funnel stats. */
  payments: {
    list: (cursor?: string) => req<AdminPaymentList>('/admin/payments', { query: { cursor } }),
    stats: () => req<AdminPaymentStats>('/admin/payments/stats'),
  },

  /** Звонки — call/match volume stats + recent feed. */
  calls: {
    stats: () => req<AdminCallsStats>('/admin/calls/stats'),
    recent: () => req<AdminCallList>('/admin/calls/recent'),
  },

  /** Контент — cover catalogue + announcements CRUD (create is admin-only). */
  content: {
    covers: () => req<AdminCoverList>('/admin/content/covers'),
    announcements: () => req<AdminAnnouncementList>('/admin/content/announcements'),
    createAnnouncement: (body: AdminCreateAnnouncementDto) =>
      req<AdminAnnouncement>('/admin/content/announcements', { method: 'POST', json: body }),
  },

  /** Рассылки — send a broadcast (admin) + history. */
  broadcast: {
    send: (body: AdminBroadcastDto) =>
      req<AdminBroadcastResult>('/admin/broadcast', { method: 'POST', json: body }),
    history: () => req<AdminBroadcastHistory>('/admin/broadcast'),
  },

  /** Безопасность — active sessions + security events (admin). */
  security: {
    sessions: () => req<AdminSessionList>('/admin/security/sessions'),
    events: () => req<AdminSecurityEventList>('/admin/security/events'),
  },

  /** Настройки — feature flags + limits; get + patch (admin). */
  settings: {
    get: () => req<AdminSettings>('/admin/settings'),
    patch: (body: AdminPatchSettingsDto) =>
      req<AdminPatchSettingsResult>('/admin/settings', { method: 'PATCH', json: body }),
  },

  /** Аудит — paginated admin action log. */
  audit: {
    list: (params: Partial<AdminAuditQuery> = {}) =>
      req<AdminAuditList>('/admin/audit', {
        query: {
          action: params.action || undefined,
          cursor: params.cursor || undefined,
          limit: params.limit != null ? String(params.limit) : undefined,
        },
      }),
  },
};

export type {
  AdminUserList,
  AdminUserSummary,
  Appeal,
  AppealStatus,
  EconomyOverview,
  OpenReportCount,
  ReviewItem,
  Role,
};
