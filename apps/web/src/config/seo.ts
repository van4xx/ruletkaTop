/**
 * SEO configuration — the single source of truth for crawlability metadata.
 *
 * Mirrors the pattern of `config/nav.ts`: one module that `sitemap.ts`,
 * `robots.ts` and the root layout's metadata all import, so the public/private
 * route split and the production origin never drift apart.
 *
 * ── i18n note (important) ─────────────────────────────────────────────────
 * The app uses next-intl with a COOKIE-based locale and NO `/en` URL prefixes:
 * every locale is served from the SAME clean URL (`/`, `/video`, …). There is
 * therefore exactly one canonical URL per page, and the ru/en hreflang
 * alternates all point at that same URL (plus `x-default`). See {@link SITE_URL}
 * and the `alternates` block in `app/layout.tsx` / the sitemap below.
 */
import { ROUTES } from './nav';

/**
 * Canonical production origin. Derived from `NEXT_PUBLIC_API_URL` (stripping the
 * trailing `/api`) so a single env drives the whole stack, with the public
 * domain as the hard fallback. NO trailing slash.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/api\/?$/, '') ?? 'https://ruletka.top'
).replace(/\/$/, '');

/** Join a route path onto {@link SITE_URL} into an absolute, canonical URL. */
export function absoluteUrl(path: string): string {
  return path === '/' ? SITE_URL : `${SITE_URL}${path}`;
}

/**
 * Sane defaults for a sitemap entry, tuned per crawl-priority tier so the most
 * important marketing/funnel pages outrank utility pages.
 */
type ChangeFrequency = NonNullable<import('next').MetadataRoute.Sitemap[number]['changeFrequency']>;

interface PublicRoute {
  path: string;
  changeFrequency: ChangeFrequency;
  /** 0.0–1.0 — relative importance for this site only. */
  priority: number;
}

/**
 * PUBLIC, indexable routes — everything a signed-out visitor (and a crawler)
 * can reach. Authenticated/utility surfaces (dashboard, settings, wallet, chats,
 * friends, notifications, onboarding, search, profile pages, gifts/premium/coins)
 * are deliberately EXCLUDED here and `disallow`ed in `robots.ts`: they require a
 * session, hold personal data, or are thin/duplicate for search.
 *
 * `/login` + `/register` are included (low priority) — they are real, valuable
 * entry points for brand/navigational queries.
 */
export const PUBLIC_ROUTES: readonly PublicRoute[] = [
  { path: ROUTES.home, changeFrequency: 'daily', priority: 1.0 },
  { path: ROUTES.video, changeFrequency: 'weekly', priority: 0.9 },
  { path: ROUTES.voice, changeFrequency: 'weekly', priority: 0.9 },
  { path: ROUTES.top, changeFrequency: 'daily', priority: 0.8 },
  { path: ROUTES.leaderboard, changeFrequency: 'daily', priority: 0.7 },
  // Legal / informational — stable, lower churn.
  { path: ROUTES.about, changeFrequency: 'monthly', priority: 0.6 },
  { path: ROUTES.documents, changeFrequency: 'monthly', priority: 0.5 },
  { path: ROUTES.rules, changeFrequency: 'monthly', priority: 0.4 },
  { path: ROUTES.privacy, changeFrequency: 'yearly', priority: 0.3 },
  { path: ROUTES.help, changeFrequency: 'monthly', priority: 0.4 },
  // Auth entry points — indexable but low priority. These routes exist on disk
  // (`(auth)/login`, `(auth)/register`) but aren't keyed in `ROUTES`, so they're
  // referenced as literals.
  { path: '/login', changeFrequency: 'yearly', priority: 0.3 },
  { path: '/register', changeFrequency: 'yearly', priority: 0.3 },
] as const;

/**
 * PRIVATE / non-indexable path prefixes — `disallow`ed for all crawlers in
 * `robots.ts`. Kept as path *prefixes* so nested routes (e.g. `/chats/:id`,
 * `/friends/requests`, `/profile/:id`) are covered by a single rule.
 *
 * Note `/profile` is disallowed wholesale: `/profile/me` is private and
 * `/profile/:id` pages are user-generated/duplicative — neither should be
 * crawled by default.
 */
export const DISALLOWED_PATHS: readonly string[] = [
  ROUTES.dashboard,
  ROUTES.settings,
  ROUTES.wallet,
  ROUTES.chats,
  ROUTES.friends, // also covers /friends/requests
  ROUTES.notifications,
  ROUTES.onboarding,
  ROUTES.search,
  '/profile', // /profile/me + /profile/:id
  ROUTES.gifts,
  ROUTES.premium,
  '/coins', // `(economy)/coins` — real route, not keyed in ROUTES
  '/api/', // the Next → Nest API proxy, never a crawl target
] as const;
