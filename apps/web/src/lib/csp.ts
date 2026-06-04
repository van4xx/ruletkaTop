/**
 * Content-Security-Policy + companion security headers for the web app.
 *
 * Shared by `next.config.ts` (which emits the static, non-CSP security headers)
 * and the edge middleware (which emits the CSP per-request with a fresh nonce).
 * Keeping it in ONE edge-safe module — pure string building + `process.env`, no
 * Node-only APIs — avoids the two drifting apart.
 *
 * The policy is hardened: no wildcard origins, `object-src 'none'`,
 * `frame-ancestors 'none'`, `base-uri 'self'`. Scripts are locked to `'self'` + a
 * per-request **nonce** (so Next's inline bootstrap/flight scripts are trusted
 * WITHOUT `'unsafe-inline'`) plus the explicit third-party hosts we actually load
 * (CloudPayments widget, Cloudflare Turnstile, analytics). We deliberately do NOT
 * use `'strict-dynamic'` so those host allowances keep working. Styles retain
 * `'unsafe-inline'` — Tailwind + framer-motion write inline styles with no nonce
 * hook, and the task is specifically to drop the *script* `'unsafe-inline'`.
 */

/** Extract scheme://host[:port] from a URL, ignoring path; fall back on parse error. */
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

/** Sentry ingest origin (browser SDK POSTs events here). Empty unless a DSN is set. */
const SENTRY_INGEST = (() => {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return [] as string[];
  try {
    return [new URL(dsn).origin];
  } catch {
    return [] as string[];
  }
})();

/** Plausible analytics origin (script + ingest). Empty unless analytics is enabled. */
const ANALYTICS_INGEST = (() => {
  if (!process.env.NEXT_PUBLIC_ANALYTICS_DOMAIN) return [] as string[];
  try {
    return [new URL(process.env.NEXT_PUBLIC_ANALYTICS_HOST || 'https://plausible.io').origin];
  } catch {
    return [] as string[];
  }
})();

/**
 * CDN origin for build assets, present only when `NEXT_PUBLIC_ASSET_PREFIX` is
 * set (e.g. https://cdn.ruletka.top). With a cross-origin assetPrefix, Next loads
 * `/_next/static` scripts, CSS and fonts from this host, so the CSP must allow it
 * for script/style/font (+ connect, for any fetch-based chunk load). Empty
 * (same-origin) when the env is unset — the policy is then byte-for-byte unchanged.
 */
const ASSET_PREFIX_ORIGIN = (() => {
  const prefix = process.env.NEXT_PUBLIC_ASSET_PREFIX;
  if (!prefix) return [] as string[];
  try {
    return [new URL(prefix).origin];
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
    ...ANALYTICS_INGEST,
    ...ASSET_PREFIX_ORIGIN,
  ]),
).join(' ');

/** Third-party script hosts (loaded alongside the nonce; no `strict-dynamic`). */
const SCRIPT_HOSTS = [
  CLOUDPAYMENTS_WIDGET,
  CLOUDFLARE_TURNSTILE,
  ...ANALYTICS_INGEST,
  ...ASSET_PREFIX_ORIGIN,
].join(' ');

/**
 * Build the production CSP string for a given per-request nonce.
 *
 * Script-src trusts `'self'` + the nonce (Next stamps it onto its own inline
 * scripts) + the explicit third-party hosts — and NOT `'unsafe-inline'`.
 */
export function buildCsp(nonce: string): string {
  return [
    `default-src 'self'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `object-src 'none'`,
    `script-src 'self' 'nonce-${nonce}' ${SCRIPT_HOSTS}`.trim(),
    [`style-src`, `'self'`, `'unsafe-inline'`, ...ASSET_PREFIX_ORIGIN].join(' '),
    `img-src 'self' data: blob: https:`,
    [`font-src`, `'self'`, `data:`, ...ASSET_PREFIX_ORIGIN].join(' '),
    `connect-src ${CONNECT_SRC}`,
    `frame-src ${CLOUDPAYMENTS_WIDGET} ${CLOUDFLARE_TURNSTILE}`,
    `media-src 'self' blob:`,
    `worker-src 'self' blob:`,
    ...(API_ORIGIN.startsWith('https') ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

/**
 * Non-CSP security headers, applied to every route in production via
 * `next.config.ts` `headers()`. The CSP itself is emitted per-request by the
 * middleware (it needs the nonce), so it is intentionally not here.
 */
export const SECURITY_HEADERS: { key: string; value: string }[] = [
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(self), microphone=(self), geolocation=(), payment=(), usb=()',
  },
];
