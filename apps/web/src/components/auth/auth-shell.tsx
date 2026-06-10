'use client';

/**
 * Split-screen shell for the auth pages.
 *
 * Left (lg+ only): a "live grid" brand panel — a 4x4 mosaic of breathing neon
 * portrait tiles (placeholder gradient blocks, NOT real photos) layered over the
 * brand aurora. A few tiles wear a LIVE dot that drifts between them, making
 * the abstract value-prop ("dozens of strangers, connecting right now") visually
 * literal. The headline and online-count caption sit above the grid.
 *
 * Right: the form, vertically centered. On mobile (< lg) the brand panel
 * collapses to a compact logo header above the form.
 */
import Link from 'next/link';
import { motion, type Variants } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { ROUTES } from '@/config/nav';
import { cn } from '@/lib/cn';

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

/**
 * Deterministic seed → 16 tile descriptors. Index-based so SSR and CSR produce
 * the exact same DOM (no hydration drift). Hues are picked from the brand palette
 * (cyan / magenta / violet) by index parity; "live" tiles are a fixed subset.
 */
const TILE_COUNT = 16;
const LIVE_INDICES = new Set([2, 5, 9, 14]);
/** Two-letter glyphs that hint at "people" without naming real users. */
const TILE_GLYPHS = [
  'AX', 'KO', 'MY', 'JS', 'RU', 'EN', 'LV', 'TZ',
  'NB', 'QO', 'PL', 'CY', 'GH', 'SD', 'IO', 'VX',
] as const;

/** Brand neon stops, indexed deterministically per tile. */
const TILE_HUES: ReadonlyArray<readonly [string, string]> = [
  ['var(--color-neon-cyan)', 'var(--color-neon-violet)'],
  ['var(--color-neon-magenta)', 'var(--color-neon-cyan)'],
  ['var(--color-neon-violet)', 'var(--color-neon-magenta)'],
] as const;

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
 * Single grid tile — pure CSS+SVG, no images. Each tile breathes on a staggered
 * 6s loop; a fixed subset wears a pulsing "LIVE" dot.
 */
function LiveTile({ index, glyph }: { index: number; glyph: string }) {
  const [from, to] = TILE_HUES[index % TILE_HUES.length]!;
  const isLive = LIVE_INDICES.has(index);
  // Stagger the LIVE pulse across the 4 live tiles so they feel like independent
  // events, not a synced strobe.
  const liveOrder = isLive ? [...LIVE_INDICES].indexOf(index) : 0;
  const liveDelay = `${liveOrder * 1750}ms`;
  return (
    <div
      aria-hidden="true"
      className="auth-tile relative aspect-square overflow-hidden rounded-2xl border border-white/10"
      style={
        {
          '--i': index,
          backgroundImage: `linear-gradient(135deg, ${from} 0%, transparent 55%), linear-gradient(315deg, ${to} 0%, transparent 65%)`,
          backgroundColor: 'rgba(10,10,16,0.85)',
        } as React.CSSProperties
      }
    >
      {/* Subtle inner sheen — sells the "glass tile" feel. */}
      <span className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),transparent_40%)]" />
      {/* Faint two-letter glyph stands in for an avatar without faking one. */}
      <span className="absolute inset-0 flex items-center justify-center font-display text-base font-bold tracking-tight text-white/40">
        {glyph}
      </span>
      {/* Scanline — only on every 3rd tile so the wall doesn't shimmer uniformly. */}
      {index % 3 === 0 && (
        <span
          className="auth-scanline pointer-events-none absolute inset-x-0 top-0 h-6 bg-[linear-gradient(180deg,transparent,rgba(255,255,255,0.18),transparent)]"
          style={{ '--i': index } as React.CSSProperties}
        />
      )}
      {/* LIVE indicator — pulsing dot + ring corner badge. */}
      {isLive && (
        <>
          <span
            className="auth-tile-live-ring absolute inset-0 rounded-2xl ring-2 ring-[var(--color-neon-magenta)]"
            style={{ '--live-delay': liveDelay } as React.CSSProperties}
          />
          <span
            className="auth-tile-live-dot absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white backdrop-blur-sm"
            style={{ '--live-delay': liveDelay } as React.CSSProperties}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-neon-magenta)] shadow-[0_0_8px_var(--color-neon-magenta)]" />
            LIVE
          </span>
        </>
      )}
    </div>
  );
}

/** 4x4 mosaic — the centerpiece of the brand panel. */
function LiveGrid() {
  return (
    <div
      aria-hidden="true"
      className="relative grid w-full max-w-md grid-cols-4 gap-2"
    >
      {Array.from({ length: TILE_COUNT }).map((_, i) => (
        <LiveTile key={i} index={i} glyph={TILE_GLYPHS[i]!} />
      ))}
      {/* Vignette so the grid melts into the aurora instead of squaring off. */}
      <span className="pointer-events-none absolute inset-0 [background:radial-gradient(ellipse_at_center,transparent_55%,rgba(8,8,14,0.65)_100%)]" />
    </div>
  );
}

const rise: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE_OUT } },
};

export interface AuthShellProps {
  /** Form column. */
  children: React.ReactNode;
  /** Headline shown above the live grid on large screens. */
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
            {/* Live-now caption — decorative dot pulses with one of the LIVE tiles. */}
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
          </motion.div>

          <motion.div variants={rise}>
            <LiveGrid />
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
