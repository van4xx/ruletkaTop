'use client';

/**
 * <Gift3DArt /> — purely inline SVG-3D renderer for the gift catalogue.
 *
 * Each gift `code` is mapped to one of 10 "art variants" — bespoke layered
 * SVG illustrations (no external assets, no Lottie, no PNGs) so the bundle
 * stays tree-shakable and the cards animate even when the network's down.
 *
 * Every variant uses gradient fills + a soft drop-shadow and adds one
 * subtle ambient micro-animation (rotation, twinkle, flicker, sway). The
 * keyframes live in `apps/web/src/app/globals.css` under the `gift-3d-*`
 * prefix and the project's global `prefers-reduced-motion` rule collapses
 * them to a 0.001ms one-shot, so the static end-state is always legible.
 */
import { useId } from 'react';
import { cn } from '@/lib/cn';

/** The 10 distinct SVG-3D designs the renderer knows. */
export type GiftArtVariant =
  | 'rose'
  | 'bear'
  | 'ring'
  | 'heart'
  | 'star'
  | 'cake'
  | 'castle'
  | 'rocket'
  | 'crown'
  | 'cocktail';

/**
 * Stable `code → variant` map. Mirrors the BE seed in
 * `apps/api/src/modules/gifts/data/gift-catalogue.ts`. Any unknown code
 * falls back to `heart` (the warmest "neutral" choice).
 */
export const GIFT_ART_BY_CODE: Readonly<Record<string, GiftArtVariant>> = {
  rose: 'rose',
  heart: 'heart',
  star: 'star',
  teddy: 'bear',
  bear: 'bear',
  cake: 'cake',
  cocktail: 'cocktail',
  martini: 'cocktail',
  diamond: 'ring',
  ring: 'ring',
  rocket: 'rocket',
  crown: 'crown',
  castle: 'castle',
};

/**
 * Resolve a variant by `code` (or an explicit override from the BE).
 * Robust to unknown codes — falls back to `heart`.
 */
export function resolveGiftVariant(
  code: string | undefined,
  override?: string | null,
): GiftArtVariant {
  if (override && isVariant(override)) return override;
  if (code) {
    const mapped = GIFT_ART_BY_CODE[code];
    if (mapped) return mapped;
  }
  return 'heart';
}

function isVariant(v: string): v is GiftArtVariant {
  return (
    v === 'rose' ||
    v === 'bear' ||
    v === 'ring' ||
    v === 'heart' ||
    v === 'star' ||
    v === 'cake' ||
    v === 'castle' ||
    v === 'rocket' ||
    v === 'crown' ||
    v === 'cocktail'
  );
}

export interface Gift3DArtProps {
  /** Catalogue code (`rose`, `crown`, …) — looked up against {@link GIFT_ART_BY_CODE}. */
  code?: string;
  /** Optional direct override (e.g. an `artVariant` field from the API). */
  variant?: GiftArtVariant | null;
  /** Sets `aria-label`; when omitted the SVG is `aria-hidden`. */
  label?: string;
  className?: string;
}

/**
 * Renders the SVG-3D art for a gift. The SVG fills its parent (use a
 * square container). Decorative by default — pass `label` to expose it.
 */
