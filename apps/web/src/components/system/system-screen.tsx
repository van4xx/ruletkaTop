'use client';

/**
 * Shared atmospheric shell for full-page system states (404, error). Centers a
 * glassy card over the brand's aurora background with a large gradient glyph,
 * keeping these utility screens as polished as the landing page.
 */
import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/cn';

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

export function SystemScreen({
  code,
  icon,
  title,
  description,
  actions,
  children,
  /** Tints the glow + glyph; defaults to brand violet. */
  tone = 'brand',
}: {
  /** Big watermark code/label behind the glyph (e.g. "404"). Optional. */
  code?: string;
  icon: ReactNode;
  title: ReactNode;
  description: ReactNode;
  actions?: ReactNode;
  /** Optional extra content rendered below the actions (e.g. an error digest). */
  children?: ReactNode;
  tone?: 'brand' | 'danger';
}) {
  const glowColor =
    tone === 'danger' ? 'var(--color-destructive)' : 'var(--color-neon-violet)';

  return (
    <div className="grain relative flex min-h-[calc(100dvh-4rem)] items-center justify-center overflow-hidden px-4 py-16">
      {/* Atmospheric background. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div
          className="absolute left-1/2 top-1/2 h-[40rem] w-[40rem] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-[0.18] blur-3xl"
          style={{ background: `radial-gradient(circle, ${glowColor} 0%, transparent 60%)` }}
        />
        <div className="absolute -right-24 top-24 h-[24rem] w-[24rem] rounded-full bg-[radial-gradient(circle,var(--color-neon-cyan)_0%,transparent_60%)] opacity-[0.12] blur-3xl" />
        <div className="absolute -left-24 bottom-24 h-[24rem] w-[24rem] rounded-full bg-[radial-gradient(circle,var(--color-neon-magenta)_0%,transparent_60%)] opacity-[0.12] blur-3xl" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,var(--color-border)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-border)_1px,transparent_1px)] bg-[size:64px_64px] opacity-[0.12] [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6, ease: EASE_OUT }}
        className="relative w-full max-w-lg text-center"
      >
        {/* Watermark code. */}
        {code && (
          <span
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute -top-16 left-1/2 -z-10 -translate-x-1/2 select-none font-display font-extrabold leading-none tracking-tighter',
              'text-[9rem] sm:text-[12rem]',
              'bg-clip-text text-transparent opacity-[0.08]',
            )}
            style={{ backgroundImage: `linear-gradient(180deg, ${glowColor}, transparent)` }}
          >
            {code}
          </span>
        )}

        <div className="glass-panel rounded-3xl px-6 py-10 sm:px-10 sm:py-12">
          <span
            className={cn(
              'mx-auto inline-flex h-16 w-16 items-center justify-center rounded-2xl',
              tone === 'danger'
                ? 'bg-destructive/12 text-destructive ring-1 ring-destructive/25'
                : 'bg-primary/12 text-primary ring-1 ring-primary/25',
            )}
          >
            {icon}
          </span>
          <h1 className="mt-6 font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
            {title}
          </h1>
          <p className="mx-auto mt-3 max-w-md text-balance text-muted-foreground">{description}</p>
          {actions && (
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              {actions}
            </div>
          )}
          {children}
        </div>
      </motion.div>
    </div>
  );
}
