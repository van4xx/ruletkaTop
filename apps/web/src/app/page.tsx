/**
 * Landing / home page for ruletka.top.
 *
 * SEO-first rewrite. The page is now a long-form marketing+content surface
 * composed of small, focused section components in `components/landing/*`:
 *
 *   1. Hero            — single H1 + signup/login CTAs + trust + stats + Top teaser
 *   2. WhatIs          — 3 prose paragraphs explaining the product (organic search)
 *   3. HowItWorks      — H2 + 3 numbered steps with H3
 *   4. FeaturesGrid    — 6 feature cards (H3 each + 2-sentence real prose)
 *   5. SafetySection   — the trust-&-safety story (Turnstile, Sightengine, mods)
 *   6. TopSection      — semantic wrap around the existing TopMarquee client island
 *   7. PricingSection  — Free / Premium Monthly (399 ₽) / Premium Yearly (3499 ₽)
 *   8. FaqSection      — 10 native `<details>` Q+A (drives FAQPage JSON-LD)
 *   9. FinalCta        — second-chance signup band at the page foot
 *
 * Every section is a SERVER component except `TopMarquee`, the only client
 * island in the tree. The LCP element (the hero H1) paints from the initial
 * HTML — no `landing-rise`, no `opacity:0` gate.
 *
 * Structured data — one JSON-LD blob in the page body covering:
 *   - Organization + WebSite           (also in root layout; ok to repeat by `@id`)
 *   - SiteNavigationElement (×N)       (primary nav)
 *   - WebApplication                   (the social roulette product)
 *   - SoftwareApplication w/ AggregateOffer (Premium price band)
 *   - FAQPage                          (mirrors the visible FAQ 1:1)
 *   - BreadcrumbList                   (home, 1 level)
 */
import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { JsonLdScript } from '@/components/json-ld';
import {
  faqPageLd,
  homeBreadcrumbLd,
  siteNavigationLd,
  softwareApplicationLd,
  webApplicationLd,
} from '@/lib/json-ld';
import { PRIMARY_NAV, USER_MENU } from '@/config/nav';
import { LandingHero } from '@/components/landing/hero';
import { WhatIsSection } from '@/components/landing/what-is-section';
import { HowItWorksSection } from '@/components/landing/how-it-works';
import { FeaturesGrid } from '@/components/landing/features-grid';
import { SafetySection } from '@/components/landing/safety-section';
import { LandingTopSection } from '@/components/landing/top-section';
import { PricingSection } from '@/components/landing/pricing-section';
import { FaqSection } from '@/components/landing/faq-section';
import { FinalCta } from '@/components/landing/final-cta';
import { PRICING_TIERS } from '@/components/landing/constants';

/**
 * Per-page metadata for `/`. Lives alongside the root-layout metadata: the
 * layout sets the SITE defaults (title template, OG site name, canonical
 * scope, manifest), while this hook concretizes the HOME page title +
 * description + canonical + hreflang for the public root URL.
 *
 * `og:image` is wired automatically by Next via the file-system convention —
 * `app/opengraph-image.tsx` is picked up as the OG image for this route, and
 * `app/twitter-image.tsx` becomes the Twitter card image. No manual `images:`
 * URL is needed and we keep the per-locale, dynamic OG renderer intact.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('metadata');
  const tl = await getTranslations('landing');
  const locale = await getLocale();

  return {
    title: t('titleDefault'),
    description: t('description'),
    keywords: t.raw('keywords') as string[],
    alternates: {
      canonical: '/',
      languages: {
        ru: '/',
        en: '/',
        'x-default': '/',
      },
    },
    openGraph: {
      type: 'website',
      url: 'https://ruletka.top/',
      siteName: 'ruletka.top',
      title: t('ogTitle'),
      description: t('ogDescription'),
      locale: locale === 'en' ? 'en_US' : 'ru_RU',
    },
    twitter: {
      card: 'summary_large_image',
      title: t('twitterTitle'),
      description: t('twitterDescription'),
    },
    // Belt-and-braces: a couple of social/legacy meta tags some scrapers still
    // read. `subject` is the H1 promise mirrored as a meta tag for crawlers
    // that don't parse JSON-LD.
    other: {
      'application-name': 'ruletka.top',
      'subject': tl('headline1'),
    },
  };
}

export default async function HomePage() {
  const t = await getTranslations('landing');
  const tm = await getTranslations('metadata');

  // ── Structured data ──────────────────────────────────────────────────
  // Pricing band for the SoftwareApplication AggregateOffer is read straight
  // from PRICING_TIERS so the JSON-LD never drifts from the visible cards.
  const paidPrices = PRICING_TIERS.filter((tier) => tier.priceRub > 0).map((tier) => tier.priceRub);
  const lowPriceRub = paidPrices.length ? Math.min(...paidPrices) : 0;
  const highPriceRub = paidPrices.length ? Math.max(...paidPrices) : 0;

  // FAQ — must mirror the visible `<details>` 1:1 (10 items).
  const faqItems = (t.raw('faq.items') as { q: string; a: string }[]).map((item) => ({
    question: item.q,
    answer: item.a,
  }));

  // Primary navigation — flatten into SiteNavigationElement nodes (helps
  // sitelinks under the brand snippet).
  const navNodes = siteNavigationLd(
    [...PRIMARY_NAV, ...USER_MENU].map((item) => ({ name: item.label, path: item.href })),
  );

  const structuredData = [
    webApplicationLd(t('headline1'), t('subheading')),
    softwareApplicationLd(tm('titleDefault'), tm('description'), {
      lowPriceRub,
      highPriceRub,
      offerCount: paidPrices.length,
    }),
    faqPageLd(faqItems),
    homeBreadcrumbLd('ruletka.top'),
    ...navNodes,
  ];

  return (
    <div className="grain relative overflow-hidden">
      {/* Landing-specific structured data. Site-wide Organization + WebSite
          nodes are already emitted by the root layout. */}
      <JsonLdScript data={structuredData} />

      {/* ── Atmospheric background — purely decorative ───────────────── */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-40 left-1/2 h-[36rem] w-[36rem] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,var(--color-neon-violet)_0%,transparent_60%)] opacity-25 blur-3xl" />
        <div className="absolute -right-24 top-32 h-[28rem] w-[28rem] rounded-full bg-[radial-gradient(circle,var(--color-neon-magenta)_0%,transparent_60%)] opacity-20 blur-3xl" />
        <div className="absolute -left-24 top-64 h-[26rem] w-[26rem] rounded-full bg-[radial-gradient(circle,var(--color-neon-cyan)_0%,transparent_60%)] opacity-20 blur-3xl" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,var(--color-border)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-border)_1px,transparent_1px)] bg-[size:64px_64px] opacity-[0.15] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />
      </div>

      {/* The brief: keep heading hierarchy strict — exactly one h1 (in Hero),
          then h2 per section, h3 per item. Verified by reading each component. */}
      <LandingHero />
      <WhatIsSection />
      <HowItWorksSection />
      <FeaturesGrid />
      <SafetySection />
      <LandingTopSection />
      <PricingSection />
      <FaqSection />
      <FinalCta />
    </div>
  );
}
