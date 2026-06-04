import type { MetadataRoute } from 'next';
import { PUBLIC_ROUTES, SITE_URL, absoluteUrl } from '@/config/seo';

/**
 * XML sitemap for ruletka.top — served at `/sitemap.xml` (Next generates the XML
 * from this `MetadataRoute.Sitemap` array).
 *
 * Lists only PUBLIC, indexable routes (see `config/seo.ts` for the curated list
 * and the rationale for what's excluded). Private/authenticated surfaces are
 * omitted here and additionally `disallow`ed in `robots.ts`.
 *
 * ── hreflang / locale ──────────────────────────────────────────────────────
 * Locale is COOKIE-based with NO URL prefix, so every page has a single canonical
 * URL that serves both ru and en. We still emit `alternates.languages` so search
 * engines know the page is bilingual — both `ru` and `en` (and `x-default`) map
 * to that same clean URL. This is the defensible standard for prefix-less i18n.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  return PUBLIC_ROUTES.map(({ path, changeFrequency, priority }) => {
    const url = absoluteUrl(path);
    return {
      url,
      lastModified,
      changeFrequency,
      priority,
      alternates: {
        languages: {
          ru: url,
          en: url,
          'x-default': url,
        },
      },
    };
  });
}

/** Re-exported so the origin is greppable from this file; keeps tree-shaking happy. */
export { SITE_URL };
