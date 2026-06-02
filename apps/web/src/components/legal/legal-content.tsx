'use client';

/**
 * Long-form "prose" primitives for the legal/info pages (Правила, Политика,
 * Помощь, О проекте). They render the brand's typographic voice — Unbounded
 * display headings, Manrope body, neon rules — without pulling in a Markdown
 * dependency. Section headings register themselves with the surrounding
 * {@link LegalLayout} so the table-of-contents + scroll-spy stay in sync.
 *
 * Each {@link Section} is a scroll target (its `id` anchors the TOC). On mount a
 * staggered fade-in plays once per section as it enters the viewport.
 */
import type { ReactNode } from 'react';
import { motion, type Variants } from 'framer-motion';
import { cn } from '@/lib/cn';

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

const sectionRise: Variants = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE_OUT } },
};

/** A top-level, anchorable section with a numbered neon heading. */
export function Section({
  id,
  index,
  title,
  children,
}: {
  id: string;
  /** 1-based ordinal shown in the heading chip. */
  index: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <motion.section
      id={id}
      // Anchor offset so the sticky header doesn't cover the heading on jump.
      className="scroll-mt-28"
      variants={sectionRise}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: '-80px' }}
    >
      <h2 className="group flex items-baseline gap-3 font-display text-2xl font-bold tracking-tight">
        <span
          aria-hidden="true"
          className="inline-flex h-7 w-7 shrink-0 translate-y-0.5 items-center justify-center rounded-lg bg-primary/12 font-sans text-sm font-bold text-primary ring-1 ring-primary/20"
        >
          {index}
        </span>
        <a href={`#${id}`} className="hover:text-foreground">
          {title}
          <span className="ml-2 text-base font-normal text-muted-foreground/0 transition-colors group-hover:text-muted-foreground/60">
            #
          </span>
        </a>
      </h2>
      <div className="mt-4 space-y-4 leading-relaxed text-muted-foreground">{children}</div>
    </motion.section>
  );
}

/** A standard paragraph (slightly larger, comfortable measure). */
export function P({ children }: { children: ReactNode }) {
  return <p className="text-[0.975rem] leading-7 text-muted-foreground sm:text-base">{children}</p>;
}

/** A minor sub-heading inside a section. */
export function H3({ children }: { children: ReactNode }) {
  return (
    <h3 className="pt-2 font-display text-base font-semibold tracking-tight text-foreground">
      {children}
    </h3>
  );
}

/** Bulleted list with neon ticks. */
export function List({
  items,
  variant = 'check',
}: {
  items: ReactNode[];
  /** `check` = cyan tick (allowed), `cross` = magenta cross (prohibited), `dot` = neutral. */
  variant?: 'check' | 'cross' | 'dot';
}) {
  const marker =
    variant === 'check'
      ? 'before:bg-[var(--color-neon-cyan)]'
      : variant === 'cross'
        ? 'before:bg-[var(--color-neon-magenta)]'
        : 'before:bg-muted-foreground/50';
  return (
    <ul className="space-y-2.5">
      {items.map((item, i) => (
        <li
          key={i}
          className={cn(
            'relative pl-6 text-[0.975rem] leading-7 text-muted-foreground sm:text-base',
            "before:absolute before:left-0 before:top-[0.7em] before:h-1.5 before:w-1.5 before:rounded-full before:content-['']",
            marker,
          )}
        >
          {item}
        </li>
      ))}
    </ul>
  );
}

/** A highlighted callout for important notices (e.g. 18+, deletion rights). */
export function Callout({
  children,
  tone = 'info',
  icon,
}: {
  children: ReactNode;
  tone?: 'info' | 'warning';
  icon?: ReactNode;
}) {
  return (
    <div
      className={cn(
        'glass-panel flex gap-3 rounded-2xl p-4',
        tone === 'warning'
          ? 'border-warning/30 bg-warning/[0.06]'
          : 'border-primary/25 bg-primary/[0.05]',
      )}
    >
      {icon && (
        <span
          className={cn(
            'mt-0.5 shrink-0',
            tone === 'warning' ? 'text-warning' : 'text-[var(--color-neon-cyan)]',
          )}
          aria-hidden="true"
        >
          {icon}
        </span>
      )}
      <div className="space-y-1.5 text-sm leading-6 text-foreground/90">{children}</div>
    </div>
  );
}

/** A definition row (term → description), used for FAQ-style and PII tables. */
export function DefinitionList({ items }: { items: { term: ReactNode; desc: ReactNode }[] }) {
  return (
    <dl className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/60">
      {items.map((it, i) => (
        <div key={i} className="grid gap-1 bg-card/30 p-4 sm:grid-cols-[minmax(0,14rem)_1fr] sm:gap-4">
          <dt className="font-medium text-foreground">{it.term}</dt>
          <dd className="text-sm leading-6 text-muted-foreground">{it.desc}</dd>
        </div>
      ))}
    </dl>
  );
}
