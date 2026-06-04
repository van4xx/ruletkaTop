'use client';

/**
 * Profile-cover VISUALS — the client renderer keyed by the shared `CoverId`.
 *
 * Each cover in the catalogue (`@ruletka/shared-types` `COVER_CATALOGUE`) maps
 * to a hand-built, on-brand LAYER STACK drawn from the neon brand tokens
 * (`--color-neon-violet|cyan|magenta`, `--coin`, gold). The same component
 * renders both the profile HERO band (full size, animated) and the picker
 * THUMBNAILS (small, motion-disabled) — see {@link ProfileCover}.
 *
 * `aurora` reproduces the historical hero markup VERBATIM, so every existing
 * user sees zero visual regression (it is also the default).
 *
 * A11y contract: looping motion is gated on the `reduce` flag (derived from
 * `useReducedMotion()` at the call site). When `reduce` is true the STATIC
 * gradient still renders in full — only the animated loops are dropped — so the
 * cover is never blank, mirroring the original hero's drifting-orb behaviour.
 */
import type { CSSProperties, FC } from 'react';
import { motion } from 'framer-motion';
import type { CoverId } from '@ruletka/shared-types';

/** Props every preset layer component receives. */
export interface CoverLayerProps {
  /** When true, looping animations are suppressed (reduced-motion / thumbnails). */
  reduce: boolean;
}

/** A registry entry: the layered visual + a CSS gradient used for chrome swatches. */
export interface CoverPreset {
  /** The full layer stack (absolutely-positioned children filling the band). */
  Layers: FC<CoverLayerProps>;
  /** A representative CSS background (used for the small swatch dot in chrome). */
  swatch: string;
}

const NEON_VIOLET = 'var(--color-neon-violet)';
const NEON_CYAN = 'var(--color-neon-cyan)';
const NEON_MAGENTA = 'var(--color-neon-magenta)';
const GOLD = 'oklch(0.82 0.14 85)';
const EMERALD = 'oklch(0.8 0.15 165)';
const AMBER = 'oklch(0.78 0.16 70)';

/** A reusable infinite-loop transition (callers pass `undefined` to pause it). */
function loop(duration: number, delay = 0) {
  return { duration, delay, repeat: Infinity, ease: 'easeInOut' as const };
}

/* ════════════════════════════════════════════════════════════════════════
 * 1) AURORA — the DEFAULT (today's hero, verbatim).
 *    violet→magenta→cyan diagonal wash, central cyan bloom, two drifting orbs,
 *    tech-grid + grain, bottom fade.
 * ════════════════════════════════════════════════════════════════════════ */
const AuroraLayers: FC<CoverLayerProps> = ({ reduce }) => (
  <>
    {/* Aurora base wash — richer so the cover reads vivid, not washed-out. */}
    <div className="absolute inset-0 bg-gradient-to-br from-[var(--color-neon-violet)]/65 via-[var(--color-neon-magenta)]/40 to-[var(--color-neon-cyan)]/55" />
    {/* Bright central bloom for depth under the identity block. */}
    <div
      aria-hidden="true"
      className="absolute left-1/2 top-0 h-56 w-2/3 -translate-x-1/2 bg-[radial-gradient(ellipse_at_top,color-mix(in_oklch,var(--color-neon-cyan)_45%,transparent),transparent_70%)] blur-2xl"
    />
    {/* Drifting neon orbs (paused under reduced-motion). */}
    <motion.div
      className="absolute -left-10 -top-16 h-48 w-48 rounded-full bg-[radial-gradient(circle,var(--color-neon-violet),transparent_65%)] opacity-60 blur-2xl"
      animate={reduce ? undefined : { x: [0, 24, 0], y: [0, 14, 0] }}
      transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut' }}
    />
    <motion.div
      className="absolute -right-8 top-0 h-40 w-40 rounded-full bg-[radial-gradient(circle,var(--color-neon-cyan),transparent_65%)] opacity-50 blur-2xl"
      animate={reduce ? undefined : { x: [0, -20, 0], y: [0, 18, 0] }}
      transition={{ duration: 17, repeat: Infinity, ease: 'easeInOut' }}
    />
    {/* Tech grid + grain for texture, fading into the panel. */}
    <div className="absolute inset-0 bg-[linear-gradient(to_right,var(--color-border)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-border)_1px,transparent_1px)] bg-[size:40px_40px] opacity-[0.12] [mask-image:linear-gradient(to_bottom,black,transparent)]" />
    <div className="grain absolute inset-0" />
    <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[var(--color-card)]/70 to-transparent" />
  </>
);