export function Gift3DArt({ code, variant, label, className }: Gift3DArtProps) {
  // useId lets us scope <defs> ids per instance so two cards on the same
  // page don't clash when reusing the same gradient ids.
  const uid = useId().replace(/:/g, '');
  const resolved: GiftArtVariant = variant ?? resolveGiftVariant(code);

  const a11y = label
    ? { role: 'img' as const, 'aria-label': label }
    : { 'aria-hidden': true as const };

  return (
    <svg
      viewBox="0 0 120 120"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('h-full w-full', className)}
      {...a11y}
    >
      {renderVariant(resolved, uid)}
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Variant renderers. Each is a self-contained <g>/<defs> tuple drawn inside
// the shared 120×120 viewBox. Coordinates are kept centered so cards crop
// uniformly when stacked on narrow viewports.
// ─────────────────────────────────────────────────────────────────────────

function renderVariant(v: GiftArtVariant, uid: string) {
  switch (v) {
    case 'rose':
      return <RoseArt uid={uid} />;
    case 'bear':
      return <BearArt uid={uid} />;
    case 'ring':
      return <RingArt uid={uid} />;
    case 'heart':
      return <HeartArt uid={uid} />;
    case 'star':
      return <StarArt uid={uid} />;
    case 'cake':
      return <CakeArt uid={uid} />;
    case 'castle':
      return <CastleArt uid={uid} />;
    case 'rocket':
      return <RocketArt uid={uid} />;
    case 'crown':
      return <CrownArt uid={uid} />;
    case 'cocktail':
      return <CocktailArt uid={uid} />;
  }
}

interface ArtProps {
  uid: string;
}

/* ── shared filter: soft drop-shadow used by every variant ─────────── */
function DropShadow({ id }: { id: string }) {
  return (
    <filter id={id} x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="2.2" />
      <feOffset dx="0" dy="3" result="off" />
      <feComponentTransfer>
        <feFuncA type="linear" slope="0.55" />
      </feComponentTransfer>
      <feMerge>
        <feMergeNode />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>
  );
}

/* 1. ROSE — multi-petal rose with stem, slow sway */
function RoseArt({ uid }: ArtProps) {
  const grad = `g-rose-${uid}`;
  const dark = `g-rose-d-${uid}`;
  const leaf = `g-rose-l-${uid}`;
  const stem = `g-rose-s-${uid}`;
  const shadow = `f-rose-sh-${uid}`;
  return (
    <>
      <defs>
        <radialGradient id={grad} cx="50%" cy="35%" r="65%">
          <stop offset="0%" stopColor="#ffb6c1" />
          <stop offset="55%" stopColor="#ff3d6e" />
          <stop offset="100%" stopColor="#b00033" />
        </radialGradient>
        <radialGradient id={dark} cx="50%" cy="55%" r="60%">
          <stop offset="0%" stopColor="#ff5e85" />
          <stop offset="100%" stopColor="#7a0022" />
        </radialGradient>
        <linearGradient id={leaf} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#3ddc7a" />
          <stop offset="100%" stopColor="#0e6b3a" />
        </linearGradient>
        <linearGradient id={stem} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1f7a3c" />
          <stop offset="100%" stopColor="#0b3a1c" />
        </linearGradient>
        <DropShadow id={shadow} />
      </defs>

      {/* stem + leaves */}
      <g className="gift-3d-sway" style={{ transformOrigin: '60px 60px' }}>
        <path d="M60 60 Q58 80 64 110" stroke={`url(#${stem})`} strokeWidth="4" fill="none" strokeLinecap="round" />
        <path
          d="M62 86 Q78 78 84 90 Q72 94 62 88 Z"
          fill={`url(#${leaf})`}
          filter={`url(#${shadow})`}
        />
        <path
          d="M58 96 Q42 92 36 104 Q50 106 58 98 Z"
          fill={`url(#${leaf})`}
          opacity="0.9"
        />

        {/* outer petals */}
        <g filter={`url(#${shadow})`}>
          <path d="M60 56 Q34 46 32 24 Q48 14 60 30 Z" fill={`url(#${dark})`} />
          <path d="M60 56 Q86 46 88 24 Q72 14 60 30 Z" fill={`url(#${dark})`} />
          <path d="M60 60 Q40 70 28 56 Q34 38 56 44 Z" fill={`url(#${grad})`} />
          <path d="M60 60 Q80 70 92 56 Q86 38 64 44 Z" fill={`url(#${grad})`} />
        </g>

        {/* inner whorl */}
        <path d="M60 56 Q48 44 60 36 Q72 44 60 56 Z" fill={`url(#${grad})`} />
        <path d="M60 52 Q54 44 60 40 Q66 44 60 52 Z" fill="#ffd1dc" opacity="0.8" />
        <circle cx="60" cy="48" r="3" fill="#ffe8ef" opacity="0.9" />
      </g>
    </>
  );
}

/* 2. BEAR — geometric teddy with bow tie, idle bob */
function BearArt({ uid }: ArtProps) {
  const fur = `g-bear-f-${uid}`;
  const belly = `g-bear-b-${uid}`;
  const bow = `g-bear-bow-${uid}`;
  const shadow = `f-bear-sh-${uid}`;
  return (
    <>
      <defs>
        <radialGradient id={fur} cx="50%" cy="40%" r="65%">
          <stop offset="0%" stopColor="#d49a64" />
          <stop offset="60%" stopColor="#8b5a2b" />
          <stop offset="100%" stopColor="#4a2c14" />
        </radialGradient>
        <radialGradient id={belly} cx="50%" cy="50%" r="55%">
          <stop offset="0%" stopColor="#f4c98e" />
          <stop offset="100%" stopColor="#a06a36" />
        </radialGradient>
        <linearGradient id={bow} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ff5e85" />
          <stop offset="100%" stopColor="#a40034" />
        </linearGradient>
        <DropShadow id={shadow} />
      </defs>
      <g className="gift-3d-bob" style={{ transformOrigin: '60px 60px' }} filter={`url(#${shadow})`}>
        {/* ears */}
        <circle cx="34" cy="30" r="12" fill={`url(#${fur})`} />
        <circle cx="86" cy="30" r="12" fill={`url(#${fur})`} />
        <circle cx="34" cy="30" r="6" fill="#f4c98e" opacity="0.8" />
        <circle cx="86" cy="30" r="6" fill="#f4c98e" opacity="0.8" />
        {/* head */}
        <circle cx="60" cy="50" r="26" fill={`url(#${fur})`} />
        {/* muzzle */}
        <ellipse cx="60" cy="58" rx="14" ry="10" fill={`url(#${belly})`} />
        {/* nose */}
        <path d="M55 53 Q60 49 65 53 Q60 60 55 53 Z" fill="#2a1809" />
        {/* eyes */}
        <circle cx="50" cy="46" r="3" fill="#1a0e05" />
        <circle cx="70" cy="46" r="3" fill="#1a0e05" />
        <circle cx="49" cy="45" r="1" fill="#fff" />
        <circle cx="69" cy="45" r="1" fill="#fff" />
        {/* mouth */}
        <path d="M58 62 Q60 65 62 62" stroke="#2a1809" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        {/* bow tie */}
        <path
          d="M44 82 L60 90 L76 82 L72 96 L60 90 L48 96 Z"
          fill={`url(#${bow})`}
        />
        <circle cx="60" cy="89" r="3" fill="#ffd1dc" />
      </g>
    </>
  );
}

/* 3. RING — diamond ring with sparkle filter */
function RingArt({ uid }: ArtProps) {
  const band = `g-ring-b-${uid}`;
  const stone = `g-ring-s-${uid}`;
  const stoneHi = `g-ring-h-${uid}`;
  const sparkle = `f-ring-sp-${uid}`;
  const shadow = `f-ring-sh-${uid}`;
  return (
    <>
      <defs>
        <linearGradient id={band} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fff3a8" />
          <stop offset="50%" stopColor="#f7c44b" />
          <stop offset="100%" stopColor="#8a5a08" />
        </linearGradient>
        <radialGradient id={stone} cx="50%" cy="40%" r="55%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="55%" stopColor="#a8e9ff" />
          <stop offset="100%" stopColor="#1e6e9c" />
        </radialGradient>
        <linearGradient id={stoneHi} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <filter id={sparkle} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.8" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <DropShadow id={shadow} />
      </defs>

      <g filter={`url(#${shadow})`}>
        {/* band */}
        <ellipse cx="60" cy="78" rx="28" ry="10" fill="none" stroke={`url(#${band})`} strokeWidth="8" />
        <ellipse cx="60" cy="78" rx="28" ry="10" fill="none" stroke="#fff3a8" strokeWidth="1.5" opacity="0.6" />

        {/* prongs */}
        <path d="M50 60 L48 48 M70 60 L72 48 M60 56 L60 44" stroke={`url(#${band})`} strokeWidth="3" strokeLinecap="round" />

        {/* diamond */}
        <g filter={`url(#${sparkle})`}>
          <path
            d="M60 28 L74 44 L60 64 L46 44 Z"
            fill={`url(#${stone})`}
          />
          <path d="M60 28 L74 44 L60 44 Z" fill={`url(#${stoneHi})`} />
          <path d="M52 36 L60 30 L60 42 Z" fill="#ffffff" opacity="0.6" />
        </g>
      </g>

      {/* sparkles */}
      <g className="gift-3d-twinkle">
        <path d="M86 30 L88 36 L94 38 L88 40 L86 46 L84 40 L78 38 L84 36 Z" fill="#fffde2" />
      </g>
      <g className="gift-3d-twinkle-2">
        <path d="M30 56 L31 60 L35 61 L31 62 L30 66 L29 62 L25 61 L29 60 Z" fill="#fffde2" />
      </g>
    </>
  );
}

/* 4. HEART — chunky 3D heart with highlight, slow pulse */
function HeartArt({ uid }: ArtProps) {
  const fill = `g-heart-${uid}`;
  const dark = `g-heart-d-${uid}`;
  const hi = `g-heart-h-${uid}`;
  const shadow = `f-heart-sh-${uid}`;
  return (
    <>
      <defs>
        <radialGradient id={fill} cx="40%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#ff8aa6" />
          <stop offset="55%" stopColor="#ff2d55" />
          <stop offset="100%" stopColor="#8a0024" />
        </radialGradient>
        <radialGradient id={dark} cx="60%" cy="80%" r="50%">
          <stop offset="0%" stopColor="#ff2d55" stopOpacity="0" />
          <stop offset="100%" stopColor="#3a000f" stopOpacity="0.6" />
        </radialGradient>
        <linearGradient id={hi} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <DropShadow id={shadow} />
      </defs>
      <g className="gift-3d-pulse" style={{ transformOrigin: '60px 64px' }} filter={`url(#${shadow})`}>
        <path
          d="M60 96 C32 76 18 60 18 42 C18 28 30 18 42 18 C50 18 56 22 60 30 C64 22 70 18 78 18 C90 18 102 28 102 42 C102 60 88 76 60 96 Z"
          fill={`url(#${fill})`}
        />
        <path
          d="M60 96 C32 76 18 60 18 42 C18 28 30 18 42 18 C50 18 56 22 60 30 C64 22 70 18 78 18 C90 18 102 28 102 42 C102 60 88 76 60 96 Z"
          fill={`url(#${dark})`}
        />
        {/* glossy highlight */}
        <path
          d="M34 32 Q42 22 54 26 Q50 36 40 42 Q34 40 34 32 Z"
          fill={`url(#${hi})`}
        />
      </g>
    </>
  );
}

/* 5. STAR — 5-point star, metallic stroke, twinkles */
function StarArt({ uid }: ArtProps) {
  const fill = `g-star-${uid}`;
  const stroke = `g-star-st-${uid}`;
  const shadow = `f-star-sh-${uid}`;
  // 5-point star centered at (60,60), outer r=42, inner r=18
  const points = starPoints(60, 60, 5, 42, 18, -90);
  return (
    <>
      <defs>
        <linearGradient id={fill} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fff3a8" />
          <stop offset="50%" stopColor="#ffce3a" />
          <stop offset="100%" stopColor="#a55a00" />
        </linearGradient>
        <linearGradient id={stroke} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#cc8400" />
        </linearGradient>
        <DropShadow id={shadow} />
      </defs>
      <g filter={`url(#${shadow})`}>
        <polygon
          points={points}
          fill={`url(#${fill})`}
          stroke={`url(#${stroke})`}
          strokeWidth="2"
          strokeLinejoin="round"
        />
        {/* inner highlight */}
        <polygon
          points={starPoints(60, 60, 5, 20, 8, -90)}
          fill="#fffde2"
          opacity="0.55"
        />
      </g>
      {/* twinkles */}
      <g className="gift-3d-twinkle">
        <circle cx="26" cy="34" r="2" fill="#fffde2" />
      </g>
      <g className="gift-3d-twinkle-2">
        <circle cx="94" cy="74" r="2.4" fill="#fffde2" />
      </g>
      <g className="gift-3d-twinkle">
        <circle cx="98" cy="34" r="1.6" fill="#fffde2" />
      </g>
    </>
  );
}

function starPoints(
  cx: number,
  cy: number,
  spikes: number,
  outerR: number,
  innerR: number,
  startDeg: number,
): string {
  const out: string[] = [];
  const step = Math.PI / spikes;
  let rot = (startDeg * Math.PI) / 180;
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    out.push(`${(cx + Math.cos(rot) * r).toFixed(2)},${(cy + Math.sin(rot) * r).toFixed(2)}`);
    rot += step;
  }
  return out.join(' ');
}

