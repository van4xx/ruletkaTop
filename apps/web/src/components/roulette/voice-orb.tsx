'use client';

/**
 * "Aurora Orb" — the immersive voice visualizer (Layout B for /voice).
 *
 * A large centred sphere of light that *breathes with the peer's voice*: a
 * slowly-rotating conic+radial aurora gradient with a glassy inner highlight,
 * a blurred bloom behind it, and a radial frequency corona painted on an
 * overlaid <canvas>. All audio-reactivity is driven OUTSIDE React from the
 * {@link useVolumeMeter} refs inside a single rAF loop — exactly the technique
 * used by {@link VoiceVisualizer} — so it animates at 60fps with zero
 * re-renders. The peer's avatar sits recessed at the orb's centre so the orb
 * reads as an aura around them.
 *
 * A `compact` variant renders the local user as a tiny cyan "moon" companion.
 *
 * Honors `prefers-reduced-motion`: no rAF loop, no rotation — a static ring +
 * dim corona, so it never looks broken when motion is off.
 */
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Avatar } from '@ruletka/ui';
import { useVolumeMeter } from '@/hooks/roulette/use-volume-meter';
import { cn } from '@/lib/cn';

export interface VoiceOrbProps {
  stream: MediaStream | null;
  name: string;
  avatarUrl?: string | null;
  /** Accent tone: peer (violet→magenta) vs local (cyan→violet). */
  tone?: 'peer' | 'local';
  /** Render the tiny "moon" companion (used for the local self). */
  compact?: boolean;
  /**
   * Localized "speaking" caption (e.g. "говорит"). When provided (peer orb), a
   * subtle caption + sr-only status fades in while the stream is audibly
   * active. Omitted for the local moon.
   */
  speakingLabel?: string;
  className?: string;
}

/** Loudness above which we consider the peer to be "speaking" (caption cue). */
const SPEAKING_THRESHOLD = 0.06;

/** Per-tone corona gradient stops (CSS custom-property references). */
const CORONA = {
  peer: ['var(--color-neon-violet)', 'var(--color-neon-magenta)', 'var(--color-neon-cyan)'],
  local: ['var(--color-neon-cyan)', 'var(--color-neon-violet)'],
} as const;