/* ════════════════════════════════════════════════════════════════════════
 * 2) GRAPHITE — calm dark minimalist (FREE). Near-black base, a single faint
 *    top-left violet glow, a fine grid fading down, no motion.
 * ════════════════════════════════════════════════════════════════════════ */
const GraphiteLayers: FC<CoverLayerProps> = () => (
  <>
    <div className="absolute inset-0" style={{ background: 'oklch(0.18 0.02 280)' }} />
    {/* Single faint top-left violet glow at low opacity. */}
    <div
      className="absolute -left-16 -top-20 h-56 w-56 rounded-full blur-3xl"
      style={{
        background: `radial-gradient(circle, ${NEON_VIOLET}, transparent 65%)`,
        opacity: 0.18,
      }}
    />
    {/* Fine 40px grid, fading toward the bottom. No animation. */}
    <div className="absolute inset-0 bg-[linear-gradient(to_right,var(--color-border)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-border)_1px,transparent_1px)] bg-[size:40px_40px] opacity-[0.10] [mask-image:linear-gradient(to_bottom,black,transparent)]" />
    <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[var(--color-card)]/70 to-transparent" />
  </>
);

/* ════════════════════════════════════════════════════════════════════════
 * 3) SUNSET DRIVE — warm synthwave (PAID). magenta→amber→violet wash with a
 *    bright horizon line, a low sun-bloom, drifting scanlines.
 * ════════════════════════════════════════════════════════════════════════ */
const SunsetLayers: FC<CoverLayerProps> = ({ reduce }) => (
  <>
    <div
      className="absolute inset-0"
      style={{
        background: `linear-gradient(180deg, ${NEON_MAGENTA} 0%, ${AMBER} 55%, ${NEON_VIOLET} 100%)`,
        opacity: 0.6,
      }}
    />
    {/* Soft sun-bloom sitting low + centred. */}
    <div
      className="absolute bottom-2 left-1/2 h-40 w-2/3 -translate-x-1/2 blur-2xl"
      style={{
        background: `radial-gradient(ellipse at bottom, color-mix(in oklch, ${AMBER} 70%, transparent), transparent 70%)`,
      }}
    />
    {/* Brighter magenta horizon line. */}
    <div
      className="absolute inset-x-0 bottom-[34%] h-px"
      style={{ background: NEON_MAGENTA, opacity: 0.55, boxShadow: `0 0 18px ${NEON_MAGENTA}` }}
    />
    {/* Faint horizontal scanlines drifting upward. */}
    <motion.div
      aria-hidden="true"
      className="absolute inset-0 opacity-[0.18]"
      style={{
        backgroundImage: `repeating-linear-gradient(0deg, transparent 0 6px, color-mix(in oklch, ${NEON_MAGENTA} 60%, transparent) 6px 7px)`,
      }}
      animate={reduce ? undefined : { backgroundPositionY: ['0px', '-14px'] }}
      transition={loop(6)}
    />
    <div className="grain absolute inset-0" />
    <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[var(--color-card)]/70 to-transparent" />
  </>
);

/* ════════════════════════════════════════════════════════════════════════
 * 4) MINT GLASS — fresh cyan/emerald (PAID). cyan→emerald mesh, a swept
 *    frosted-glass highlight, slow rising bokeh dots.
 * ════════════════════════════════════════════════════════════════════════ */
const MINT_BOKEH = [
  { left: '12%', size: 10, dur: 9, delay: 0 },
  { left: '34%', size: 6, dur: 11, delay: 1.4 },
  { left: '58%', size: 14, dur: 8, delay: 0.6 },
  { left: '76%', size: 8, dur: 12, delay: 2.1 },
  { left: '90%', size: 5, dur: 10, delay: 0.9 },
] as const;

