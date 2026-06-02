import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';
import createNextIntlPlugin from 'next-intl/plugin';
import { SECURITY_HEADERS } from './src/lib/csp';

/**
 * Next.js 16 (App Router) configuration for the ruletka.top web shell.
 *
 * - `transpilePackages` lets Next compile the workspace source packages
 *   (`@ruletka/shared-types`, `@ruletka/ui`) directly — they ship raw TS/TSX.
 * - `reactStrictMode` surfaces lifecycle/effect issues early in dev.
 * - `compress` gzips the Next server's own responses; `poweredByHeader` is off.
 * - `optimizePackageImports` tree-shakes the icon/animation libs per route.
 * - Security headers: the hardened, per-request **Content-Security-Policy** (with
 *   a fresh nonce so `script-src` drops `'unsafe-inline'`) is emitted by the edge
 *   middleware (`src/middleware.ts` + `src/lib/csp.ts`). Here we emit only the
 *   static, non-CSP security headers (Referrer-Policy, X-Content-Type-Options,
 *   X-Frame-Options, Permissions-Policy) for every route in production.
 */

const isProd = process.env.NODE_ENV === 'production';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@ruletka/shared-types', '@ruletka/ui'],
  compress: true,
  poweredByHeader: false,
  experimental: {
    optimizePackageImports: ['lucide-react', 'framer-motion'],
  },
  async headers() {
    // Dev needs looser rules (HMR/eval, arbitrary localhost ws) and gets no CSP;
    // prod gets the static security headers here + the nonce'd CSP from middleware.
    if (!isProd) return [];
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
};

/**
 * Sentry build-time wrapper — inert without configuration. Source-map upload is
 * gated on `SENTRY_AUTH_TOKEN` (disabled + no org/project without it), so a
 * token-less `next build` stays green and uploads nothing. Runtime capture is
 * separately gated by the DSN, so wrapping here has no effect when no DSN is set.
 */
const hasSentryAuth = Boolean(process.env.SENTRY_AUTH_TOKEN);

/**
 * next-intl plugin — wires the per-request i18n config (`src/i18n/request.ts`)
 * into the build. Cookie-based locale selection WITHOUT route prefixes, so no
 * routing middleware is added.
 */
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

export default withSentryConfig(withNextIntl(nextConfig), {
  org: hasSentryAuth ? process.env.SENTRY_ORG : undefined,
  project: hasSentryAuth ? process.env.SENTRY_PROJECT : undefined,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !hasSentryAuth,
  sourcemaps: {
    disable: !hasSentryAuth,
  },
  widenClientFileUpload: true,
  disableLogger: true,
  telemetry: false,
  tunnelRoute: process.env.NEXT_PUBLIC_SENTRY_TUNNEL_ROUTE || undefined,
});
