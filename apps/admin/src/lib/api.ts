/**
 * Admin API client — talks to the ruletka.top API (api.ruletka.top in prod,
 * :4000 in dev). Access token in memory; refresh rides the httpOnly cookie
 * (same-site across *.ruletka.top). All requests are credentialed.
 */
import type {
  AdminUserList,
  AdminUserListQuery,
  AdminUserSummary,
  AuthResponse,
  AuthUser,
  EconomyOverview,
  ReviewItem,
  Role,
} from '@ruletka/shared-types';

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:4000/api';

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
        const res = await fetch(`${API_BASE}/auth/refresh`, { method: 'POST', credentials: 'include' });
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

async function req<T>(
  path: string,
  opts: { method?: string; json?: unknown; query?: Record<string, string | undefined>; _retry?: boolean } = {},
): Promise<T> {
  const url = new URL(path.replace(/^\//, ''), `${API_BASE.replace(/\/$/, '')}/`);
  if (opts.query) for (const [k, v] of Object.entries(opts.query)) if (v != null) url.searchParams.set(k, v);
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
    const body = await req<AuthResponse>('/auth/login', { method: 'POST', json: { email, password } });
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
};

export type { AdminUserList, AdminUserSummary, EconomyOverview, ReviewItem, Role };