const MintLayers: FC<CoverLayerProps> = ({ reduce }) => (
  <>
    <div
      className="absolute inset-0"
      style={{
        background: `radial-gradient(120% 120% at 20% 0%, ${NEON_CYAN} 0%, transparent 55%), radial-gradient(120% 120% at 90% 100%, ${EMERALD} 0%, transparent 55%)`,
        opacity: 0.55,
      }}
    />
    {/* Swept frosted-glass highlight streak. */}
    <div
      className="absolute -inset-x-1/4 top-0 h-full -skew-x-12"
      style={{
        background: `linear-gradient(90deg, transparent, color-mix(in oklch, white 22%, transparent), transparent)`,
        opacity: 0.35,
      }}
    />
    {/* Tiny bokeh dots rising slowly. */}
    {MINT_BOKEH.map((b, i) => (
      <motion.span
        key={i}
        aria-hidden="true"
        className="absolute bottom-0 rounded-full"
        style={{
          left: b.left,
          width: b.size,
          height: b.size,
          background: `radial-gradient(circle, color-mix(in oklch, white 70%, ${NEON_CYAN}), transparent 70%)`,
        }}
        animate={reduce ? undefined : { y: [10, -90], opacity: [0, 0.7, 0] }}
        transition={loop(b.dur, b.delay)}
      />
    ))}
    <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[var(--color-card)]/70 to-transparent" />
  </>
);

/* ════════════════════════════════════════════════════════════════════════
 * 5) LIQUID MESH — animated gradient-mesh (PAID). Three blurred colour blobs on
 *    independent slow loops overlapping into shifting hues, grain on top.
 * ════════════════════════════════════════════════════════════════════════ */
const MeshLayers: FC<CoverLayerProps> = ({ reduce }) => (
  <>
    <div className="absolute inset-0" style={{ background: 'oklch(0.16 0.03 285)' }} />
    <motion.div
      className="absolute h-56 w-56 rounded-full blur-3xl"
      style={{ left: '5%', top: '-20%', background: NEON_VIOLET, opacity: 0.6 }}
      animate={reduce ? undefined : { x: [0, 60, 10, 0], y: [0, 30, 60, 0] }}
      transition={loop(18)}
    />
    <motion.div
      className="absolute h-52 w-52 rounded-full blur-3xl"
      style={{ right: '8%', top: '-10%', background: NEON_CYAN, opacity: 0.5 }}
      animate={reduce ? undefined : { x: [0, -50, -10, 0], y: [0, 40, 10, 0] }}
      transition={loop(21, 1)}
    />
    <motion.div
      className="absolute h-48 w-48 rounded-full blur-3xl"
      style={{ left: '40%', bottom: '-30%', background: NEON_MAGENTA, opacity: 0.55 }}
      animate={reduce ? undefined : { x: [0, 30, -20, 0], y: [0, -20, -50, 0] }}
      transition={loop(16, 0.5)}
    />
    <div className="grain absolute inset-0" />
    <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[var(--color-card)]/70 to-transparent" />
  </>
);

/* ════════════════════════════════════════════════════════════════════════
 * 6) NOIR GOLD — luxe dark + gold (PAID). Charcoal base, a sweeping gold
 *    light-streak, a thin gold hairline along the bottom, a vignette.
 * ════════════════════════════════════════════════════════════════════════ */
const NoirLayers: FC<CoverLayerProps> = ({ reduce }) => (
  <>
    <div className="absolute inset-0" style={{ background: 'oklch(0.16 0.01 80)' }} />
    {/* Sweeping diagonal gold light-streak. */}
    <motion.div
      aria-hidden="true"
      className="absolute -inset-y-1/2 w-1/3 rotate-12"
      style={{
        background: `linear-gradient(90deg, transparent, color-mix(in oklch, ${GOLD} 55%, transparent), transparent)`,
        filter: 'blur(8px)',
      }}
      initial={false}
      animate={reduce ? { left: '20%' } : { left: ['-30%', '120%'] }}
      transition={reduce ? undefined : { duration: 7, repeat: Infinity, ease: 'easeInOut' }}
    />
    {/* Vignette. */}
    <div
      className="absolute inset-0"
      style={{ background: 'radial-gradient(120% 90% at 50% 30%, transparent 55%, black 130%)', opacity: 0.6 }}
    />
    {/* Thin gold hairline along the bottom edge. */}
    <div
      className="absolute inset-x-0 bottom-0 h-px"
      style={{ background: GOLD, opacity: 0.7, boxShadow: `0 0 12px ${GOLD}` }}
    />
    <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[var(--color-card)]/70 to-transparent" />
  </>
);

