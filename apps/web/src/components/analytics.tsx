'use client';

/**
 * Loads the privacy-first Plausible analytics script + the `window.plausible`
 * queue stub (so {@link track} calls fired before the script finishes loading are
 * buffered and replayed). Renders NOTHING when analytics is not configured, so
 * the app ships zero analytics weight by default.
 *
 * Pageviews — including App Router client-side navigations (History API) — are
 * tracked automatically by the script; only custom product events go through
 * `track()`.
 */
import Script from 'next/script';
import { ANALYTICS_DOMAIN, ANALYTICS_HOST, analyticsEnabled } from '@/lib/analytics';

export function Analytics() {
  if (!analyticsEnabled) return null;

  const src = `${ANALYTICS_HOST.replace(/\/$/, '')}/js/script.js`;

  return (
    <>
      {/* Queue stub: buffers events fired before the async script is ready. */}
      <Script id="plausible-init" strategy="afterInteractive">
        {`window.plausible=window.plausible||function(){(window.plausible.q=window.plausible.q||[]).push(arguments)}`}
      </Script>
      <Script defer data-domain={ANALYTICS_DOMAIN} src={src} strategy="afterInteractive" />
    </>
  );
}