/* 6. CAKE — three-tier cake with flickering candle flame */
function CakeArt({ uid }: ArtProps) {
  const tier1 = `g-cake-1-${uid}`;
  const tier2 = `g-cake-2-${uid}`;
  const tier3 = `g-cake-3-${uid}`;
  const flame = `g-cake-fl-${uid}`;
  const shadow = `f-cake-sh-${uid}`;
  return (
    <>
      <defs>
        <linearGradient id={tier1} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffd9ea" />
          <stop offset="100%" stopColor="#d35a8a" />
        </linearGradient>
        <linearGradient id={tier2} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fff3cf" />
          <stop offset="100%" stopColor="#c98a2c" />
        </linearGradient>
        <linearGradient id={tier3} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#d6ecff" />
          <stop offset="100%" stopColor="#3a7ec2" />
        </linearGradient>
        <radialGradient id={flame} cx="50%" cy="60%" r="60%">
          <stop offset="0%" stopColor="#fff8a6" />
          <stop offset="55%" stopColor="#ff9b1e" />
          <stop offset="100%" stopColor="#a32500" />
        </radialGradient>
        <DropShadow id={shadow} />
      </defs>
      <g filter={`url(#${shadow})`}>
        {/* bottom tier */}
        <rect x="22" y="74" width="76" height="20" rx="4" fill={`url(#${tier1})`} />
        <path d="M22 74 Q34 70 46 74 Q58 70 70 74 Q82 70 98 74 L98 80 L22 80 Z" fill="#fff" opacity="0.4" />
        {/* mid tier */}
        <rect x="32" y="56" width="56" height="18" rx="3" fill={`url(#${tier2})`} />
        <path d="M32 56 Q46 52 60 56 Q74 52 88 56 L88 62 L32 62 Z" fill="#fff" opacity="0.4" />
        {/* top tier */}
        <rect x="44" y="40" width="32" height="16" rx="2.5" fill={`url(#${tier3})`} />
        <path d="M44 40 Q52 36 60 40 Q68 36 76 40 L76 46 L44 46 Z" fill="#fff" opacity="0.45" />
        {/* candle */}
        <rect x="58" y="24" width="4" height="18" rx="1" fill="#f3f3f3" />
        <rect x="58" y="26" width="4" height="2" fill="#ff5e85" />
        <rect x="58" y="32" width="4" height="2" fill="#ff5e85" />
      </g>
      {/* flame — flickers */}
      <g className="gift-3d-flicker" style={{ transformOrigin: '60px 22px' }}>
        <path
          d="M60 10 Q66 16 64 22 Q60 26 56 22 Q54 16 60 10 Z"
          fill={`url(#${flame})`}
        />
        <circle cx="60" cy="20" r="2" fill="#fff8a6" />
      </g>
    </>
  );
}

