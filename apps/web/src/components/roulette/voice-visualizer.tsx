'use client';

/**
 * A canvas-based audio equalizer for the voice roulette. Renders mirrored
 * frequency bars in the brand neon gradient, animated at 60fps directly from a
 * {@link useVolumeMeter} reading (no React re-renders). A large avatar sits at
 * the centre with a glow ring that pulses with overall loudness.
 *
 * Honors `prefers-reduced-motion` by falling back to a static ring + bars.
 */
import { useEffect, useRef } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { Avatar } from '@ruletka/ui';
import { useVolumeMeter } from '@/hooks/roulette/use-volume-meter';
import { cn } from '@/lib/cn';

export interface VoiceVisualizerProps {
  stream: MediaStream | null;
  name: string;
  avatarUrl?: string | null;
  /** Subtitle under the name (e.g. country + age, or "вы"). */
  subtitle?: string;
  /** Accent tone: peer (magenta-violet) vs local (cyan). */
  tone?: 'peer' | 'local';
  /** Render a compact version (used for the local self-tile). */
  compact?: boolean;
  className?: string;
}

const NEON = {
  peer: ['var(--color-neon-violet)', 'var(--color-neon-magenta)'],
  local: ['var(--color-neon-cyan)', 'var(--color-neon-violet)'],
} as const;

export function VoiceVisualizer({
  stream,
  name,
  avatarUrl,
  subtitle,
  tone = 'peer',
  compact = false,
  className,
}: VoiceVisualizerProps) {
  const t = useTranslations('roulette');
  const bands = compact ? 18 : 32;
  const { bandsRef, levelRef, activeRef } = useVolumeMeter(stream, bands);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    const [c0, c1] = NEON[tone];

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

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      ctx.clearRect(0, 0, w, h);

      const data = bandsRef.current;
      const n = data.length;
      const gap = compact ? 3 : 5;
      const barW = (w - gap * (n - 1)) / n;
      const midY = h / 2;

      const grad = ctx.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, c0);
      grad.addColorStop(1, c1);
      ctx.fillStyle = grad;

      for (let i = 0; i < n; i++) {
        const v = reduceMotion ? 0.25 : (data[i] ?? 0);
        // Ease the bar height; keep a minimum so it never fully collapses.
        const barH = Math.max(compact ? 4 : 6, v * v * (h * 0.92));
        const x = i * (barW + gap);
        const y = midY - barH / 2;
        const r = Math.min(barW / 2, 4);
        // Rounded bar.
        ctx.beginPath();
        ctx.roundRect(x, y, barW, barH, r);
        ctx.fill();
      }

      if (!reduceMotion) raf = requestAnimationFrame(draw);
    };

    if (reduceMotion) {
      draw();
    } else {
      raf = requestAnimationFrame(draw);
    }

    // Drive the avatar glow ring from the level (outside React).
    let ringRaf = 0;
    const animateRing = () => {
      const el = ringRef.current;
      if (el) {
        const level = reduceMotion ? 0.4 : levelRef.current;
        const scale = 1 + level * 0.18;
        const opacity = 0.35 + Math.min(0.55, level * 1.4);
        el.style.transform = `scale(${scale})`;
        el.style.opacity = String(opacity);
      }
      if (!reduceMotion) ringRaf = requestAnimationFrame(animateRing);
    };
    if (reduceMotion) animateRing();
    else ringRaf = requestAnimationFrame(animateRing);

    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(ringRaf);
      ro.disconnect();
    };
  }, [tone, compact, reduceMotion, bandsRef, levelRef]);

  const avatarSize = compact ? 'lg' : 'xl';

  return (
    <div className={cn('relative flex flex-col items-center justify-center gap-4', className)}>
      {/* Avatar with pulsing glow ring */}
      <div className={cn('relative grid place-items-center', compact ? 'h-20 w-20' : 'h-36 w-36')}>
        <div
          ref={ringRef}
          aria-hidden="true"
          className={cn(
            'absolute inset-0 rounded-full blur-md transition-[transform,opacity] duration-150 will-change-transform',
            tone === 'peer'
              ? 'bg-[radial-gradient(circle,var(--color-neon-magenta),transparent_70%)]'
              : 'bg-[radial-gradient(circle,var(--color-neon-cyan),transparent_70%)]',
          )}
        />
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="relative"
        >
          <Avatar size={avatarSize} src={avatarUrl ?? undefined} alt={name} ring="aurora" />
        </motion.div>
      </div>

      {/* Equalizer */}
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className={cn('w-full', compact ? 'h-10' : 'h-20 max-w-md')}
      />

      {!compact && (
        <div className="text-center">
          <p className="font-display text-lg font-bold leading-tight">{name}</p>
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>
      )}

      {/* SR-only live status so screen-reader users know audio is active. */}
      <span className="sr-only" role="status">
        {activeRef.current ? t('voiceVisualizer.audioActive', { name }) : name}
      </span>
    </div>
  );
}
