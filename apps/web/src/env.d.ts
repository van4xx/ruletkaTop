/**
 * Typed `process.env` for the public (browser-exposed) Next.js variables.
 *
 * Only `NEXT_PUBLIC_*` variables are inlined into the client bundle. Keeping
 * the surface declared here gives us autocompletion and prevents typos when
 * reading config in `src/lib`.
 */
declare global {
  namespace NodeJS {
    interface ProcessEnv {
      /** Base URL of the NestJS REST API, e.g. `http://localhost:4000/api`. */
      readonly NEXT_PUBLIC_API_URL?: string;
      /** Base URL of the Socket.io gateway, e.g. `http://localhost:4000`. */
      readonly NEXT_PUBLIC_WS_URL?: string;
      /** CloudPayments public id for the payment widget (optional). */
      readonly NEXT_PUBLIC_CLOUDPAYMENTS_PUBLIC_ID?: string;
      /** Comma-separated STUN URLs for WebRTC. */
      readonly NEXT_PUBLIC_STUN_URLS?: string;
      /** Comma-separated TURN URLs for WebRTC. */
      readonly NEXT_PUBLIC_TURN_URLS?: string;

      // --- Sentry (observability) — ALL optional; blank ⇒ Sentry is a no-op ---

      /**
       * Public Sentry DSN. When unset, the browser + server Sentry SDKs never
       * initialize (clean no-op) and the CSP is left unchanged.
       */
      readonly NEXT_PUBLIC_SENTRY_DSN?: string;
      /** Override the reported Sentry environment (else Sentry infers it). */
      readonly NEXT_PUBLIC_SENTRY_ENVIRONMENT?: string;
      /** Override the reported release/version string. */
      readonly NEXT_PUBLIC_SENTRY_RELEASE?: string;
      /** Client traces sample rate, `0`..`1` (default 0.1 in prod, 1.0 in dev). */
      readonly NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE?: string;
      /** `'true'` enables Session Replay on errored sessions (off by default). */
      readonly NEXT_PUBLIC_SENTRY_ENABLE_REPLAY?: string;
      /** `'true'` enables verbose Sentry SDK debug logging (browser). */
      readonly NEXT_PUBLIC_SENTRY_DEBUG?: string;
      /** Same-origin tunnel path (e.g. `/monitoring`) to dodge ad-blockers. */
      readonly NEXT_PUBLIC_SENTRY_TUNNEL_ROUTE?: string;
    }
  }
}

export {};