/* 7. CASTLE — fairy-tale castle silhouette with banner */
function CastleArt({ uid }: ArtProps) {
  const wall = `g-cas-w-${uid}`;
  const roof = `g-cas-r-${uid}`;
  const sky = `g-cas-sky-${uid}`;
  const flag = `g-cas-f-${uid}`;
  const shadow = `f-cas-sh-${uid}`;
  return (
    <>
      <defs>
        <radialGradient id={sky} cx="50%" cy="40%" r="70%">
          <stop offset="0%" stopColor="#7faaff" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#3b2a8c" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={wall} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#e2d5ff" />
          <stop offset="100%" stopColor="#6f4cb8" />
        </linearGradient>
        <linearGradient id={roof} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ff8aa6" />
          <stop offset="100%" stopColor="#a4063b" />
        </linearGradient>
        <linearGradient id={flag} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#ffce3a" />
          <stop offset="100%" stopColor="#ff5e85" />
        </linearGradient>
        <DropShadow id={shadow} />
      </defs>
      <ellipse cx="60" cy="60" rx="55" ry="40" fill={`url(#${sky})`} />
      <g filter={`url(#${shadow})`}>
        {/* main keep */}
        <rect x="46" y="44" width="28" height="50" fill={`url(#${wall})`} />
        {/* side towers */}
        <rect x="22" y="56" width="20" height="38" fill={`url(#${wall})`} />
        <rect x="78" y="56" width="20" height="38" fill={`url(#${wall})`} />
        {/* crenelations */}
        <path d="M22 56 h4 v-4 h4 v4 h4 v-4 h4 v4 h4 v-4 h2 v4" fill={`url(#${wall})`} />
        <path d="M78 56 h4 v-4 h4 v4 h4 v-4 h4 v4 h4 v-4 h2 v4" fill={`url(#${wall})`} />
        {/* roofs */}
        <path d="M22 56 L32 36 L42 56 Z" fill={`url(#${roof})`} />
        <path d="M78 56 L88 36 L98 56 Z" fill={`url(#${roof})`} />
        <path d="M46 44 L60 22 L74 44 Z" fill={`url(#${roof})`} />
        {/* door */}
        <path d="M52 94 L52 76 Q60 64 68 76 L68 94 Z" fill="#2a1745" />
        <circle cx="64" cy="84" r="1" fill="#ffce3a" />
        {/* windows */}
        <rect x="28" y="64" width="3" height="6" fill="#ffce3a" opacity="0.8" />
        <rect x="34" y="64" width="3" height="6" fill="#ffce3a" opacity="0.8" />
        <rect x="84" y="64" width="3" height="6" fill="#ffce3a" opacity="0.8" />
        <rect x="90" y="64" width="3" height="6" fill="#ffce3a" opacity="0.8" />
      </g>
      {/* banner */}
      <line x1="60" y1="22" x2="60" y2="6" stroke="#e2d5ff" strokeWidth="1.2" />
      <g className="gift-3d-sway" style={{ transformOrigin: '60px 8px' }}>
        <path d="M60 6 L78 10 L74 16 L78 22 L60 18 Z" fill={`url(#${flag})`} />
      </g>
    </>
  );
}