/* ════════════════════════════════════════════════════════════════════════
 * 7) BUBBLEGUM — playful pastel (PAID). magenta→pink→cyan wash with translucent
 *    circles drifting upward at varied speeds, light grain.
 * ════════════════════════════════════════════════════════════════════════ */
const BUBBLES = [
  { left: '8%', size: 26, dur: 12, delay: 0 },
  { left: '22%', size: 16, dur: 15, delay: 2 },
  { left: '40%', size: 34, dur: 10, delay: 1 },
  { left: '57%', size: 20, dur: 13, delay: 3 },
  { left: '72%', size: 14, dur: 16, delay: 0.5 },
  { left: '86%', size: 28, dur: 11, delay: 1.8 },
] as const;

const BubblesLayers: FC<CoverLayerProps> = ({ reduce }) => (
  <>
    <div
      className="absolute inset-0"
      style={{
        background: `linear-gradient(120deg, ${NEON_MAGENTA} 0%, color-mix(in oklch, ${NEON_MAGENTA} 50%, ${NEON_CYAN}) 50%, ${NEON_CYAN} 100%)`,
        opacity: 0.5,
      }}
    />
    {BUBBLES.map((b, i) => (
      <motion.span
        key={i}
        aria-hidden="true"
        className="absolute bottom-0 rounded-full ring-1"
        style={{
          left: b.left,
          width: b.size,
          height: b.size,
          background: 'color-mix(in oklch, white 24%, transparent)',
          borderColor: 'color-mix(in oklch, white 35%, transparent)',
        }}
        animate={reduce ? undefined : { y: [20, -140], opacity: [0, 0.85, 0] }}
        transition={loop(b.dur, b.delay)}
      />
    ))}
    <div className="grain absolute inset-0" />
    <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[var(--color-card)]/70 to-transparent" />
  </>
);

/* ════════════════════════════════════════════════════════════════════════
 * 8) NEON CIRCUIT — techy (PAID). Deep-indigo base, animated cyan circuit-trace
 *    strokes with a dash-offset "data pulse", pulsing node dots, grid underlay.
 * ════════════════════════════════════════════════════════════════════════ */
const CIRCUIT_NODES = [
  { cx: 60, cy: 30 },
  { cx: 150, cy: 30 },
  { cx: 150, cy: 70 },
  { cx: 250, cy: 70 },
  { cx: 320, cy: 30 },
] as const;

const CircuitLayers: FC<CoverLayerProps> = ({ reduce }) => (
  <>
    <div className="absolute inset-0" style={{ background: 'oklch(0.17 0.05 275)' }} />
    {/* Grid underlay. */}
    <div className="absolute inset-0 bg-[linear-gradient(to_right,var(--color-border)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-border)_1px,transparent_1px)] bg-[size:32px_32px] opacity-[0.12]" />
    {/* Circuit traces (SVG strokes) with a slow dash-offset pulse. */}
    <svg
      aria-hidden="true"
      className="absolute inset-0 h-full w-full"
      viewBox="0 0 380 120"
      preserveAspectRatio="xMidYMid slice"
      fill="none"
    >
      <g stroke={NEON_CYAN} strokeWidth={1.5} opacity={0.55}>
        <path d="M0 30 H60 V70 H150 V30 H250 V90 H380" />
        <path d="M0 95 H110 V60 H210 V95 H300 V40 H380" opacity={0.6} />
      </g>
      <motion.g
        stroke={NEON_CYAN}
        strokeWidth={2}
        strokeDasharray="14 220"
        style={{ filter: `drop-shadow(0 0 4px ${NEON_CYAN})` }}
        animate={reduce ? undefined : { strokeDashoffset: [234, 0] }}
        transition={{ duration: 3.2, repeat: Infinity, ease: 'linear' }}
      >
        <path d="M0 30 H60 V70 H150 V30 H250 V90 H380" />
      </motion.g>
      {CIRCUIT_NODES.map((n, i) => (
        <motion.circle
          key={i}
          cx={n.cx}
          cy={n.cy}
          r={3}
          fill={NEON_CYAN}
          animate={reduce ? undefined : { opacity: [0.35, 1, 0.35], r: [2.5, 3.6, 2.5] }}
          transition={loop(2.4, i * 0.3)}
        />
      ))}
    </svg>
    <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[var(--color-card)]/70 to-transparent" />
  </>
);

