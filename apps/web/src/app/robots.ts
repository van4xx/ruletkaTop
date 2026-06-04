import type { MetadataRoute } from 'next';
import { DISALLOWED_PATHS, SITE_URL, absoluteUrl } from '@/config/seo';

/**
 * `robots.txt` for ruletka.top — generated at `/robots.txt`.
 *
 * - Allows all crawlers to index the public site.
 * - `disallow`s the authenticated/utility surfaces (dashboard, settings, wallet,
 *   chats, friends, notifications, onboarding, search, profile, gifts/premium/
 *   coins) and the `/api` proxy — see `config/seo.ts` for the full list.
 * - Points crawlers at the sitemap and declares the canonical host.
 *
 * Note: when this app is deployed somewhere OTHER than production (e.g. a staging
 * subdomain), set `NEXT_PUBLIC_API_URL` accordingly so `SITE_URL` — and thus the
 * advertised sitemap/host — reflect that origin rather than the prod domain.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [...DISALLOWED_PATHS],
    },
    sitemap: absoluteUrl('/sitemap.xml'),
    host: SITE_URL,
  };
}