/* 8. ROCKET — angled rocket with exhaust flame */
function RocketArt({ uid }: ArtProps) {
  const body = `g-rok-b-${uid}`;
  const fin = `g-rok-f-${uid}`;
  const glass = `g-rok-g-${uid}`;
  const flame = `g-rok-fl-${uid}`;
  const shadow = `f-rok-sh-${uid}`;
  return (
    <>
      <defs>
        <linearGradient id={body} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#5a607a" />
          <stop offset="50%" stopColor="#eef0f8" />
          <stop offset="100%" stopColor="#5a607a" />
        </linearGradient>
        <linearGradient id={fin} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ff5e85" />
          <stop offset="100%" stopColor="#a4063b" />
        </linearGradient>
        <radialGradient id={glass} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#a8e9ff" />
          <stop offset="100%" stopColor="#1e6e9c" />
        </radialGradient>
        <radialGradient id={flame} cx="50%" cy="20%" r="80%">
          <stop offset="0%" stopColor="#fff8a6" />
          <stop offset="55%" stopColor="#ff9b1e" />
          <stop offset="100%" stopColor="#a32500" stopOpacity="0" />
        </radialGradient>
        <DropShadow id={shadow} />
      </defs>
      {/* flame (under rocket) */}
      <g className="gift-3d-flicker" style={{ transformOrigin: '60px 92px' }}>
        <path d="M50 86 Q60 116 70 86 Q60 100 50 86 Z" fill={`url(#${flame})`} />
        <path d="M54 86 Q60 104 66 86 Q60 96 54 86 Z" fill="#fffce0" opacity="0.85" />
      </g>
      {/* rocket — tilted */}
      <g transform="rotate(-12 60 60)" filter={`url(#${shadow})`}>
        {/* fins */}
        <path d="M44 78 L36 92 L52 84 Z" fill={`url(#${fin})`} />
        <path d="M76 78 L84 92 L68 84 Z" fill={`url(#${fin})`} />
        {/* body */}
        <path d="M48 80 Q48 38 60 18 Q72 38 72 80 Z" fill={`url(#${body})`} />
        {/* window */}
        <circle cx="60" cy="42" r="8" fill={`url(#${glass})`} stroke="#eef0f8" strokeWidth="2" />
        <path d="M55 38 Q60 34 65 38" stroke="#ffffff" strokeWidth="1.5" fill="none" opacity="0.7" />
        {/* trim stripe */}
        <rect x="48" y="64" width="24" height="4" fill="#ff5e85" />
      </g>
    </>
  );
}

