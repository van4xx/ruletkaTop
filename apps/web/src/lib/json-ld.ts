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

/**
 * schema.org `SoftwareApplication` for the platform itself — emitted alongside
 * `WebApplication` so search engines that index either type can surface us.
 * Carries an `AggregateOffer` with the free → paid price band, the most honest
 * representation of the free-core + Premium-subscription model.
 *
 * `lowPrice`/`highPrice` are STRINGS per schema.org (not numbers); pass plain
 * integers from the caller and we format them here.
 */
export function softwareApplicationLd(
  name: string,
  description: string,
  options: {
    /** Paid tier minimum (e.g. monthly Premium price in RUB). */
    lowPriceRub: number;
    /** Paid tier maximum (e.g. yearly Premium price in RUB). */
    highPriceRub: number;
    /** Number of paid tiers offered (used for `offerCount`). */
    offerCount: number;
  },
): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    '@id': `${SITE_URL}/#software`,
    name,
    description,
    url: SITE_URL,
    applicationCategory: 'SocialNetworkingApplication',
    operatingSystem: 'Web, Android, iOS',
    inLanguage: ['ru', 'en'],
    publisher: { '@id': ORG_ID },
    offers: {
      '@type': 'AggregateOffer',
      priceCurrency: 'RUB',
      lowPrice: String(options.lowPriceRub),
      highPrice: String(options.highPriceRub),
      offerCount: options.offerCount,
    },
  };
}

/**
 * schema.org `FAQPage` — emits each visible FAQ item as a `Question` node
 * paired with an `Answer`. CRITICAL for Google's QA-style snippets, which feed
 * directly off this structured data. The `items` array MUST match the rendered
 * `<dl>` 1:1; callers pass the same i18n-resolved strings used in the markup.
 */
export function faqPageLd(items: readonly { question: string; answer: string }[]): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    '@id': `${SITE_URL}/#faq`,
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer,
      },
    })),
  };
}

/**
 * schema.org `BreadcrumbList` for the home page — a single-item trail naming
 * the site itself. Surfaces a friendly breadcrumb under the snippet on SERPs.
 */
export function homeBreadcrumbLd(label: string): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    '@id': `${SITE_URL}/#breadcrumb`,
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: label,
        item: SITE_URL,
      },
    ],
  };
}

/**
 * schema.org `SiteNavigationElement` — declares the primary nav so search
 * engines can render sitelinks under the brand snippet. Pass an in-order list
 * of `{ name, path }` pairs; we resolve paths against {@link SITE_URL}.
 */
export function siteNavigationLd(
  items: readonly { name: string; path: string }[],
): JsonLd[] {
  return items.map((item, idx) => ({
    '@context': 'https://schema.org',
    '@type': 'SiteNavigationElement',
    '@id': `${SITE_URL}/#nav-${idx}`,
    name: item.name,
    url: absoluteUrl(item.path),
  }));
}
