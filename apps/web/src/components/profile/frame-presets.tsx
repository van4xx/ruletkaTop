'use client';

/**
 * Avatar-frame VISUALS — the client renderer keyed by the shared `FrameId`.
 *
 * Each frame in the catalogue (`@ruletka/shared-types` `FRAME_CATALOGUE`)
 * maps to a hand-built, on-brand DECORATIVE RING drawn around the user's
 * avatar. The frame ring sits ABOVE the avatar disk but BELOW any interactive
 * overlay (presence dot, change-avatar button), as a single absolute-position
 * layer ~16px taller/wider than the avatar on each side.
 *
 * Same component renders both the profile HERO (full size, animated) and the
 * picker THUMBNAILS (small, motion-disabled) — see {@link AvatarFrame}'s
 * `animated` prop.
 *
 * A11y contract: every frame is decorative — its root container is
 * `aria-hidden`. The avatar element keeps its `alt` text. Looping motion is
 * gated on the `reduce` flag (derived from `useReducedMotion()` at the call
 * site); when true, animated loops freeze but the static visual still renders
 * so the frame is never blank.
 *
 * Implementation rules:
 *  - CSS-only animation (no framer-motion) so multiple frames can render in
 *    the picker grid without scheduler pressure; keyframes live below as
 *    inline `<style>` blocks scoped to the frame.
 *  - All motion respects `prefers-reduced-motion` via the `reduce` flag the
 *    caller passes.
 */
import type { CSSProperties, FC } from 'react';
import type { FrameId } from '@ruletka/shared-types';

const NEON_VIOLET = 'var(--color-neon-violet)';
const NEON_CYAN = 'var(--color-neon-cyan)';
const NEON_MAGENTA = 'var(--color-neon-magenta)';
const GOLD = 'oklch(0.82 0.14 85)';
const GOLD_DARK = 'oklch(0.62 0.12 75)';
const EMERALD = 'oklch(0.8 0.15 165)';
const AMBER = 'oklch(0.78 0.16 70)';
const FLAME_RED = 'oklch(0.68 0.22 25)';
const FLAME_ORANGE = 'oklch(0.78 0.21 55)';
const FLAME_YELLOW = 'oklch(0.88 0.18 90)';

/** Props every frame layer component receives. */
export interface FrameLayerProps {
  /** When true, looping animations are suppressed (reduced-motion / thumbnails). */
  reduce: boolean;
}

/** A registry entry: the layered frame visual + a CSS swatch for chrome. */
export interface FramePreset {
  /** The full layer stack (absolutely-positioned, fills the wrapper). */
  Layers: FC<FrameLayerProps>;
  /** A representative CSS background used for the small swatch dot in chrome. */
  swatch: string;
}

/* ════════════════════════════════════════════════════════════════════════
 * Shared base styles — every frame is a rounded ring that absolutely fills
 * its parent (the `AvatarFrame` wrapper takes care of the 16px-on-each-side
 * outset relative to the avatar).
 * ════════════════════════════════════════════════════════════════════════ */
const RING_BASE: CSSProperties = {
  position: 'absolute',
  inset: 0,
  borderRadius: '9999px',
  pointerEvents: 'none',
};

/* ════════════════════════════════════════════════════════════════════════
 * 1) NEON RING (free) — a single cyan ring with a soft outer glow.
 * ════════════════════════════════════════════════════════════════════════ */
const NeonRingLayers: FC<FrameLayerProps> = () => (
  <div
    aria-hidden="true"
    style={{
      ...RING_BASE,
      boxShadow: `0 0 0 3px ${NEON_CYAN}, 0 0 16px 2px color-mix(in oklch, ${NEON_CYAN} 65%, transparent)`,
    }}
  />
);

/* ════════════════════════════════════════════════════════════════════════
 * 2) MAGENTA PULSE (free) — magenta ring with a slow CSS pulse.
 * ════════════════════════════════════════════════════════════════════════ */
const MagentaPulseLayers: FC<FrameLayerProps> = ({ reduce }) => (
  <>
    <style>{`
      @keyframes ruletka-frame-magenta-pulse {
        0%, 100% { box-shadow: 0 0 0 3px ${NEON_MAGENTA}, 0 0 10px 0 color-mix(in oklch, ${NEON_MAGENTA} 55%, transparent); }
        50% { box-shadow: 0 0 0 3px ${NEON_MAGENTA}, 0 0 22px 4px color-mix(in oklch, ${NEON_MAGENTA} 85%, transparent); }
      }
    `}</style>
    <div
      aria-hidden="true"
      style={{
        ...RING_BASE,
        boxShadow: `0 0 0 3px ${NEON_MAGENTA}, 0 0 14px 2px color-mix(in oklch, ${NEON_MAGENTA} 65%, transparent)`,
        animation: reduce ? undefined : 'ruletka-frame-magenta-pulse 2.4s ease-in-out infinite',
      }}
    />
  </>
);