/* 9. CROWN — gold crown with jewels, idle gleam */
function CrownArt({ uid }: ArtProps) {
  const gold = `g-cr-g-${uid}`;
  const hi = `g-cr-h-${uid}`;
  const ruby = `g-cr-r-${uid}`;
  const emerald = `g-cr-e-${uid}`;
  const sapphire = `g-cr-s-${uid}`;
  const shadow = `f-cr-sh-${uid}`;
  return (
    <>
      <defs>
        <linearGradient id={gold} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fff3a8" />
          <stop offset="50%" stopColor="#f7c44b" />
          <stop offset="100%" stopColor="#7a4a04" />
        </linearGradient>
        <linearGradient id={hi} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={ruby} cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#ff8aa6" />
          <stop offset="100%" stopColor="#7a0022" />
        </radialGradient>
        <radialGradient id={emerald} cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#9bf2c0" />
          <stop offset="100%" stopColor="#0a5a2a" />
        </radialGradient>
        <radialGradient id={sapphire} cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#a8c8ff" />
          <stop offset="100%" stopColor="#0a2a8a" />
        </radialGradient>
        <DropShadow id={shadow} />
      </defs>
      <g filter={`url(#${shadow})`}>
        {/* base band */}
        <rect x="20" y="74" width="80" height="14" rx="3" fill={`url(#${gold})`} />
        {/* points */}
        <path
          d="M20 74 L30 40 L42 66 L52 30 L60 60 L68 30 L78 66 L90 40 L100 74 Z"
          fill={`url(#${gold})`}
        />
        {/* gleam */}
        <path
          d="M20 74 L30 40 L42 66 L52 30 L60 60 L68 30 L78 66 L90 40 L100 74 L100 78 L20 78 Z"
          fill={`url(#${hi})`}
        />
        {/* jewels on points */}
        <circle cx="30" cy="42" r="5" fill={`url(#${sapphire})`} />
        <circle cx="52" cy="32" r="5" fill={`url(#${emerald})`} />
        <circle cx="60" cy="62" r="6" fill={`url(#${ruby})`} />
        <circle cx="68" cy="32" r="5" fill={`url(#${emerald})`} />
        <circle cx="90" cy="42" r="5" fill={`url(#${sapphire})`} />
        {/* band jewels */}
        <circle cx="34" cy="81" r="3" fill={`url(#${ruby})`} />
        <circle cx="60" cy="81" r="3" fill={`url(#${emerald})`} />
        <circle cx="86" cy="81" r="3" fill={`url(#${ruby})`} />
      </g>
      {/* sparkle */}
      <g className="gift-3d-twinkle">
        <circle cx="98" cy="28" r="2" fill="#fffde2" />
      </g>
      <g className="gift-3d-twinkle-2">
        <circle cx="24" cy="32" r="1.6" fill="#fffde2" />
      </g>
    </>
  );
}