/* ════════════════════════════════════════════════════════════════════════
 * 9) GALAXY — cosmic (PAID). violet→black radial nebula, a twinkling starfield,
 *    a drifting magenta nebula cloud, an occasional shooting-star streak.
 * ════════════════════════════════════════════════════════════════════════ */
const STARS = [
  { left: '10%', top: '30%', size: 2, dur: 3, delay: 0 },
  { left: '20%', top: '60%', size: 1.5, dur: 4, delay: 1 },
  { left: '33%', top: '20%', size: 2.5, dur: 3.5, delay: 0.5 },
  { left: '45%', top: '70%', size: 1.5, dur: 5, delay: 2 },
  { left: '55%', top: '35%', size: 2, dur: 3, delay: 1.5 },
  { left: '66%', top: '55%', size: 1.5, dur: 4.5, delay: 0.8 },
  { left: '74%', top: '25%', size: 2.5, dur: 3.2, delay: 2.2 },
  { left: '83%', top: '64%', size: 2, dur: 4, delay: 0.3 },
  { left: '92%', top: '40%', size: 1.5, dur: 3.8, delay: 1.2 },
  { left: '28%', top: '48%', size: 1.5, dur: 5, delay: 2.6 },
] as const;

const GalaxyLayers: FC<CoverLayerProps> = ({ reduce }) => (
  <>
    <div
      className="absolute inset-0"
      style={{
        background: `radial-gradient(120% 120% at 30% 10%, ${NEON_VIOLET} 0%, transparent 45%), oklch(0.12 0.04 290)`,
        opacity: 0.95,
      }}
    />
    {/* Drifting magenta nebula cloud. */}
    <motion.div
      className="absolute h-52 w-72 rounded-full blur-3xl"
      style={{ right: '0%', top: '-10%', background: NEON_MAGENTA, opacity: 0.32 }}
      animate={reduce ? undefined : { x: [0, -30, 0], y: [0, 18, 0] }}
      transition={loop(22)}
    />
    {/* Twinkling starfield. */}
    {STARS.map((s, i) => (
      <motion.span
        key={i}
        aria-hidden="true"
        className="absolute rounded-full bg-white"
        style={{ left: s.left, top: s.top, width: s.size, height: s.size }}
        animate={reduce ? undefined : { opacity: [0.2, 1, 0.2] }}
        transition={loop(s.dur, s.delay)}
      />
    ))}
    {/* Occasional shooting-star streak on a long interval. */}
    <motion.span
      aria-hidden="true"
      className="absolute h-px w-24"
      style={{
        top: '22%',
        left: '-10%',
        background: `linear-gradient(90deg, transparent, white)`,
        rotate: '18deg',
      }}
      animate={reduce ? undefined : { left: ['-10%', '110%'], opacity: [0, 1, 0] }}
      transition={{ duration: 1.1, repeat: Infinity, repeatDelay: 6, ease: 'easeIn' }}
    />
    <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[var(--color-card)]/70 to-transparent" />
  </>
);

/* ════════════════════════════════════════════════════════════════════════
 * 10) PRISMATIC — flagship (PAID). A rotating conic holographic spectrum behind
 *     a frosted layer (iridescent shimmer) + a specular highlight, grain.
 * ════════════════════════════════════════════════════════════════════════ */
const PRISMATIC_CONIC: CSSProperties = {
  background: `conic-gradient(from 0deg, ${NEON_VIOLET}, ${NEON_CYAN}, ${EMERALD}, ${AMBER}, ${NEON_MAGENTA}, ${NEON_VIOLET})`,
};