export function VoiceOrb({
  stream,
  name,
  avatarUrl,
  tone = 'peer',
  compact = false,
  speakingLabel,
  className,
}: VoiceOrbProps) {
  const bands = compact ? 18 : 32;
  const { bandsRef, levelRef, activeRef } = useVolumeMeter(stream, bands);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const orbRef = useRef<HTMLDivElement>(null);
  const bloomRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  // A throttled (≈5Hz) "is speaking" flag for the centred caption + sr-only
  // status. We poll the refs rather than re-render per frame, so the 60fps
  // visuals stay re-render-free while the accessible cue still updates.
  const [speaking, setSpeaking] = useState(false);
  const wantCaption = Boolean(speakingLabel) && !compact;
  useEffect(() => {
    if (!wantCaption) return;
    const id = setInterval(() => {
      setSpeaking(activeRef.current === true && levelRef.current > SPEAKING_THRESHOLD);
    }, 200);
    return () => clearInterval(id);
  }, [wantCaption, activeRef, levelRef]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    const stops = CORONA[tone];

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    // ── Radial frequency corona ──────────────────────────────────────────
    // The 32 bands become spokes radiating from the centre around the rim, so
    // speech ripples as a soft halo (polar plot of the same data the bars use).
    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      ctx.clearRect(0, 0, w, h);

      const cx = w / 2;
      const cy = h / 2;
      const data = bandsRef.current;
      const n = data.length;
      // Inner radius = the orb rim; spokes grow outward from there.
      const baseR = Math.min(w, h) * 0.32;
      const amp = Math.min(w, h) * (compact ? 0.14 : 0.18);

      const grad = ctx.createLinearGradient(0, 0, w, h);
      const last = stops.length - 1;
      stops.forEach((c, i) => grad.addColorStop(last === 0 ? 0 : i / last, c));
      ctx.strokeStyle = grad;
      ctx.lineCap = 'round';
      ctx.lineWidth = compact ? 2 : Math.max(2, (Math.PI * 2 * baseR) / n / 2.4);

      // Mirror the bands across the full circle so the corona is symmetric
      // (n bands → 2n spokes), starting at the top and sweeping clockwise.
      const spokes = n * 2;
      for (let s = 0; s < spokes; s++) {
        const idx = s < n ? s : spokes - 1 - s;
        const v = reduceMotion ? 0.18 : (data[idx] ?? 0);
        const len = v * v * amp;
        if (len < 0.5 && !reduceMotion) continue;
        const a = (s / spokes) * Math.PI * 2 - Math.PI / 2;
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        const r0 = baseR;
        const r1 = baseR + len + (reduceMotion ? amp * 0.18 : 0);
        ctx.globalAlpha = reduceMotion ? 0.35 : 0.45 + Math.min(0.5, v * 1.2);
        ctx.beginPath();
        ctx.moveTo(cx + cos * r0, cy + sin * r0);
        ctx.lineTo(cx + cos * r1, cy + sin * r1);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      if (!reduceMotion) raf = requestAnimationFrame(draw);
    };

    // ── Breathing orb + bloom (driven from the level, outside React) ──────
    let breatheRaf = 0;
    const breathe = () => {
      const level = reduceMotion ? 0.0 : levelRef.current;
      const orb = orbRef.current;
      const bloom = bloomRef.current;
      if (orb) {
        orb.style.transform = `scale(${1 + level * 0.1})`;
        // Louder passages skew the aurora a few degrees warmer (toward magenta).
        orb.style.filter = `hue-rotate(${(level * 18).toFixed(2)}deg)`;
      }
      if (bloom) {
        bloom.style.transform = `scale(${1 + level * 0.35})`;
        bloom.style.opacity = String(0.4 + level * 0.5);
      }
      if (!reduceMotion) breatheRaf = requestAnimationFrame(breathe);
    };

    if (reduceMotion) {
      draw();
      breathe();
    } else {
      raf = requestAnimationFrame(draw);
      breatheRaf = requestAnimationFrame(breathe);
    }

    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(breatheRaf);
      ro.disconnect();
    };
  }, [tone, compact, reduceMotion, bandsRef, levelRef]);

  // Conic aurora + soft inner highlight that gives the orb planet-like sphericity.
  const auroraFill =
    tone === 'peer'
      ? 'conic-gradient(from 0deg, var(--color-neon-violet), var(--color-neon-magenta), var(--color-neon-cyan), var(--color-neon-violet))'
      : 'conic-gradient(from 0deg, var(--color-neon-cyan), var(--color-neon-violet), var(--color-neon-cyan))';

  if (compact) {
    // The local "moon": a tiny companion orb, no avatar/label chrome.
    return (
      <div
        className={cn('relative grid h-14 w-14 place-items-center', className)}
        role="img"
        aria-label={name}
      >
        <div
          ref={bloomRef}
          aria-hidden="true"
          className="absolute inset-0 rounded-full bg-[radial-gradient(circle,var(--color-neon-cyan),transparent_70%)] blur-lg will-change-transform"
          style={{ opacity: 0.4 }}
        />
        <canvas ref={canvasRef} aria-hidden="true" className="absolute inset-0 h-full w-full" />
        {/* orbRef carries the breathing scale (inline transform); the inner
            child owns the rotation so the two transforms don't collide. */}
        <div ref={orbRef} aria-hidden="true" className="relative h-9 w-9 will-change-transform">
          <div
            className={cn(
              'h-full w-full overflow-hidden rounded-full',
              !reduceMotion && 'motion-safe:animate-[orb-spin_28s_linear_infinite]',
            )}
            style={{ backgroundImage: auroraFill }}
          >
            <span className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_32%_28%,rgba(255,255,255,0.6),transparent_55%)]" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ scale: 0.92, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        'relative grid aspect-square w-[clamp(16rem,42vmin,22rem)] place-items-center',
        className,
      )}
    >
      {/* Outer bloom — a blurred duplicate that inflates when the peer talks. */}
      <div
        ref={bloomRef}
        aria-hidden="true"
        className={cn(
          'absolute inset-[-12%] rounded-full blur-2xl will-change-transform',
          tone === 'peer'
            ? 'bg-[radial-gradient(circle,var(--color-neon-magenta),transparent_68%)]'
            : 'bg-[radial-gradient(circle,var(--color-neon-cyan),transparent_68%)]',
        )}
        style={{ opacity: 0.4 }}
      />

      {/* Radial frequency corona, painted over the orb. */}
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-[-8%] h-[116%] w-[116%]"
      />

      {/* The orb body. orbRef carries the breathing scale + hue-rotate (inline
          transform/filter); the inner child owns the slow rotation so the two
          transforms never collide. */}
      <div
        ref={orbRef}
        aria-hidden="true"
        className="absolute inset-0 rounded-full will-change-transform"
      >
        <div
          className={cn(
            'h-full w-full overflow-hidden rounded-full',
            'shadow-[inset_0_0_60px_rgba(0,0,0,0.55)]',
            !reduceMotion && 'motion-safe:animate-[orb-spin_24s_linear_infinite]',
          )}
          style={{ backgroundImage: auroraFill }}
        >
          {/* Inner radial highlight → planet-like sphericity. */}
          <span className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_34%_28%,rgba(255,255,255,0.55),rgba(255,255,255,0.08)_40%,transparent_62%)]" />
          {/* Darken the lower rim so it reads as a lit sphere. */}
          <span className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_66%_78%,rgba(0,0,0,0.45),transparent_55%)]" />
        </div>
      </div>

      {/* Avatar inset at the orb's centre, slightly recessed. */}
      <div className="relative grid h-[58%] w-[58%] place-items-center rounded-full shadow-[inset_0_2px_18px_rgba(0,0,0,0.6)]">
        <Avatar
          size="xl"
          src={avatarUrl ?? undefined}
          alt={name}
          ring="aurora"
          className="h-full w-full"
        />
      </div>

      {/* "Speaking" caption — fades in over the orb's lower rim while the peer
          is audibly active. Visual only; the sr-only status below is the
          accessible source of truth. */}
      {wantCaption && (
        <AnimatePresence>
          {speaking && (
            <motion.span
              key="speaking"
              aria-hidden="true"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="glass-panel pointer-events-none absolute bottom-[6%] rounded-full px-3 py-1 text-xs font-medium text-foreground"
            >
              {speakingLabel}
            </motion.span>
          )}
        </AnimatePresence>
      )}

      {/* SR-only live status so screen-reader users know who is speaking. */}
      <span className="sr-only" role="status">
        {wantCaption && speaking ? `${name}: ${speakingLabel}` : name}
      </span>
    </motion.div>
  );
}