/* 10. COCKTAIL — martini glass with liquid sway + olive */
function CocktailArt({ uid }: ArtProps) {
  const glass = `g-co-g-${uid}`;
  const liquid = `g-co-l-${uid}`;
  const olive = `g-co-o-${uid}`;
  const shadow = `f-co-sh-${uid}`;
  return (
    <>
      <defs>
        <linearGradient id={glass} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#a8e9ff" stopOpacity="0.5" />
        </linearGradient>
        <linearGradient id={liquid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffce3a" />
          <stop offset="100%" stopColor="#ff5e85" />
        </linearGradient>
        <radialGradient id={olive} cx="40%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#a4d65e" />
          <stop offset="100%" stopColor="#3a5c14" />
        </radialGradient>
        <DropShadow id={shadow} />
      </defs>
      <g filter={`url(#${shadow})`}>
        {/* bowl outline */}
        <path
          d="M28 28 L92 28 L60 70 Z"
          fill={`url(#${glass})`}
          stroke="#ffffff"
          strokeWidth="1.5"
          opacity="0.95"
        />
        {/* liquid (swayed via group) */}
        <g className="gift-3d-sway" style={{ transformOrigin: '60px 36px' }}>
          <path
            d="M34 32 Q60 40 86 32 L60 64 Z"
            fill={`url(#${liquid})`}
          />
          {/* surface shimmer */}
          <ellipse cx="50" cy="34" rx="8" ry="1.5" fill="#fff" opacity="0.6" />
        </g>
        {/* stem */}
        <rect x="58" y="70" width="4" height="22" fill={`url(#${glass})`} />
        {/* base */}
        <ellipse cx="60" cy="96" rx="18" ry="4" fill={`url(#${glass})`} />
        {/* rim highlight */}
        <line x1="28" y1="28" x2="92" y2="28" stroke="#ffffff" strokeWidth="2" opacity="0.7" strokeLinecap="round" />
      </g>
      {/* olive on a pick — slight bob */}
      <g className="gift-3d-bob" style={{ transformOrigin: '74px 30px' }}>
        <line x1="62" y1="22" x2="84" y2="46" stroke="#e2d5ff" strokeWidth="1.5" />
        <circle cx="84" cy="46" r="5" fill={`url(#${olive})`} />
        <circle cx="84" cy="46" r="1.5" fill="#ff5e85" />
      </g>
    </>
  );
}