const PrismaticLayers: FC<CoverLayerProps> = ({ reduce }) => (
  <>
    <div className="absolute inset-0" style={{ background: 'oklch(0.15 0.02 285)' }} />
    {/* Rotating conic spectrum, softened behind a blur (the holographic base). */}
    <motion.div
      aria-hidden="true"
      className="absolute left-1/2 top-1/2 h-[180%] w-[140%] -translate-x-1/2 -translate-y-1/2 blur-2xl"
      style={{ ...PRISMATIC_CONIC, opacity: 0.5 }}
      animate={reduce ? undefined : { rotate: [0, 360] }}
      transition={{ duration: 18, repeat: Infinity, ease: 'linear' }}
    />
    {/* Frosted veil to tame the spectrum into an iridescent sheen. */}
    <div
      className="absolute inset-0"
      style={{ background: 'color-mix(in oklch, var(--color-card) 28%, transparent)', backdropFilter: 'blur(4px)' }}
    />
    {/* Fine specular highlight sweeping across, tracking the shimmer. */}
    <motion.div
      aria-hidden="true"
      className="absolute -inset-y-1/2 w-1/4 -skew-x-12"
      style={{
        background: 'linear-gradient(90deg, transparent, color-mix(in oklch, white 35%, transparent), transparent)',
      }}
      animate={reduce ? undefined : { left: ['-25%', '125%'] }}
      transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
    />
    <div className="grain absolute inset-0" />
    <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[var(--color-card)]/70 to-transparent" />
  </>
);

/**
 * THE registry: every `CoverId` → its layered visual + swatch. Keyed by the
 * shared enum so a missing/extra id is a compile error (the `Record` is total).
 */
export const COVER_PRESETS: Record<CoverId, CoverPreset> = {
  aurora: {
    Layers: AuroraLayers,
    swatch: `linear-gradient(135deg, ${NEON_VIOLET}, ${NEON_MAGENTA} 55%, ${NEON_CYAN})`,
  },
  graphite: {
    Layers: GraphiteLayers,
    swatch: `linear-gradient(135deg, oklch(0.22 0.03 280), oklch(0.16 0.02 280))`,
  },
  sunset: {
    Layers: SunsetLayers,
    swatch: `linear-gradient(180deg, ${NEON_MAGENTA}, ${AMBER} 55%, ${NEON_VIOLET})`,
  },
  mint: { Layers: MintLayers, swatch: `linear-gradient(135deg, ${NEON_CYAN}, ${EMERALD})` },
  mesh: {
    Layers: MeshLayers,
    swatch: `radial-gradient(circle at 30% 20%, ${NEON_VIOLET}, transparent 60%), radial-gradient(circle at 80% 80%, ${NEON_CYAN}, ${NEON_MAGENTA})`,
  },
  noir: { Layers: NoirLayers, swatch: `linear-gradient(135deg, oklch(0.2 0.01 80), ${GOLD})` },
  bubbles: {
    Layers: BubblesLayers,
    swatch: `linear-gradient(120deg, ${NEON_MAGENTA}, ${NEON_CYAN})`,
  },
  circuit: {
    Layers: CircuitLayers,
    swatch: `linear-gradient(135deg, oklch(0.2 0.06 275), ${NEON_CYAN})`,
  },
  galaxy: {
    Layers: GalaxyLayers,
    swatch: `radial-gradient(circle at 30% 20%, ${NEON_VIOLET}, oklch(0.12 0.04 290) 70%)`,
  },
  prismatic: { Layers: PrismaticLayers, swatch: PRISMATIC_CONIC.background as string },
};

/**
 * Render a profile cover by id as a self-contained, absolutely-filling layer
 * stack. Used by the profile HERO (full size, `animated`) and the picker
 * THUMBNAILS (`animated={false}` → static gradient, no looping trees, per the
 * low-end-jank guard). Falls back to `aurora` for any unknown id so the band is
 * never blank.
 *
 * The caller owns the sizing/clipping container (`relative overflow-hidden`).
 */
export function ProfileCover({
  coverId,
  animated,
}: {
  coverId: CoverId | string | null | undefined;
  /** When false, looping animation is disabled (the static gradient still shows). */
  animated: boolean;
}) {
  const preset = COVER_PRESETS[(coverId as CoverId) in COVER_PRESETS ? (coverId as CoverId) : 'aurora'];
  const { Layers } = preset;
  return <Layers reduce={!animated} />;
}