/* ════════════════════════════════════════════════════════════════════════
 * 3) GOLD FILIGREE — ornate gold border with curls (SVG ornamental ring).
 * ════════════════════════════════════════════════════════════════════════ */
const GoldFiligreeLayers: FC<FrameLayerProps> = () => (
  <div aria-hidden="true" style={{ ...RING_BASE, overflow: 'visible' }}>
    {/* Solid gold border with a subtle inner highlight. */}
    <div
      style={{
        ...RING_BASE,
        boxShadow: `0 0 0 4px ${GOLD_DARK}, inset 0 0 0 1px color-mix(in oklch, ${GOLD} 80%, white)`,
      }}
    />
    {/* Ornamental curls overlay — 8 small curlicues at compass points. */}
    <svg
      style={{ position: 'absolute', inset: '-12%', width: '124%', height: '124%' }}
      viewBox="0 0 100 100"
      fill="none"
    >
      <defs>
        <path
          id="filigree-curl"
          d="M50 2 C 54 10 50 14 46 18 C 42 22 48 26 50 32 M50 2 C 46 10 50 14 54 18 C 58 22 52 26 50 32"
          stroke={GOLD}
          strokeWidth={1.3}
          strokeLinecap="round"
          fill="none"
        />
      </defs>
      {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
        <use
          key={angle}
          href="#filigree-curl"
          transform={`rotate(${angle} 50 50)`}
          style={{ filter: `drop-shadow(0 0 1.5px ${GOLD})` }}
        />
      ))}
    </svg>
  </div>
);

/* ════════════════════════════════════════════════════════════════════════
 * 4) DIAMOND SHARDS — 12 small diamond polygons orbiting the avatar.
 * ════════════════════════════════════════════════════════════════════════ */
