import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';
import createNextIntlPlugin from 'next-intl/plugin';

/**
 * Next.js 16 (App Router) configuration for the ruletka.top web shell.
 *
 * - `transpilePackages` lets Next compile the workspace source packages
 *   (`@ruletka/shared-types`, `@ruletka/ui`) directly — they ship raw TS/TSX
 *   (their `main`/`exports` point at `src`), so Next must transpile them.
 * - `reactStrictMode` surfaces lifecycle and effect issues early in dev.
 * - `compress` gzips the Next server's own responses (HTML/RSC/static) for a
 *   smaller-on-the-wire payload; the API compresses its JSON separately.
 * - `optimizePackageImports` tree-shakes the icon/animation libs so only the
 *   used exports land in each route's bundle.
 * - A tightened production `Content-Security-Policy` (+ companion security
 *   headers) is emitted via `headers()`. It is scoped to the app's real needs:
 *   it permits the hosted CloudPayments widget (script + iframe + its API), the
 *   REST API + WebSocket origins, and WebRTC media — and nothing else.
 */

/** Extract the scheme://host[:port] origin from a URL, ignoring any path. */
function originOf(url: string | undefined, fallback: string): string {
  try {
    return new URL(url ?? fallback).origin;
  } catch {
    return new URL(fallback).origin;
  }
}

/** Map an http(s) origin to its ws(s) equivalent for `connect-src`. */
function toWsOrigin(httpOrigin: string): string {
  return httpOrigin.replace(/^http/, 'ws');
}

const API_ORIGIN = originOf(process.env.NEXT_PUBLIC_API_URL, 'http://localhost:4000/api');
const WS_ORIGIN = originOf(process.env.NEXT_PUBLIC_WS_URL, 'http://localhost:4000');

/** CloudPayments hosted widget origins (script bundle + iframe + tokenisation API). */
const CLOUDPAYMENTS_WIDGET = 'https://widget.cloudpayments.ru';
const CLOUDPAYMENTS_API = 'https://api.cloudpayments.ru';

/** Cloudflare Turnstile (CAPTCHA) — hosted challenge script + iframe. */
const CLOUDFLARE_TURNSTILE = 'https://challenges.cloudflare.com';

/**
 * Sentry ingest origin for the CSP `connect-src`.
 *
 * A DSN looks like `https://<publicKey>@<host>/<projectId>`; the browser SDK
 * POSTs events to `https://<host>`. We derive that origin from
 * `NEXT_PUBLIC_SENTRY_DSN` so the hardened CSP doesn't block error ingestion.
 *
 * Gated: when no DSN is set this is an empty array and the CSP is byte-for-byte
 * what it was before — dev / CI are completely unaffected. (When the optional
 * `tunnelRoute` is enabled below, events go same-origin and are already covered
 * by `'self'`, but allowing the direct ingest host keeps both paths working.)
 */
const SENTRY_INGEST = (() => {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return [] as string[];
  try {
    return [new URL(dsn).origin];
  } catch {
    return [] as string[];
  }
})();

/** De-duplicated `connect-src` origins (API/WS may share a host in some envs). */
const CONNECT_SRC = Array.from(
  new Set([
    `'self'`,
    API_ORIGIN,
    WS_ORIGIN,
    toWsOrigin(WS_ORIGIN),
    CLOUDPAYMENTS_API,
    CLOUDPAYMENTS_WIDGET,
    ...SENTRY_INGEST,
  ]),
).join(' ');

const isProd = process.env.NODE_ENV === 'production';

/**
 * Production Content-Security-Policy.
 *
 * NOTE on `'unsafe-inline'` for scripts: Next.js's App Router injects inline
 * bootstrap/flight scripts; a nonce-based policy would require coordinating a
 * per-request nonce through middleware (owned elsewhere). To avoid regressing
 * the working app we allow inline scripts but otherwise lock the policy down
 * hard (no wildcard origins, `object-src 'none'`, `frame-ancestors 'none'`,
 * `base-uri 'self'`). Tightening to nonces is a clean follow-up once a CSP
 * nonce middleware is in place.
 */
