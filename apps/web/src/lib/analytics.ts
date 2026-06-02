/**
 * Privacy-first product analytics — a thin, typed wrapper over Plausible.
 *
 * Clean NO-OP unless `NEXT_PUBLIC_ANALYTICS_DOMAIN` is set: {@link track} does
 * nothing, the {@link Analytics} script renders nothing, and zero network traffic
 * occurs (dev/CI stay completely quiet). Plausible is **cookieless** and stores
 * **no personal data**, so this needs no consent banner (GDPR/CCPA-friendly) — a
 * deliberate choice for a global product.
 *
 * Self-hosted instances: point `NEXT_PUBLIC_ANALYTICS_HOST` at your server
 * (defaults to https://plausible.io). The provider is isolated behind this
 * module + the loader, so swapping to Umami/PostHog/etc. is a one-file change.
 */

/** The Plausible `data-domain` (e.g. `ruletka.top`). Empty ⇒ analytics disabled. */
export const ANALYTICS_DOMAIN = process.env.NEXT_PUBLIC_ANALYTICS_DOMAIN ?? '';

/** Analytics host (script + ingest). Override for a self-hosted Plausible. */
export const ANALYTICS_HOST = process.env.NEXT_PUBLIC_ANALYTICS_HOST ?? 'https://plausible.io';

/** True only when a domain is configured; everything else gates on this. */
export const analyticsEnabled = Boolean(ANALYTICS_DOMAIN);

/**
 * Closed product-event taxonomy. Keeping the names in one union makes them
 * consistent, greppable, and safe to rename — no stray string literals across
 * the app. These map to the key funnels: acquisition, the core roulette loop,
 * and monetisation.
 */
export type AnalyticsEvent =
  | 'signup'
  | 'login'
  | 'match_started'
  | 'match_ended'
  | 'match_skipped'
  | 'gift_sent'
  | 'coins_purchase_started'
  | 'premium_purchase_started'
  | 'friend_added';

/** Plausible custom-event props: up to 30 scalar key/value pairs (no PII). */
export type AnalyticsProps = Record<string, string | number | boolean>;

interface PlausibleFn {
  (event: string, options?: { props?: AnalyticsProps; callback?: () => void }): void;
  q?: unknown[];
}

declare global {
  interface Window {
    plausible?: PlausibleFn;
  }
}

/**
 * Fire a product event. Safe to call from anywhere on the client — it is a no-op
 * during SSR and when analytics is disabled, and it NEVER throws (analytics must
 * not be able to break a user flow). Do not pass PII in `props`.
 */
export function track(event: AnalyticsEvent, props?: AnalyticsProps): void {
  if (!analyticsEnabled || typeof window === 'undefined') return;
  try {
    window.plausible?.(event, props ? { props } : undefined);
  } catch {
    /* swallow — a flaky analytics call must never surface to the user */
  }
}
