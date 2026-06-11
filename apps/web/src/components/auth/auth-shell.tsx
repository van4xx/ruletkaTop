'use client';

/**
 * Split-screen shell for the auth pages.
 *
 * Left (lg+ only): an editorial "constellation" — pseudonymous "stars" scattered
 * across a starry void, connected by faint edges that pulse one-by-one as if new
 * matches were forming live. Pure SVG; positions are derived from a stable
 * integer hash of the node index so SSR and CSR produce byte-identical markup.
 * The headline + live caption sit above the figure.
 *
 * Right: the form, vertically centered. On mobile (< lg) the brand panel
 * collapses to the same compact RouletteEmblem header the previous shell used.
 */
import Link from 'next/link';
import { motion, type Variants } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { ROUTES } from '@/config/nav';
import { cn } from '@/lib/cn';

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

/** SVG canvas in design units. The viewBox is fixed; the panel scales it. */
const W = 520;
const H = 560;

/**
 * Deterministic integer hash for a non-negative input. xorshift-style mixing
 * over a single u32; identical math runs on both server and client, so we never
 * import a PRNG and never read Date/random. The two seeds (sx/sy) decouple the
 * axes so x and y don't visibly correlate.
 */
function hash(n: number, seed: number): number {
  let x = (n + 1) * 0x9e3779b1 + seed;
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 0xffffffff;
}

const NODE_COUNT = 14;

/**
 * Place stars deterministically inside a soft inset, with a couple of "anchor"
 * nodes pinned near the optical centre so the cluster has a focal point.
 */
const NODES = Array.from({ length: NODE_COUNT }, (_, i) => {
  const fx = hash(i, 0x1337);
  const fy = hash(i, 0xbeef);
  // Inset 10% on each side; anchors (i=0,1) pulled toward the centre.
  const inset = 0.1;
  let x = inset * W + fx * (1 - inset * 2) * W;
  let y = inset * H + fy * (1 - inset * 2) * H;
  if (i < 2) {
    x = W * 0.5 + (fx - 0.5) * W * 0.25;
    y = H * 0.45 + (fy - 0.5) * H * 0.3;
  }
  const r = 2 + hash(i, 0xc0de) * 2.5; // 2 – 4.5
  // Cycle through brand neon stops so the field reads as one palette, not three.
  const hueStops = [
    'var(--color-neon-cyan)',
    'var(--color-neon-magenta)',
    'var(--color-neon-violet)',
  ] as const;
  const hue = hueStops[i % 3]!;
  return { x, y, r, hue };
});

/**
 * Edges connect each node to its nearest two neighbours (deduplicated). This
 * yields a graph that *looks* organic — no triangulation library needed — and
 * because input is deterministic the edge list is stable across renders.
 */
const EDGES = (() => {
  const pairs: Array<{ a: number; b: number; len: number }> = [];
  for (let i = 0; i < NODES.length; i++) {
    const ds = NODES.map((n, j) => ({
      j,
      d: j === i ? Infinity : Math.hypot(n.x - NODES[i]!.x, n.y - NODES[i]!.y),
    }))
      .sort((p, q) => p.d - q.d)
      .slice(0, 2);
    for (const { j, d } of ds) {
      const a = Math.min(i, j);
      const b = Math.max(i, j);
      if (!pairs.some((p) => p.a === a && p.b === b)) pairs.push({ a, b, len: d });
    }
  }
  return pairs;
})();

/** Tiny "field stars" sprinkled behind the graph for depth. Pure decoration. */
const FIELD_STARS = Array.from({ length: 36 }, (_, i) => ({
  cx: hash(i, 0xfeed) * W,
  cy: hash(i, 0xface) * H,
  r: 0.4 + hash(i, 0xa11a) * 0.9,
  o: 0.18 + hash(i, 0xb0b0) * 0.32,
}));

function RouletteEmblem() {
  return (
    <span className="relative inline-flex h-12 w-12 items-center justify-center">
      <span
        aria-hidden="true"
        className="absolute inset-0 rounded-full bg-[conic-gradient(from_140deg,var(--color-neon-violet),var(--color-neon-magenta),var(--color-neon-cyan),var(--color-neon-violet))] opacity-90 blur-[1px] [animation:spin_8s_linear_infinite]"
      />
      <span aria-hidden="true" className="absolute inset-[4px] rounded-full bg-background" />
      <span
        aria-hidden="true"
        className="relative h-2.5 w-2.5 rounded-full bg-[var(--color-neon-cyan)] shadow-[0_0_12px_var(--color-neon-cyan)]"
      />
    </span>
  );
}

/**
 * The constellation figure. Edges pulse one-by-one via a stroke-dashoffset loop
 * staggered by index; nodes twinkle on a slower 4–7s cycle (cycle length seeded
 * per-node so the field never feels metronomic).
 */
