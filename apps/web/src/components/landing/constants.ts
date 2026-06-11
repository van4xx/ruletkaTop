/**
 * Landing-page constants — single source of truth for the structured-content
 * sections (features grid, how-it-works, pricing tiers, FAQ shape).
 *
 * Pricing TIERS are listed here as a typed list of i18n keys + the LITERAL
 * price string in roubles that ALSO appears in the JSON-LD `Offer` blob, so the
 * structured data + the rendered card never drift apart. Updating a price means
 * editing this file and the matching `landing.pricing.*.price` message.
 *
 * The FAQ count is mirrored in the structured-data builder so `FAQPage`
 * `mainEntity` always matches the rendered `<dl>`. Keep this in sync with
 * `messages/{ru,en}/landing.json` → `faq.items`.
 */
import type { LucideIcon } from 'lucide-react';
import {
  ArrowRight,
  Crown,
  Gift,
  Heart,
  MessagesSquare,
  Mic,
  Sparkles,
  UserPlus,
  Users,
  Video,
} from 'lucide-react';
import { ROUTES, type RoutePath } from '@/config/nav';

// ── How it works ──────────────────────────────────────────────────────────
export interface HowStep {
  /** Key into `landing.howItWorks.step{1,2,3}`. */
  key: 'step1' | 'step2' | 'step3';
  icon: LucideIcon;
  /** Stop colour for the gradient bullet. */
  hue: 'violet' | 'magenta' | 'cyan';
}

export const HOW_STEPS: readonly HowStep[] = [
  { key: 'step1', icon: UserPlus, hue: 'violet' },
  { key: 'step2', icon: Video, hue: 'magenta' },
  { key: 'step3', icon: Heart, hue: 'cyan' },
] as const;

// ── Features grid (6 cards, brief asks for SIX) ───────────────────────────
export interface LandingFeature {
  /** Key into `landing.features.<key>.{title,description}`. */
  key: 'video' | 'voice' | 'friends' | 'chat' | 'gifts' | 'premium';
  icon: LucideIcon;
  href: RoutePath;
  /** Tailwind gradient stops used for the card's accent glow. */
  accent: string;
}

export const LANDING_FEATURES: readonly LandingFeature[] = [
  {
    key: 'video',
    icon: Video,
    href: ROUTES.video,
    accent: 'from-violet-500/30 to-fuchsia-500/10',
  },
  {
    key: 'voice',
    icon: Mic,
    href: ROUTES.voice,
    accent: 'from-cyan-400/30 to-sky-500/10',
  },
  {
    key: 'friends',
    icon: Users,
    href: ROUTES.friends,
    accent: 'from-emerald-400/30 to-teal-500/10',
  },
  {
    key: 'chat',
    icon: MessagesSquare,
    href: ROUTES.chats,
    accent: 'from-sky-400/30 to-indigo-500/10',
  },
  {
    key: 'gifts',
    icon: Gift,
    href: ROUTES.gifts,
    accent: 'from-amber-400/30 to-pink-500/10',
  },
  {
    key: 'premium',
    icon: Crown,
    href: ROUTES.premium,
    accent: 'from-fuchsia-500/30 to-violet-500/10',
  },
] as const;

// ── Pricing tiers ─────────────────────────────────────────────────────────
/**
 * One pricing tier. The `priceRub` literal flows into the
 * `AggregateOffer.lowPrice / highPrice` JSON-LD so structured data tracks the
 * rendered card. `0` means «free» (no Offer emitted for that tier).
 */
export interface PricingTier {
  /** Key into `landing.pricing.<key>.*` (name / price / period / perks / cta). */
  key: 'free' | 'lite' | 'pro';
  icon: LucideIcon;
  href: RoutePath;
  /** Price floor in RUB (0 = free). Mirrors what the visible price says. */
  priceRub: number;
  /** Tailwind gradient ring for the card. */
  accent: string;
  /** Mark this tier as "highlighted" (drawn slightly louder). */
  highlighted?: boolean;
}

export const PRICING_TIERS: readonly PricingTier[] = [
  {
    key: 'free',
    icon: Sparkles,
    href: ROUTES.home,
    priceRub: 0,
    accent: 'from-emerald-400/20 to-teal-500/0',
  },
  {
    key: 'lite',
    icon: Crown,
    href: ROUTES.premium,
    priceRub: 299,
    accent: 'from-violet-500/30 to-fuchsia-500/10',
    highlighted: true,
  },
  {
    key: 'pro',
    icon: ArrowRight,
    href: ROUTES.premium,
    priceRub: 3499,
    accent: 'from-cyan-400/25 to-sky-500/5',
  },
] as const;

/** Number of FAQ items the JSON-LD `FAQPage` must mirror. */
export const FAQ_COUNT = 10 as const;

// ── In-prose link routes (used by t.rich for natural inline anchors) ──────
export const PROSE_LINKS = {
  premium: ROUTES.premium,
  help: ROUTES.help,
  rules: ROUTES.rules,
} as const;
