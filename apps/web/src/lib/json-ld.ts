/**
 * Typed JSON-LD (schema.org) helpers — no external deps.
 *
 * These build the structured-data objects we embed via a
 * `<script type="application/ld+json">` tag (see `components/json-ld.tsx`).
 * Because the script type is `application/ld+json`, browsers never *execute* it,
 * so it is unaffected by the `script-src` CSP (no nonce required).
 *
 * Schemas:
 *  - {@link organizationLd}  — the publishing entity (brand, logo, socials).
 *  - {@link websiteLd}       — the site itself (name, locales, search action).
 *
 * Keep these minimal and honest: only assert facts that are true on the live
 * site. `sameAs` social profiles are intentionally omitted until real handles
 * exist (an empty/placeholder `sameAs` hurts more than it helps).
 */
import { SITE_URL, absoluteUrl } from '@/config/seo';

/** Minimal structural type for a JSON-LD node (avoids `any`). */
export type JsonLd = Record<string, unknown> & { '@context': 'https://schema.org' };

const ORG_NAME = 'ruletka.top';
const ORG_ID = `${SITE_URL}/#organization`;
const WEBSITE_ID = `${SITE_URL}/#website`;

/**
 * schema.org `Organization` for the brand. `@id` is a stable node reference so
 * the WebSite node (and any future nodes) can point at it via `publisher`.
 */
export function organizationLd(description: string): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': ORG_ID,
    name: ORG_NAME,
    url: SITE_URL,
    description,
    // Use the SVG mark in /public as the canonical logo.
    logo: absoluteUrl('/favicon.svg'),
  };
}

/**
 * schema.org `WebSite`. Declares both content locales and wires a
 * `SearchAction` (people discovery) so eligible results can surface a sitelinks
 * search box. `inLanguage` lists the two locales the same URLs are served in.
 */
export function websiteLd(name: string, description: string): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': WEBSITE_ID,
    name,
    alternateName: ORG_NAME,
    url: SITE_URL,
    description,
    inLanguage: ['ru', 'en'],
    publisher: { '@id': ORG_ID },
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${SITE_URL}/search?q={search_term_string}`,
      },
      // schema.org requires this exact property name on SearchAction.
      'query-input': 'required name=search_term_string',
    },
  };
}

/**
 * schema.org `WebApplication` for the landing page — the most honest type for a
 * browser-based video/voice-roulette social product. Declares the social
 * category, free-to-use offer, and links back to the brand via `publisher`.
 * `name`/`description` are passed in localized by the caller.
 */
export function webApplicationLd(name: string, description: string): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    '@id': `${SITE_URL}/#webapp`,
    name,
    description,
    url: SITE_URL,
    applicationCategory: 'SocialNetworkingApplication',
    operatingSystem: 'Web',
    browserRequirements: 'Requires JavaScript and WebRTC.',
    inLanguage: ['ru', 'en'],
    isAccessibleForFree: true,
    publisher: { '@id': ORG_ID },
    // Free to start using — no purchase required to access the core roulette.
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'RUB',
    },
  };
}