function Constellation() {
  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      className="auth2-constellation block h-auto w-full max-w-[34rem]"
    >
      <defs>
        <radialGradient id="auth2-vignette" cx="50%" cy="50%" r="65%">
          <stop offset="55%" stopColor="rgba(8,8,14,0)" />
          <stop offset="100%" stopColor="rgba(8,8,14,0.85)" />
        </radialGradient>
        <radialGradient id="auth2-node-cyan" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--color-neon-cyan)" stopOpacity="1" />
          <stop offset="100%" stopColor="var(--color-neon-cyan)" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Far-field stars — static; tuned low-opacity so they read as depth, not noise. */}
      {FIELD_STARS.map((s, i) => (
        <circle key={`f${i}`} cx={s.cx} cy={s.cy} r={s.r} fill="white" opacity={s.o} />
      ))}

      {/* Edges: each gets a fixed pathLength=1, then animates a dash sliding along it
          (stroke-dashoffset loop). Stagger via per-edge --i so the pulse train
          ripples across the graph instead of strobing in sync. */}
      <g
        fill="none"
        stroke="var(--color-neon-violet)"
        strokeWidth={0.7}
        strokeLinecap="round"
        opacity={0.55}
      >
        {EDGES.map((e, i) => {
          const a = NODES[e.a]!;
          const b = NODES[e.b]!;
          return (
            <line
              key={`e${i}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              className="auth2-edge"
              pathLength={1}
              strokeDasharray="0.18 0.82"
              style={{ '--i': i } as React.CSSProperties}
            />
          );
        })}
      </g>

      {/* Nodes: outer halo (gradient circle) + bright core. Halo radius animates
          on a per-node delay derived from index. */}
      {NODES.map((n, i) => (
        <g key={`n${i}`} className="auth2-node" style={{ '--i': i } as React.CSSProperties}>
          <circle cx={n.x} cy={n.y} r={n.r * 4} fill={n.hue} opacity={0.18} />
          <circle
            cx={n.x}
            cy={n.y}
            r={n.r}
            fill={n.hue}
            style={{ filter: `drop-shadow(0 0 6px ${n.hue})` }}
          />
        </g>
      ))}

      {/* Vignette on top — same trick the old grid used to melt the figure into
          the aurora instead of clipping at the SVG bounds. */}
      <rect x={0} y={0} width={W} height={H} fill="url(#auth2-vignette)" />
    </svg>
  );
}

const rise: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE_OUT } },
};

export interface AuthShellProps {
  /** Form column. */
  children: React.ReactNode;
  /** Headline shown above the constellation on large screens. */
  pitch?: string;
}

export function AuthShell({ children, pitch }: AuthShellProps) {
  const t = useTranslations('auth');
  const headline = pitch ?? t('shell.pitch.default');
  return (
    <div className="grain relative min-h-[calc(100dvh-4rem)] overflow-hidden">
      {/* Atmospheric background — neon aurora behind the brand side on lg+. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -left-32 -top-32 h-[34rem] w-[34rem] rounded-full bg-[radial-gradient(circle,var(--color-neon-violet)_0%,transparent_60%)] opacity-25 blur-3xl" />
        <div className="absolute -bottom-24 left-1/4 h-[26rem] w-[26rem] rounded-full bg-[radial-gradient(circle,var(--color-neon-magenta)_0%,transparent_60%)] opacity-20 blur-3xl" />
        <div className="absolute right-1/4 top-1/3 h-[24rem] w-[24rem] rounded-full bg-[radial-gradient(circle,var(--color-neon-cyan)_0%,transparent_60%)] opacity-[0.18] blur-3xl" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,var(--color-border)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-border)_1px,transparent_1px)] bg-[size:64px_64px] opacity-[0.12] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />
      </div>

      <div className="mx-auto grid min-h-[calc(100dvh-4rem)] max-w-7xl grid-cols-1 items-stretch gap-0 px-4 sm:px-6 lg:grid-cols-2 lg:px-8">
        {/* ── Brand panel (lg+) ── */}
        <motion.aside
          initial="hidden"
          animate="show"
          variants={{ show: { transition: { staggerChildren: 0.09 } } }}
          className={cn(
            'relative hidden flex-col justify-center gap-8 py-12 pr-12 lg:flex',
          )}
        >
          <motion.div variants={rise}>
            <Link
              href={ROUTES.home}
              className="inline-flex items-center gap-3 rounded-lg"
              aria-label={t('shell.homeAria')}
            >
              <RouletteEmblem />
              <span className="font-display text-2xl font-bold leading-none tracking-tight">
                ruletka<span className="text-gradient-neon">.top</span>
              </span>
            </Link>
          </motion.div>

          <motion.div variants={rise} className="flex flex-col gap-3">
            <div
              className="inline-flex w-fit items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground"
              aria-hidden="true"
            >
              <span className="relative inline-flex h-2 w-2">
                <span className="absolute inset-0 animate-ping rounded-full bg-[var(--color-neon-magenta)] opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--color-neon-magenta)] shadow-[0_0_10px_var(--color-neon-magenta)]" />
              </span>
              {t('shell.live.caption')}
              <span className="ml-2 text-foreground/80">
                {t('shell.live.online', { count: '12k' })}
              </span>
            </div>

            <h2 className="max-w-md font-display text-4xl font-extrabold leading-[1.08] tracking-tight">
              {headline}
            </h2>
            <p className="max-w-md text-sm text-muted-foreground">
              {t('shell.constellation.sub')}
            </p>
          </motion.div>

          <motion.div variants={rise} className="relative">
            <Constellation />
          </motion.div>
        </motion.aside>

        {/* ── Form panel ── */}
        <div className="flex flex-col justify-center py-10 sm:py-14 lg:pl-12">
          {/* Compact brand header for mobile / tablet. */}
          <Link
            href={ROUTES.home}
            className="mb-8 inline-flex items-center gap-2.5 self-center rounded-lg lg:hidden"
            aria-label={t('shell.homeAria')}
          >
            <RouletteEmblem />
            <span className="font-display text-xl font-bold leading-none tracking-tight">
              ruletka<span className="text-gradient-neon">.top</span>
            </span>
          </Link>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, ease: EASE_OUT }}
            className="mx-auto w-full max-w-md"
          >
            {children}
          </motion.div>
        </div>
      </div>
    </div>
  );
}