const csp = [
  `default-src 'self'`,
  `base-uri 'self'`,
  `form-action 'self'`,
  // Clickjacking: the app must not be framed.
  `frame-ancestors 'none'`,
  `object-src 'none'`,
  // Scripts: our bundle + Next inline bootstrap + the CloudPayments widget +
  // the Cloudflare Turnstile (CAPTCHA) challenge script.
  `script-src 'self' 'unsafe-inline' ${CLOUDPAYMENTS_WIDGET} ${CLOUDFLARE_TURNSTILE}`,
  // Styles: Tailwind/inline styles + framer-motion's inline style writes.
  `style-src 'self' 'unsafe-inline'`,
  // Images: self, inlined data URIs, blob previews (avatar crops), and https
  // remotes (user/CDN avatars, identicons).
  `img-src 'self' data: blob: https:`,
  // Fonts: self + data URIs (next/font inlines some).
  `font-src 'self' data:`,
  // Network: the REST API, the Socket.io gateway (http upgrade + ws frames),
  // and the CloudPayments tokenisation API.
  `connect-src ${CONNECT_SRC}`,
  // Iframes: the CloudPayments card form + the Cloudflare Turnstile challenge.
  `frame-src ${CLOUDPAYMENTS_WIDGET} ${CLOUDFLARE_TURNSTILE}`,
  // NOTE (prod): the on-device NSFW model (nsfwjs/tfjs) must be SELF-HOSTED via
  // NEXT_PUBLIC_NSFW_MODEL_URL (same-origin) so its weight fetch passes this CSP;
  // otherwise add the model CDN origin to `connect-src` above.
  // WebRTC remote/local MediaStreams are attached via blob: URLs.
  `media-src 'self' blob:`,
  // Web Workers (if any) from our own origin / blob.
  `worker-src 'self' blob:`,
  // Force https on subresources — but ONLY on a real https deployment. On an
  // http origin (e.g. a local `next start` demo hitting http://localhost APIs)
  // this directive would upgrade API/WS calls to https and break the connection.
  ...(API_ORIGIN.startsWith('https') ? ['upgrade-insecure-requests'] : []),
].join('; ');

/** Security headers applied to every route in production. */
const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  // Don't leak full URLs to cross-origin navigations.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // No MIME sniffing.
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Belt-and-braces clickjacking guard for legacy UAs (CSP covers modern ones).
  { key: 'X-Frame-Options', value: 'DENY' },
  // Drop powerful features the app never uses; camera/mic are same-origin only
  // (WebRTC runs in our own pages).
  {
    key: 'Permissions-Policy',
    value: 'camera=(self), microphone=(self), geolocation=(), payment=(), usb=()',
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@ruletka/shared-types', '@ruletka/ui'],
  // Gzip the Next server's own HTML/RSC/static responses on the wire.
  compress: true,
  // Trim the `X-Powered-By: Next.js` fingerprint.
  poweredByHeader: false,
  experimental: {
    // Keep optimized package imports tidy for icon/animation libs so only the
    // imported symbols are bundled per route.
    optimizePackageImports: ['lucide-react', 'framer-motion'],
  },
  async headers() {
    // Apply the hardened CSP/security headers in production only — dev needs
    // looser rules (HMR/eval, websockets to arbitrary localhost ports).
    if (!isProd) return [];
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

/**
 * Sentry build-time wrapper.
 *
 * `withSentryConfig` is always applied (it injects the small client/server SDK
 * shims and the `onRequestError`/instrumentation glue), but it is designed to
 * be inert without configuration:
 *
 *  - SOURCE-MAP UPLOAD is gated on `SENTRY_AUTH_TOKEN`. With no token we set
 *    `sourcemaps.disable: true` and omit `org`/`project`, so a local or CI
 *    `next build` with NO Sentry env succeeds exactly as before — nothing is
 *    uploaded and the build never fails on a missing token. Provide
 *    `SENTRY_AUTH_TOKEN` + `SENTRY_ORG` + `SENTRY_PROJECT` (typically only in
 *    the production/CD build) to enable upload.
 *  - `silent` is true unless a token is present, so build logs stay clean.
 *  - `tunnelRoute` is opt-in via `NEXT_PUBLIC_SENTRY_TUNNEL_ROUTE` (e.g.
 *    `/monitoring`) to route browser events same-origin and dodge ad-blockers;
 *    off by default.
 *
 * Runtime error capture is independently gated by the DSN inside the Sentry
 * config files, so wrapping here has no runtime effect when no DSN is set.
 */
const hasSentryAuth = Boolean(process.env.SENTRY_AUTH_TOKEN);

/**
 * next-intl plugin — wires the per-request i18n config (`src/i18n/request.ts`)
 * into the build. The app uses cookie-based locale selection WITHOUT route
 * prefixes, so no middleware/routing is added; the plugin only makes
 * `getRequestConfig` available to Server Components + `useTranslations`.
 */
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

export default withSentryConfig(withNextIntl(nextConfig), {
  // Org/project only matter for source-map upload; omit them without a token so
  // the build never attempts (and fails) an unauthenticated upload.
  org: hasSentryAuth ? process.env.SENTRY_ORG : undefined,
  project: hasSentryAuth ? process.env.SENTRY_PROJECT : undefined,
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Quiet build logs unless we're actually uploading.
  silent: !hasSentryAuth,

  // Disable all source-map work unless an auth token is present. This is the
  // key guard that keeps token-less dev / CI builds green.
  sourcemaps: {
    disable: !hasSentryAuth,
  },

  // Upload dependency + Next-internal frames too, for fuller stack traces.
  widenClientFileUpload: true,

  // Tree-shake the SDK's logger statements out of the client bundle.
  disableLogger: true,

  // Don't phone home with plugin telemetry from our build.
  telemetry: false,

  // Optional same-origin tunnel for browser events (off unless configured).
  tunnelRoute: process.env.NEXT_PUBLIC_SENTRY_TUNNEL_ROUTE || undefined,
});