const DiamondShardsLayers: FC<FrameLayerProps> = ({ reduce }) => (
  <>
    <style>{`
      @keyframes ruletka-frame-diamond-orbit { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      @keyframes ruletka-frame-diamond-twinkle {
        0%, 100% { opacity: 0.55; }
        50% { opacity: 1; }
      }
    `}</style>
    <div aria-hidden="true" style={{ ...RING_BASE, overflow: 'visible' }}>
      {/* Faint base cyan ring for cohesion. */}
      <div
        style={{
          ...RING_BASE,
          boxShadow: `0 0 0 1px color-mix(in oklch, ${NEON_CYAN} 60%, transparent)`,
        }}
      />
      {/* 12 diamonds rotating around the centre. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          animation: reduce ? undefined : 'ruletka-frame-diamond-orbit 16s linear infinite',
        }}
      >
        {Array.from({ length: 12 }).map((_, i) => {
          const angle = (i * 360) / 12;
          return (
            <span
              key={i}
              style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                width: 0,
                height: 0,
                transform: `rotate(${angle}deg) translateY(-50%)`,
                transformOrigin: '0 0',
              }}
            >
              <span
                style={{
                  display: 'block',
                  width: 8,
                  height: 8,
                  marginLeft: -4,
                  marginTop: -4,
                  background: `linear-gradient(135deg, white, ${NEON_CYAN})`,
                  transform: 'rotate(45deg)',
                  boxShadow: `0 0 6px color-mix(in oklch, ${NEON_CYAN} 70%, transparent)`,
                  animation: reduce
                    ? undefined
                    : `ruletka-frame-diamond-twinkle 2.4s ease-in-out infinite ${(i * 0.2).toFixed(2)}s`,
                }}
              />
            </span>
          );
        })}
      </div>
    </div>
  </>
);

/* ════════════════════════════════════════════════════════════════════════
 * 5) CONSTELLATION — sparkly stars on a thin ring with subtle rotation.
 * ════════════════════════════════════════════════════════════════════════ */
const STAR_OFFSETS = [
  { angle: 12, size: 3 },
  { angle: 42, size: 2 },
  { angle: 73, size: 4 },
  { angle: 110, size: 2.5 },
  { angle: 148, size: 3 },
  { angle: 188, size: 2 },
  { angle: 222, size: 3.5 },
  { angle: 256, size: 2.5 },
  { angle: 292, size: 3 },
  { angle: 328, size: 2 },
] as const;

const ConstellationLayers: FC<FrameLayerProps> = ({ reduce }) => (
  <>
    <style>{`
      @keyframes ruletka-frame-constellation-rotate { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      @keyframes ruletka-frame-constellation-twinkle {
        0%, 100% { opacity: 0.45; transform: rotate(var(--a, 0deg)) translateY(-50%) scale(0.85); }
        50% { opacity: 1; transform: rotate(var(--a, 0deg)) translateY(-50%) scale(1.15); }
      }
    `}</style>
    <div aria-hidden="true" style={{ ...RING_BASE, overflow: 'visible' }}>
      {/* Hair-thin cyan ring (the constellation's invisible orbit). */}
      <div
        style={{
          ...RING_BASE,
          boxShadow: `0 0 0 1px color-mix(in oklch, ${NEON_CYAN} 35%, transparent)`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          animation: reduce ? undefined : 'ruletka-frame-constellation-rotate 40s linear infinite',
        }}
      >
        {STAR_OFFSETS.map((s, i) => (
          <span
            key={i}
            style={
              {
                '--a': `${s.angle}deg`,
                position: 'absolute',
                left: '50%',
                top: '50%',
                width: s.size,
                height: s.size,
                marginLeft: -s.size / 2,
                marginTop: -s.size / 2,
                borderRadius: '9999px',
                background: 'white',
                boxShadow: `0 0 ${s.size * 2}px white`,
                transform: `rotate(${s.angle}deg) translateY(-50%)`,
                animation: reduce
                  ? undefined
                  : `ruletka-frame-constellation-twinkle 3s ease-in-out infinite ${(i * 0.3).toFixed(2)}s`,
              } as CSSProperties
            }
          />
        ))}
      </div>
    </div>
  </>
);

/* ════════════════════════════════════════════════════════════════════════
 * 6) ROULETTE WHEEL — alternating red/black wedge segments (brand-fit).
 * ════════════════════════════════════════════════════════════════════════ */
const ROULETTE_RED = 'oklch(0.55 0.22 25)';
const ROULETTE_BLACK = 'oklch(0.18 0.02 280)';
const RouletteWheelLayers: FC<FrameLayerProps> = ({ reduce }) => {
  // Build a conic gradient with 16 alternating wedge segments.
  const wedges = Array.from({ length: 16 }).map((_, i) => {
    const from = (i * 360) / 16;
    const to = ((i + 1) * 360) / 16;
    const color = i % 2 === 0 ? ROULETTE_RED : ROULETTE_BLACK;
    return `${color} ${from}deg ${to}deg`;
  });
  return (
    <>
      <style>{`
        @keyframes ruletka-frame-wheel-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
      <div aria-hidden="true" style={{ ...RING_BASE, overflow: 'hidden' }}>
        {/* Spinning conic wheel; masked into a ring (centre cut out). */}
        <div
          style={{
            ...RING_BASE,
            background: `conic-gradient(${wedges.join(', ')})`,
            // A circular ring: keep an outer 10% band of color, mask out the inner disc.
            mask: 'radial-gradient(circle, transparent 64%, black 65%)',
            WebkitMask: 'radial-gradient(circle, transparent 64%, black 65%)',
            animation: reduce ? undefined : 'ruletka-frame-wheel-spin 18s linear infinite',
          }}
        />
        {/* Crisp gold bezel hairlines (inner + outer). */}
        <div
          style={{
            ...RING_BASE,
            boxShadow: `inset 0 0 0 1px ${GOLD}, 0 0 0 1px ${GOLD}`,
          }}
        />
      </div>
    </>
  );
};

/* ════════════════════════════════════════════════════════════════════════
 * 7) HOLOGRAPHIC — multi-color conic-gradient ring.
 * ════════════════════════════════════════════════════════════════════════ */
const HolographicLayers: FC<FrameLayerProps> = ({ reduce }) => (
  <>
    <style>{`
      @keyframes ruletka-frame-holo-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
    `}</style>
    <div aria-hidden="true" style={{ ...RING_BASE, overflow: 'hidden' }}>
      <div
        style={{
          ...RING_BASE,
          background: `conic-gradient(from 0deg, ${NEON_VIOLET}, ${NEON_CYAN}, ${EMERALD}, ${AMBER}, ${NEON_MAGENTA}, ${NEON_VIOLET})`,
          mask: 'radial-gradient(circle, transparent 64%, black 65%)',
          WebkitMask: 'radial-gradient(circle, transparent 64%, black 65%)',
          animation: reduce ? undefined : 'ruletka-frame-holo-spin 8s linear infinite',
          filter: 'saturate(1.2)',
        }}
      />
      {/* Soft outer glow. */}
      <div
        style={{
          ...RING_BASE,
          boxShadow: `0 0 14px 2px color-mix(in oklch, ${NEON_VIOLET} 50%, transparent)`,
        }}
      />
    </div>
  </>
);

/* ════════════════════════════════════════════════════════════════════════
 * 8) AURORA SWEEP — animated linear-gradient ring (green/violet sweep).
 * ════════════════════════════════════════════════════════════════════════ */
const AuroraSweepLayers: FC<FrameLayerProps> = ({ reduce }) => (
  <>
    <style>{`
      @keyframes ruletka-frame-aurora-sweep {
        0% { background-position: 0% 50%; }
        50% { background-position: 100% 50%; }
        100% { background-position: 0% 50%; }
      }
    `}</style>
    <div aria-hidden="true" style={{ ...RING_BASE, overflow: 'hidden' }}>
      <div
        style={{
          ...RING_BASE,
          background: `linear-gradient(90deg, ${EMERALD}, ${NEON_VIOLET}, ${NEON_CYAN}, ${EMERALD})`,
          backgroundSize: '300% 300%',
          mask: 'radial-gradient(circle, transparent 64%, black 65%)',
          WebkitMask: 'radial-gradient(circle, transparent 64%, black 65%)',
          animation: reduce ? undefined : 'ruletka-frame-aurora-sweep 6s ease-in-out infinite',
        }}
      />
    </div>
  </>
);

/* ════════════════════════════════════════════════════════════════════════
 * 9) VINYL RECORD — black ring with grooves + tiny rotating label dot.
 * ════════════════════════════════════════════════════════════════════════ */
const VinylRecordLayers: FC<FrameLayerProps> = ({ reduce }) => (
  <>
    <style>{`
      @keyframes ruletka-frame-vinyl-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
    `}</style>
    <div aria-hidden="true" style={{ ...RING_BASE, overflow: 'hidden' }}>
      <div
        style={{
          ...RING_BASE,
          background: `repeating-radial-gradient(circle at 50% 50%, oklch(0.18 0.01 280) 0, oklch(0.18 0.01 280) 2px, oklch(0.22 0.01 280) 3px, oklch(0.18 0.01 280) 4px)`,
          mask: 'radial-gradient(circle, transparent 64%, black 65%)',
          WebkitMask: 'radial-gradient(circle, transparent 64%, black 65%)',
          animation: reduce ? undefined : 'ruletka-frame-vinyl-spin 12s linear infinite',
        }}
      />
      {/* Tiny gold label dot, top-right, follows the spin. */}
      <div
        style={{
          ...RING_BASE,
          animation: reduce ? undefined : 'ruletka-frame-vinyl-spin 12s linear infinite',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: '6%',
            left: '50%',
            width: 6,
            height: 6,
            marginLeft: -3,
            borderRadius: '9999px',
            background: GOLD,
            boxShadow: `0 0 6px ${GOLD}`,
          }}
        />
      </div>
    </div>
  </>
);

/* ════════════════════════════════════════════════════════════════════════
 * 10) FLAME — animated SVG flames around the perimeter.
 * ════════════════════════════════════════════════════════════════════════ */
const FLAME_POSITIONS = Array.from({ length: 12 }).map((_, i) => (i * 360) / 12);
const FlameLayers: FC<FrameLayerProps> = ({ reduce }) => (
  <>
    <style>{`
      @keyframes ruletka-frame-flame-flicker {
        0%, 100% { transform: rotate(var(--a, 0deg)) translateY(-50%) scaleY(1) scaleX(1); opacity: 0.85; }
        50% { transform: rotate(var(--a, 0deg)) translateY(-52%) scaleY(1.3) scaleX(0.85); opacity: 1; }
      }
    `}</style>
    <div aria-hidden="true" style={{ ...RING_BASE, overflow: 'visible' }}>
      {/* Hot inner ring. */}
      <div
        style={{
          ...RING_BASE,
          boxShadow: `0 0 0 2px ${FLAME_ORANGE}, 0 0 14px 2px color-mix(in oklch, ${FLAME_RED} 65%, transparent)`,
        }}
      />
      {FLAME_POSITIONS.map((angle, i) => (
        <span
          key={angle}
          style={
            {
              '--a': `${angle}deg`,
              position: 'absolute',
              left: '50%',
              top: '50%',
              width: 8,
              height: 14,
              marginLeft: -4,
              marginTop: -7,
              background: `radial-gradient(ellipse at bottom, ${FLAME_YELLOW}, ${FLAME_ORANGE} 55%, ${FLAME_RED})`,
              borderRadius: '50% 50% 50% 50% / 80% 80% 20% 20%',
              transform: `rotate(${angle}deg) translateY(-50%)`,
              transformOrigin: '50% 50%',
              filter: 'blur(0.5px)',
              animation: reduce
                ? undefined
                : `ruletka-frame-flame-flicker 1.2s ease-in-out infinite ${(i * 0.1).toFixed(2)}s`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  </>
);

/**
 * THE registry: every `FrameId` → its layered visual + swatch. Keyed by the
 * shared enum so a missing/extra id is a compile error (the `Record` is total).
 */
export const FRAME_PRESETS: Record<FrameId, FramePreset> = {
  'neon-ring': {
    Layers: NeonRingLayers,
    swatch: `radial-gradient(circle, transparent 55%, ${NEON_CYAN} 56%, ${NEON_CYAN} 70%, transparent 71%)`,
  },
  'magenta-pulse': {
    Layers: MagentaPulseLayers,
    swatch: `radial-gradient(circle, transparent 55%, ${NEON_MAGENTA} 56%, ${NEON_MAGENTA} 70%, transparent 71%)`,
  },
  'gold-filigree': {
    Layers: GoldFiligreeLayers,
    swatch: `linear-gradient(135deg, ${GOLD}, ${GOLD_DARK})`,
  },
  'diamond-shards': {
    Layers: DiamondShardsLayers,
    swatch: `radial-gradient(circle at 30% 30%, white, ${NEON_CYAN} 70%)`,
  },
  constellation: {
    Layers: ConstellationLayers,
    swatch: `radial-gradient(circle at 50% 50%, white 8%, transparent 12%), oklch(0.18 0.04 280)`,
  },
  'roulette-wheel': {
    Layers: RouletteWheelLayers,
    swatch: `conic-gradient(${ROULETTE_RED} 0 45deg, ${ROULETTE_BLACK} 45deg 90deg, ${ROULETTE_RED} 90deg 135deg, ${ROULETTE_BLACK} 135deg 180deg, ${ROULETTE_RED} 180deg 225deg, ${ROULETTE_BLACK} 225deg 270deg, ${ROULETTE_RED} 270deg 315deg, ${ROULETTE_BLACK} 315deg 360deg)`,
  },
  holographic: {
    Layers: HolographicLayers,
    swatch: `conic-gradient(from 0deg, ${NEON_VIOLET}, ${NEON_CYAN}, ${EMERALD}, ${AMBER}, ${NEON_MAGENTA}, ${NEON_VIOLET})`,
  },
  'aurora-sweep': {
    Layers: AuroraSweepLayers,
    swatch: `linear-gradient(90deg, ${EMERALD}, ${NEON_VIOLET}, ${NEON_CYAN})`,
  },
  'vinyl-record': {
    Layers: VinylRecordLayers,
    swatch: `repeating-radial-gradient(circle at 50% 50%, oklch(0.18 0.01 280) 0, oklch(0.18 0.01 280) 2px, oklch(0.28 0.01 280) 3px, oklch(0.18 0.01 280) 4px)`,
  },
  flame: {
    Layers: FlameLayers,
    swatch: `radial-gradient(ellipse at bottom, ${FLAME_YELLOW}, ${FLAME_ORANGE} 55%, ${FLAME_RED})`,
  },
};

/**
 * Render an avatar frame by id as a self-contained, absolutely-filling layer
 * stack. Used by the {@link AvatarFrame} wrapper (full size, `animated`) and
 * the picker THUMBNAILS (`animated={false}` → static-only, no looping motion).
 *
 * Returns `null` for `null`/unknown ids so the avatar renders bare — matching
 * the contract that a frame is OPTIONAL (the default is no frame).
 */
export function ProfileFrame({
  frameId,
  animated,
}: {
  frameId: FrameId | string | null | undefined;
  /** When false, looping animation is disabled (the static visual still shows). */
  animated: boolean;
}) {
  if (!frameId) return null;
  const preset = FRAME_PRESETS[frameId as FrameId];
  if (!preset) return null;
  const { Layers } = preset;
  return <Layers reduce={!animated} />;
}
