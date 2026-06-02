'use client';

/**
 * Shared chrome for the economy route group: an atmospheric, aurora-lit hero
 * header with an optional eyebrow, title, lede, and a right-aligned actions
 * slot (e.g. the live balance pill). Keeps the four economy pages visually
 * cohesive without each re-implementing the background.
 */
import type { ReactNode } from 'react';
import { motion, type Variants } from 'framer-motion';
import { cn } from '@/lib/cn';

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

const rise: Variants = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: EASE_OUT } },
};

export interface EconomyShellProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  lede?: ReactNode;
  /** Right-aligned header content (balance pill, secondary CTA, …). */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function EconomyShell({ eyebrow, title, lede, actions, children, className }: EconomyShellProps) {
  return (
    <div className="grain relative overflow-hidden">
      {/* Atmospheric background — layered aurora glows + a faint grid. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-48 left-1/2 h-[34rem] w-[34rem] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,var(--color-neon-violet)_0%,transparent_60%)] opacity-20 blur-3xl" />
        <div className="absolute -right-28 top-24 h-[26rem] w-[26rem] rounded-full bg-[radial-gradient(circle,var(--color-neon-magenta)_0%,transparent_60%)] opacity-15 blur-3xl" />
        <div className="absolute -left-28 top-72 h-[24rem] w-[24rem] rounded-full bg-[radial-gradient(circle,var(--color-neon-cyan)_0%,transparent_60%)] opacity-15 blur-3xl" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,var(--color-border)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-border)_1px,transparent_1px)] bg-[size:64px_64px] opacity-[0.12] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />
      </div>

      <section className={cn('mx-auto max-w-7xl px-4 pb-20 pt-12 sm:px-6 sm:pt-16 lg:px-8', className)}>
        <motion.header
          variants={rise}
          initial="hidden"
          animate="show"
          className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between"
        >
          <div className="max-w-2xl">
            {eyebrow && (
              <span className="glass-panel mb-4 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium text-muted-foreground">
                {eyebrow}
              </span>
            )}
            <h1 className="font-display text-3xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl">
              {title}
            </h1>
            {lede && <p className="mt-4 text-balance text-base text-muted-foreground sm:text-lg">{lede}</p>}
          </div>
          {actions && <div className="shrink-0">{actions}</div>}
        </motion.header>

        <div className="mt-10 sm:mt-12">{children}</div>
      </section>
    </div>
  );
}
