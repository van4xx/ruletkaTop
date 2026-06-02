'use client';

/**
 * Shared chrome for the four legal/info pages (/rules, /privacy, /help,
 * /about). Provides:
 *  - the brand's atmospheric hero (aurora glows + grain + grid),
 *  - an eyebrow / gradient title / lede / "last updated" meta block,
 *  - a two-column reading layout: a sticky table-of-contents rail (desktop)
 *    with scroll-spy, and the long-form prose column.
 *
 * The TOC is keyboard-navigable and reflects the section currently in view via
 * an IntersectionObserver. On mobile the TOC collapses into a compact, scrollable
 * chip row pinned under the header.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { motion, type Variants } from 'framer-motion';
import { cn } from '@/lib/cn';

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

const rise: Variants = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: EASE_OUT } },
};

export interface TocEntry {
  id: string;
  label: string;
}

export interface LegalLayoutProps {
  eyebrow: ReactNode;
  title: ReactNode;
  lede: ReactNode;
  /** ISO-ish display string, e.g. "1 июня 2026". */
  updatedAt?: string;
  toc: TocEntry[];
  children: ReactNode;
}

/** Tracks which section heading is currently nearest the top of the viewport. */
function useScrollSpy(ids: string[]): string | null {
  const [active, setActive] = useState<string | null>(ids[0] ?? null);
  // Stable dependency: re-subscribe only when the *set* of ids changes, not on
  // every render (the caller passes a freshly-mapped array each time).
  const key = ids.join('|');

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined' || ids.length === 0) return;
    const elements = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => Boolean(el));

    const visible = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.set(entry.target.id, entry.intersectionRatio);
          else visible.delete(entry.target.id);
        }
        // Pick the topmost visible section (falls back to last passed one).
        let best: string | null = null;
        for (const id of ids) {
          if (visible.has(id)) {
            best = id;
            break;
          }
        }
        if (best) setActive(best);
      },
      // Bias the "active" zone to the upper third of the viewport.
      { rootMargin: '-15% 0px -70% 0px', threshold: [0, 0.25, 0.5, 1] },
    );

    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
    // `key` encodes the id set; `ids` is intentionally read but excluded to
    // avoid re-subscribing on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return active;
}

export function LegalLayout({ eyebrow, title, lede, updatedAt, toc, children }: LegalLayoutProps) {
  const ids = toc.map((t) => t.id);
  const active = useScrollSpy(ids);
  const mobileNavRef = useRef<HTMLDivElement>(null);

  // Keep the active chip in view on the mobile TOC rail.
  useEffect(() => {
    if (!active || !mobileNavRef.current) return;
    const chip = mobileNavRef.current.querySelector<HTMLAnchorElement>(`[data-toc="${active}"]`);
    chip?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, [active]);

  return (
    <div className="grain relative overflow-hidden">
      {/* Atmospheric background. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-48 left-1/2 h-[34rem] w-[34rem] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,var(--color-neon-violet)_0%,transparent_60%)] opacity-[0.18] blur-3xl" />
        <div className="absolute -right-28 top-24 h-[26rem] w-[26rem] rounded-full bg-[radial-gradient(circle,var(--color-neon-cyan)_0%,transparent_60%)] opacity-[0.12] blur-3xl" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,var(--color-border)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-border)_1px,transparent_1px)] bg-[size:64px_64px] opacity-[0.1] [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]" />
      </div>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-4 pb-2 pt-12 sm:px-6 sm:pt-16 lg:px-8">
        <motion.header variants={rise} initial="hidden" animate="show" className="max-w-3xl">
          <span className="glass-panel mb-4 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium text-muted-foreground">
            {eyebrow}
          </span>
          <h1 className="font-display text-3xl font-extrabold leading-[1.06] tracking-tight sm:text-5xl">
            {title}
          </h1>
          <p className="mt-4 text-balance text-base text-muted-foreground sm:text-lg">{lede}</p>
          {updatedAt && (
            <p className="mt-4 text-xs text-muted-foreground/70">
              Последнее обновление: <time>{updatedAt}</time>
            </p>
          )}
        </motion.header>
      </section>

      {/* Mobile TOC — horizontal chip rail, sticky under the site header. */}
      <nav
        aria-label="Содержание"
        className="sticky top-16 z-30 mt-6 border-y border-border/60 bg-background/70 backdrop-blur lg:hidden"
      >
        <div
          ref={mobileNavRef}
          className="mx-auto flex max-w-6xl gap-2 overflow-x-auto px-4 py-3 sm:px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {toc.map((t) => (
            <a
              key={t.id}
              href={`#${t.id}`}
              data-toc={t.id}
              aria-current={active === t.id ? 'true' : undefined}
              className={cn(
                'shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors',
                active === t.id
                  ? 'bg-primary/15 text-foreground ring-1 ring-primary/40'
                  : 'bg-card/50 text-muted-foreground ring-1 ring-border/60',
              )}
            >
              {t.label}
            </a>
          ))}
        </div>
      </nav>

      {/* Reading area */}
      <section className="mx-auto max-w-6xl px-4 pb-24 pt-10 sm:px-6 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-[16rem_1fr] lg:gap-14">
          {/* Desktop sticky TOC */}
          <aside className="hidden lg:block">
            <nav aria-label="Содержание" className="sticky top-24">
              <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Содержание
              </p>
              <ul className="space-y-0.5 border-l border-border/60">
                {toc.map((t) => {
                  const isActive = active === t.id;
                  return (
                    <li key={t.id}>
                      <a
                        href={`#${t.id}`}
                        aria-current={isActive ? 'true' : undefined}
                        className={cn(
                          '-ml-px block border-l-2 py-1.5 pl-4 text-sm transition-colors',
                          isActive
                            ? 'border-[var(--color-neon-violet)] font-medium text-foreground'
                            : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
                        )}
                      >
                        {t.label}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </nav>
          </aside>

          {/* Prose column */}
          <div className="min-w-0 max-w-2xl space-y-12">{children}</div>
        </div>
      </section>
    </div>
  );
}
